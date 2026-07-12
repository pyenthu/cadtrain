/**
 * sweep-rmf.test.ts — rotation-minimizing frames (parallel transport) for
 * `sweepAlongPath`.
 *
 * Pins the twist fix: the old per-station fixed-up frame (side = tangent × up)
 * ROLLED the cross-section along a 3D path and DEGENERATED when the path ran
 * ~parallel to `up` (a straight-along-Z path lost its `side`). `sweepFrames`
 * carries a reference normal forward by double-reflection (Wang et al. 2008), so
 * consecutive frames stay COHERENT (no roll) and a straight-Z path is well-posed.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initManifold } from '$lib/engines/manifold/manifold-helpers';
import { sweepFrames, sweepAlongPath, type SweepFrame } from '$lib/engines/manifold/manifold-mesh';

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);

/** Each frame's basis is orthonormal (side ⟂ up ⟂ tangent, all unit). */
function assertOrthonormal(f: SweepFrame) {
  expect(len(f.side)).toBeCloseTo(1, 6);
  expect(len(f.up)).toBeCloseTo(1, 6);
  expect(len(f.tangent)).toBeCloseTo(1, 6);
  expect(dot(f.side, f.up)).toBeCloseTo(0, 5);
  expect(dot(f.side, f.tangent)).toBeCloseTo(0, 5);
  expect(dot(f.up, f.tangent)).toBeCloseTo(0, 5);
}

describe('sweepFrames — RMF coherence', () => {
  it('a STRAIGHT-along-Z path is well-posed (no degenerate side) with default up=Z', () => {
    // The old `side = tangent × up` collapsed here (tangent ∥ up = world-Z).
    const path: V3[] = [[0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 0, 3]];
    const frames = sweepFrames(path);
    expect(frames.length).toBe(4);
    for (const f of frames) assertOrthonormal(f);
    // Twist-free: every station shares the SAME side/up (no roll around Z).
    for (let i = 1; i < frames.length; i++) {
      expect(dot(frames[i].side, frames[0].side)).toBeCloseTo(1, 5);
      expect(dot(frames[i].up, frames[0].up)).toBeCloseTo(1, 5);
    }
  });

  it('a NEAR-Z wobble path keeps consecutive frames coherent (no roll flip)', () => {
    // A path that mostly climbs Z with a tiny XY wobble — the exact case the
    // fixed-up frame rolled/flipped on. Adjacent reference normals must stay
    // nearly aligned (dot ≈ 1), never snapping to a flipped basis (dot < 0).
    const path: V3[] = [];
    for (let i = 0; i <= 20; i++) {
      const z = i * 0.5;
      path.push([0.03 * Math.cos(i * 0.6), 0.03 * Math.sin(i * 0.6), z]);
    }
    const frames = sweepFrames(path as V3[]);
    for (const f of frames) assertOrthonormal(f);
    for (let i = 1; i < frames.length; i++) {
      // Parallel transport → minimal change → consecutive normals stay close.
      expect(dot(frames[i].up, frames[i - 1].up)).toBeGreaterThan(0.9);
      expect(dot(frames[i].side, frames[i - 1].side)).toBeGreaterThan(0.9);
    }
  });

  it('a CURVED (quarter-circle in XY) path orients the frame with the path', () => {
    const path: V3[] = [];
    const R = 5;
    for (let i = 0; i <= 12; i++) {
      const a = (Math.PI / 2) * (i / 12);
      path.push([R * Math.cos(a), R * Math.sin(a), 0]);
    }
    const frames = sweepFrames(path);
    for (const f of frames) assertOrthonormal(f);
    // Tangent must follow the circle: at the start it points +Y-ish, at the end
    // it points −X-ish (a 90° turn). The tangent actually rotated in-plane.
    const t0 = frames[0].tangent, tN = frames[frames.length - 1].tangent;
    expect(t0[1]).toBeGreaterThan(0.5);       // start heads +Y
    expect(tN[0]).toBeLessThan(-0.5);         // end heads −X
    // Planar XY path with up=Z → the seed reproduces the old fixed-up basis:
    // `up` stays ≈ world-Z at every station (a spiral-wall-like frame).
    for (const f of frames) expect(Math.abs(f.up[2])).toBeGreaterThan(0.99);
  });

  it('seed matches the legacy fixed-up basis at station 0 (planar case unchanged)', () => {
    const path: V3[] = [[0, 0, 0], [1, 0, 0], [2, 0.2, 0], [3, 0.5, 0]];
    const f0 = sweepFrames(path)[0];
    // t0 = +X, up=world-Z → old side0 = t0×up = (1,0,0)×(0,0,1) = (0,-1,0);
    // up0' = side0×t0 = (0,-1,0)×(1,0,0) = (0,0,1).
    expect(f0.side[0]).toBeCloseTo(0, 5);
    expect(f0.side[1]).toBeCloseTo(-1, 5);
    expect(f0.up[2]).toBeCloseTo(1, 5);
  });
});

describe('sweepAlongPath — builds a valid welded solid on a straight-Z path', () => {
  beforeAll(async () => { await initManifold(); });

  it('straight-Z round sweep = a positive-volume watertight cylinder', () => {
    // Round section (side=r, up=r) swept straight down Z. The old frame
    // degenerated here; the RMF builds a clean tube.
    const section: [number, number][] = [];
    const n = 24, r = 1.5;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      section.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    const path: V3[] = [[0, 0, 0], [0, 0, 2], [0, 0, 4], [0, 0, 6]];
    const m = sweepAlongPath(path, section);
    expect(m.volume()).toBeGreaterThan(0);
    const bb = m.boundingBox();
    // Round tube: XY extent ≈ 2r, Z extent ≈ path length.
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(2 * r, 1);
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(6, 1);
  });
});
