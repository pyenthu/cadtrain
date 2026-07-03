import { describe, it, expect } from 'vitest';
import { buildRevolveMesh } from './revolve';
import { STAND_PARTS, N_JOINTS, JOINT_LEN, JOINT_DELTA, OVERLAP, SEGMENTS } from './dp_stand';

/**
 * Pure guards for the dp_stand STACK (no WASM — the booleanUnion of the N joints is
 * verified in-browser under cross-origin isolation, like every tf boolean). We prove
 * what the pure layer can: (1) each of the N_JOINTS × 3 Z-offset half-sections
 * (box/tube/pin per joint) revolves to a WATERTIGHT genus-1 2-manifold (χ=0, a bored
 * tube) with a non-zero enclosed volume, and (2) successive joints are stacked with an
 * OVERLAP > 0 (so the union welds cleanly rather than kissing at a coplanar face) and
 * their bores stay coaxial → one continuous through-bore.
 */

/** Count undirected edges over a flat [F*3] triangle index buffer. */
function edgeCounts(faces: ArrayLike<number>): Map<string, number> {
  const m = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f], b = faces[f + 1], c = faces[f + 2];
    for (const [x, y] of [[a, b], [b, c], [c, a]] as const) {
      m.set(key(x, y), (m.get(key(x, y)) ?? 0) + 1);
    }
  }
  return m;
}

function directedCounts(faces: ArrayLike<number>): Map<string, number> {
  const m = new Map<string, number>();
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f], b = faces[f + 1], c = faces[f + 2];
    for (const [x, y] of [[a, b], [b, c], [c, a]] as const) {
      m.set(`${x}>${y}`, (m.get(`${x}>${y}`) ?? 0) + 1);
    }
  }
  return m;
}

function euler(points: Float32Array, faces: Int32Array): number {
  return points.length / 3 - edgeCounts(faces).size + faces.length / 3;
}

function assertClosedManifold(points: Float32Array, faces: Int32Array) {
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f], b = faces[f + 1], c = faces[f + 2];
    expect(a !== b && b !== c && c !== a, `degenerate tri ${a},${b},${c}`).toBe(true);
  }
  for (const [edge, n] of edgeCounts(faces)) {
    expect(n, `edge ${edge} shared by ${n} faces`).toBe(2);
  }
  for (const [edge, n] of directedCounts(faces)) {
    expect(n, `directed edge ${edge} appears ${n}×`).toBe(1);
  }
}

/** |signed volume| of a closed triangle mesh (divergence theorem). > 0 ⇒ a real
 *  enclosed solid (sign depends only on winding; we take magnitude). */
function absVolume(points: Float32Array, faces: Int32Array): number {
  let v6 = 0;
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f] * 3, b = faces[f + 1] * 3, c = faces[f + 2] * 3;
    const ax = points[a], ay = points[a + 1], az = points[a + 2];
    const bx = points[b], by = points[b + 1], bz = points[b + 2];
    const cx = points[c], cy = points[c + 1], cz = points[c + 2];
    v6 += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return Math.abs(v6) / 6;
}

/** [minZ, maxZ] of a half-section's z column. */
function zRange(profile: readonly (readonly [number, number])[]): [number, number] {
  const zs = profile.map((p) => p[1]);
  return [Math.min(...zs), Math.max(...zs)];
}

describe('dp_stand parts', () => {
  it('has N_JOINTS × 3 stacked parts (box/tube/pin per joint)', () => {
    expect(N_JOINTS).toBe(3);
    expect(STAND_PARTS.length).toBe(N_JOINTS * 3);
    // Joint 0 leads with box0/tube0/pin0, each subsequent joint suffixed by its index.
    expect(STAND_PARTS.slice(0, 3).map((p) => p.name)).toEqual(['box0', 'tube0', 'pin0']);
    expect(STAND_PARTS.slice(-3).map((p) => p.name)).toEqual([
      `box${N_JOINTS - 1}`, `tube${N_JOINTS - 1}`, `pin${N_JOINTS - 1}`,
    ]);
  });

  it('each Z-offset half-section revolves to a watertight genus-1 tube (χ=0) with volume > 0', () => {
    for (const { name, profile } of STAND_PARTS) {
      const { points, faces } = buildRevolveMesh(profile, SEGMENTS);
      assertClosedManifold(points, faces);
      // Every part is BORED (min r > 0) → a hole through it → χ = 0.
      expect(euler(points, faces), `${name} euler`).toBe(0);
      // No point touches the axis (min r > 0), so V = P × segments.
      expect(points.length / 3, `${name} verts`).toBe(profile.length * SEGMENTS);
      // A real enclosed solid, not a degenerate shell.
      expect(absVolume(points, faces), `${name} volume`).toBeGreaterThan(0);
    }
  });

  it('stacks N joints down-hole with an OVERLAP > 0 at every joint junction', () => {
    // Group the flat parts back into per-joint triples and take each joint's Z-span.
    const jointRanges = Array.from({ length: N_JOINTS }, (_, i) => {
      const parts = STAND_PARTS.slice(i * 3, i * 3 + 3);
      const zs = parts.flatMap((p) => zRange(p.profile));
      return [Math.min(...zs), Math.max(...zs)] as [number, number];
    });
    // Joint 0's box face is the top of the whole stand.
    expect(jointRanges[0][0]).toBe(0);
    // Each joint spans one JOINT_LEN.
    for (const [lo, hi] of jointRanges) {
      expect(hi - lo).toBeCloseTo(JOINT_LEN, 6);
    }
    // Monotone down-hole order, each joint tucked into the previous one by OVERLAP.
    for (let i = 1; i < N_JOINTS; i++) {
      expect(jointRanges[i][0]).toBeCloseTo(i * JOINT_DELTA, 6);
      // prev joint bottom − this joint top = OVERLAP (they interpenetrate, not kiss).
      expect(jointRanges[i - 1][1] - jointRanges[i][0]).toBeCloseTo(OVERLAP, 6);
    }
  });
});
