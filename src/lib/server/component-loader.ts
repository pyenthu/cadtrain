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

/**
 * Transpile a component `.ts` source string and execute it in a sandboxed
 * host-realm function, returning `{ meta, geom }`. `resolveDep` supplies
 * sibling-component modules for composition imports.
 */
export function loadGeomFromSource(
  src: string,
  resolveDep: DepResolver,
): LoadedComponent {
  const { stripped, deps } = parseImports(src);

  const { code } = transformSync(stripped, {
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
  const hash = sha(src);
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

  const loaded = loadGeomFromSource(src, (depId) => {
    const dep = resolved.get(depId);
    if (!dep) throw new Error(`Unresolved composition dep "${depId}".`);
    return dep;
  });

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
