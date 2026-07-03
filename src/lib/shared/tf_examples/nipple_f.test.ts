import { describe, it, expect } from 'vitest';
import { buildRevolveMesh } from './revolve';
import { NIPPLE_F_PROFILE } from './nipple_f';

/**
 * Headless decode-probe for the g_nipple_f TrueForm demo. Lathing the nipple's
 * REAL half-section (imported from nipple_f.ts, so it can't silently drift) a full
 * 360° must yield a WATERTIGHT 2-MANIFOLD solid with genus-1 topology (χ=0 — a
 * bored tube with a through-hole) and a strictly positive enclosed volume.
 *
 * No WASM: this exercises the PURE lathe `buildRevolveMesh` (behind
 * `tfRevolveProfile`), the authoritative "is it a valid closed solid?" check. The
 * absolute in/out winding is fixed at runtime by tf's `positivelyOriented`, so the
 * mesh signed-volume sign here is winding-dependent — we assert |V| > 0 (a real
 * enclosed solid), the topology assertions carry the orientation-consistency proof.
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

/** Count DIRECTED half-edges — each appears exactly once in a consistently
 *  oriented closed 2-manifold. */
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

/** χ = V − E + F from the flat buffers (E = unique undirected edges). */
function euler(points: Float32Array, faces: Int32Array): number {
  return points.length / 3 - edgeCounts(faces).size + faces.length / 3;
}

/** Enclosed mesh volume via the signed-tetrahedron (divergence) sum: the sign is
 *  winding-dependent, so callers assert |V| > 0. */
function meshVolume(points: Float32Array, faces: Int32Array): number {
  let v = 0;
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f] * 3, b = faces[f + 1] * 3, c = faces[f + 2] * 3;
    const ax = points[a], ay = points[a + 1], az = points[a + 2];
    const bx = points[b], by = points[b + 1], bz = points[b + 2];
    const cx = points[c], cy = points[c + 1], cz = points[c + 2];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

describe('nipple_f demo profile', () => {
  it('revolves the landing-nipple bore → watertight genus-1 solid (χ=0), positive volume', () => {
    const { points, faces } = buildRevolveMesh(NIPPLE_F_PROFILE, 64);

    // No degenerate triangles (a repeated index) — every point is off-axis (min r > 0).
    for (let f = 0; f < faces.length; f += 3) {
      const a = faces[f], b = faces[f + 1], c = faces[f + 2];
      expect(a !== b && b !== c && c !== a, `degenerate tri ${a},${b},${c}`).toBe(true);
    }
    // CLOSED + 2-MANIFOLD: every undirected edge shared by exactly 2 faces.
    for (const [edge, n] of edgeCounts(faces)) {
      expect(n, `edge ${edge} shared by ${n} faces`).toBe(2);
    }
    // Consistent orientation: every directed half-edge exactly once.
    for (const [edge, n] of directedCounts(faces)) {
      expect(n, `directed edge ${edge} appears ${n}×`).toBe(1);
    }
    // 18 off-axis profile points × 64 segments, no axis collapse.
    expect(points.length / 3).toBe(18 * 64);
    // Genus-1 (a through-bore hole) → χ = 0.
    expect(euler(points, faces)).toBe(0);
    // A real enclosed solid → non-zero volume (sign fixed at runtime by tf).
    expect(Math.abs(meshVolume(points, faces))).toBeGreaterThan(0);
  });
});
