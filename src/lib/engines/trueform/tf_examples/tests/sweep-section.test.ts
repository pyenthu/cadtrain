import { describe, it, expect } from 'vitest';
import {
  buildSweepGrid,
  buildSweepSectionMesh,
  circleSection,
  type Pt2,
} from '../sweep-section';
import { roundedRect } from '../test-profiles';
import type { V3 } from '../tf-weld';

/**
 * Guards the PURE arbitrary-section sweep builder (behind `tfSweepSection`) — the
 * native TF analogue of Manifold's `sweepAlongPath`. Transporting a closed 2D
 * section along the path's RMF frames + welding must yield a WATERTIGHT 2-MANIFOLD
 * (every undirected edge shared by exactly 2 triangles, every directed half-edge
 * exactly once → orientable), χ=2 (genus-0) for an OPEN capped path / χ=0 for a
 * CLOSED torus path, enclosing a non-zero volume. No WASM — same split as
 * `buildExtrudeMesh` / `buildWeldGrid`. The absolute in/out SIGN is fixed at
 * runtime by tf's `positivelyOriented`, so we assert |volume| + winding-independent
 * topology (matching extrude.test.ts / tf-weld.test.ts).
 */

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
  const V = points.length / 3;
  const F = faces.length / 3;
  const E = edgeCounts(faces).size;
  return V - E + F;
}

/** Signed volume of a closed triangle mesh = Σ (v0 · (v1 × v2)) / 6. Sign is
 *  winding-dependent (fixed outward by tf's positivelyOriented at runtime). */
function signedVolume(points: Float32Array, faces: Int32Array): number {
  let vol = 0;
  const g = (i: number, k: number) => points[i * 3 + k];
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f], b = faces[f + 1], c = faces[f + 2];
    const ax = g(a, 0), ay = g(a, 1), az = g(a, 2);
    const bx = g(b, 0), by = g(b, 1), bz = g(b, 2);
    const cx = g(c, 0), cy = g(c, 1), cz = g(c, 2);
    const crx = by * cz - bz * cy;
    const cry = bz * cx - bx * cz;
    const crz = bx * cy - by * cx;
    vol += ax * crx + ay * cry + az * crz;
  }
  return vol / 6;
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

// A NON-circular hex section (r_weld_extrude's default ngon), CCW, centred.
const HEX: Pt2[] = Array.from({ length: 6 }, (_, i) => {
  const a = (i / 6) * Math.PI * 2;
  return [0.6 * Math.cos(a), 0.6 * Math.sin(a)] as Pt2;
});

// An L-bend path: straight down +Z, then turning into +X (distinct 3D stations so
// no accidental weld). 6 stations.
const L_BEND: V3[] = [
  [0, 0, 0],
  [0, 0, 1],
  [0, 0, 2],
  [1, 0, 2.6],
  [2, 0, 3],
  [3.2, 0, 3],
];

describe('buildSweepSectionMesh — arbitrary-section sweep along a path', () => {
  it('rounded-rect (NON-circular) section along an L-bend: watertight genus-0 (χ=2)', () => {
    const section = roundedRect(1.2, 0.8, 0.2, 3); // 12-pt non-circular closed loop
    expect(section.length).toBe(12);
    const { points, faces } = buildSweepSectionMesh(section, L_BEND, {
      closedSection: true,
      caps: true,
    });
    // 6 stations × 12 section pts + 2 cap centroids (clean grid → weld identity).
    expect(points.length / 3).toBe(6 * 12 + 2);
    // wall: rowSteps 5 × colSteps 12 × 2 tris + 2 caps × 12-fan.
    expect(faces.length / 3).toBe(5 * 12 * 2 + 2 * 12);
    assertClosedManifold(points, faces);
    expect(euler(points, faces)).toBe(2); // genus-0
    expect(Math.abs(signedVolume(points, faces))).toBeGreaterThan(0.1);
  });

  it('hex section along the L-bend: watertight genus-0 (χ=2), non-zero volume', () => {
    const { points, faces } = buildSweepSectionMesh(HEX, L_BEND, { caps: true });
    expect(points.length / 3).toBe(6 * 6 + 2);
    expect(faces.length / 3).toBe(5 * 6 * 2 + 2 * 6);
    assertClosedManifold(points, faces);
    expect(euler(points, faces)).toBe(2);
    expect(Math.abs(signedVolume(points, faces))).toBeGreaterThan(0);
  });

  it('circle section (thin wrapper) along a straight path: watertight genus-0 (χ=2)', () => {
    const straight: V3[] = [0, 1, 2, 3, 4].map((z): V3 => [0, 0, z]);
    const section = circleSection(0.5, 16);
    const { points, faces } = buildSweepSectionMesh(section, straight, { caps: true });
    expect(points.length / 3).toBe(5 * 16 + 2);
    assertClosedManifold(points, faces);
    expect(euler(points, faces)).toBe(2);
    // A tube of radius 0.5, length 4 → ~π r² L (cap-fan area ≈ full circle).
    expect(Math.abs(signedVolume(points, faces))).toBeCloseTo(Math.PI * 0.25 * 4, 0);
  });

  it('CLOSED-path sweep (torus, no caps): every edge shared by 2, χ = 0', () => {
    // A square section swept around a closed loop in the XZ plane.
    const ringPath: V3[] = Array.from({ length: 12 }, (_, i): V3 => {
      const a = (i / 12) * Math.PI * 2;
      return [3 * Math.cos(a), 0, 3 * Math.sin(a)];
    });
    const section: Pt2[] = [[-0.4, -0.4], [0.4, -0.4], [0.4, 0.4], [-0.4, 0.4]];
    const { points, faces } = buildSweepSectionMesh(section, ringPath, {
      closedPath: true,
      closedSection: true,
    });
    expect(points.length / 3).toBe(12 * 4); // no cap centroids
    for (const [edge, n] of edgeCounts(faces)) {
      expect(n, `edge ${edge} shared by ${n}`).toBe(2); // closed, no boundary
    }
    expect(euler(points, faces)).toBe(0); // torus
  });
});

describe('buildSweepGrid — RMF section transport (no roll)', () => {
  it('straight +Z path: the section rides a CONSTANT frame offset (torsion-free)', () => {
    const straight: V3[] = [0, 1, 2, 3].map((z): V3 => [0, 0, z]);
    // A single marker point at [1, 0] — its world offset from the station origin
    // must be identical at every station (the RMF does not roll on a straight run).
    const grid = buildSweepGrid([[1, 0], [0, 1], [-1, 0], [0, -1]], straight);
    expect(grid.length).toBe(4); // one ring per station
    const offset0: V3 = [
      grid[0][0][0] - straight[0][0],
      grid[0][0][1] - straight[0][1],
      grid[0][0][2] - straight[0][2],
    ];
    for (let r = 0; r < grid.length; r++) {
      const off: V3 = [
        grid[r][0][0] - straight[r][0],
        grid[r][0][1] - straight[r][1],
        grid[r][0][2] - straight[r][2],
      ];
      expect(off[0]).toBeCloseTo(offset0[0], 6);
      expect(off[1]).toBeCloseTo(offset0[1], 6);
      expect(off[2]).toBeCloseTo(offset0[2], 6);
    }
  });

  it('grid dims = (path stations) × (section points)', () => {
    const grid = buildSweepGrid(HEX, L_BEND);
    expect(grid.length).toBe(L_BEND.length);
    for (const ring of grid) expect(ring.length).toBe(HEX.length);
  });
});
