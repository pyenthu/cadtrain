// svg-reduce.test.ts — pure back-face-cull + degenerate-drop reduction helper.
import { describe, it, expect } from 'vitest';
import { triangleKeepMask, type TriReduceInput } from './svg-reduce';

// A unit cube as a NON-INDEXED mesh: 6 faces × 2 tris = 12 tris = 36 verts,
// each vertex carrying its face's OUTWARD normal (as a real bake would).
function unitCube(): TriReduceInput {
  const faces: { n: [number, number, number]; quad: [number, number, number][] }[] = [
    { n: [1, 0, 0],  quad: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] }, // +X
    { n: [-1, 0, 0], quad: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] }, // -X
    { n: [0, 1, 0],  quad: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] }, // +Y
    { n: [0, -1, 0], quad: [[1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 0, 0]] }, // -Y
    { n: [0, 0, 1],  quad: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] }, // +Z
    { n: [0, 0, -1], quad: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] }, // -Z
  ];
  const pos: number[] = [];
  const nrm: number[] = [];
  const a: number[] = [], b: number[] = [], c: number[] = [];
  let v = 0;
  const push = (p: number[], n: number[]) => { pos.push(...p); nrm.push(...n); return v++; };
  for (const f of faces) {
    const [p0, p1, p2, p3] = f.quad;
    const i0 = push(p0, f.n), i1 = push(p1, f.n), i2 = push(p2, f.n), i3 = push(p3, f.n);
    a.push(i0); b.push(i1); c.push(i2); // tri 1
    a.push(i0); b.push(i2); c.push(i3); // tri 2
  }
  return { triN: a.length, a, b, c, pos, nrm };
}

describe('triangleKeepMask — back-face cull', () => {
  it('diagonal view culls exactly the 3 away-facing faces (6 of 12 tris)', () => {
    const cube = unitCube();
    const r = triangleKeepMask(cube, { view: [1, 1, 1], cull: true });
    expect(r.culled).toBe(6);      // −X, −Y, −Z faces (2 tris each)
    expect(r.kept).toBe(6);        // +X, +Y, +Z faces
    expect(r.degenerate).toBe(0);
    expect(r.mask.reduce((s, x) => s + x, 0)).toBe(6);
  });

  it('axis view keeps silhouette-grazing (perpendicular) faces — only the back face culls', () => {
    const cube = unitCube();
    const r = triangleKeepMask(cube, { view: [0, 0, 1], cull: true });
    expect(r.culled).toBe(2);      // only −Z (dead away); ±X, ±Y graze (dot≈0) → kept
    expect(r.kept).toBe(10);
  });

  it('cull disabled keeps every (non-degenerate) triangle', () => {
    const cube = unitCube();
    const r = triangleKeepMask(cube, { view: [1, 1, 1], cull: false });
    expect(r.culled).toBe(0);
    expect(r.kept).toBe(12);
  });

  it('no normals → nothing culled even with cull:true (facing undeterminable)', () => {
    const cube = unitCube();
    const r = triangleKeepMask({ ...cube, nrm: undefined }, { view: [1, 1, 1], cull: true });
    expect(r.culled).toBe(0);
    expect(r.kept).toBe(12);
  });
});

describe('triangleKeepMask — degenerate drop', () => {
  it('drops a numerically-degenerate (collinear) triangle, keeps the real one', () => {
    // tri 0: real (unit right triangle). tri 1: three collinear points → area 0.
    const input: TriReduceInput = {
      triN: 2,
      a: [0, 3], b: [1, 4], c: [2, 5],
      pos: [
        0, 0, 0,  1, 0, 0,  0, 1, 0,        // real
        0, 0, 0,  1, 0, 0,  2, 0, 0,        // collinear (degenerate)
      ],
      nrm: [
        0, 0, 1,  0, 0, 1,  0, 0, 1,
        0, 0, 1,  0, 0, 1,  0, 0, 1,
      ],
    };
    const r = triangleKeepMask(input, { view: [0, 0, 1], cull: false });
    expect(r.degenerate).toBe(1);
    expect(r.kept).toBe(1);
    expect(Array.from(r.mask)).toEqual([1, 0]);
  });
});
