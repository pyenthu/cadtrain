import { describe, it, expect } from 'vitest';
import { buildRevolveMesh, type ProfilePoint } from './revolve';

/**
 * Guards the PURE lathe `buildRevolveMesh` (behind `tfRevolveProfile`): revolving a
 * CLOSED half-section a full 360° must yield a WATERTIGHT 2-MANIFOLD (every
 * undirected edge shared by exactly 2 triangles) with CONSISTENT orientation
 * (every directed half-edge exactly once). No WASM needed — same split as
 * `buildCappedMesh`. The winding sign is fixed at runtime by tf's
 * `positivelyOriented`, so we assert winding-independent topology here.
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

/** Count DIRECTED half-edges. In a consistently-oriented closed 2-manifold every
 *  directed edge appears exactly once. */
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

/** Euler characteristic V − E + F from the flat buffers (E from unique edges). */
function euler(points: Float32Array, faces: Int32Array): number {
  const V = points.length / 3;
  const F = faces.length / 3;
  const E = edgeCounts(faces).size;
  return V - E + F;
}

function assertClosedManifold(points: Float32Array, faces: Int32Array) {
  // No degenerate triangles (a repeated index) emitted.
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f], b = faces[f + 1], c = faces[f + 2];
    expect(a !== b && b !== c && c !== a, `degenerate tri ${a},${b},${c}`).toBe(true);
  }
  // Watertight + 2-manifold: every undirected edge shared by exactly 2 faces.
  for (const [edge, n] of edgeCounts(faces)) {
    expect(n, `edge ${edge} shared by ${n} faces`).toBe(2);
  }
  // Consistent orientation: every directed half-edge exactly once.
  for (const [edge, n] of directedCounts(faces)) {
    expect(n, `directed edge ${edge} appears ${n}×`).toBe(1);
  }
}

describe('buildRevolveMesh', () => {
  // dp_pin's exact half-section — closed loop, min r = 1.7 (bored) → hollow tube.
  const DP_PIN: ProfilePoint[] = [
    [3, 0], [3, 4], [2.6, 4], [2.25, 7], [1.7, 7], [1.7, 0],
  ];
  // cone right-triangle — touches the axis at (0,0) and (0,8) → solid cone.
  const CONE: ProfilePoint[] = [[0, 0], [3, 0], [0, 8]];

  it('dp_pin: revolves a closed bored profile → watertight genus-1 solid (χ=0)', () => {
    const { points, faces } = buildRevolveMesh(DP_PIN, 64);
    assertClosedManifold(points, faces);
    // P=6 non-axis points × 64 segments; χ = 6S − 18S + 12S = 0 (a hole through it).
    expect(points.length / 3).toBe(6 * 64);
    expect(euler(points, faces)).toBe(0);
  });

  it('cone: axis points collapse → watertight genus-0 solid (χ=2, positive volume)', () => {
    const { points, faces } = buildRevolveMesh(CONE, 64);
    assertClosedManifold(points, faces);
    // 2 axis verts (base centre + apex) + 64 rim verts; χ = 2 (sphere topology).
    expect(points.length / 3).toBe(2 + 64);
    expect(euler(points, faces)).toBe(2);
  });

  it('is watertight at a coarse segment count too (no wrap-around gaps)', () => {
    const { points, faces } = buildRevolveMesh(CONE, 5);
    assertClosedManifold(points, faces);
    expect(euler(points, faces)).toBe(2);
  });
});
