import { describe, it, expect } from 'vitest';
import { compilePrimitiveScript } from '$lib/server/primitive-loader';
import { runCompiledManifold } from '../bake-worker-core';
import { autoNodes } from '$lib/wells/dtx';

/**
 * CHANGE 2 — VERTICAL DTX autoscale (no warp). A VERTICAL multi-element part has NO
 * `warpSpline(...)` in its compiled script, so the graded DTX never rides a bend.
 * `runCompiledManifold` instead wraps the baked manifold along a STRAIGHT vertical
 * spline when `warpViewScale.verticalDtx` is set — a PURE z-remap (radial x/y kept):
 * a short element magnifies, total length is preserved, and (Rule 25) it is a proper
 * Manifold.warp, NOT a post-bake MeshGL subdivision. Mirrors the client-bake harness
 * (Manifold runs in Node via runCompiledManifold).
 */

// A VERTICAL multi-element part: three stacked cylinders at different depths. Element
// B is SHORT (len 10) and NARROW (r 1.4) so its vertices are isolable by a radius band
// and its z-span is measurable before/after the vertical stretch. No warpSpline → the
// only step is "no warp". Uses only sandbox helpers (cyl/mv) → no dep fetch.
const SRC = `export const meta = { id:'tvd_asm', name:'tvd', params:{} };
export function tvd_asm(){
  const a = cyl(100, 3);                  // z [0,100],   r 3  (long, wide)
  const b = mv(cyl(10, 1.4), [0,0,110]);  // z [110,120], r 1.4 (SHORT, narrow)
  const c = mv(cyl(100, 3), [0,0,130]);   // z [130,230], r 3  (long, wide)
  return [a, b, c];
}`;

const fakeFetch = (async (url: any) => {
  const name = new URL(String(url), 'http://x').searchParams.get('name') ?? '';
  if (name === 'tvd_asm') return { ok: true, status: 200, json: async () => ({ source: SRC }) } as any;
  return { ok: false, status: 404, json: async () => ({}) } as any;
}) as any;

/** z-span of the vertices in a radius BAND (isolates the narrow element B; excludes the
 *  wide r≈3 elements and any r≈0 cap-centre verts). */
function bandZSpan(positions: ArrayLike<number>, rLo: number, rHi: number): { span: number; count: number } {
  let zMin = Infinity, zMax = -Infinity, count = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const r = Math.hypot(positions[i], positions[i + 1]);
    if (r > rLo && r < rHi) {
      const z = positions[i + 2];
      if (z < zMin) zMin = z; if (z > zMax) zMax = z;
      count++;
    }
  }
  return { span: count ? zMax - zMin : 0, count };
}

/** overall z-extent of all vertices. */
function zExtent(positions: ArrayLike<number>): { lo: number; hi: number } {
  let lo = Infinity, hi = -Infinity;
  for (let i = 2; i < positions.length; i += 3) { const z = positions[i]; if (z < lo) lo = z; if (z > hi) hi = z; }
  return { lo, hi };
}

describe('CHANGE 2 — vertical DTX post-bake z-stretch', () => {
  it('magnifies a SHORT element vs. the un-stretched bake, keeps total length + radius', async () => {
    const { script } = await compilePrimitiveScript(SRC, 'tvd_asm', fakeFetch);
    // No warpSpline in a vertical part → the DTX would otherwise be a no-op.
    expect(script).not.toContain('warpSpline(');

    // Baseline bake — no vertical DTX.
    const base = await runCompiledManifold(script, [], { cutaway: false, segments: 24 });
    const basePos = base.full.positions;
    const b0 = bandZSpan(basePos, 0.8, 2.2); // element B (r 1.4)
    expect(b0.count).toBeGreaterThan(0);
    const ext0 = zExtent(basePos);

    // Build the DTX around element B's MEASURED absolute z-span, over the well depth.
    const bBand = (() => {
      let zMin = Infinity, zMax = -Infinity;
      for (let i = 0; i < basePos.length; i += 3) {
        const r = Math.hypot(basePos[i], basePos[i + 1]);
        if (r > 0.8 && r < 2.2) { const z = basePos[i + 2]; if (z < zMin) zMin = z; if (z > zMax) zMax = z; }
      }
      return { zMin, zMax };
    })();
    const maxDepth = ext0.hi; // well total depth (~230)
    const dtx = autoNodes([{ start: bBand.zMin, end: bBand.zMax }], maxDepth, { footprintFrac: 0.15, maxRatio: 6 });

    // Vertical-DTX bake — the "stretch, no warp" step.
    const warped = await runCompiledManifold(script, [], {
      cutaway: false, segments: 24,
      warpViewScale: { dtx, verticalDtx: true, verticalMaxDepth: maxDepth },
    });
    const warpPos = warped.full.positions;
    const b1 = bandZSpan(warpPos, 0.8, 2.2);
    expect(b1.count).toBeGreaterThan(0);

    // (a) The short element's z-span is clearly magnified.
    expect(b1.span).toBeGreaterThan(b0.span * 1.5);

    // (b) Radial size is UNTOUCHED (a pure z-remap): B's band is still populated and no
    //     r≈3 element leaked into the narrow band.
    let maxBandR = 0;
    for (let i = 0; i < warpPos.length; i += 3) {
      const r = Math.hypot(warpPos[i], warpPos[i + 1]);
      if (r > 0.8 && r < 2.2) maxBandR = Math.max(maxBandR, r);
    }
    expect(maxBandR).toBeLessThan(2.0);

    // (c) TOTAL length preserved (anchored DTX): the overall z-extent is unchanged.
    const ext1 = zExtent(warpPos);
    expect(ext1.lo).toBeCloseTo(ext0.lo, 1);
    expect(ext1.hi).toBeCloseTo(ext0.hi, 1);
  });

  it('a bake WITHOUT verticalDtx is byte-identical (the generic-part skip)', async () => {
    const { script } = await compilePrimitiveScript(SRC, 'tvd_asm', fakeFetch);
    const a = await runCompiledManifold(script, [], { cutaway: false, segments: 24 });
    const b = await runCompiledManifold(script, [], { cutaway: false, segments: 24 });
    expect(a.full.positions.length).toBe(b.full.positions.length);
    for (let i = 0; i < a.full.positions.length; i++) expect(a.full.positions[i]).toBe(b.full.positions[i]);
  });
});
