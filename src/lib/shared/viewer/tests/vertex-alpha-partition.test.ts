import { describe, it, expect } from 'vitest';
import { partitionTrianglesByAlpha, OPAQUE_ALPHA_EPS } from '../vertex-alpha-partition';

/** Build a non-indexed RGBA colour array from a per-triangle alpha list.
 *  Mirrors colorBySourceGeo: 3 verts/triangle, all 3 corners share the alpha. */
function nonIndexedColors(triAlphas: number[]): Float32Array {
  const c = new Float32Array(triAlphas.length * 3 * 4);
  triAlphas.forEach((a, t) => {
    for (let v = 0; v < 3; v++) {
      const o = (t * 3 + v) * 4;
      c[o] = 1; c[o + 1] = 0; c[o + 2] = 0; c[o + 3] = a;
    }
  });
  return c;
}

describe('partitionTrianglesByAlpha (non-indexed, per-triangle alpha)', () => {
  it('flags the mixed case and counts opaque vs transparent triangles', () => {
    // 4 triangles: opaque, transparent, opaque, transparent.
    const colors = nonIndexedColors([1, 0.4, 1, 0.4]);
    const p = partitionTrianglesByAlpha(colors, null, 12);
    expect(p.mixed).toBe(true);
    expect(p.opaqueCount).toBe(6); // 2 opaque tris × 3
    expect(p.transparentCount).toBe(6); // 2 transparent tris × 3
    expect(p.order.length).toBe(12);
  });

  it('orders opaque triangles first, then transparent', () => {
    // tri0 transparent, tri1 opaque, tri2 transparent.
    const colors = nonIndexedColors([0.3, 1, 0.3]);
    const p = partitionTrianglesByAlpha(colors, null, 9);
    // group 0 (indices 0..2) must be the opaque tri (original verts 3,4,5)
    expect(Array.from(p.order.slice(0, p.opaqueCount))).toEqual([3, 4, 5]);
    // group 1 = the two transparent tris (verts 0,1,2 then 6,7,8)
    expect(Array.from(p.order.slice(p.opaqueCount))).toEqual([0, 1, 2, 6, 7, 8]);
    expect(p.opaqueCount).toBe(3);
    expect(p.transparentCount).toBe(6);
  });

  it('near-opaque (>= threshold) counts as opaque; just under does not', () => {
    // 0.998 ≥ 0.996 → opaque; 0.99 < 0.996 → transparent. (Avoids the float32
    // round of exactly OPAQUE_ALPHA_EPS dipping just under the threshold.)
    expect(0.998).toBeGreaterThanOrEqual(OPAQUE_ALPHA_EPS);
    const colors = nonIndexedColors([0.998, 0.99]);
    const p = partitionTrianglesByAlpha(colors, null, 6);
    expect(p.opaqueCount).toBe(3);
    expect(p.transparentCount).toBe(3);
    expect(p.mixed).toBe(true);
  });

  it('fully opaque → not mixed (single opaque material path)', () => {
    const colors = nonIndexedColors([1, 1, 1]);
    const p = partitionTrianglesByAlpha(colors, null, 9);
    expect(p.mixed).toBe(false);
    expect(p.opaqueCount).toBe(9);
    expect(p.transparentCount).toBe(0);
  });

  it('fully transparent → not mixed (single transparent material path)', () => {
    const colors = nonIndexedColors([0.5, 0.2, 0.9]);
    const p = partitionTrianglesByAlpha(colors, null, 9);
    expect(p.mixed).toBe(false);
    expect(p.opaqueCount).toBe(0);
    expect(p.transparentCount).toBe(9);
  });

  it('honours an explicit index buffer (indexed geometry)', () => {
    // 4 shared verts, 2 triangles via index; tri0 opaque, tri1 transparent.
    const colors = new Float32Array([
      1, 0, 0, 1, // v0 opaque
      1, 0, 0, 1, // v1 opaque
      1, 0, 0, 1, // v2 opaque
      1, 0, 0, 0.3, // v3 transparent
    ]);
    const index = [0, 1, 2, /* tri1 */ 1, 2, 3];
    const p = partitionTrianglesByAlpha(colors, index, 4);
    expect(p.mixed).toBe(true);
    expect(Array.from(p.order.slice(0, p.opaqueCount))).toEqual([0, 1, 2]);
    expect(Array.from(p.order.slice(p.opaqueCount))).toEqual([1, 2, 3]);
  });
});
