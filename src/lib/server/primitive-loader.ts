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
  // PARALLEL — a composite's deps were resolved one-at-a-time, so each dep's
  // source.ts fetch (a prod round-trip in dev) blocked the next.
  // DEDUPE: `new Function(...depNames, body)` throws "Invalid parameters … in
  // strict mode" on a duplicate param name. meta.uses can legitimately list the
  // same primitive twice (e.g. adding a 2nd r_extrude part), which otherwise
  // crashed the whole build with a 400.
  const depNames = [...new Set(usesOf(source))].filter((d) => !SANDBOX_ARG_NAMES.includes(d));
  for (const dep of depNames) {
    if (visited.has(dep)) {
      throw new Error(`circular primitive dependency: ${[...visited, dep].join(' → ')}`);
    }
  }
  const depFns = await Promise.all(
    depNames.map((dep) => loadPrimitiveGeomById(dep, fetchFn, new Set([...visited, dep]))),
  );

  let body = transpile(source);
  // A composite instance named after the primitive it calls — `const X = X()`,
  // produced by older saves before uniqueInstName forbade it — shadows the
  // injected dep param, so the RHS call hits the temporal-dead-zone ("Cannot
  // access X before initialization"). When a dep is ALSO declared as a
  // const/let/var in the body, inject it under a collision-proof alias and
  // rewrite its CALL sites (`X(` → `__dep_i(`), so the declaration no longer
  // shadows it. Non-colliding deps are untouched (zero blast radius). This
  // repairs every already-saved broken composite without a data migration.
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const injectNames = [...depNames];
  depNames.forEach((dep, i) => {
    if (new RegExp(`\\b(?:const|let|var)\\s+${escapeRe(dep)}\\b`).test(body)) {
      const alias = `__dep_${i}`;
      body = body.replace(new RegExp(`(?<![.\\w$])${escapeRe(dep)}\\s*\\(`, 'g'), `${alias}(`);
      injectNames[i] = alias;
    }
  });
  const wrapper = `"use strict";
    const module = { exports: {} };
    const exports = module.exports;
    const currentSegments = CIRCULAR_SEGMENTS_DEFAULT;
    ${body}
    return module.exports[${JSON.stringify(name)}]
        ?? Object.values(module.exports).find((v) => typeof v === 'function');`;

  const factory = new Function(...SANDBOX_ARG_NAMES, ...injectNames, wrapper);
  const fn = factory(...sandboxArgValues(), ...depFns);
  if (typeof fn !== 'function') {
    throw new Error(`primitive "${name}" did not export a function`);
  }
  return fn as GeomFn;
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
    // primitives/{basic,industrial,archive}/<id>/ and completions/<family>/
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

/** Resolve a primitive id → geom function. Bundle helpers (cyl, tube, …)
 *  return directly; volume primitives are read from
 *  <volume>/primitives/<id>/source.ts (via fetchFn, cached) and built
 *  recursively. */
export async function loadPrimitiveGeomById(
  id: string,
  fetchFn: typeof fetch,
  visited: Set<string> = new Set(),
): Promise<GeomFn> {
  const bundle = (helpers as any)[id];
  if (typeof bundle === 'function') return bundle as GeomFn;

  const src = await fetchDepSource(id, fetchFn);
  return buildPrimitiveGeom(src, id, fetchFn, visited);
}
