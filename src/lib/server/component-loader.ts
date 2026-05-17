/**
 * Library-component loader — transpile + execute a part's `component.ts`
 * that lives on the persistent volume under `library/<category>/<id>/`
 * (not the build-time `src/` tree, so Vite's `import.meta.glob` never
 * sees it). See `library.ts` for the directory model.
 *
 * The geom endpoint (`/api/components/geom`) calls `loadVolumeComponent(id)`
 * to get back `{ meta, geom }` for a library part, then runs the geom
 * server-side exactly like a bundled primitive.
 *
 * Security model — a volume `.ts` is untrusted code:
 *   - `parseImports` allowlists ONLY `'../manifold-helpers'`, `'.'` and
 *     `'./<sibling-id>'`. Anything else (`node:fs`, bare packages, `'..'`,
 *     parent traversal) throws before any execution.
 *   - all import lines are physically stripped from the source.
 *   - a denylist scan rejects `require(`, `process`, `globalThis`, dynamic
 *     `import(`, `eval(`, `Function(`, `child_process`, `__dirname`.
 *   - execution is via `new Function` (host realm — keeps `Manifold` class
 *     identity intact) with ONLY the manifold helpers + `defineGeom` +
 *     resolved sibling deps in scope. No `require`, no `process`, no module
 *     loader is reachable from the function body.
 */

import { readFile } from 'fs/promises';
import { createHash } from 'crypto';
import { transformSync } from 'esbuild';
import {
  M,
  cyl,
  tube,
  mv,
  rot,
  initManifold,
  setCircularSegmentMode,
  getCutBox,
  CIRCULAR_SEGMENTS_DEFAULT,
  CIRCULAR_SEGMENTS_COMPOSE,
} from '../cad/manifold-helpers';
import { defineGeom, geomById, metaById } from '../cad/components';
import type { GeomFn, PrimitiveMeta } from '../cad/components';
import { discoverHelpers } from '../cad/manifold-helpers-meta';

const HELPER_PROP_NAMES: Map<string, string[]> = new Map(
  discoverHelpers().map((h) => [h.name, h.props.map((p) => p.name)]),
);

/** Walk balanced parens starting at `i` (which points at the char AFTER
 *  the opening `(`). Returns the index of the matching `)`, or -1.
 *  Mirrors the client-side helper in src/routes/primitives/+page.svelte. */
function findMatchingParen(src: string, i: number): number {
  let depth = 1;
  let inS: '"' | "'" | '`' | null = null;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (inS) {
      if (c === '\\') { i += 2; continue; }
      if (c === inS) inS = null;
    } else {
      if (c === '"' || c === "'" || c === '`') inS = c as '"' | "'" | '`';
      else if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) return i; }
    }
    i++;
  }
  return -1;
}

/** Split a comma-separated arg list, respecting brackets / parens /
 *  strings. Returns the segments WITHOUT the separating commas. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  let inS: '"' | "'" | '`' | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inS) {
      if (c === '\\') { buf += c + (s[i + 1] ?? ''); i++; continue; }
      if (c === inS) inS = null;
      buf += c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inS = c as '"' | "'" | '`'; buf += c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; buf += c; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; buf += c; continue; }
    if (c === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim() !== '' || out.length > 0) out.push(buf);
  return out;
}

/** Replace every `<INST>.<prop>` reference in `src` with the raw arg
 *  value taken from the matching base declaration. Lets the user
 *  write live cross-instance refs in the editor (e.g.
 *  `B = mv(B, [A.length, 0, 0])`) without needing to snapshot at
 *  edit-time — A's current `length` value is inlined here, so the
 *  cascade is automatic on every re-execute.
 *
 *  Resolution rules:
 *    - helper instance (`A = tube(0.5, 0.4, 4)`): positional args are
 *      mapped to HELPER prop names from manifold-helpers-meta. So
 *      `A.h` → `4`.
 *    - component instance (`B = hollowCylinderGeom({ od: 4.5, ... })`):
 *      object-literal keys taken from the imported component's
 *      `meta.params`. So `B.od` → `4.5`.
 *  Unresolved refs (unknown instance, unknown prop) pass through
 *  unchanged — the WASM execution will throw a useful TypeError. */
function expandInstancePropRefs(
  src: string,
  deps: ParsedImports['deps'],
  resolveDep: DepResolver,
): string {
  // Map: import-alias (e.g. `hollowCylinderGeom`) → the imported
  // component's meta.params keys.
  const aliasParamKeys = new Map<string, Set<string>>();
  for (const { depId, specs } of deps) {
    let mod: LoadedComponent | undefined;
    try { mod = resolveDep(depId); } catch { continue; }
    const params = (mod?.meta as Record<string, unknown> | undefined)?.['params'];
    if (!params || typeof params !== 'object') continue;
    const keys = new Set(Object.keys(params as Record<string, unknown>));
    for (const s of specs) {
      // Only the `geom` import is relevant — that's the call-site name
      // users write in the body. Other exports (e.g. `meta`) don't
      // bind callable params.
      if (s.imported === 'geom') aliasParamKeys.set(s.local, keys);
    }
  }

  // Parse every base declaration: `(let|const) X = call(args)`.
  // Build instance → { propName: rawValue }.
  const propMap = new Map<string, Record<string, string>>();
  const baseRe = /\b(?:let|const)\s+([A-Z][A-Z0-9]*)\s*=\s*(\w+)\s*\(/g;
  for (const m of src.matchAll(baseRe)) {
    const inst = m[1];
    const callName = m[2];
    const argStart = m.index! + m[0].length;
    const argEnd = findMatchingParen(src, argStart);
    if (argEnd < 0) continue;
    const argText = src.slice(argStart, argEnd);
    const componentKeys = aliasParamKeys.get(callName);
    const props: Record<string, string> = {};
    if (componentKeys) {
      // Component call — parse `{ key: value, … }`.
      const trimmed = argText.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        const inner = trimmed.slice(1, -1);
        for (const seg of splitTopLevel(inner)) {
          const colon = seg.indexOf(':');
          if (colon < 0) continue;
          const k = seg.slice(0, colon).trim();
          const v = seg.slice(colon + 1).trim();
          if (k && componentKeys.has(k)) props[k] = v;
        }
      }
    } else {
      // Helper call — positional args mapped to HELPER prop names.
      const positional = splitTopLevel(argText);
      const propNames = HELPER_PROP_NAMES.get(callName) ?? [];
      for (let i = 0; i < Math.min(positional.length, propNames.length); i++) {
        const v = positional[i].trim();
        if (v) props[propNames[i]] = v;
      }
    }
    if (Object.keys(props).length > 0) propMap.set(inst, props);
  }

  if (propMap.size === 0) return src;

  // Multi-pass substitution to a fixpoint. A single .replace pass only
  // resolves direct refs — chained ones like `E.top = D.top + D.length`
  // need a second pass over the SUBSTITUTED text (the first pass writes
  // `D.top + D.length` into the mv expression, the second resolves it
  // to `0 + 5`). Capped to avoid runaway on circular refs (the regex
  // can't detect them, but the iteration count will).
  const re = /\b([A-Z][A-Z0-9]*)\.([a-z][a-zA-Z0-9_]*)\b/g;
  const substitute = (s: string) =>
    s.replace(re, (full, inst, prop) => {
      const v = propMap.get(inst)?.[prop];
      if (v == null) return full;
      // Wrap compound expressions in parens so substitution preserves
      // precedence inside larger expressions (`A.length / 2` stays
      // sane even if A.length itself is `p.bodyOD - 1`).
      return /^-?\d+(\.\d+)?$/.test(v) || /^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(v) ? v : `(${v})`;
    });
  let cur = src;
  for (let i = 0; i < 8; i++) {
    const next = substitute(cur);
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

export interface LoadedComponent {
  meta: PrimitiveMeta;
  geom: GeomFn;
}

/** A single named import specifier: `{ imported as local }`. */
interface ImportSpec {
  imported: string;
  local: string;
}

interface ParsedImports {
  /** Source with every `import …` line removed. */
  stripped: string;
  /** Sibling-component imports — `import { geom as fooGeom } from './foo'`. */
  deps: { depId: string; specs: ImportSpec[] }[];
}

/** Helper / `defineGeom` names a component file is allowed to import.
 *  The local name MUST equal the export name (no aliasing) — we pass
 *  these positionally into `new Function`. */
const HELPER_NAMES = new Set([
  'M',
  'cyl',
  'tube',
  'mv',
  'rot',
  'initManifold',
  'setCircularSegmentMode',
  'getCutBox',
  'CIRCULAR_SEGMENTS_DEFAULT',
  'CIRCULAR_SEGMENTS_COMPOSE',
  'defineGeom',
]);

/** Substrings that must never appear in a volume component body. */
const DENYLIST = [
  'require(',
  'process',
  'globalThis',
  'import(',
  'eval(',
  'Function(',
  'child_process',
  '__dirname',
  '__filename',
];

const IMPORT_RE =
  /import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:from\s*)?['"]([^'"]+)['"]\s*;?/g;

/** Parse + validate the import header. Throws on any disallowed import. */
export function parseImports(src: string): ParsedImports {
  const deps: { depId: string; specs: ImportSpec[] }[] = [];
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    const [, defaultImport, named, source] = m;
    if (defaultImport) {
      throw new Error(
        `Disallowed default import "${defaultImport}" from "${source}" — volume components may only use named imports from '../manifold-helpers', '.' or './<sibling>'.`,
      );
    }
    const specs = parseSpecifiers(named ?? '');
    if (source === '../manifold-helpers' || source === '.') {
      for (const s of specs) {
        if (s.imported !== s.local) {
          throw new Error(
            `Disallowed aliased import "{ ${s.imported} as ${s.local} }" from "${source}" — helper imports must use the export name verbatim.`,
          );
        }
        if (!HELPER_NAMES.has(s.local)) {
          throw new Error(
            `Unknown import "${s.local}" from "${source}" — not a manifold helper or defineGeom.`,
          );
        }
      }
      continue;
    }
    const depMatch = /^\.\/([a-z][a-z0-9_]*)$/.exec(source);
    if (depMatch) {
      deps.push({ depId: depMatch[1], specs });
      continue;
    }
    throw new Error(
      `Disallowed import from "${source}" — volume components may only import from '../manifold-helpers', '.' or './<sibling-id>'.`,
    );
  }

  const stripped = src.replace(IMPORT_RE, '');
  for (const bad of DENYLIST) {
    if (stripped.includes(bad)) {
      throw new Error(
        `Disallowed token "${bad}" in component body — volume components run sandboxed and may not touch the host environment.`,
      );
    }
  }
  return { stripped, deps };
}

function parseSpecifiers(named: string): ImportSpec[] {
  const out: ImportSpec[] = [];
  for (const raw of named.split(',')) {
    const part = raw.trim().replace(/^type\s+/, '');
    if (!part) continue;
    const asMatch = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(part);
    if (asMatch) {
      out.push({ imported: asMatch[1], local: asMatch[2] });
    } else if (/^[A-Za-z_$][\w$]*$/.test(part)) {
      out.push({ imported: part, local: part });
    } else {
      throw new Error(`Unparseable import specifier "${part}".`);
    }
  }
  return out;
}

/** resolveDep(depId) → the module object exporting `meta` / `geom`. */
export type DepResolver = (depId: string) => LoadedComponent;

/** Rewrite every `geom.add(<inst>);` call to the configured op
 *  (`geom.subtract(<inst>);` or `geom.intersect(<inst>);`) per the
 *  caller-supplied `instanceOps` map. Unset instances are left as-is
 *  (default 'add'). Source-on-disk preserves the `geom.add(...)`
 *  shape so the GUI's add/remove/move logic — which pattern-matches
 *  on `geom.add(<inst>);` lines — keeps working unchanged. */
function applyInstanceOps(
  src: string,
  instanceOps: Record<string, 'add' | 'subtract' | 'intersect'> | undefined,
): string {
  if (!instanceOps || Object.keys(instanceOps).length === 0) return src;
  return src.replace(
    /\bgeom\s*\.\s*add\s*\(\s*([A-Z][A-Z0-9]*)\s*\)/g,
    (full, inst) => {
      const op = instanceOps[inst];
      if (op === 'subtract') return `geom.subtract(${inst})`;
      if (op === 'intersect') return `geom.intersect(${inst})`;
      return full;
    },
  );
}

/**
 * Transpile a component `.ts` source string and execute it in a sandboxed
 * host-realm function, returning `{ meta, geom }`. `resolveDep` supplies
 * sibling-component modules for composition imports.
 *
 * `instanceOps` (optional) rewrites `geom.add(<inst>);` calls to
 * `geom.subtract(...)` / `geom.intersect(...)` per the part's
 * meta.instanceOps map. Unset instances stay as `geom.add` (default).
 */
export function loadGeomFromSource(
  src: string,
  resolveDep: DepResolver,
  instanceOps?: Record<string, 'add' | 'subtract' | 'intersect'>,
): LoadedComponent {
  const { stripped, deps } = parseImports(src);
  // Substitute `<INST>.<prop>` cross-instance references (e.g.
  // `B = mv(B, [A.length, 0, 0])`) BEFORE transpile — the executed
  // JS sees the concrete numeric value where the user wrote a
  // part-prop reference. Source-on-disk preserves the reference
  // text, so the substitution re-runs on every load and the
  // cascade stays live across saves.
  const expanded = expandInstancePropRefs(stripped, deps, resolveDep);
  // Per-instance CSG op rewrite — flips `geom.add(<inst>);` to
  // `geom.subtract(...)` / `geom.intersect(...)` based on the part's
  // meta.instanceOps. The source on disk stays additive; the
  // semantics layer on top of it at execute time.
  const withOps = applyInstanceOps(expanded, instanceOps);

  const { code } = transformSync(withOps, {
    loader: 'ts',
    format: 'cjs',
    target: 'node22',
  });

  // Resolve sibling deps and flatten their specifiers into positional args.
  const depArgNames: string[] = [];
  const depArgValues: unknown[] = [];
  for (const { depId, specs } of deps) {
    const mod = resolveDep(depId);
    const modAsRecord = mod as unknown as Record<string, unknown>;
    for (const s of specs) {
      depArgNames.push(s.local);
      depArgValues.push(modAsRecord[s.imported]);
    }
  }

  const exportsObj: Record<string, unknown> = {};
  const helperValues: unknown[] = [
    M,
    cyl,
    tube,
    mv,
    rot,
    initManifold,
    setCircularSegmentMode,
    getCutBox,
    CIRCULAR_SEGMENTS_DEFAULT,
    CIRCULAR_SEGMENTS_COMPOSE,
    defineGeom,
  ];
  const helperParamNames = [
    'M',
    'cyl',
    'tube',
    'mv',
    'rot',
    'initManifold',
    'setCircularSegmentMode',
    'getCutBox',
    'CIRCULAR_SEGMENTS_DEFAULT',
    'CIRCULAR_SEGMENTS_COMPOSE',
    'defineGeom',
  ];

  // eslint-disable-next-line no-new-func
  const factory = new Function(
    ...helperParamNames,
    ...depArgNames,
    'exports',
    'module',
    `${code}\nreturn module.exports !== exports ? module.exports : exports;`,
  );
  const moduleObj = { exports: exportsObj };
  const result = factory(
    ...helperValues,
    ...depArgValues,
    exportsObj,
    moduleObj,
  ) as Record<string, unknown>;

  const meta = result.meta as PrimitiveMeta | undefined;
  const geom = result.geom as GeomFn | undefined;
  if (!meta || typeof geom !== 'function') {
    throw new Error(
      'Component source must export both `meta` (object) and `geom` (function).',
    );
  }
  return { meta, geom };
}

// ── loadVolumeComponent — read + cache ───────────────────────────────────────

interface CacheEntry {
  sourceHash: string;
  loaded: LoadedComponent;
}
const volumeCache = new Map<string, CacheEntry>();

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Load a volume-resident component by id. Reads `<volume>/components/<id>.ts`,
 * transpiles + executes it, and memoizes the result keyed by source hash so
 * an unchanged file is loaded once. Composition imports (`./<sibling>`)
 * resolve to a bundled primitive first (`geomById`), otherwise recurse into
 * another volume component, with a cycle guard.
 */
export async function loadVolumeComponent(
  id: string,
  seen: Set<string> = new Set(),
): Promise<LoadedComponent> {
  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    throw new Error(`Invalid component id "${id}".`);
  }
  if (seen.has(id)) {
    throw new Error(
      `Circular composition import — "${id}" appears in its own dependency chain.`,
    );
  }
  seen.add(id);

  // Lazy import — library.ts → volume.ts pulls `$env/dynamic/private`,
  // which only resolves inside the SvelteKit runtime. Deferring it here
  // keeps parseImports / loadGeomFromSource importable from plain unit tests.
  const { resolvePart } = await import('./library');
  // A library part is a directory under library/<category>/<id>/ —
  // resolvePart finds it in whichever category it currently sits in.
  const part = await resolvePart(id);
  if (!part) {
    throw new Error(`Library part "${id}" not found in any category.`);
  }
  const path = part.componentPath;
  let src: string;
  try {
    src = await readFile(path, 'utf8');
  } catch {
    throw new Error(`Library part "${id}" component.ts unreadable at ${path}.`);
  }
  // Cache key folds in instanceOps so toggling an op flips the executed
  // geom on the next /api/components/geom call without needing the user
  // to also edit the source. (Save endpoint also calls invalidate, so
  // this is belt + suspenders.)
  const opsSig = part.meta.instanceOps
    ? JSON.stringify(Object.entries(part.meta.instanceOps).sort())
    : '';
  const hash = sha(`${src} ${opsSig}`);
  const cached = volumeCache.get(id);
  if (cached && cached.sourceHash === hash) return cached.loaded;

  // resolveDep must be synchronous for loadGeomFromSource, so any volume
  // sibling has to be loaded ahead of time. Pre-scan the import header and
  // resolve every dep, then hand loadGeomFromSource a sync lookup.
  const { deps } = parseImports(src);
  const resolved = new Map<string, LoadedComponent>();
  for (const { depId } of deps) {
    if (resolved.has(depId)) continue;
    const bundledGeom = geomById(depId);
    if (bundledGeom) {
      const bundledMeta = metaById(depId);
      if (!bundledMeta) {
        throw new Error(`Bundled dep "${depId}" has a geom but no meta.`);
      }
      resolved.set(depId, { meta: bundledMeta, geom: bundledGeom });
    } else {
      resolved.set(depId, await loadVolumeComponent(depId, seen));
    }
  }

  const loaded = loadGeomFromSource(
    src,
    (depId) => {
      const dep = resolved.get(depId);
      if (!dep) throw new Error(`Unresolved composition dep "${depId}".`);
      return dep;
    },
    part.meta.instanceOps,
  );

  volumeCache.set(id, { sourceHash: hash, loaded });
  return loaded;
}

// ── Serialized-geometry result cache ─────────────────────────────────────────
// Keyed by `<id>|<paramsJson>|<zScale>`. Holds the JSON the /api/components/geom
// endpoint sends to the client, so an unchanged (id, params, zScale) tuple
// skips the WASM rebuild entirely. Capped LRU-ish: oldest insertion evicted
// once over capacity.

const RESULT_CACHE_CAP = 200;
const resultCache = new Map<string, unknown>();

export function getGeomResult(key: string): unknown | undefined {
  const hit = resultCache.get(key);
  if (hit !== undefined) {
    // Touch — move to newest position for LRU eviction order.
    resultCache.delete(key);
    resultCache.set(key, hit);
  }
  return hit;
}

export function setGeomResult(key: string, value: unknown): void {
  resultCache.set(key, value);
  while (resultCache.size > RESULT_CACHE_CAP) {
    const oldest = resultCache.keys().next().value;
    if (oldest === undefined) break;
    resultCache.delete(oldest);
  }
}

/** Drop the memoized entry for a component (called after a save overwrites it).
 *  Also evicts every result-cache entry derived from that component id. */
export function invalidateVolumeComponent(id: string): void {
  volumeCache.delete(id);
  const prefix = `${id}|`;
  for (const key of resultCache.keys()) {
    if (key.startsWith(prefix)) resultCache.delete(key);
  }
}
