/**
 * wells-bake-coverage — headless proof that the /wells 3D pipeline (#42h) is
 * sound geometry, so MOUNTING it is pure wiring (no browser needed to verify the
 * geometry seam). Two layers, matching `well-graph-bake.ts`'s split:
 *
 *  PART A — TRANSLATE + EMIT (pure, portable, ALWAYS runs). Every bundled
 *    `samples/*.wson` must translate (`wsonToGraph`) and emit (`emitGraph`) to a
 *    clean, compilable `bw_*` assembly — the exact input the compile endpoint
 *    consumes. Proves the translator covers the whole sample set, straight AND
 *    deviated. No WASM, no deps, no network.
 *
 *  PART B — REAL MANIFOLD BAKE (skipped when the local dev-volume cache is
 *    absent, e.g. CI). Loads the DEP-RESOLVED compiled scripts the dev server
 *    already cached for saved well assemblies + the last well preview, runs each
 *    through the SAME sandbox the bake worker uses, and asserts the geom fn yields
 *    SEPARATE, positive-volume `_parts` — NOT the single fused shell that
 *    `M.compose` collapses a well to (well-graph-bake.ts header; manifold-helpers
 *    `place` gotcha). This is the geometry the mount will render as `parts[]`.
 *
 * Why Part B reads cached scripts rather than compiling here: `compilePrimitiveScript`
 * resolves each `bw_*` dep via `/api/primitives/source`, and the `bw_*` element
 * library lives on the PROXIED prod volume (not on local disk), so a fresh
 * per-sample compile needs a live server. That last hop is covered in-browser by
 * the live compile endpoint at mount time; everything upstream is proven here.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { parseWson, isDeviated, type Wson } from '../wson';
import { wellBakeSpec } from '../well-graph-bake';
import * as helpers from '$lib/engines/manifold/manifold-helpers';
import { runCompiledManifold } from '$lib/engines/manifold/bake-worker-core';
import { SANDBOX_ARG_NAMES, sandboxArgValues } from '$lib/graph/primitive/primitive-sandbox';

// ─────────────────────────────────────────────────────────────────────────────
// PART A — translate + emit coverage (pure)
// ─────────────────────────────────────────────────────────────────────────────
const SAMPLES_DIR = resolve('src/lib/wells/samples');
const SLUGS = readdirSync(SAMPLES_DIR)
  .filter((f) => f.endsWith('.wson'))
  .map((f) => f.replace(/\.wson$/, ''))
  .sort();

const loadSample = (slug: string): Wson =>
  parseWson(readFileSync(join(SAMPLES_DIR, `${slug}.wson`), 'utf8')).wson;

/** Count `bw_*(` element Calls emitted into the assembly source. */
const bwCallCount = (source: string): number => (source.match(/bw_\w+\(/g) || []).length;

describe('PART A — every WSON sample translates + emits a clean bw_* assembly', () => {
  it('discovers the bundled sample set', () => {
    expect(SLUGS.length).toBeGreaterThanOrEqual(5);
  });

  for (const slug of SLUGS) {
    it(`${slug} → graph → emit (no throw, references bw_*, survey-consistent)`, () => {
      const wson = loadSample(slug);
      const spec = wellBakeSpec(wson); // throws on an unmappable well — the NO-FALLBACK contract

      // A real, compilable assembly with at least one structural element.
      expect(spec.source).toContain('export const meta');
      expect(bwCallCount(spec.source)).toBeGreaterThanOrEqual(1);

      // The deviated flag agrees with the WSON survey, and the emit shape follows:
      // deviated ⇒ ONE warp spline + a derived (positive) axial ring spacing;
      // straight ⇒ no warp and no densification.
      expect(spec.deviated).toBe(isDeviated(wson));
      if (spec.deviated) {
        expect(spec.source).toContain('resampleSpline(');
        expect(spec.source).toContain('warpSpline(');
        expect(typeof spec.options.axialMaxZSpan).toBe('number');
        expect(spec.options.axialMaxZSpan as number).toBeGreaterThan(0);
      } else {
        expect(spec.source).not.toContain('warpSpline(');
        expect(spec.options.axialMaxZSpan).toBeNull();
        // A straight MULTI-element well returns a LIST (never one composed body —
        // that would fuse to the open hole). A single-element well may return one body.
        if (bwCallCount(spec.source) > 1) expect(spec.source).toContain('return [');
      }
    });
  }

  it('pins the translator element count for two reference wells', () => {
    expect(bwCallCount(wellBakeSpec(loadSample('11-vertical-land-producer')).source)).toBe(16);
    expect(bwCallCount(wellBakeSpec(loadSample('10-three-open-holes')).source)).toBe(3);
  });

  it('04-horizontal-shale-pnp: the TRANSLATOR is clean (the Manifold bake is a separate, tracked investigation)', () => {
    // Recorded explicitly: emit + warp-spline lowering succeed for the horizontal
    // producer. Whatever is failing its Manifold bake is downstream of the graph
    // seam this task de-risks, and is owned by another agent tonight.
    const spec = wellBakeSpec(loadSample('04-horizontal-shale-pnp'));
    expect(spec.deviated).toBe(true);
    expect(spec.source).toContain('warpSpline(');
    expect(bwCallCount(spec.source)).toBeGreaterThan(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART B — real Manifold bake of dep-resolved well graphs (local cache only)
// ─────────────────────────────────────────────────────────────────────────────

/** Walk up from cwd (handles both the main checkout and a git worktree whose
 *  own tree has no `.dev-volume`) to the dev-volume holding the script cache. */
function findScriptCache(): string | null {
  const cands: string[] = [];
  if (process.env.CADTRAIN_VOLUME_ROOT) cands.push(process.env.CADTRAIN_VOLUME_ROOT);
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    cands.push(join(dir, '.dev-volume'));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const c of cands) {
    if (existsSync(join(c, 'cache', 'scripts'))) return join(c, 'cache', 'scripts');
  }
  return null;
}

/** Newest cached compiled script for `id` that uses the CURRENT lazy-place
 *  prelude (`__lazyPlace`) — older eager-compose caches would fuse a well and
 *  are skipped as stale. Returns null when none qualify. */
function newestLazyScript(cacheDir: string, id: string): string | null {
  const dir = join(cacheDir, id);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const { path } of files) {
    const src = readFileSync(path, 'utf8');
    if (src.includes('__lazyPlace')) return src;
  }
  return null;
}

function buildGeomFn(script: string): (...a: any[]) => any {
  const factory = new Function(...SANDBOX_ARG_NAMES, script);
  const fn = factory(...sandboxArgValues());
  if (typeof fn !== 'function') throw new Error('compiled script did not return a geom function');
  return fn;
}

/** Reading `_parts` never forces the compose (well-graph-bake.ts / render-helpers). */
function partsOf(m: any): any[] | null {
  const p = m?._parts;
  return Array.isArray(p) ? p.filter((x) => x && typeof x.getMesh === 'function') : null;
}

const CACHE = findScriptCache();

// The saved well ASSEMBLIES + the last well PREVIEW the dev server has compiled +
// cached (dep-resolved). Nature is recorded so the coverage matrix is legible.
const WELL_CASES: { id: string; nature: string; expectSeparate: boolean; minParts?: number }[] = [
  { id: 'w_multi_string', nature: 'straight 3-string cased hole', expectSeparate: true },
  { id: 'w_multi_string_dev', nature: 'deviated 3-string (warped)', expectSeparate: true },
  { id: 'w_wells_preview', nature: 'full completion well preview (warped)', expectSeparate: true },
  { id: 'w_deviated_casing', nature: 'deviated single casing', expectSeparate: false },
  // #42e SAMPLE-LADDER rungs, baked from their dep-resolved cached scripts: the
  // ladder's translate→emit is pinned in sample-ladder.test.ts; here it BAKES to
  // the expected count of SEPARATE positive-volume parts (never one fused shell).
  { id: 'w_sample_10_three_telescoping_open_holes', nature: 'ladder rung 2 — 3 telescoping open holes', expectSeparate: true, minParts: 3 },
  { id: 'w_sample_1_vertical_land_producer', nature: 'ladder rung 3 — vertical multi-string + completion', expectSeparate: true, minParts: 9 },
];

describe.skipIf(!CACHE)('PART B — dep-resolved well graphs bake to SEPARATE positive-volume parts', () => {
  beforeAll(async () => { await helpers.initManifold(); });

  it('found the dev-volume script cache', () => {
    expect(CACHE).toBeTruthy();
  });

  for (const { id, nature, expectSeparate, minParts } of WELL_CASES) {
    const script = CACHE ? newestLazyScript(CACHE, id) : null;

    it.skipIf(!script)(`${id} (${nature}) bakes to valid geometry, not a fused shell`, () => {
      const geomFn = buildGeomFn(script!);
      const m = geomFn({ segments: 16 });
      expect(m && typeof m.getMesh === 'function').toBe(true);

      const parts = partsOf(m);
      if (expectSeparate) {
        // The point of the whole pipeline: a well is a LIST of independently
        // warped elements, kept apart so composing them can't collapse the well
        // to the outer open hole. Each element must be real, positive-volume solid.
        expect(parts, 'a multi-element well must expose separate _parts').not.toBeNull();
        // A ladder rung pins its exact minimum (one _part per WSON element);
        // the seeded fixtures just require "more than one" (never a fused shell).
        expect(parts!.length).toBeGreaterThanOrEqual(minParts ?? 2);
        for (let i = 0; i < parts!.length; i++) {
          const vol = parts![i].volume();
          const tris = parts![i].getMesh().triVerts.length / 3;
          expect(vol, `${id} part[${i}] volume`).toBeGreaterThan(0);
          expect(tris, `${id} part[${i}] triangles`).toBeGreaterThan(0);
        }
      } else {
        // A single-element well returns one body (no list) — assert it is solid.
        expect(parts).toBeNull();
        expect(m.volume(), `${id} single body volume`).toBeGreaterThan(0);
        expect(m.getMesh().triVerts.length / 3).toBeGreaterThan(0);
      }
    });
  }

  it('runs a straight well through the PRODUCTION executor (runCompiledManifold) end-to-end', () => {
    const script = CACHE ? newestLazyScript(CACHE, 'w_multi_string') : null;
    if (!script) return; // covered by skipIf above when truly absent
    return runCompiledManifold(script, { segments: 16 } as any, { cutaway: false }).then((s) => {
      // The exact serialize the bake worker hands the scene — a real, non-empty mesh.
      expect(s.full.positions.length).toBeGreaterThan(0);
      expect(s.full.positions.length % 3).toBe(0);
    });
  });
});
