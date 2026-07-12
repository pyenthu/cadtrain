import { describe, it, expect } from 'vitest';
import { buildWeldGrid, extrudeProfileGrid, type V3, type WeldGrid } from './tf-weld';
import { roundedRect } from './test-profiles';

/**
 * Guards the PURE welded-grid builder `buildWeldGrid` (behind `weldGridToTf`): an
 * ordered (rows × cols) vertex grid must weld into topology with (a) the right
 * vertex/face counts, (b) a CONSISTENT winding (every directed half-edge exactly
 * once → orientable), (c) coincident verts COLLAPSED by the position-weld, and
 * (d) a WATERTIGHT-BY-CONSTRUCTION solid when capped (every undirected edge shared
 * by exactly 2 faces, χ = 2). No WASM — same split as `buildRevolveMesh`. The
 * absolute in/out sign is fixed at runtime by tf's `positivelyOriented`, so only
 * winding-INDEPENDENT topology is asserted here.
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

/** Count DIRECTED half-edges. A consistently-oriented closed 2-manifold has every
 *  directed edge exactly once. */
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

/** Euler characteristic V − E + F (E from unique undirected edges). */
function euler(points: Float32Array, faces: Int32Array): number {
  const V = points.length / 3;
  const F = faces.length / 3;
  const E = edgeCounts(faces).size;
  return V - E + F;
}

function assertClosedManifold(points: Float32Array, faces: Int32Array) {
  // No degenerate triangles (a repeated index).
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

/** A unit square section `[x,y]`, CCW, 4 points (a closed loop when closedV). */
const SQUARE: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

describe('buildWeldGrid — winding + counts (open wall)', () => {
  it('open ribbon (no wrap, no caps): counts + consistent winding', () => {
    // 3 rows × 4 cols, open in both dims → a (2×3) field of quads = 12 tris.
    const grid: WeldGrid = extrudeProfileGrid(SQUARE, 2, 0, 4); // 3 rings
    const { points, faces } = buildWeldGrid(grid, { closedV: false, weld: true });
    expect(points.length / 3).toBe(3 * 4);       // clean grid → weld is identity
    expect(faces.length / 3).toBe(2 * 3 * 2);    // rowSteps 2 × colSteps 3 × 2 tris = 12
    // Orientable: no directed half-edge is traversed twice the same way.
    for (const [edge, n] of directedCounts(faces)) {
      expect(n, `directed edge ${edge} appears ${n}×`).toBe(1);
    }
  });

  it('closed section (wrap, no caps): the seam quad closes the side wall', () => {
    // closedV wraps col 3 → col 0 via modulo (no duplicate seam vert): an open
    // tube. rowSteps 2 × colSteps 4 × 2 = 16 tris; verts unchanged (clean grid).
    const grid: WeldGrid = extrudeProfileGrid(SQUARE, 2, 0, 4);
    const { points, faces } = buildWeldGrid(grid, { closedV: true, caps: false, weld: true });
    expect(points.length / 3).toBe(3 * 4);
    expect(faces.length / 3).toBe(2 * 4 * 2);
    // Only boundary edges are the two open RIMS (top + bottom), each of 4 edges →
    // 8 undirected edges shared by a single face. The vertical seam is NOT open.
    let boundary = 0;
    for (const [, n] of edgeCounts(faces)) if (n === 1) boundary++;
    expect(boundary).toBe(8);
  });
});

describe('buildWeldGrid — position-weld collapses coincident verts', () => {
  it('a caller-duplicated seam column welds shut (watertight side)', () => {
    // Author pattern: a profile that REPEATS its closing vertex, swept OPEN
    // (closedV:false). Col 4 is coincident with col 0 → an open seam without weld,
    // closed after weld.
    const closedProfile: [number, number][] = [...SQUARE, [-1, -1]]; // 5 pts, [4]==[0]
    const grid: WeldGrid = extrudeProfileGrid(closedProfile, 2, 0, 4); // 3 rows × 5 cols

    const noWeld = buildWeldGrid(grid, { closedV: false, weld: false });
    expect(noWeld.points.length / 3).toBe(3 * 5); // 15 verts, seam duplicated

    const welded = buildWeldGrid(grid, { closedV: false, weld: true });
    expect(welded.points.length / 3).toBe(3 * 4); // coincident seam column collapsed → 12

    // After weld the vertical seam is shared, so only the two rims remain open (8
    // boundary edges) — the same watertight side as the modulo-wrap path.
    let boundary = 0;
    for (const [, n] of edgeCounts(welded.faces)) if (n === 1) boundary++;
    expect(boundary).toBe(8);
  });
});

describe('buildWeldGrid — capped closed solid is watertight by construction', () => {
  it('square prism (closedV + caps): closed 2-manifold, χ = 2', () => {
    const grid: WeldGrid = extrudeProfileGrid(SQUARE, 2, -2, 4); // 3 rings
    const { points, faces } = buildWeldGrid(grid, { closedV: true, caps: true, weld: true });
    // 12 wall verts + 2 cap centroids = 14; wall 16 tris + 2 caps × 4-fan = 24 tris.
    expect(points.length / 3).toBe(3 * 4 + 2);
    expect(faces.length / 3).toBe(2 * 4 * 2 + 2 * 4);
    assertClosedManifold(points, faces);
    expect(euler(points, faces)).toBe(2); // genus 0
  });

  it('rounded-rect prism (the demo section, 12 pts): watertight genus-0 solid', () => {
    const profile = roundedRect(4, 3, 0.8, 3); // 12-pt section
    expect(profile.length).toBe(12);
    const grid: WeldGrid = extrudeProfileGrid(profile, 8, -4, 8); // 9 rings
    const { points, faces } = buildWeldGrid(grid, { closedV: true, caps: true, weld: true });
    // 9 rings × 12 + 2 centroids; wall 8×12×2 + 2 caps × 12-fan.
    expect(points.length / 3).toBe(9 * 12 + 2);
    expect(faces.length / 3).toBe(8 * 12 * 2 + 2 * 12);
    assertClosedManifold(points, faces);
    expect(euler(points, faces)).toBe(2);
  });

  it('closed PATH (closedU torus, no caps): every edge shared by 2, χ = 0', () => {
    // A closed sweep loop — rows wrap too. No open boundary, no caps: a torus.
    const ring: V3[] = SQUARE.map(([x, y]): V3 => [x, y, 0]);
    // 4 stations around a big loop in Z (distinct positions so no accidental weld).
    const grid: V3[][] = [0, 1, 2, 3].map((r) =>
      ring.map(([x, y]): V3 => [x, y, r * 3]),
    );
    const { points, faces } = buildWeldGrid(grid, { closedU: true, closedV: true, weld: true });
    expect(points.length / 3).toBe(4 * 4);
    for (const [edge, n] of edgeCounts(faces)) {
      expect(n, `edge ${edge} shared by ${n}`).toBe(2); // closed, no boundary
    }
    expect(euler(points, faces)).toBe(0); // torus
  });
});
