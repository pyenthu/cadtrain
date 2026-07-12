/**
 * sweep-cap-triangulation.test.ts — end-cap triangulation for r_sweep tubes.
 *
 * Pins the NON-CONVEX cap fix: `fanCap3D` used to fan a closed section end-cap
 * from vertex 0 (tris (0,j,j+1)), which is ONLY valid for a CONVEX polygon.
 * `sweep_tube`'s section is `resampleSpline` of 4 irregular control points → a
 * NON-CONVEX loop, so the vertex-0 fan emitted triangles crossing OUTSIDE the
 * polygon → overlapping / degenerate sliver caps at both ends. The fix ear-clips
 * an arbitrary simple polygon (Newell plane → 2D projection → O(n²) ear clip,
 * centroid-fan fallback), so cap triangles are all positive-area, non-overlapping
 * and total exactly the section area.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initManifold } from '$lib/engines/manifold/manifold-helpers';
import { earClip2D, fanCap3D, sweepAlongPath } from '$lib/engines/manifold/manifold-mesh';

type V2 = [number, number];
type V3 = [number, number, number];

// ── geometry helpers ─────────────────────────────────────────────────────────
const cross2 = (a: V2, b: V2, c: V2) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
/** Absolute area of a simple polygon (shoelace). */
function polyArea2D(p: V2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}
/** Sum of the (unsigned) areas of an ear-clip triangulation. Overlapping tris
 *  (the old crossing fan) make this EXCEED the polygon area; a proper
 *  non-overlapping cover equals it. */
function triAreaSum2D(p: V2[], tris: number[][]): number {
  let s = 0;
  for (const [a, b, c] of tris) s += Math.abs(cross2(p[a], p[b], p[c])) / 2;
  return s;
}
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossV = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lenV = (a: V3) => Math.hypot(a[0], a[1], a[2]);
/** 3D triangle area from three vertex indices into an interleaved xyz array. */
function tri3DArea(v: Float32Array, a: number, b: number, c: number): number {
  const pa: V3 = [v[a * 3], v[a * 3 + 1], v[a * 3 + 2]];
  const pb: V3 = [v[b * 3], v[b * 3 + 1], v[b * 3 + 2]];
  const pc: V3 = [v[c * 3], v[c * 3 + 1], v[c * 3 + 2]];
  return lenV(crossV(sub3(pb, pa), sub3(pc, pa))) / 2;
}

// ── fixtures ─────────────────────────────────────────────────────────────────
// L-shape (one reflex vertex at (1,1)) — a minimal NON-CONVEX polygon. Area 5.
const L: V2[] = [[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]];
// 5-point star — five reflex vertices, the hard non-convex case.
function star(n = 5, rOut = 2, rIn = 0.8): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n;
    const r = i % 2 === 0 ? rOut : rIn;
    out.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return out;
}
// Convex references (must NOT regress).
function circle(n = 24, r = 1.5): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; out.push([r * Math.cos(a), r * Math.sin(a)]); }
  return out;
}
const square: V2[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

describe('earClip2D — arbitrary simple polygon triangulation', () => {
  for (const [name, poly] of [['L-shape', L], ['star', star()], ['circle', circle()], ['square', square]] as const) {
    it(`${name}: N-2 non-overlapping positive-area triangles totalling the polygon area`, () => {
      const tris = earClip2D(poly as V2[]);
      expect(tris).not.toBeNull();
      expect(tris!.length).toBe(poly.length - 2); // a simple polygon → exactly N-2 tris
      // Every triangle non-degenerate + same winding (sign) — no zero-area slivers.
      let sign = 0;
      for (const [a, b, c] of tris!) {
        const cr = cross2(poly[a], poly[b], poly[c]);
        expect(Math.abs(cr)).toBeGreaterThan(1e-9);
        const s = Math.sign(cr);
        if (sign === 0) sign = s; else expect(s).toBe(sign); // consistent orientation
      }
      // Non-overlap + full coverage: Σ|tri| == polygon area (a crossing fan exceeds it).
      expect(triAreaSum2D(poly as V2[], tris!)).toBeCloseTo(polyArea2D(poly as V2[]), 6);
    });
  }

  it('degenerate input (< 3 verts) returns null', () => {
    expect(earClip2D([[0, 0], [1, 1]])).toBeNull();
  });
});

describe('fanCap3D — non-convex ring planted in a tilted 3D plane', () => {
  // Plant the L-shape into a tilted, translated plane (side = X̂, up = tilted).
  const side: V3 = [1, 0, 0];
  const up: V3 = [0, Math.cos(0.6), Math.sin(0.6)];
  const origin: V3 = [2, -1, 5];
  const ring: V3[] = L.map(([a, b]): V3 => [
    origin[0] + side[0] * a + up[0] * b,
    origin[1] + side[1] * a + up[1] * b,
    origin[2] + side[2] * a + up[2] * b,
  ]);

  it('shares the ring verts (no centroid added) and covers the section area with no degenerate tris', () => {
    const cap = fanCap3D(ring, false);
    // Ear-clip succeeded → NO extra centroid vertex, exactly N-2 triangles.
    expect(cap.verts.length).toBe(ring.length * 3);
    expect(cap.tris.length).toBe((ring.length - 2) * 3);
    let sum = 0, degenerate = 0;
    for (let t = 0; t < cap.tris.length; t += 3) {
      const area = tri3DArea(cap.verts, cap.tris[t], cap.tris[t + 1], cap.tris[t + 2]);
      if (area < 1e-9) degenerate++;
      sum += area;
    }
    expect(degenerate).toBe(0);
    // Rigid transform preserves area → cap area == 2D section area (5).
    expect(sum).toBeCloseTo(polyArea2D(L), 5);
  });

  it('reverse flips every triangle winding (same verts)', () => {
    const fwd = fanCap3D(ring, false);
    const rev = fanCap3D(ring, true);
    expect(rev.verts.length).toBe(fwd.verts.length);
    for (let t = 0; t < fwd.tris.length; t += 3) {
      // (a,b,c) → (a,c,b)
      expect(rev.tris[t]).toBe(fwd.tris[t]);
      expect(rev.tris[t + 1]).toBe(fwd.tris[t + 2]);
      expect(rev.tris[t + 2]).toBe(fwd.tris[t + 1]);
    }
  });
});

describe('sweepAlongPath — non-convex section builds a watertight capped solid', () => {
  beforeAll(async () => { await initManifold(); });

  function decodeDegenerate(m: any): { verts: number; degenerate: number } {
    const mesh = m.getMesh();
    const v: Float32Array = mesh.vertProperties;
    const tv: Uint32Array = mesh.triVerts;
    let degenerate = 0;
    for (let t = 0; t < tv.length; t += 3) {
      if (tri3DArea(v, tv[t], tv[t + 1], tv[t + 2]) < 1e-9) degenerate++;
    }
    return { verts: v.length / mesh.numProp, degenerate };
  }

  it('star section swept along a gentle 3D path → positive volume, genus 0, no degenerate tris', () => {
    const section = star(5, 2, 0.9);
    const path: V3[] = [[0, 0, 0], [0.3, 0, 3], [1.6, -1, 7], [0.2, 0, 10.5]];
    const m = sweepAlongPath(path, section, { caps: true, closedPath: false, closedSection: true });
    expect(m.status()).toBe('NoError'); // status() returns a STRING
    expect(m.volume()).toBeGreaterThan(0);
    expect(m.genus()).toBe(0); // tube + 2 caps = topological sphere, watertight
    const { degenerate } = decodeDegenerate(m);
    expect(degenerate).toBe(0);
  });

  it('convex CIRCLE section straight-Z sweep stays clean (no regression)', () => {
    const m = sweepAlongPath([[0, 0, 0], [0, 0, 2], [0, 0, 4], [0, 0, 6]], circle(24, 1.5),
      { caps: true, closedPath: false, closedSection: true });
    expect(m.status()).toBe('NoError');
    expect(m.volume()).toBeGreaterThan(0);
    expect(m.genus()).toBe(0);
    expect(decodeDegenerate(m).degenerate).toBe(0);
  });

  it('square (4-gon) section sweep → clean caps, sharp corners', () => {
    const m = sweepAlongPath([[0, 0, 0], [0, 0, 2], [0, 0, 4]], square,
      { caps: true, closedPath: false, closedSection: true });
    expect(m.status()).toBe('NoError');
    expect(m.volume()).toBeGreaterThan(0);
    expect(m.genus()).toBe(0);
    expect(decodeDegenerate(m).degenerate).toBe(0);
    const bb = m.boundingBox();
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(2, 4); // 2×1 square → 2-unit span, sharp
  });
});
