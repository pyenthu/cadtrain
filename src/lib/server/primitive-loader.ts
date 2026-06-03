/**
 * primitive-loader — build a volume primitive's geom function from its
 * source, resolving its declared dependencies.
 *
 * COMPOSITION MODEL: a primitive may compose other primitives. It declares
 * them in its meta as `uses: ['cube', 'ball']`, then calls them by name in
 * its function body:
 *
 *     export const meta = { id:'r_cube_ball', uses:['cube','ball'], ... };
 *     export function r_cube_ball(size, ballDia) {
 *       return cube(size,size,size).subtract(ball(ballDia));
 *     }
 *
 * Resolution is DYNAMIC + runtime (there is no bundler/module graph): for
 * each `uses` id we read that primitive's `source.ts` from the volume
 * (proxy-aware via the passed `fetch` → /api/volume), transpile + execute
 * it (recursively resolving ITS uses), and inject the resulting geom
 * function into the sandbox by name — alongside the standard helper scope
 * (primitive-sandbox.ts). Bundle helpers (cyl, tube, …) resolve directly
 * and are already in scope, so a `uses` entry that names one is skipped
 * (no double-injection). Cycle-guarded.
 *
 * Mirrors what component-loader.ts does for library components, but for
 * the single-file volume-primitive sandbox.
 */
import { transformSync } from 'esbuild';
import * as helpers from '$lib/cad/manifold-helpers';
import { SANDBOX_ARG_NAMES, sandboxArgValues } from '$lib/cad/primitive-sandbox';
import { compileProfileBuild } from './profile-fn';
import { recognizeComposite } from './recognize-composite';
import { partHashId } from '$lib/cad/part-id';
import { paramKeysOf } from '$lib/cad/assembly-deps';

/**
 * Wrap each recognized named PART instance's init with `__tag(<init>,
 * <hashId>)` so its geometry carries a stable source id through CSG
 * (color-by-source — see part-id.ts). Operates on the ORIGINAL source
 * (recognizer offsets map to it) and splices in reverse offset order so
 * earlier edits don't shift later spans. Only "parts" (instances whose
 * call is a declared `uses` dependency) are tagged — a `resolveProfile`
 * local is skipped, and `__tag` is a no-op on non-Manifolds anyway.
 * Returns the source unchanged when recognition isn't position-mapped
 * (type-stripped) → falls back to a single uniform color.
 */
function tagInstanceSources(source: string): string {
  let rec: any;
  try { rec = recognizeComposite(source); } catch { return source; }
  if (!rec.editable || !Array.isArray(rec.instances) || !rec.instances.length) return source;
  const uses = new Set<string>(rec.uses ?? []);
  const targets = rec.instances
    .filter((i: any) => uses.has(i.call) && i.initStart >= 0 && i.initEnd > i.initStart)
    .sort((a: any, b: any) => b.initStart - a.initStart);
  let out = source;
  for (const inst of targets) {
    const id = partHashId(inst.name);
    out = out.slice(0, inst.initStart)
      + `__tag(${out.slice(inst.initStart, inst.initEnd)}, ${id})`
      + out.slice(inst.initEnd);
  }
  return out;
}

type GeomFn = (...args: any[]) => any;

const IMPORT_RE = /import\s+(?:type\s+)?(?:\{([^}]*)\})?\s*(?:from\s*)?['"]([^'"]+)['"]\s*;?/g;
function stripImports(src: string): string {
  let out = src;
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src)) !== null) out = out.replace(m[0], '');
  return out;
}

/** Pull declared dependency ids from `meta.uses: ['a', 'b']`. Regex over
 *  the source (independent of the full meta parser) — robust to whatever
 *  else the meta carries. */
export function usesOf(source: string): string[] {
  const m = /\buses\s*:\s*\[([^\]]*)\]/.exec(source);
  if (!m) return [];
  return [...m[1].matchAll(/['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]/g)].map((x) => x[1]);
}

function transpile(source: string): string {
  return transformSync(stripImports(source), { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
}

/**
 * Build a geom function from a primitive source string, resolving its
 * `meta.uses` dependencies and injecting them by name.
 *
 * @param fetchFn  SvelteKit `event.fetch` — used to read dep sources from
 *                 /api/volume (local FS on prod, proxied to prod in dev).
 */
export async function buildPrimitiveGeom(
  source: string,
  name: string,
  fetchFn: typeof fetch,
  visited: Set<string> = new Set(),
): Promise<GeomFn> {
  // Resolve declared deps. PARALLEL — composites had their deps resolved
  // one-at-a-time, so each dep's source.ts fetch (a prod round-trip in dev)
  // blocked the next.
  //
  // SANDBOX-COLLISION RESOLUTION (the tube/cyl/mv naming trap):
  //   Names like `tube`, `cyl`, `mv` exist as raw helpers in SANDBOX_ARG_NAMES
  //   AND can legitimately exist as user-authored volume primitives. The old
  //   filter dropped any volume dep matching a sandbox name — silently — so
  //   the raw helper won and the user's primitive was invisible at runtime.
  //   New behaviour: try to LOAD every declared dep; if the load fails AND
  //   the name is a sandbox helper, fall back silently (the raw helper takes
  //   over); if the load succeeds, the volume version wins via aliasing.
  //
  // DEDUPE: `new Function(...depNames, body)` throws "Invalid parameters … in
  // strict mode" on a duplicate param name. meta.uses can legitimately list
  // the same primitive twice (e.g. adding a 2nd r_extrude part), so we
  // de-dupe before the Function ctor.
  const declared = [...new Set(usesOf(source))];
  for (const dep of declared) {
    if (visited.has(dep)) {
      throw new Error(`circular primitive dependency: ${[...visited, dep].join(' → ')}`);
    }
  }
  const settled = await Promise.allSettled(
    declared.map((dep) => loadPrimitiveGeomById(dep, fetchFn, new Set([...visited, dep]))),
  );
  // Partition into loaded (volume hit) vs deferred-to-sandbox (sandbox helper
  // takes over). A failed load for a name that is NOT a sandbox helper is a
  // real error and gets re-thrown with the parent's name + chain attached so
  // the user can see WHICH part needed the missing dependency.
  const depNames: string[] = [];
  const depFns: GeomFn[] = [];
  for (let i = 0; i < declared.length; i++) {
    const dep = declared[i]!;
    const r = settled[i]!;
    if (r.status === 'fulfilled') {
      depNames.push(dep);
      depFns.push(r.value);
    } else if (!SANDBOX_ARG_NAMES.includes(dep)) {
      // Decorate the underlying "dependency primitive 'X' not found" with
      // the calling part's name, the full dep chain (parent → child),
      // and an action hint. Avoids the user seeing a bare "shaft not
      // found" with no clue what brought it in.
      const chain = visited.size
        ? [...visited, dep].join(' → ')
        : `${name} → ${dep}`;
      const inner = (r.reason as Error)?.message ?? String(r.reason);
      const looksMissing = /not found|HTTP 404/i.test(inner);
      const hint = looksMissing
        ? ` (the primitive doesn't exist on the volume — either restore it from the archive, drop it from "${name}"'s meta.uses if the body doesn't actually call it, or re-create it)`
        : '';
      throw new Error(`primitive "${name}" needs dependency "${dep}" but it failed to load: ${inner} [dep chain: ${chain}]${hint}`);
    }
    // else: defer to the sandbox helper of the same name (raw helper wins
    // when there's no volume primitive with this id).
  }

  let body = transpile(tagInstanceSources(source));
  // ALIAS POLICY — rewrite a dep's call sites in the body to a collision-proof
  // alias when any of:
  //   (a) the body declares a `const/let/var <dep>` shadowing the dep arg
  //       (older saves produced `const X = X()` — a temporal-dead-zone trap);
  //   (b) the dep name matches a SANDBOX_ARG_NAMES helper (tube / cyl / mv /
  //       …) — without an alias, `new Function(...SANDBOX_ARG_NAMES, dep,
  //       body)` throws "duplicate parameter" in strict mode AND the body's
  //       call site would otherwise resolve to the raw helper, not the user
  //       primitive.
  // Non-colliding deps are untouched (zero blast radius).
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const injectNames = [...depNames];
  depNames.forEach((dep, i) => {
    const constCollision = new RegExp(`\\b(?:const|let|var)\\s+${escapeRe(dep)}\\b`).test(body);
    const sandboxCollision = SANDBOX_ARG_NAMES.includes(dep);
    if (constCollision || sandboxCollision) {
      const alias = `__dep_${i}`;
      body = body.replace(new RegExp(`(?<![.\\w$])${escapeRe(dep)}\\s*\\(`, 'g'), `${alias}(`);
      injectNames[i] = alias;
    }
  });
  // Expose the part's params as `p.<name>` inside the geom function so a profile
  // or arg EXPRESSION can explicitly link to a top-level param (e.g. r: p.od).
  // The params are the function's positional args; bundle them into a `p` object
  // at the top of the body. Top params stay INDEPENDENT — a part links only if
  // its expression references p.<name> (bare <name> still resolves too).
  //
  // ROBUSTNESS: derive the bundle keys from META.PARAMS (the canonical schema)
  // instead of the function signature. Older / hand-authored assemblies sometimes
  // ship a `(p: any)` signature that doesn't match meta.params {od, id, length, …};
  // in that case the old regex extracted `p` as the ONLY positional name and
  // emitted `const p = { p }`, which collides with the parameter and throws
  // "Identifier 'p' has already been declared" before the body even runs.
  // The new pass:
  //   1. Reads meta.params for the canonical key list.
  //   2. Rewrites the function signature to those keys, in order — so the
  //      positional args the caller sends (one per meta.params row) actually
  //      bind to named locals the body can use.
  //   3. Injects `const _p = { …keys }` and aliases `const p = _p` ONLY when
  //      `p` isn't already a positional name (the rewritten signature decides).
  //      Either way the body's `p.X` works without a duplicate declaration.
  const metaKeys = paramKeysOf(source);
  // Detect object-arg style: signature `function id(p)` (single param, any
  // name). When detected, leave the signature ALONE — no rewrite, no `const p`
  // injection. The caller will pass a single object built from meta.params,
  // and the body uses `p.<key>` (or destructures) directly. Set during the
  // .replace pass; consumed by the adaptive `wrapped` boundary below.
  let isObjectStyle = false;
  // Be tolerant of a name MISMATCH between the requested primitive id and the
  // function declared in the source. Happens after a rename where the file
  // got renamed (e_tube.asm.ts) but the body still says `export function
  // my_assy(p)`. Without this, the regex below would miss, the signature
  // would never be rewritten or detected as object-style, and calls would
  // misbind. Resolve to the source's ACTUAL exported function name when the
  // requested id has no match.
  const reqMatchesBody = new RegExp(`function\\s+${escapeRe(name)}\\s*\\(`).test(body);
  let actualFnName = name;
  if (!reqMatchesBody) {
    const m = body.match(/(?:export\s+)?function\s+(\w+)\s*\(/);
    if (m) actualFnName = m[1]!;
  }
  body = body.replace(
    new RegExp(`function\\s+${escapeRe(actualFnName)}\\s*\\(([^)]*)\\)\\s*\\{`),
    (full: string, params: string) => {
      const sigNames = String(params).split(',').map((s) => s.trim().split(/[\s=:]/)[0].trim()).filter((n) => /^[a-zA-Z_$][\w$]*$/.test(n));
      // Single-positional + has meta.params keys → object-arg style. Leave
      // signature unchanged so `fn(obj)` binds obj to the function's `p`.
      if (sigNames.length === 1 && metaKeys.length > 0) {
        isObjectStyle = true;
        return full;
      }
      // Legacy positional path — rewrite signature to canonical positional
      // names so `fn(...args)` at the call site binds each `args[i]` to
      // `ns[i]` regardless of what the source happens to spell.
      const base = metaKeys.length ? metaKeys : sigNames;
      if (!base.length) return full;
      // PRESERVE TRAILING POSITIONAL ARGS — a function may declare params
      // BEYOND meta.params (e.g. r_weld_extrude has an optional
      // `scaleTopOverride` 7th arg that the part body passes but
      // meta.params doesn't surface in the GUI). Without this, the
      // rewritten signature drops those, and the body's reference to
      // `scaleTopOverride` throws "is not defined" at runtime.
      const extras = sigNames.slice(base.length).filter((n) => !base.includes(n));
      const ns = [...base, ...extras];
      const rewrittenHead = full.replace(/\(([^)]*)\)/, `(${ns.join(', ')})`);
      // Skip the `const p = …` line when `p` is already a positional name
      // (would shadow). If `p` is in meta.params (unusual but legal), the
      // bundling becomes a no-op and the user's `p` wins. The `const p`
      // bundle uses BASE keys only — extras (overrides) aren't exposed
      // as `p.X`.
      if (ns.includes('p')) return rewrittenHead;
      return `${rewrittenHead} const p = { ${base.join(', ')} };`;
    },
  );
  const wrapper = `"use strict";
    const module = { exports: {} };
    const exports = module.exports;
    const currentSegments = CIRCULAR_SEGMENTS_DEFAULT;
    ${body}
    return module.exports[${JSON.stringify(name)}]
        ?? Object.values(module.exports).find((v) => typeof v === 'function');`;

  const factory = new Function(...SANDBOX_ARG_NAMES, ...injectNames, wrapper);
  const argValues = await profileAwareArgValues(source, fetchFn);
  const fn = factory(...argValues, ...depFns);
  if (typeof fn !== 'function') {
    throw new Error(`primitive "${name}" did not export a function`);
  }
  // K.62 Phase E.1: lists-are-groups. When a geom fn returns an Array, treat
  // it as a topological compose group — recursively flatten any nested
  // arrays via place(). Lets assemblies be authored as `return [A, B, [C, D]]`
  // without explicit place(...) wrappers, matching the user's JSX-style
  // mental model ("a list IS place"). Manifold returns pass through unchanged.
  const autoPlace = (v: any): any => {
    if (Array.isArray(v)) {
      const placed = v.map(autoPlace);
      return helpers.place(placed);
    }
    return v;
  };
  // Adaptive call boundary — makes positional-style and object-style parts
  // interoperate without the caller having to know which style this fn uses.
  //
  // Possible inbound call shapes:
  //   * positional args (legacy /preview, legacy assembly calls): args = [4.5, 0.5, 5]
  //   * single object arg (new assembly calls): args = [{od: 4.5, wall: 0.5, length: 5}]
  //
  // Possible internal fn signatures:
  //   * object-style `function id(p)` (isObjectStyle = true) — expects ONE
  //     object arg.
  //   * positional `function id(od, wall, length)` (rewritten to metaKeys) —
  //     expects N args in metaKeys order.
  //
  // We bridge by detecting the single-object inbound shape and the fn's style,
  // then translating as needed. metaKeys is the ground truth for both
  // directions when present (canonical key list).
  const wrapped: GeomFn = (...args: any[]) => {
    const objectInbound = args.length === 1 && args[0] && typeof args[0] === 'object'
      && !Array.isArray(args[0]) && (args[0] as any).__cadtrain_manifold__ === undefined
      && !(args[0] as any).constructor?.name?.startsWith?.('Manifold');
    if (isObjectStyle) {
      // fn expects a single object. Pass through when already object; bundle
      // positional args into an object via metaKeys when not.
      const obj = objectInbound
        ? args[0]
        : Object.fromEntries(metaKeys.map((k, i) => [k, args[i]]));
      return autoPlace((fn as any)(obj));
    }
    // fn expects positional args. Pass through when already positional;
    // spread an object via metaKeys when single-object inbound.
    if (objectInbound && metaKeys.length > 0) {
      const positional = metaKeys.map((k) => (args[0] as any)[k]);
      return autoPlace((fn as any)(...positional));
    }
    return autoPlace((fn as any)(...args));
  };
  return wrapped;
}

// Dep-source cache. A composite preview fetches each `uses` dep's source.ts
// from the volume (proxied to prod in dev = a network round-trip). Without
// this, the Mesh build, the GLB bake, and EVERY param re-render each
// re-fetch the same leaves. Cache by id with a short TTL, caching the
// PROMISE so concurrent Mesh+GLB builds dedupe to ONE fetch. Leaves rarely
// change; the TTL bounds staleness (edit a dep → refreshes within the TTL).
const DEP_TTL_MS = 30_000;
const depSourceCache = new Map<string, { p: Promise<string>; ts: number }>();
function fetchDepSource(id: string, fetchFn: typeof fetch): Promise<string> {
  const hit = depSourceCache.get(id);
  if (hit && Date.now() - hit.ts < DEP_TTL_MS) return hit.p;
  const p = (async () => {
    // Resolve via the source endpoint, which is CATEGORY-AWARE (it walks
    // primitives/{basic,archive}/<id>/ and completions/<family>/
    // <id>/). Reading the flat primitives/<id>/source.ts directly broke
    // after the 2026-05-23 restructure moved parts into sub-folders.
    const r = await fetchFn(
      `/api/primitives/source?name=${encodeURIComponent(id)}`,
      { cache: 'no-store' },
    );
    if (!r.ok) throw new Error(`dependency primitive "${id}" not found on the volume (HTTP ${r.status})`);
    const data = await r.json();
    const src = typeof data?.source === 'string' ? data.source : '';
    if (!src) throw new Error(`dependency primitive "${id}" returned empty source`);
    return src;
  })().catch((e) => { depSourceCache.delete(id); throw e; });
  depSourceCache.set(id, { p, ts: Date.now() });
  return p;
}

// ── P6: VOLUME profile bake-resolve ─────────────────────────────────────────
// A part's `resolveProfile({kind})` resolves only CURATED kinds in-sandbox
// (sync). For a VOLUME function profile, pre-load its build here (server-side,
// volume access) and inject a resolveProfile that resolves volume kinds too —
// so editing/forking a profile in the editor actually drives its parts.
const PROF_TTL_MS = 30_000;
type ProfBuild = (pm?: Record<string, number>) => [number, number][];
const profFnCache = new Map<string, { p: Promise<ProfBuild | null>; ts: number }>();
function loadProfileBuild(id: string, fetchFn: typeof fetch): Promise<ProfBuild | null> {
  const hit = profFnCache.get(id);
  if (hit && Date.now() - hit.ts < PROF_TTL_MS) return hit.p;
  const p = (async () => {
    try {
      const r = await fetchFn(`/api/primitives/profiles/source?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!r.ok) return null;
      const d = await r.json();
      if (typeof d?.source !== 'string' || !d.source) return null;
      const build = compileProfileBuild(d.source);
      // Merge the profile's OWN param defaults (d.params — the schema returned
      // alongside the build-only source) UNDER the caller's params, mirroring the
      // curated resolveProfile (`build({ ...defaultsFor(def), ...d.params })`).
      // Without this, a part's `resolveProfile({kind})` with partial / no params
      // fed the volume build an empty object → undefined params → NaN coords →
      // "Not manifold". Only bit VOLUME profiles (curated already merged);
      // surfaced by the self-contained inline-profile parts (minimal params).
      const defaults: Record<string, number> = {};
      const ps = d.params && typeof d.params === 'object' ? d.params : {};
      for (const k of Object.keys(ps)) { const dv = ps[k]?.default; if (typeof dv === 'number') defaults[k] = dv; }
      return (params?: Record<string, number>) => build({ ...defaults, ...(params || {}) });
    } catch { return null; }
  })().catch(() => null);
  profFnCache.set(id, { p, ts: Date.now() });
  return p;
}
async function profileAwareArgValues(source: string, fetchFn: typeof fetch): Promise<any[]> {
  const values = sandboxArgValues();
  // ALL kinds. A VOLUME function profile WINS over the same-named curated kind
  // (consistent with the palette + editor): loadProfileBuild returns null when
  // no volume profile exists for the id, so curated kinds without a volume
  // override fall through to the in-sandbox curated resolveProfile below.
  // Extract string-literal `kind: '...'` from ANY `resolveProfile(` call,
  // independent of property order or nested braces inside the argument object.
  function kindsFromResolveProfileCalls(src: string): string[] {
    const calls: Array<{ callIndex: number; argsStart: number }> = [];
    const callRe = /resolveProfile\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(src)) !== null) {
      calls.push({ callIndex: m.index, argsStart: m.index + m[0].length });
      if (callRe.lastIndex === m.index) callRe.lastIndex++; // safety for zero-width matches
    }
    const out: string[] = [];
    for (let i = 0; i < calls.length; i++) {
      const { argsStart } = calls[i];
      const end = calls[i + 1]?.callIndex ?? src.length;
      const segment = src.slice(argsStart, end);
      const km = /\bkind\s*:\s*['"`]([a-z_$][\w$]*)['"`]/i.exec(segment);
      if (km) out.push(km[1]);
    }
    return [...new Set(out)];
  }
  const kinds = kindsFromResolveProfileCalls(source);
  if (!kinds.length) return values;
  const builds: Record<string, ProfBuild> = {};
  await Promise.all(kinds.map(async (k) => { const b = await loadProfileBuild(k, fetchFn); if (b) builds[k] = b; }));
  if (!Object.keys(builds).length) return values;
  const idx = SANDBOX_ARG_NAMES.indexOf('resolveProfile');
  if (idx < 0) return values;
  const curated = values[idx] as (d: any) => any;
  const out = [...values];
  out[idx] = (desc: any) => {
    const kind = desc && typeof desc === 'object' && !Array.isArray(desc) ? desc.kind : undefined;
    if (kind && builds[kind]) return builds[kind](desc.params ?? {});
    return curated(desc);
  };
  return out;
}

/** Resolve a primitive id → geom function.
 *
 *  Resolution order: VOLUME FIRST, bundle helper as fallback. A user who
 *  authors a volume primitive named `tube` (or `cyl`, `mv`, …) expects
 *  their primitive to win when something declares `uses: ['tube']` — the
 *  raw helpers are reachable transparently through the sandbox without
 *  ever appearing in `meta.uses` (CLAUDE.md Rule 20). The previous order
 *  silently shadowed the user's volume primitive when a same-named raw
 *  helper existed; this caused the nested-assembly tube collision bug. */
export async function loadPrimitiveGeomById(
  id: string,
  fetchFn: typeof fetch,
  visited: Set<string> = new Set(),
): Promise<GeomFn> {
  try {
    const src = await fetchDepSource(id, fetchFn);
    return await buildPrimitiveGeom(src, id, fetchFn, visited);
  } catch (e) {
    // No volume primitive with this id — fall back to a bundle helper if
    // one exists by the same name. (The catch path includes the build/
    // type errors too; re-throw those when there's no helper to fall back
    // to so the caller sees the real error instead of a silent miss.)
    const bundle = (helpers as any)[id];
    if (typeof bundle === 'function') return bundle as GeomFn;
    throw e;
  }
}
