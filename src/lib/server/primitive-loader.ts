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
import { createHash } from 'node:crypto';
import { transformSync } from 'esbuild';
import { ENGINE_HASH } from '$lib/graph/composition/engine-hash';
import * as helpers from '$lib/engines/manifold/manifold-helpers';
import { SANDBOX_ARG_NAMES, sandboxArgValues } from '$lib/graph/primitive/primitive-sandbox';
import { compileProfileBuild } from './profile-fn';
import { recognizeComposite } from './recognize-composite';
import { partHashId } from '$lib/graph/part/part-id';
import { paramKeysOf } from '$lib/graph/composition/param-keys';
import { extractMetaFromSource } from '$lib/server/primitives-meta';

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
 *
 * EXPORTED so the BREP executor (`brep-occt.ts`) can run the SAME tagged source
 * — its `__tag(shape, hashId)` records the part id on each OCCT solid, giving
 * BREP color-by-source at PARITY with the Manifold path (one tagging rule, no
 * drift). The hashIds it splices (`partHashId(instanceName)`) are exactly the
 * keys `analyzeParts` (part-colors) writes into the LUT, so a tag looks straight
 * up in `lut.outer`.
 */
export function tagInstanceSources(source: string): string {
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
    // __tagNest (not __tag): for a nested MULTI-PART assembly instance it PRESERVES the
    // callee's internal named sub-part runs, namespaced as partNestId(id, childId), so
    // a part's own materials survive one Call deeper (#947 — the packer-blob bug). For a
    // leaf instance (≤1 named run, or anonymous internal CSG) it collapses to `id`,
    // byte-identical to the old __tag. The render LUT recomputes the same partNestId.
    out = out.slice(0, inst.initStart)
      + `__tagNest(${out.slice(inst.initStart, inst.initEnd)}, ${id})`
      + out.slice(inst.initEnd);
  }
  return out;
}

type GeomFn = (...args: any[]) => any;

/** Result of the pure source→runnable-body rewrite step. The SAME object is
 *  consumed two ways:
 *   - `buildPrimitiveGeom` feeds `wrapper` + `injectNames` to `new Function`
 *     and INJECTS the resolved dep geom-functions positionally (unchanged
 *     server-executor behaviour);
 *   - `compilePrimitiveScript` feeds `body` + `injectNames` into a
 *     self-contained text IIFE and INLINES each dep as nested text instead.
 *  Extracting it keeps the (load-bearing, much-commented) signature-rewrite
 *  byte-identical across both paths — no drift. */
export interface AssembledBody {
  /** Rewritten + transpiled function body (signature canonicalised, deps
   *  aliased, `__tag` instance-tagging spliced). Does NOT include the
   *  `"use strict"` / module-exports wrapper. */
  body: string;
  /** The full `new Function` body: `"use strict"` + module/exports shims +
   *  `body` + the `return module.exports[name] ?? …` tail. */
  wrapper: string;
  /** Per-dep argument names, aligned to the caller-supplied `depNames`. A dep
   *  that collides with a sandbox helper or a body-local const is renamed to a
   *  `__dep_<i>` alias (and its call sites in `body` are rewritten to match). */
  injectNames: string[];
  /** Canonical meta.params key order (drives the adaptive call boundary). */
  metaKeys: string[];
  /** True when the part takes a single object arg (`function id(p)`), false for
   *  legacy positional signatures. */
  isObjectStyle: boolean;
}

/**
 * PURE source→body rewrite — the careful signature-rewriting half of
 * `buildPrimitiveGeom`, factored out so the server executor (inject dep
 * FUNCTIONS) and the client-script compiler (inline dep TEXT) share ONE
 * implementation and can never drift.
 *
 * Takes the ALREADY-PARTITIONED list of dependency names that resolved to a
 * volume source (`depNames`) — i.e. the deps that will be injected/inlined by
 * name. Bundle-helper deps (which stay in the sandbox scope) are NOT in this
 * list. No async, no I/O.
 *
 * `stripMetaFromBody` (compiler path only): drop the `export const meta = {…}`
 * block from the TRANSPILED body so the emitted text — and therefore the
 * script's sha256 — is invariant to meta-only churn (random NodeIds, layout,
 * whitespace), mirroring bake-cache's body-only hash philosophy. The schema
 * (paramKeysOf / extractMetaFromSource) is still read from the FULL `source`,
 * so behaviour is unchanged. The geom FUNCTION text is byte-identical either
 * way (meta is a dead sibling statement at runtime), so executor↔compiler
 * parity holds; the executor passes `false` → its body is unchanged.
 */
export function assemblePrimitiveBody(
  source: string,
  name: string,
  depNames: string[],
  stripMetaFromBody = false,
): AssembledBody {
  // Instance-tag on the FULL source (which still carries `meta.uses`) BEFORE any
  // meta strip — recognizeComposite needs `uses` to know which calls are parts.
  // #86: the compiler path (stripMetaFromBody=true) previously stripped meta
  // first, so `usesOf` saw nothing and NO `__tag(...)` was spliced → client
  // (client-exec) bakes carried no source IDs and color-by-source was impossible.
  // Tagging is name-based (`partHashId(instanceName)`), so it stays invariant to
  // meta churn — scriptHash is unaffected by meta-only edits, executor↔compiler
  // parity holds, and stripMetaBlock still removes the untouched meta block after.
  const tagged = tagInstanceSources(source);
  const toTranspile = stripMetaFromBody ? stripMetaBlock(tagged) : tagged;
  let body = transpile(toTranspile);
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
  // meta.params DEFAULTS, for the object-style default-merge below. A composed
  // body calls a sub-part as `g_dp_joint({ od_body, wall })` and omits the
  // rest; without this the sub-part's `p.od_collar` is `undefined` → NaN/empty
  // geometry deep in the chain (the g_dp_stand regression: omitted od_collar →
  // the pin collapsed → "stack item 3 EMPTY"). Merging the sub-part's own
  // defaults makes an omitted key fall back to its default, not undefined.
  let metaDefaults: Record<string, any> = {};
  try {
    const mp = (extractMetaFromSource(source) as any)?.params ?? {};
    for (const [k, v] of Object.entries(mp)) {
      if (v && typeof v === 'object' && 'default' in (v as any)) metaDefaults[k] = (v as any).default;
    }
  } catch { /* meta-less / unparseable → no defaults to merge */ }
  const defaultsLiteral = Object.entries(metaDefaults)
    .map(([k, dv]) => `${JSON.stringify(k)}: ${JSON.stringify(dv)}`)
    .join(', ');
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
      // signature unchanged so `fn(obj)` binds obj to the function's `p`, but
      // inject a default-merge: when `p` is a plain object (the call-with-named-
      // args path), fill any OMITTED meta.params key from this part's own
      // defaults so `p.X` is never `undefined`. Guarded so a positional/number
      // `p` (defensive) is left untouched.
      if (sigNames.length === 1 && metaKeys.length > 0) {
        isObjectStyle = true;
        if (!defaultsLiteral) return full;
        const pn = sigNames[0];
        // Default-merge for omitted named args (see comment above). ALSO warn on
        // UNKNOWN keys — a passed key that isn't in this part's meta.params is a
        // stale/misspelled arg (e.g. a dep renamed `len`→`length` but a consumer
        // still passes `len`). The merge would otherwise swallow it silently and
        // fall the real key back to its default with no error (the g_tube bug).
        const knownArr = `[${metaKeys.map((k) => JSON.stringify(k)).join(', ')}]`;
        return `${full} if (${pn} && typeof ${pn} === 'object' && !Array.isArray(${pn})) { var __known = ${knownArr}; for (var __k of Object.keys(${pn})) { if (__known.indexOf(__k) === -1) { try { console.warn("[primitive ${name}] unknown arg key '" + __k + "' (not in meta.params: " + __known.join(", ") + ") — ignored; a dep likely renamed this param"); } catch (e) {} } } ${pn} = { ${defaultsLiteral}, ...${pn} }; }`;
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
  return { body, wrapper, injectNames, metaKeys, isObjectStyle };
}

/** True for a meta.params key that controls circular tessellation resolution
 *  (engine primitives expose it as an explicit param, e.g. `segments`). Used by
 *  the coarse-bake clamp so an assembly's deps actually bake low-poly. */
function isSegmentKey(key: string): boolean {
  const k = key.toLowerCase();
  return k === 'segments' || k === 'segment' || k === 'seg' || k === 'segs'
    || k === 'nseg' || k === 'nsegments' || k === 'circularsegments'
    || k.endsWith('segments');
}

/** Compact one-line shape for an args list — used to annotate the
 *  `[in parent → dep(<shape>)]` suffix on a decorated dep error. Hides
 *  Manifold objects (huge) + truncates long arrays. */
function argShape(args: any[]): string {
  if (args.length === 0) return '';
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    const o = args[0];
    const keys = Object.keys(o).slice(0, 6);
    const body = keys.map((k) => {
      const v = (o as any)[k];
      if (v === null || v === undefined) return `${k}:${v}`;
      if (typeof v === 'number') return `${k}:${Number.isFinite(v) ? v : 'NaN'}`;
      if (typeof v === 'string') return `${k}:${JSON.stringify(v).slice(0, 24)}`;
      return `${k}:?`;
    }).join(',');
    return `{${body}${Object.keys(o).length > keys.length ? ',…' : ''}}`;
  }
  return args.slice(0, 6).map((a) =>
    typeof a === 'number' ? (Number.isFinite(a) ? String(a) : 'NaN') :
    typeof a === 'string' ? JSON.stringify(a).slice(0, 24) :
    a == null ? String(a) : '?',
  ).join(',');
}

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
 *  else the meta carries. Accepts BOTH unquoted (`uses: [...]`) AND
 *  quoted (`"uses": [...]`) property forms — JSON.stringify-emitted
 *  metas use quotes, and without the optional-quote sentinel the loader
 *  failed to resolve any deps and the body errored "X is not defined"
 *  at preview time. Mirrors paramKeysOf's quote-aware match in
 *  assembly-deps.ts. */
export function usesOf(source: string): string[] {
  const m = /["']?\buses\b["']?\s*:\s*\[([^\]]*)\]/.exec(source);
  if (!m) return [];
  return [...m[1].matchAll(/['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]/g)].map((x) => x[1]);
}

function transpile(source: string): string {
  return transformSync(stripImports(source), { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
}

/** Remove a top-level `export const meta = { … }` declaration (balanced-brace
 *  walk; tolerant of a `: Type` annotation and a trailing `;`). The meta block
 *  is dead weight at runtime — the wrapper returns the geom FUNCTION, never meta
 *  — so dropping it from the compiled script makes the script's hash invariant
 *  to meta-only churn (NodeIds / layout / whitespace). Used by the script
 *  compiler only; the executor keeps meta so its body stays byte-identical. */
function stripMetaBlock(source: string): string {
  const m = /export\s+const\s+meta\b[^={]*=\s*\{/.exec(source);
  if (!m) return source;
  const braceStart = source.indexOf('{', m.index + m[0].length - 1);
  if (braceStart < 0) return source;
  let depth = 0;
  let i = braceStart;
  for (; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  // Swallow an immediately-following `;` and trailing spaces/newline.
  while (i < source.length && (source[i] === ';' || source[i] === ' ' || source[i] === '\t')) i++;
  return source.slice(0, m.index) + source.slice(i);
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
      const inner = (r.reason as Error)?.message ?? String(r.reason);
      const looksMissing = /not found|HTTP 404/i.test(inner);
      // LOADER TOLERANCE: a dangling `meta.uses` entry whose primitive was
      // deleted is only FATAL if the body actually calls it. When the dep is
      // missing AND the body never invokes `dep(...)`, it's a stale leftover
      // (e.g. a renamed/replaced child) — skip it with a warning so the bake
      // still succeeds, instead of failing the whole part. `dep(` matches a
      // CALL but not the quoted `'dep'` string in meta.uses.
      const callRe = new RegExp('\\b' + dep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(');
      if (looksMissing && !callRe.test(source)) {
        console.warn(`[primitive ${name}] meta.uses lists "${dep}" but that primitive is missing AND the body never calls it — skipping the dangling ref (clean it from "${name}"'s meta.uses to silence this).`);
        continue; // not injected; the body doesn't reference it
      }
      // Decorate the underlying "dependency primitive 'X' not found" with
      // the calling part's name, the full dep chain (parent → child),
      // and an action hint. Avoids the user seeing a bare "shaft not
      // found" with no clue what brought it in.
      const chain = visited.size
        ? [...visited, dep].join(' → ')
        : `${name} → ${dep}`;
      const hint = looksMissing
        ? ` (the primitive doesn't exist on the volume — either restore it from the archive, drop it from "${name}"'s meta.uses if the body doesn't actually call it, or re-create it)`
        : '';
      throw new Error(`primitive "${name}" needs dependency "${dep}" but it failed to load: ${inner} [dep chain: ${chain}]${hint}`);
    }
    // else: defer to the sandbox helper of the same name (raw helper wins
    // when there's no volume primitive with this id).
  }

  // Pure source→body rewrite (signature canonicalisation + dep aliasing +
  // instance tagging). Extracted into assemblePrimitiveBody so the client-script
  // COMPILER (compilePrimitiveScript) reuses byte-identical text transforms —
  // the executor INJECTS dep functions here; the compiler INLINES dep text.
  const { wrapper, injectNames, metaKeys, isObjectStyle } = assemblePrimitiveBody(source, name, depNames);

  const factory = new Function(...SANDBOX_ARG_NAMES, ...injectNames, wrapper);
  const argValues = await profileAwareArgValues(source, fetchFn);
  // Decorate each dep-fn so a WASM crash (typically "memory access out of
  // bounds") thrown from inside its body comes out tagged with WHICH dep
  // blew up + the parent's name. Without this the user sees a bare
  // `primitive call failed: memory access out of bounds` with no idea
  // whether dt_box, dt_pin, or dt_joint produced the bad mesh.
  // Tag once at the top of the chain — nested decoration would prepend the
  // chain multiple times. Caller's catch in /api/primitives/preview
  // unwraps + returns the structured form.
  const decoratedDepFns = depFns.map((dfn, i) => {
    const dep = declared[i]!;
    return (...args: any[]) => {
      try { return dfn(...args); }
      catch (e: any) {
        const msg = String(e?.message ?? e ?? '');
        if (/\[in /.test(msg)) throw e;                                 // already tagged upstream
        const tagged = new Error(`${msg} [in ${name} → ${dep}(${argShape(args)})]`);
        (tagged as any).cause = e;
        (tagged as any).depChain = [name, dep];
        throw tagged;
      }
    };
  });
  const fn = factory(...argValues, ...decoratedDepFns);
  if (typeof fn !== 'function') {
    throw new Error(`primitive "${name}" did not export a function`);
  }
  // K.62 Phase E.1: lists-are-groups. When a geom fn returns an Array, treat
  // it as a topological compose group — recursively flatten any nested
  // arrays via place(). Lets assemblies be authored as `return [A, B, [C, D]]`
  // without explicit place(...) wrappers, matching the user's JSX-style
  // mental model ("a list IS place"). Manifold returns pass through unchanged.
  // SEPARATE-PARTS, and the compose is LAZY.
  //
  // `place()` is `M.compose`, and M.compose on OVERLAPPING bodies is a UNION:
  // measured, `compose(bigCyl, cylNestedInside)` returns exactly what
  // `big.add(small)` returns — the inner body is DESTROYED. (On disjoint bodies
  // it merely concatenates.) A well is the pathological case: every element sits
  // inside the open hole, so composing 16 elements collapsed them to the outer
  // hole alone — 510 tris, genus 0, the entire completion string gone.
  //
  // The list is therefore kept as SEPARATE parts (`_parts`), which is what the
  // renderer meshes (render-helpers `finalizeManifold`) and what a WarpNode's
  // `children[]` emit already assumes. The single composed body is still needed
  // when a PARENT does further CSG on a list-returning dep, or when a consumer
  // wants one merged mesh — so it is built ON DEMAND and memoised, never eagerly.
  // Reading `_parts` alone never pays for (nor is corrupted by) the union.
  const isManifoldLike = (p: any) =>
    !!p && (p.__isLazyPlace === true || typeof p.getMesh === 'function');

  const lazyPlace = (placed: any[]): any => {
    const ms = placed.filter(isManifoldLike);
    // 0 or 1 real bodies → nothing to fuse; place() is trivial and eager.
    if (ms.length <= 1) return helpers.place(placed);
    let composed: any = null;
    const force = () => (composed ??= helpers.place(placed));
    return new Proxy(Object.create(null), {
      get(_t, prop) {
        if (prop === '_parts') return ms;
        if (prop === '__isLazyPlace') return true;
        // Test/diagnostic hook: null until something forced the union.
        if (prop === '__composedOrNull') return composed;
        // `await someLazy` probes `.then`, and console/util inspection probes
        // symbols. Neither means "give me one merged body" — forcing a 16-way
        // union there would defeat the whole point.
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        const t = force();
        const v = t[prop];
        return typeof v === 'function' ? v.bind(t) : v;
      },
      set(_t, prop, value) {
        if (prop === '_parts' || prop === '__isLazyPlace') return true;
        force()[prop] = value;
        return true;
      },
      has(_t, prop) {
        if (prop === '_parts' || prop === '__isLazyPlace') return true;
        return prop in force();
      },
    });
  };

  // K.62 Phase E.1: lists-are-groups. When a geom fn returns an Array, treat
  // it as a topological compose group — recursively flatten any nested
  // arrays via place(). Lets assemblies be authored as `return [A, B, [C, D]]`
  // without explicit place(...) wrappers, matching the user's JSX-style
  // mental model ("a list IS place"). Manifold returns pass through unchanged.
  const autoPlace = (v: any): any => (Array.isArray(v) ? lazyPlace(v.map(autoPlace)) : v);
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
  // ── Coarse-bake segment clamp ───────────────────────────────────────────
  // When /preview activates a coarse SVG bake it sets a segment CAP (see
  // manifold-helpers.setCircularSegmentCap). Engine primitives (r_revolve /
  // r_tube / r_cylinder, …) take their circular-resolution as an explicit
  // `segments` PARAM and feed it straight to revolveProfile — they ignore the
  // module-global currentSegments AND the WASM global, so without this clamp
  // an assembly's circular geometry (which lives entirely inside those deps)
  // stays at full resolution even under the override. Here — at the single
  // call boundary every built part (top-level AND dep) passes through — we
  // clamp any `segments`-style param DOWN to the cap. Read at CALL time so the
  // cap is observed only while a coarse bake is in flight (deps execute
  // synchronously inside the parent's primFn, with the cap set).
  const segKeyIdx = metaKeys.findIndex(isSegmentKey);
  // Apply the segment levers to a value: clamp DOWN to `cap`, then RAISE UP to
  // `floor` (the cap can only lower a part's explicit segments; the floor lifts
  // a hard-coded low value so the SVG "high" drawing renders smooth bores). null
  // for either = inactive. Returns the adjusted value (or the original).
  const adjustSeg = (v: any, cap: number | null, floor: number | null): any => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return v;
    let nv = v;
    if (cap != null && nv > cap) nv = cap;
    if (floor != null && nv < floor) nv = floor;
    return nv;
  };
  const adjustSegInObj = (obj: any, cap: number | null, floor: number | null): any => {
    if (segKeyIdx < 0) return obj;
    const k = metaKeys[segKeyIdx]!;
    const nv = adjustSeg(obj?.[k], cap, floor);
    return nv === obj?.[k] ? obj : { ...obj, [k]: nv };
  };
  const adjustSegInArgs = (a: any[], cap: number | null, floor: number | null): any[] => {
    if (segKeyIdx < 0 || segKeyIdx >= a.length) return a;
    const nv = adjustSeg(a[segKeyIdx], cap, floor);
    if (nv === a[segKeyIdx]) return a;
    const out = a.slice();
    out[segKeyIdx] = nv;
    return out;
  };
  const wrapped: GeomFn = (...args: any[]) => {
    const cap = helpers.getCircularSegmentCap();
    const floor = helpers.getCircularSegmentFloor();
    const segActive = cap != null || floor != null;
    const objectInbound = args.length === 1 && args[0] && typeof args[0] === 'object'
      && !Array.isArray(args[0]) && (args[0] as any).__cadtrain_manifold__ === undefined
      && !(args[0] as any).constructor?.name?.startsWith?.('Manifold');
    if (isObjectStyle) {
      // fn expects a single object. Pass through when already object; bundle
      // positional args into an object via metaKeys when not.
      let obj = objectInbound
        ? args[0]
        : Object.fromEntries(metaKeys.map((k, i) => [k, args[i]]));
      if (segActive) obj = adjustSegInObj(obj, cap, floor);
      return autoPlace((fn as any)(obj));
    }
    // fn expects positional args. Pass through when already positional;
    // spread an object via metaKeys when single-object inbound.
    if (objectInbound && metaKeys.length > 0) {
      let positional = metaKeys.map((k) => (args[0] as any)[k]);
      if (segActive) positional = adjustSegInArgs(positional, cap, floor);
      return autoPlace((fn as any)(...positional));
    }
    const finalArgs = segActive ? adjustSegInArgs(args, cap, floor) : args;
    return autoPlace((fn as any)(...finalArgs));
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

/** A failure that says nothing about the dep itself — upstream down (5xx),
 *  rate-limited, or timed out. Worth ONE retry, and worth a message that doesn't
 *  accuse the part of not existing. Mirrors the same helper in /api/tf/compile. */
export function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}
export function fetchDepSource(id: string, fetchFn: typeof fetch): Promise<string> {
  const hit = depSourceCache.get(id);
  if (hit && Date.now() - hit.ts < DEP_TTL_MS) return hit.p;
  const p = (async () => {
    // Resolve via the source endpoint, which is CATEGORY-AWARE (it walks
    // primitives/{basic,archive}/<id>/ and completions/<family>/
    // <id>/). Reading the flat primitives/<id>/source.ts directly broke
    // after the 2026-05-23 restructure moved parts into sub-folders.
    // ONE retry on a transient upstream failure. In dev `/api/primitives/source`
    // proxies to the Railway origin, which serves 502 for the ~30s of every
    // redeploy — so a bake that happens to land mid-deploy died with a message
    // claiming the dep did "not found on the volume", which is simply false: the
    // dep exists, the upstream was down. Say which it is, and retry once.
    let r = await fetchFn(`/api/primitives/source?name=${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!r.ok && isTransientStatus(r.status)) {
      await new Promise((res) => setTimeout(res, 250));
      r = await fetchFn(`/api/primitives/source?name=${encodeURIComponent(id)}`, { cache: 'no-store' });
    }
    if (!r.ok) {
      throw new Error(isTransientStatus(r.status)
        ? `dependency primitive "${id}" could not be loaded — the volume is temporarily unavailable (HTTP ${r.status}, retried once). The part is probably fine; try again.`
        : `dependency primitive "${id}" not found on the volume (HTTP ${r.status})`);
    }
    const data = await r.json();
    const src = typeof data?.source === 'string' ? data.source : '';
    if (!src) throw new Error(`dependency primitive "${id}" returned empty source`);
    return src;
  })().catch((e) => { depSourceCache.delete(id); throw e; });
  depSourceCache.set(id, { p, ts: Date.now() });
  return p;
}

/** Test-only: drop the dep-source TTL cache so a test can simulate the cache
 *  expiring between two dep-source versions. No production caller. */
export function _resetDepSourceCacheForTest(): void {
  depSourceCache.clear();
}

// ── Dep-aware bake-cache key ────────────────────────────────────────────────
// The bake-cache key (bake-cache.ts) hashes only the PARENT's own body +
// params + options. A parent that composes `meta.uses` deps can be byte-
// identical while a DEP it calls changed → the cache returns the parent's
// STALE mesh ("deja-vu"). The fix: fold a hash of the resolved dep sources
// into the parent's key (depSourcesHash option). These helpers do the
// resolution — they reuse fetchDepSource's TTL promise-cache, so when
// buildPrimitiveGeom runs right after for the same part, the dep fetches
// dedupe to the same promises (≈ no extra network).

/**
 * Resolve the FULL TRANSITIVE set of a primitive's dependency sources, keyed
 * by id. Walks `meta.uses` recursively (the same resolution buildPrimitiveGeom
 * uses). Deps with no volume source — bundle helpers like `cyl` / `tube`,
 * whose source is baked into the build and never changes at runtime — are
 * skipped (a failed fetch ⇒ skip). Cycle- and re-visit-guarded.
 */
export async function collectDepSources(
  source: string,
  fetchFn: typeof fetch,
  acc: Map<string, string> = new Map(),
  visited: Set<string> = new Set(),
): Promise<Map<string, string>> {
  const declared = [...new Set(usesOf(source))];
  await Promise.all(declared.map(async (dep) => {
    if (visited.has(dep)) return;   // already resolved or attempted (cycle / shared dep)
    visited.add(dep);
    let src: string;
    try { src = await fetchDepSource(dep, fetchFn); }
    catch { return; }               // bundle helper / missing → no volume source to hash
    acc.set(dep, src);
    await collectDepSources(src, fetchFn, acc, visited);
  }));
  return acc;
}

/**
 * SHA-256 (hex, first 16 chars) of a primitive's resolved dependency sources,
 * sorted by id for determinism. Returns `undefined` when there are no
 * resolvable volume deps (a leaf part, or one whose only deps are bundle
 * helpers) — so passing it into BakeCacheOptions leaves the legacy cache key
 * byte-identical (hashBakeKey drops undefined option keys). Pair with the
 * `depSourcesHash` option in bake-cache.ts.
 */
export async function hashDepSources(
  source: string,
  fetchFn: typeof fetch,
): Promise<string | undefined> {
  const map = await collectDepSources(source, fetchFn);
  if (map.size === 0) return undefined;
  const h = createHash('sha256');
  for (const id of [...map.keys()].sort()) {
    h.update(id);
    h.update('\0');
    h.update(map.get(id)!);
    h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

// ── PR1: self-contained client SCRIPT compiler ──────────────────────────────
// `buildPrimitiveGeom` (the server EXECUTOR) resolves each `meta.uses` dep to a
// geom FUNCTION and INJECTS it positionally into `new Function(...)`. For the
// client-side executor we instead emit a single self-contained SCRIPT (text)
// that INLINES every transitive dep's code, so the client fetches nothing and
// bakes locally. Both paths share `assemblePrimitiveBody` → the load-bearing
// signature-rewriting is byte-identical → no drift.
//
// The script is meant to be run the SAME way the server runs `wrapper`:
//   new Function(...SANDBOX_ARG_NAMES, script)(...sandboxArgValues())  → geomFn
// i.e. the SANDBOX_ARG_NAMES helpers are injected exactly as today; only the
// deps move from injected-functions to inlined-text. Because the script folds
// in the resolved dep source, its sha256 changes whenever a dep changes — the
// "deja-vu" stale-bake bug becomes impossible by construction.

/** Runtime prelude inlined ONCE at the top of every compiled script. It ports
 *  the adaptive call boundary (`wrapped` in buildPrimitiveGeom) + segment-clamp
 *  + autoPlace to TEXT so each inlined part can wrap its raw fn identically.
 *  References ONLY sandbox names (`place`, optionally `getCircularSegmentCap`)
 *  — both resolved defensively so the script stays self-contained. */
const SCRIPT_PRELUDE = `
function __isSegmentKey(key) {
  var k = String(key).toLowerCase();
  return k === 'segments' || k === 'segment' || k === 'seg' || k === 'segs'
    || k === 'nseg' || k === 'nsegments' || k === 'circularsegments'
    || k.endsWith('segments');
}
function __adapt(fn, metaKeys, isObjectStyle) {
  var __place = (typeof place === 'function') ? place : function (v) { return v; };
  // LAZY compose - must mirror lazyPlace/autoPlace in this module's TS above.
  // M.compose UNIONS overlapping bodies (destroying inner ones), so the list is
  // kept as separate _parts and the merged body is built only on demand.
  // (No backticks in here: this whole block lives inside a template literal.)
  function __isManifoldLike(p) { return !!p && (p.__isLazyPlace === true || typeof p.getMesh === 'function'); }
  function __lazyPlace(placed) {
    var ms = placed.filter(__isManifoldLike);
    if (ms.length <= 1) return __place(placed);
    var composed = null;
    function force() { if (!composed) composed = __place(placed); return composed; }
    return new Proxy(Object.create(null), {
      get: function (_t, prop) {
        if (prop === '_parts') return ms;
        if (prop === '__isLazyPlace') return true;
        if (prop === '__composedOrNull') return composed;
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        var t = force(); var v = t[prop];
        return (typeof v === 'function') ? v.bind(t) : v;
      },
      set: function (_t, prop, value) {
        if (prop === '_parts' || prop === '__isLazyPlace') return true;
        force()[prop] = value; return true;
      },
      has: function (_t, prop) {
        if (prop === '_parts' || prop === '__isLazyPlace') return true;
        return prop in force();
      }
    });
  }
  function autoPlace(v) { return Array.isArray(v) ? __lazyPlace(v.map(autoPlace)) : v; }
  var segKeyIdx = metaKeys.findIndex(__isSegmentKey);
  function clampSegInObj(obj, cap) {
    if (segKeyIdx < 0) return obj;
    var k = metaKeys[segKeyIdx]; var v = obj && obj[k];
    if (typeof v === 'number' && isFinite(v) && v > cap) { var o = Object.assign({}, obj); o[k] = cap; return o; }
    return obj;
  }
  function clampSegInArgs(a, cap) {
    if (segKeyIdx < 0 || segKeyIdx >= a.length) return a;
    var v = a[segKeyIdx];
    if (typeof v === 'number' && isFinite(v) && v > cap) { var out = a.slice(); out[segKeyIdx] = cap; return out; }
    return a;
  }
  return function () {
    var args = Array.prototype.slice.call(arguments);
    var cap = (typeof getCircularSegmentCap === 'function') ? getCircularSegmentCap() : null;
    var objectInbound = args.length === 1 && args[0] && typeof args[0] === 'object'
      && !Array.isArray(args[0]) && args[0].__cadtrain_manifold__ === undefined
      && !(args[0].constructor && args[0].constructor.name && args[0].constructor.name.indexOf('Manifold') === 0);
    if (isObjectStyle) {
      var obj;
      if (objectInbound) { obj = args[0]; }
      else { obj = {}; for (var i = 0; i < metaKeys.length; i++) { obj[metaKeys[i]] = args[i]; } }
      if (cap != null) obj = clampSegInObj(obj, cap);
      return autoPlace(fn(obj));
    }
    if (objectInbound && metaKeys.length > 0) {
      var positional = metaKeys.map(function (k) { return args[0][k]; });
      if (cap != null) positional = clampSegInArgs(positional, cap);
      return autoPlace(fn.apply(null, positional));
    }
    var finalArgs = (cap != null) ? clampSegInArgs(args, cap) : args;
    return autoPlace(fn.apply(null, finalArgs));
  };
}`;

/**
 * Emit the IIFE EXPRESSION that evaluates (in the sandbox scope) to ONE part's
 * adapted geom fn, with every dependency inlined recursively as a nested IIFE.
 * Mirrors buildPrimitiveGeom's partition (volume-source deps inline; bundle
 * helpers stay sandbox-resolved) + cycle guard. `visited` tracks the current
 * PATH only (copied per branch) so a shared dep is inlined once per use, not
 * blocked — the script must contain all resolved code.
 */
async function emitInlinedPart(
  source: string,
  name: string,
  fetchFn: typeof fetch,
  visited: Set<string>,
): Promise<string> {
  const declared = [...new Set(usesOf(source))];
  for (const dep of declared) {
    if (visited.has(dep)) {
      throw new Error(`circular primitive dependency: ${[...visited, dep].join(' → ')}`);
    }
  }
  // Resolve each declared dep's SOURCE (volume hit) in parallel; a failed fetch
  // for a sandbox-helper name is fine (it stays a sandbox arg), otherwise error.
  const settled = await Promise.allSettled(
    declared.map((dep) => fetchDepSource(dep, fetchFn)),
  );
  const depNames: string[] = [];
  const depSources: string[] = [];
  for (let i = 0; i < declared.length; i++) {
    const dep = declared[i]!;
    const r = settled[i]!;
    if (r.status === 'fulfilled') {
      depNames.push(dep);
      depSources.push(r.value);
    } else if (!SANDBOX_ARG_NAMES.includes(dep)) {
      const inner = (r.reason as Error)?.message ?? String(r.reason);
      // LOADER TOLERANCE (mirror of buildPrimitiveGeom): a dangling meta.uses
      // entry that the body never calls is skipped, not fatal — so the COMPILED
      // client script matches the server bake on parts with stale refs.
      const callRe = new RegExp('\\b' + dep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(');
      if (/not found|HTTP 404/i.test(inner) && !callRe.test(source)) {
        console.warn(`[compile ${name}] meta.uses lists "${dep}" but it's missing AND never called — skipping the dangling ref.`);
        continue;
      }
      const chain = visited.size ? [...visited, dep].join(' → ') : `${name} → ${dep}`;
      throw new Error(`primitive "${name}" needs dependency "${dep}" but it failed to load: ${inner} [dep chain: ${chain}]`);
    }
    // else: bundle helper — stays in the sandbox scope, not inlined.
  }
  const { body, injectNames, metaKeys, isObjectStyle } = assemblePrimitiveBody(source, name, depNames, true);
  // Inline each loaded dep as a nested IIFE, bound to the SAME injectName the
  // body's (already-aliased) call sites reference.
  const depDecls: string[] = [];
  for (let i = 0; i < depNames.length; i++) {
    const inj = injectNames[i]!;
    const expr = await emitInlinedPart(depSources[i]!, depNames[i]!, fetchFn, new Set([...visited, depNames[i]!]));
    depDecls.push(`  const ${inj} = ${expr};`);
  }
  // Each part gets its OWN module/exports scope (mirrors the per-dep
  // `new Function` the executor uses) so nested IIFEs never collide.
  return `(function () {
  "use strict";
  const module = { exports: {} };
  const exports = module.exports;
  const currentSegments = CIRCULAR_SEGMENTS_DEFAULT;
${depDecls.join('\n')}
  ${body}
  const __fn = module.exports[${JSON.stringify(name)}] ?? Object.values(module.exports).find((v) => typeof v === 'function');
  if (typeof __fn !== 'function') throw new Error(${JSON.stringify(`primitive "${name}" did not export a function`)});
  return __adapt(__fn, ${JSON.stringify(metaKeys)}, ${isObjectStyle});
})()`;
}

export interface CompiledScript {
  /** Self-contained text. Run as
   *  `new Function(...SANDBOX_ARG_NAMES, script)(...sandboxArgValues())` to get
   *  the part's adapted geom fn (then call it with positional/object params). */
  script: string;
  /** sha256(script), hex. The script folds in resolved dep source, so this hash
   *  changes when ANY dep changes — the dep-aware cache key, for free. */
  scriptHash: string;
  /** Transitive volume-dep ids inlined into the script (deduped, sorted). */
  depNames: string[];
}

/**
 * Compile a primitive into a self-contained Manifold script + its sha256.
 * Resolves `meta.uses` transitively (reusing the loader's TTL dep-source cache)
 * and inlines every dep as text. Throws on a genuinely missing dep / cycle —
 * the /compile endpoint catches and reports supported:false (never-500).
 */
export async function compilePrimitiveScript(
  source: string,
  name: string,
  fetchFn: typeof fetch,
  engineHash: string = ENGINE_HASH,
): Promise<CompiledScript> {
  const rootExpr = await emitInlinedPart(source, name, fetchFn, new Set());
  const script = `${SCRIPT_PRELUDE}\nreturn ${rootExpr};\n`;
  // Fold the geometry-engine content hash into scriptHash (N4). The compiled
  // SCRIPT text does not include the injected engine helpers (manifold-mesh,
  // render-helpers, warp-spline, …) — they're sandbox args resolved at run
  // time — so a fix to one of them leaves `script` byte-identical. Because the
  // CLIENT IndexedDB bake key is `KERNEL_VERSION + scriptHash + …`, moving the
  // hash here busts the client cache automatically after an engine deploy, with
  // no manual KERNEL_VERSION bump and nothing to compute in the worker. The
  // script TEXT is unchanged (deps still fold in exactly as before), only its
  // hash advances. `engineHash` is a defaulted arg only so tests can drive two
  // engine states without editing real files. See src/lib/graph/engine-hash.ts.
  const scriptHash = createHash('sha256').update(`engine:${engineHash}\0`).update(script).digest('hex');
  const depMap = await collectDepSources(source, fetchFn);
  return { script, scriptHash, depNames: [...depMap.keys()].sort() };
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
