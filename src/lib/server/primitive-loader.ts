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
  // Resolve declared deps (skip ones already in the standard sandbox scope,
  // e.g. a `uses:['tube']` — that's the bundle helper, already injected).
  const deps: Array<[string, GeomFn]> = [];
  for (const dep of usesOf(source)) {
    if (SANDBOX_ARG_NAMES.includes(dep)) continue;
    if (visited.has(dep)) {
      throw new Error(`circular primitive dependency: ${[...visited, dep].join(' → ')}`);
    }
    deps.push([dep, await loadPrimitiveGeomById(dep, fetchFn, new Set([...visited, dep]))]);
  }
  const depNames = deps.map((d) => d[0]);
  const depFns = deps.map((d) => d[1]);

  const js = transpile(source);
  const wrapper = `"use strict";
    const module = { exports: {} };
    const exports = module.exports;
    const currentSegments = CIRCULAR_SEGMENTS_DEFAULT;
    ${js}
    return module.exports[${JSON.stringify(name)}]
        ?? Object.values(module.exports).find((v) => typeof v === 'function');`;

  const factory = new Function(...SANDBOX_ARG_NAMES, ...depNames, wrapper);
  const fn = factory(...sandboxArgValues(), ...depFns);
  if (typeof fn !== 'function') {
    throw new Error(`primitive "${name}" did not export a function`);
  }
  return fn as GeomFn;
}

/** Resolve a primitive id → geom function. Bundle helpers (cyl, tube, …)
 *  return directly; volume primitives are read from
 *  <volume>/primitives/<id>/source.ts (via fetchFn) and built recursively. */
export async function loadPrimitiveGeomById(
  id: string,
  fetchFn: typeof fetch,
  visited: Set<string> = new Set(),
): Promise<GeomFn> {
  const bundle = (helpers as any)[id];
  if (typeof bundle === 'function') return bundle as GeomFn;

  const r = await fetchFn(
    `/api/volume?path=${encodeURIComponent(`primitives/${id}/source.ts`)}`,
    { cache: 'no-store' },
  );
  if (!r.ok) {
    throw new Error(`dependency primitive "${id}" not found on the volume (HTTP ${r.status})`);
  }
  const src = await r.text();
  return buildPrimitiveGeom(src, id, fetchFn, visited);
}
