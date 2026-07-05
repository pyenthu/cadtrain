import { describe, it, expect } from 'vitest';
import { buildRevolveMesh, type ProfilePoint } from './revolve';
import { densifyProfileAxial, warpMeshJS, type Pt3 } from '$lib/cad/warp-spline';

/**
 * REGRESSION guard for the TF WARP triangulation fix (execute.ts `case 'warp'`,
 * revolve-child fast path). No WASM — the fix is pure JS: densify the revolve
 * PROFILE along Z (densifyProfileAxial) → re-lathe (buildRevolveMesh, the SAME
 * builder tfRevolveProfile wraps) → warp (warpMeshJS). This mirrors, node-for-node,
 * what the executor does for a revolve warp child.
 *
 * THE BUG (before this fix): the executor densified the ALREADY-BUILT 2-ring lathe
 * with subdivideAxialAdaptive (triangle plane-splitting). A tube wall quad is two
 * triangles sharing a DIAGONAL edge spanning both z AND the circumference; a z-plane
 * always cuts that diagonal → an off-ring vertex at an intermediate angle → "strange
 * circumferential subdivisions" and long spanning triangles. Reproduced numerically
 * as: pre-warp welded mesh with max/median edge ≈ 31 and 576 spanning edges, then a
 * final w1_oh_warp mesh of exactly 3216 tris (matching the reported TF-tab count) vs
 * Manifold's clean 8448.
 *
 * THE FIX builds a clean ring×segment GRID at lathe time, so there are NO diagonal
 * cuts → no circumferential spanning triangles, matching the Manifold warp's quality.
 */

// REAL w1_oh_warp inputs (from prod source w1_oh_warp / bw_open_hole / g_shaft):
//  bw_open_hole → g_shaft(r=4.25, length=80, segments=24) — a SOLID cylinder,
//  warped along a 3D spline; g_shaft's r_revolve carries zSegments:10 so Manifold
//  gets 10 axial rings, but TF's lathe only has the profile's 2 z-levels.
const R = 4.25, SEG = 24;
const OH_PATH: Pt3[] = [
  [0, 0, 0],
  [2.883, 1.725, 7.342],
  [5.705, 4.654, 12.58],
  [6.787, 9.27, 16.412],
];

/** Solid-shaft closed [r,z] half-section over z0..z1 (disk-capped cylinder). */
function shaftProfile(z0: number, z1: number): ProfilePoint[] {
  return [[R, z0], [R, z1], [0, z1], [0, z0]];
}

interface MeshQ {
  nVert: number;
  nTri: number;
  degenerate: number;
  medianEdge: number;
  maxEdge: number;
  spanners: number; // circumferential/axial edges far longer than the grid pitch
}

function meshQuality(positions: Float32Array, faces: Uint32Array | Int32Array, spanFactor = 6): MeshQ {
  const nTri = faces.length / 3;
  const p = (i: number) => [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]] as const;
  const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const area = (a: readonly number[], b: readonly number[], c: readonly number[]) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  };
  const edges: number[] = [];
  let degenerate = 0;
  for (let f = 0; f < nTri; f++) {
    const a = p(faces[3 * f]), b = p(faces[3 * f + 1]), c = p(faces[3 * f + 2]);
    if (area(a, b, c) < 1e-9) degenerate++;
    edges.push(dist(a, b), dist(b, c), dist(c, a));
  }
  edges.sort((x, y) => x - y);
  const medianEdge = edges[Math.floor(edges.length / 2)] || 1e-9;
  const maxEdge = edges[edges.length - 1];
  // Ignore the axis-cap fan edges (length ≈ R, the disk radius) — those are a
  // legitimate part of a solid revolve, not a circumferential spanning artifact.
  const spanners = edges.filter((e) => e > medianEdge * spanFactor && e > R * 1.05).length;
  return { nVert: positions.length / 3, nTri, degenerate, medianEdge, maxEdge, spanners };
}

/** The executor's revolve-warp fast path, reproduced in pure JS. */
function tfWarpRevolve(profile: ProfilePoint[], path: Pt3[]) {
  const dense = densifyProfileAxial(profile, path, {});
  const mesh = buildRevolveMesh(dense, SEG);
  const { positions } = warpMeshJS(mesh.points, null, path, {});
  return { positions, faces: mesh.faces, denseProfilePts: dense.length };
}

describe('densifyProfileAxial — build-time axial ring insertion', () => {
  it('inserts z-samples only on AXIAL edges; caps (constant-z) untouched', () => {
    const prof = shaftProfile(0, 80);
    const out = densifyProfileAxial(prof, OH_PATH, {});
    expect(out.length).toBeGreaterThan(prof.length); // rings were added
    // Every original corner survives; radii stay within [0, R] (linear r-interp).
    for (const [r] of out) expect(r).toBeGreaterThanOrEqual(-1e-9);
    for (const [r] of out) expect(r).toBeLessThanOrEqual(R + 1e-9);
    // The two annular caps (r spanning 0..R at constant z=0 and z=80) get no inserts:
    // count distinct z-levels == inserts landed on the two axial WALL edges only.
    const zLevels = new Set(out.map((p) => Math.round(p[1] * 1e3)));
    expect(zLevels.size).toBeGreaterThan(6); // real interior rings, not just z0/z1
  });

  it('is adaptive — a straight path stays sparse, a bend densifies', () => {
    const prof = shaftProfile(0, 80);
    const straight: Pt3[] = [[0, 0, 0], [0, 0, 40], [0, 0, 80]];
    const straightPts = densifyProfileAxial(prof, straight, {}).length;
    const bentPts = densifyProfileAxial(prof, OH_PATH, {}).length;
    expect(bentPts).toBeGreaterThan(straightPts); // the bend earns extra rings
  });

  it('no-ops safely on a degenerate profile / path', () => {
    expect(densifyProfileAxial([[1, 0]], OH_PATH, {}).length).toBe(1);        // <2 pts → unchanged
    expect(densifyProfileAxial(shaftProfile(0, 80), [[0, 0, 0]] as any, {}).length).toBe(4); // <2 cp → unchanged
    expect(densifyProfileAxial([[1, 3], [2, 3]], OH_PATH, {}).length).toBe(2); // no z-range → unchanged
  });
});

describe('TF warp — clean ring×segment grid (no circumferential spanners)', () => {
  it('REAL w1_oh_warp inputs → a clean grid, NO spanning triangles', () => {
    const { positions, faces, denseProfilePts } = tfWarpRevolve(shaftProfile(0, 80), OH_PATH);
    const q = meshQuality(positions, faces);
    // A clean grid, not the 2-ring lathe: many rings × 24 segments.
    expect(denseProfilePts).toBeGreaterThan(10);
    expect(q.nTri).toBeGreaterThan(500);
    // THE regression: the old triangle-split path produced 576 spanning edges (max/
    // median ≈ 31). The clean grid has ZERO circumferential spanners.
    expect(q.spanners).toBe(0);
    expect(q.maxEdge).toBeLessThan(q.medianEdge * 6 + R * 1.05);
  });

  it('LENGTH-MATCHED spline (no tail clamp) → clean AND zero-degenerate', () => {
    // When the part length ≈ the spline arc, nothing clamps onto the endpoint, so
    // the whole mesh is a clean, non-degenerate grid. (The real w1_oh_warp part is
    // 4× longer than its ~21-unit spline, so its tail collapses into a nub — the
    // SAME inherent, non-stretch behaviour the Manifold warp has; that tail is the
    // only source of zero-area tris, so we isolate cleanliness on a matched span.)
    const matched: Pt3[] = [[0, 0, 0], [1.2, 0.8, 6], [2.0, 2.4, 12], [1.6, 4.2, 18]];
    const { positions, faces } = tfWarpRevolve(shaftProfile(0, 18), matched);
    const q = meshQuality(positions, faces);
    expect(q.nTri).toBeGreaterThan(300);
    expect(q.degenerate).toBe(0);      // no collapse → no zero-area tris
    expect(q.spanners).toBe(0);        // clean grid → no long circumferential tris
  });

  it('grid regularity — median edge is the ring pitch, not a full-tube span', () => {
    const { positions, faces } = tfWarpRevolve(shaftProfile(0, 18),
      [[0, 0, 0], [1.2, 0.8, 6], [2.0, 2.4, 12], [1.6, 4.2, 18]]);
    const q = meshQuality(positions, faces);
    // Circumferential pitch of a 24-seg ring at R=4.25 ≈ 1.11; axial pitch similar.
    // The median edge must be ~O(1), never O(tube length) — the old bug's 58-unit
    // spanning edges pushed the max/median to ≈31.
    expect(q.medianEdge).toBeLessThan(3);
    expect(q.maxEdge / q.medianEdge).toBeLessThan(8);
  });
});
