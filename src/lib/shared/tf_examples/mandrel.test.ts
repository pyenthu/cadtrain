import { describe, it, expect } from 'vitest';
import { buildRevolveMesh, type ProfilePoint } from './revolve';

/**
 * Guards the `mandrel` demo's geometry. The demo's `build()` loads the 31 MB
 * TrueForm WASM (via `ensureTf` → `tf.init()`), which needs cross-origin isolation
 * (SharedArrayBuffer pthread pool) — unavailable in the vitest node env. So, like
 * `revolve.test.ts`, we assert the PURE lathe output (`buildRevolveMesh`, which
 * `tfRevolveProfile` wraps 1:1): the mandrel half-section must revolve into a
 * WATERTIGHT 2-MANIFOLD, genus-0 (χ=2), enclosing a non-zero volume.
 *
 * The mesh's ABSOLUTE volume being > 0 (winding-independent) is what we assert here
 * — `tfRevolveProfile` then runs the mesh through tf's `positivelyOriented` at
 * runtime so the shipped solid has a POSITIVE signed volume (outward walls).
 */

/** g_mandrel's exact half-section — closed loop, touches the axis at both ends. */
const MANDREL: ProfilePoint[] = [
  [0, 0], [0.5, 0], [0.6, 0.15], [0.6, 0.8], [0.55, 1],
  [0.55, 10], [0.4, 10.4], [0.4, 13.4], [0.25, 13.7], [0, 14],
];

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

/** Count DIRECTED half-edges — each appears exactly once in a consistently-oriented
 *  closed 2-manifold. */
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

/** Euler characteristic V − E + F from the flat buffers. */
function euler(points: Float32Array, faces: Int32Array): number {
  return points.length / 3 - edgeCounts(faces).size + faces.length / 3;
}

/** Signed mesh volume via the divergence theorem (Σ of signed tetrahedra from the
 *  origin). Sign follows the winding; |V| is the enclosed volume regardless. */
function meshVolume(points: Float32Array, faces: Int32Array): number {
  let v6 = 0;
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f] * 3, b = faces[f + 1] * 3, c = faces[f + 2] * 3;
    const ax = points[a], ay = points[a + 1], az = points[a + 2];
    const bx = points[b], by = points[b + 1], bz = points[b + 2];
    const cx = points[c], cy = points[c + 1], cz = points[c + 2];
    // a · (b × c)
    v6 += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v6 / 6;
}

describe('mandrel demo geometry', () => {
  it('revolves g_mandrel\'s half-section → watertight genus-0 solid (χ=2, volume>0)', () => {
    const { points, faces } = buildRevolveMesh(MANDREL, 64);

    // No degenerate triangles (repeated index).
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
    // Genus-0 (both ends collapse to the axis): 2 axis verts + 8 non-axis × 64 segs.
    expect(points.length / 3).toBe(2 + 8 * 64);
    expect(euler(points, faces)).toBe(2);
    // Encloses a non-zero region (winding-independent; positivelyOriented fixes the
    // sign at runtime). Rough analytic sanity: > a 0.25-radius × 14-long cylinder.
    expect(Math.abs(meshVolume(points, faces))).toBeGreaterThan(Math.PI * 0.25 * 0.25 * 14);
  });
});
