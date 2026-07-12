import { describe, it, expect } from 'vitest';
import { brepGeometryFromResponse, brepResponseToGeo } from '../brep-adapter';

// A minimal indexed solid (one triangle) with exact normals — the no-cut shape.
const solid = {
  supported: true as const,
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  index: [0, 1, 2],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  cut: false,
  meta: { tris: 1, verts: 3, ms: 12, tolerance: 0.05 },
};

// A non-indexed per-vertex-coloured half-section — the cut shape.
const cut = {
  supported: true as const,
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  colors: [0.8, 0.13, 0.13, 0.8, 0.13, 0.13, 0.53, 0.53, 0.53],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  cut: true,
  meta: { tris: 1, verts: 3, ms: 30, tolerance: 0.05 },
};

describe('brep-adapter', () => {
  it('builds a NON-INDEXED BufferGeometry with crease-aware normals for a solid (E5)', () => {
    // OCCT normals are NO LONGER passed through — the adapter recomputes
    // crease-aware corner normals so a revolve shades smooth at parity with
    // MF/TF (see brep-adapter header). Output is non-indexed (creases split).
    const g = brepGeometryFromResponse(solid);
    expect(g.getAttribute('position').count).toBe(3);
    expect(g.index).toBeNull(); // non-indexed
    // The single triangle lies in z=0 with CCW winding → face normal +z; the
    // crease-aware pass returns that unit normal on every corner.
    const n = Array.from(g.getAttribute('normal').array as Float32Array);
    for (let c = 0; c < 3; c++) {
      expect(n[c * 3]).toBeCloseTo(0, 5);
      expect(n[c * 3 + 1]).toBeCloseTo(0, 5);
      expect(Math.abs(n[c * 3 + 2])).toBeCloseTo(1, 5);
    }
    expect(g.getAttribute('color')).toBeUndefined();
  });

  it('keeps per-vertex colours for a cut half-section', () => {
    const g = brepGeometryFromResponse(cut);
    expect(g.getAttribute('color')).toBeTruthy();
    expect(Array.from(g.getAttribute('color').array)).toEqual(Array.from(new Float32Array(cut.colors)));
  });

  it('routes a solid to { full } and a cut to { cutVC }', () => {
    const solidGeo = brepResponseToGeo(solid);
    expect(solidGeo.full).toBeTruthy();
    expect(solidGeo.cutVC).toBeUndefined();

    const cutGeo = brepResponseToGeo(cut);
    expect(cutGeo.cutVC).toBeTruthy();
    expect(cutGeo.full).toBeUndefined();
  });

  it('computes vertex normals when the response carries none', () => {
    const g = brepGeometryFromResponse({ supported: true, positions: solid.positions, index: solid.index });
    expect(g.getAttribute('normal')).toBeTruthy();
    expect(g.getAttribute('normal').count).toBe(3);
  });

  it('ignores a malformed (length-mismatched) colour array', () => {
    const g = brepGeometryFromResponse({ supported: true, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], colors: [1, 0, 0] });
    expect(g.getAttribute('color')).toBeUndefined();
  });
});
