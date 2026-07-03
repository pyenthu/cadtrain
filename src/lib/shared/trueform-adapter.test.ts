import { describe, it, expect } from 'vitest';
import { tfMeshToGeo, triangulateFaces, sectionFaceColors, SECTION_OUTER_RGB, SECTION_INNER_RGB } from './trueform-adapter';

/**
 * Guards the bored-pipe shading fix (2026-07-03): the TF adapter must produce
 * CREASE-AWARE normals — smooth across shallow facets (curved walls), hard at a
 * >crease-angle rim (cap↔wall) — not the fully-averaged normals a plain
 * `computeVertexNormals()` would give (which smears the pipe rim).
 */

// Read the per-corner normal for triangle `t`, corner `k` from a non-indexed geo.
function cornerNormal(geo: any, t: number, k: number): [number, number, number] {
  const n = geo.getAttribute('normal').array as Float32Array;
  const o = t * 9 + k * 3;
  return [n[o], n[o + 1], n[o + 2]];
}
const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) < eps;

describe('triangulateFaces', () => {
  it('passes triangles through unchanged', () => {
    const f = triangulateFaces([0, 1, 2, 2, 3, 0], 3);
    expect(Array.from(f)).toEqual([0, 1, 2, 2, 3, 0]);
  });
  it('fan-triangulates quads (stride 4)', () => {
    const f = triangulateFaces([0, 1, 2, 3], 4);
    expect(Array.from(f)).toEqual([0, 1, 2, 0, 2, 3]);
  });
});

describe('tfMeshToGeo crease-aware normals', () => {
  it('is non-indexed with a normal attribute', () => {
    const g: any = tfMeshToGeo({ points: [0, 0, 0, 1, 0, 0, 0, 1, 0], faces: [0, 1, 2] });
    expect(g.index).toBeNull();
    expect(g.getAttribute('normal')).toBeTruthy();
    expect(g.getAttribute('position').count).toBe(3);
  });

  it('empty faces → keeps points, no crash', () => {
    const g: any = tfMeshToGeo({ points: [0, 0, 0, 1, 1, 1], faces: [] });
    expect(g.getAttribute('position').count).toBe(2);
  });

  it('keeps a HARD rim (cap↔wall at 90°) split — not averaged', () => {
    // A vertical wall quad (in the x=1 plane, facing +x) sharing its TOP edge
    // with a horizontal cap triangle (facing +z at z=1). The shared edge is a
    // 90° crease → the wall corners must stay +x, the cap corners +z.
    //   verts: 0=(1,0,0) 1=(1,1,0) 2=(1,1,1) 3=(1,0,1)  wall (x=1, normal +x)
    //          4=(0,0,1) 5=(0,1,1)                       cap  (z=1, normal +z)
    // wall tris: (0,1,2) (0,2,3)  ; cap tri uses the shared top edge 3-2:
    //   cap tri: (3,2,5) then (3,5,4)  (z=1 plane, normal +z)
    const points = [
      1, 0, 0,  // 0
      1, 1, 0,  // 1
      1, 1, 1,  // 2
      1, 0, 1,  // 3
      0, 0, 1,  // 4
      0, 1, 1,  // 5
    ];
    const faces = [
      0, 1, 2,   // wall t0
      0, 2, 3,   // wall t1
      3, 2, 5,   // cap  t2
      3, 5, 4,   // cap  t3
    ];
    const g: any = tfMeshToGeo({ points, faces });
    // Every wall corner (t0,t1) points +x (|nx|≈1, nz≈0) — the rim did NOT blend
    // the cap's +z into it.
    for (const t of [0, 1]) {
      for (const k of [0, 1, 2]) {
        const [nx, , nz] = cornerNormal(g, t, k);
        expect(Math.abs(nx)).toBeGreaterThan(0.99);
        expect(near(nz, 0)).toBe(true);
      }
    }
    // Every cap corner (t2,t3) points +z (|nz|≈1, nx≈0).
    for (const t of [2, 3]) {
      for (const k of [0, 1, 2]) {
        const [nx, , nz] = cornerNormal(g, t, k);
        expect(Math.abs(nz)).toBeGreaterThan(0.99);
        expect(near(nx, 0)).toBe(true);
      }
    }
  });

  it('SMOOTHS a shallow wall bend (< crease angle) at the shared edge', () => {
    // Two wall facets meeting at a ~20° dihedral along a shared vertical edge —
    // below the 60° crease → the shared-edge corners must average the two facet
    // normals (a single blended normal), so a faceted cylinder reads smooth.
    // Facet A normal ~ +x ; facet B tilted 20° about z from +x.
    const A = 0, deg = 20, r = 1;
    const ax = Math.cos((A * Math.PI) / 180), ay = Math.sin((A * Math.PI) / 180);
    const bx = Math.cos((deg * Math.PI) / 180), by = Math.sin((deg * Math.PI) / 180);
    // Shared edge along z at the "hinge" point p1 (top) / p1b (bottom).
    // Build two quads (as 2 tris each) that share the vertical edge.
    const points = [
      // facet A: outward point pA, hinge pH   (z=0 and z=1)
      -ax * r, -ay * r, 0,  // 0 A-outer bottom
      -ax * r, -ay * r, 1,  // 1 A-outer top
      0, 0, 0,              // 2 hinge bottom (shared)
      0, 0, 1,              // 3 hinge top (shared)
      bx * r, by * r, 0,    // 4 B-outer bottom
      bx * r, by * r, 1,    // 5 B-outer top
    ];
    // A quad: (0,2,3,1) ; B quad: (2,4,5,3). Wind so normals face outward (+ish x).
    const faces = [
      0, 2, 3, 0, 3, 1,   // facet A
      2, 4, 5, 2, 5, 3,   // facet B
    ];
    const g: any = tfMeshToGeo({ points, faces });
    // Collect corner normals at the shared hinge positions (0,0,0)/(0,0,1) across
    // A-tris (0,1) and B-tris (2,3). They must be a SINGLE blended direction, so
    // an A-hinge corner ≈ a B-hinge corner (dot ≈ 1), not two distinct facets.
    const pos = g.getAttribute('position').array as Float32Array;
    const nrm = g.getAttribute('normal').array as Float32Array;
    const hingeNormals: [number, number, number][] = [];
    for (let c = 0; c < pos.length / 3; c++) {
      const x = pos[c * 3], y = pos[c * 3 + 1];
      if (near(x, 0) && near(y, 0)) hingeNormals.push([nrm[c * 3], nrm[c * 3 + 1], nrm[c * 3 + 2]]);
    }
    expect(hingeNormals.length).toBeGreaterThan(0);
    // All hinge-corner normals are (nearly) identical → smoothed across the bend.
    // A HARD (unsmoothed) split would leave A-corners at +x and B-corners tilted
    // 20°, i.e. dot ≈ cos20° = 0.9397; the blended case sits ~0.993 (a hair below
    // 1 only from asymmetric top/bottom triangle-area weighting), so 0.98 cleanly
    // proves the bend was smoothed, not faceted.
    const [rx, ry, rz] = hingeNormals[0];
    for (const [x, y, z] of hingeNormals) {
      const dot = x * rx + y * ry + z * rz;
      expect(dot).toBeGreaterThan(0.98);
    }
  });
});

/**
 * Guards the TF cutaway face→colour split (sectional cross-section): a triangle
 * whose three verts all lie on a cut plane is a revealed SECTION face (grey
 * interior); anything else is outer body skin (red). Mirrors the Manifold
 * `manifoldToCutVC` onCutX/onCutY classifier.
 */
describe('sectionFaceColors (TF cutaway split)', () => {
  const planes = [{ axis: 0 as const, coord: 0 }, { axis: 1 as const, coord: 0 }];
  // Colours round-trip through Float32Array, so compare with a tolerance.
  const rgbNear = (cols: ArrayLike<number>, off: number, rgb: [number, number, number]) => {
    expect(cols[off]).toBeCloseTo(rgb[0], 5);
    expect(cols[off + 1]).toBeCloseTo(rgb[1], 5);
    expect(cols[off + 2]).toBeCloseTo(rgb[2], 5);
  };

  it('colours a face flush with the x=0 cut plane GREY (interior)', () => {
    // Triangle entirely on x=0 (a cross-section face).
    const cols = sectionFaceColors([0, 0, 0, 0, 1, 0, 0, 0, 1], [0, 1, 2], { planes });
    rgbNear(cols, 0, SECTION_INNER_RGB);
  });

  it('colours a face flush with the y=0 cut plane GREY (interior)', () => {
    const cols = sectionFaceColors([0, 0, 0, 1, 0, 0, 0, 0, 1], [0, 1, 2], { planes });
    rgbNear(cols, 0, SECTION_INNER_RGB);
  });

  it('colours an off-plane (outer skin) face RED', () => {
    // A face out at x=5 — nowhere near a cut plane.
    const cols = sectionFaceColors([5, 0, 0, 5, 1, 0, 5, 0, 1], [0, 1, 2], { planes });
    rgbNear(cols, 0, SECTION_OUTER_RGB);
  });

  it('a face only PARTLY on the plane is NOT a section face (stays red)', () => {
    // Two verts on x=0 but the third off it → the cut didn't create this face.
    const cols = sectionFaceColors([0, 0, 0, 0, 1, 0, 2, 0, 1], [0, 1, 2], { planes });
    rgbNear(cols, 0, SECTION_OUTER_RGB);
  });

  it('honours custom outer/inner colours', () => {
    const outer: [number, number, number] = [1, 1, 1];
    const inner: [number, number, number] = [0.2, 0.2, 0.2];
    const onPlane = sectionFaceColors([0, 0, 0, 0, 1, 0, 0, 0, 1], [0, 1, 2], { planes, outer, inner });
    const offPlane = sectionFaceColors([5, 0, 0, 5, 1, 0, 5, 0, 1], [0, 1, 2], { planes, outer, inner });
    rgbNear(onPlane, 0, inner);
    rgbNear(offPlane, 0, outer);
  });
});

describe('tfMeshToGeo section colouring', () => {
  it('emits a per-vertex color attribute when section is supplied', () => {
    // One on-plane triangle (x=0) + one off-plane triangle.
    const points = [
      0, 0, 0, 0, 1, 0, 0, 0, 1,   // 0,1,2 — on x=0 (section → grey)
      5, 0, 0, 5, 1, 0, 5, 0, 1,   // 3,4,5 — off-plane (skin → red)
    ];
    const faces = [0, 1, 2, 3, 4, 5];
    const g: any = tfMeshToGeo({ points, faces }, undefined, { planes: [{ axis: 0, coord: 0 }] });
    const col = g.getAttribute('color');
    expect(col).toBeTruthy();
    expect(col.count).toBe(6); // 2 tris * 3 corners, non-indexed
    // First tri corners (0,1,2) grey; second tri corners (3,4,5) red.
    expect(col.array[0]).toBeCloseTo(SECTION_INNER_RGB[0], 5);
    expect(col.array[9]).toBeCloseTo(SECTION_OUTER_RGB[0], 5);
    expect(col.array[10]).toBeCloseTo(SECTION_OUTER_RGB[1], 5);
  });

  it('emits NO color attribute when section is absent (plain solid path)', () => {
    const g: any = tfMeshToGeo({ points: [0, 0, 0, 1, 0, 0, 0, 1, 0], faces: [0, 1, 2] });
    expect(g.getAttribute('color')).toBeFalsy();
  });
});
