import { describe, it, expect } from 'vitest';
import { buildRevolveMesh } from './revolve';
import { isRevolveTree, densifyRevolveTree } from './execute';
import { subdivideAxialAdaptive, type Pt3 } from '$lib/engines/manifold/warp-spline';

/**
 * REGRESSION guard for TODO #39 — the TF-warp complex-assembly regression.
 *
 * `w1_oh_warp` warps `bw_casing`, which compiles to a hollow tube =
 * `revolve(outer).subtract(revolve(inner))` — a boolean COMPOSITE, not a single
 * revolve. Before the fix, execute.ts's `case 'warp'` only fast-pathed a BARE
 * revolve; a composite fell to the GENERIC `subdivideAxialAdaptive` path, whose
 * default 128 z-stations plane-SPLIT the already-triangulated tube — every wall
 * quad's diagonal spans z+circumference, so each z-plane cut it into off-ring
 * "spanning" triangles. Result: a ~192-tri tube ballooned to ~26 k tris of
 * garbage triangulation → the reported ~53 k verts + faceted sides.
 *
 * The fix generalises the fast path to a revolve-TREE: `isRevolveTree` recognises
 * a boolean/transform tree of revolve leaves, `densifyRevolveTree` densifies each
 * leaf PROFILE (clean ring×segment grid) before the boolean re-runs. This test
 * covers the PURE recognition + densify logic; the WASM boolean build is proven
 * separately by the existing tf golden tests.
 */

const PATH: Pt3[] = [[0, 0, 0], [0.001, 0.928, 9.988], [0.009, 3.059, 17.567], [6.67, 19.037, 39.717]];
// bw_casing od 7 wall 0.4 length 40 → outer 3.5 / inner 3.1, closed [r,z] loop.
const casingOuter: [number, number][] = [[3.5, 0], [3.5, 40], [0, 40], [0, 0]];
const casingInner: [number, number][] = [[3.1, 0], [3.1, 40], [0, 40], [0, 0]];

// The instr tree bw_casing compiles to: revolve(outer).subtract(revolve(inner)).
const casingTree = {
  op: 'booleanDifference',
  obj: { op: 'revolve', profile: casingOuter, segments: 24 },
  arg: { op: 'revolve', profile: casingInner, segments: 24 },
};

describe('TODO #39 — composite (tube) warp takes the clean revolve-tree path', () => {
  it('isRevolveTree recognises a boolean-of-revolves composite', () => {
    expect(isRevolveTree(casingTree)).toBe(true);
    expect(isRevolveTree({ op: 'revolve', profile: casingOuter })).toBe(true);
    // Transforms/unions of revolves qualify; a box/sweep leaf does not.
    expect(isRevolveTree({ op: 'translate', offset: [0, 0, 1], child: casingTree })).toBe(true);
    expect(isRevolveTree({ op: 'union', children: [casingTree, { op: 'revolve', profile: casingOuter }] })).toBe(true);
    expect(isRevolveTree({ op: 'box', w: 1, h: 1, d: 1 })).toBe(false);
    expect(isRevolveTree({ op: 'booleanDifference', obj: casingTree, arg: { op: 'sweep', path: PATH, radius: 1 } })).toBe(false);
  });

  it('densifyRevolveTree densifies each leaf profile while preserving structure', () => {
    const dense = densifyRevolveTree(casingTree, PATH);
    expect(dense.op).toBe('booleanDifference');
    // Both leaves gained interior rings (was 4 pts each → many).
    expect(dense.obj.profile.length).toBeGreaterThan(casingTree.obj.profile.length);
    expect(dense.arg.profile.length).toBeGreaterThan(casingTree.arg.profile.length);
    // Segments + op untouched; radii stay within the original band.
    expect(dense.obj.segments).toBe(24);
    for (const [r] of dense.obj.profile) expect(r).toBeGreaterThanOrEqual(-1e-9);
  });

  it('the densified leaf grids are BOUNDED (no 128-station explosion)', () => {
    const dense = densifyRevolveTree(casingTree, PATH);
    const outer = buildRevolveMesh(dense.obj.profile, 24);
    const inner = buildRevolveMesh(dense.arg.profile, 24);
    // Each leaf is a modest clean grid; the pre-fix generic path exploded the
    // SAME tube to ~26 k tris (measured), so a per-leaf ceiling proves the win.
    expect(outer.faces.length / 3).toBeLessThan(3000);
    expect(inner.faces.length / 3).toBeLessThan(3000);
  });

  it('the OLD generic plane-split path really did explode (documents the bug)', () => {
    // A coarse 2-ring tube (192 tris) → subdivideAxialAdaptive default (128 max)
    // balloons past 20 k tris. Our GENERIC_WARP_MAX_STATIONS=24 cap holds it well
    // under. This asserts the cap matters for the remaining non-revolve warps.
    const coarse = buildRevolveMesh([[3.1, 0], [3.5, 0], [3.5, 40], [3.1, 40]], 24);
    const exploded = subdivideAxialAdaptive(coarse.points, null, coarse.faces, PATH, {});
    const capped = subdivideAxialAdaptive(coarse.points, null, coarse.faces, PATH, { maxStations: 24 });
    expect(exploded.faces.length / 3).toBeGreaterThan(20000); // the bug
    expect(capped.faces.length / 3).toBeLessThan(exploded.faces.length / 3 / 3); // the cap
  });
});
