import { describe, it, expect } from 'vitest';
import { warpMeshJS, splineSampler, type Pt2 } from '../warp-spline';

/**
 * The warp perpendicularity fix (2026-07): the radial (xDiaScale) + depth (yScale)
 * exaggeration is applied PRE-FRAME — the local cross-section is scaled BEFORE it is
 * placed on the spline frame — so a scaled section stays perpendicular to the tangent.
 * (The bug the user hit was a post-warp WORLD scale [xScale,xScale,zScale] on the
 * render group, which shears any tilted section. These params are the perpendicular
 * alternative.) This test pins that a large radial scale does NOT break perpendicularity.
 */
describe('warp radial/depth scale is applied BEFORE the frame (perpendicularity)', () => {
  const CP: Pt2[] = [[0, 0], [0, 5], [4, 9], [8, 10]]; // planar (x,z) bend

  // A unit cross-section RING at the part's local z=0 (its top) — the section whose
  // perpendicularity we check after the bend.
  const N = 24;
  const ring = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = (2 * Math.PI * i) / N;
    ring[i * 3] = Math.cos(a);
    ring[i * 3 + 1] = Math.sin(a);
    ring[i * 3 + 2] = 0;
  }

  function measure(xDia: number, yScale = 1) {
    const { positions } = warpMeshJS(ring, null, CP, { xDiaScale: xDia, yScale });
    // The z=0 ring maps to arc-length station s = (0 - z0) * yScale = 0.
    const { sampleAt } = splineSampler(CP);
    const { pos, tan } = sampleAt(0);
    let maxDot = 0, minR = Infinity, maxR = -Infinity;
    for (let i = 0; i < N; i++) {
      const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
      // Perpendicular ⟺ (vertex − pos)·tangent ≈ 0 for every section vertex.
      const dot = (px - pos[0]) * tan[0] + (py - pos[1]) * tan[1] + (pz - pos[2]) * tan[2];
      maxDot = Math.max(maxDot, Math.abs(dot));
      const r = Math.hypot(px - pos[0], py - pos[1], pz - pos[2]);
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
    }
    return { maxDot, minR, maxR };
  }

  it('true scale (xDiaScale=1): section is perpendicular, radius 1', () => {
    const { maxDot, minR, maxR } = measure(1);
    expect(maxDot).toBeLessThan(1e-4);
    expect(minR).toBeGreaterThan(0.99);
    expect(maxR).toBeLessThan(1.01);
  });

  it('exaggerated (xDiaScale=6): STILL perpendicular, radius scaled ~6×', () => {
    const { maxDot, minR, maxR } = measure(6);
    expect(maxDot).toBeLessThan(1e-4);   // section stays in the plane ⊥ tangent
    expect(minR).toBeGreaterThan(5.9);   // radius exaggerated 6×
    expect(maxR).toBeLessThan(6.1);
  });

  it('radial + depth exaggeration together keep the section perpendicular', () => {
    const { maxDot } = measure(4, 3);
    expect(maxDot).toBeLessThan(1e-4);
  });
});
