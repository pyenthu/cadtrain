/**
 * crease-normals.test.ts — crease-aware smooth normals (the smoothness fix).
 *
 * Manifold's `calculateNormals` returns ALL-ZERO normals on some welded meshes
 * (most acutely a perfectly-straight PRISM sweep). The old fallback either
 * flat-shaded (non-indexed `computeVertexNormals`) or smoothed EVERYTHING
 * (rounding genuine sharp edges). `creaseAwareCornerNormals` recomputes per-
 * triangle-corner normals that shade smooth ACROSS gentle dihedrals and stay
 * hard across sharp ones (> crease angle). Pins:
 *   • a cylinder's side wall → smooth + radial,
 *   • a cube's faces → flat (corners stay sharp),
 *   • a square-tube's side edges → sharp,
 *   • end-to-end: a straight-Z sweep's rendered `full` normals are radial.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initManifold } from './manifold-helpers';
import { sweepAlongPath } from './manifold-mesh';
import { creaseAwareCornerNormals, finalizeManifold } from './render-helpers';

/** Regular n-gon prism (radius R, height H along +Z) as ONE indexed mesh:
 *  side band + top/bottom cap fans. Returns deduped positions + triangles. */
function prism(n: number, R: number, H: number): { pos: Float32Array; tri: Uint32Array } {
  const pos: number[] = [];
  const idx = (r: number, ring: 0 | 1) => (ring * n + r);
  for (let ring = 0; ring < 2; ring++) {
    for (let r = 0; r < n; r++) {
      const a = (2 * Math.PI * r) / n;
      pos.push(R * Math.cos(a), R * Math.sin(a), ring * H);
    }
  }
  const cB = pos.length / 3; pos.push(0, 0, 0);      // bottom centre
  const cT = pos.length / 3; pos.push(0, 0, H);      // top centre
  const tri: number[] = [];
  for (let r = 0; r < n; r++) {
    const r1 = (r + 1) % n;
    // side quad (outward)
    tri.push(idx(r, 0), idx(r1, 0), idx(r1, 1));
    tri.push(idx(r, 0), idx(r1, 1), idx(r, 1));
    // caps
    tri.push(cB, idx(r1, 0), idx(r, 0));
    tri.push(cT, idx(r, 1), idx(r1, 1));
  }
  return { pos: new Float32Array(pos), tri: new Uint32Array(tri) };
}

/** Unit cube [0,1]³ as an indexed mesh (12 tris). */
function cube(): { pos: Float32Array; tri: Uint32Array } {
  const pos = new Float32Array([
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,   // z=0
    0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,   // z=1
  ]);
  const tri = new Uint32Array([
    0, 2, 1, 0, 3, 2,   // bottom
    4, 5, 6, 4, 6, 7,   // top
    0, 1, 5, 0, 5, 4,   // y=0
    1, 2, 6, 1, 6, 5,   // x=1
    2, 3, 7, 2, 7, 6,   // y=1
    3, 0, 4, 3, 4, 7,   // x=0
  ]);
  return { pos, tri };
}

describe('creaseAwareCornerNormals', () => {
  it('cylinder side wall → smooth + radial (crease 60°)', () => {
    const { pos, tri } = prism(48, 2, 4);
    const nrm = creaseAwareCornerNormals(pos, tri, 60);
    const nt = tri.length / 3;
    let sideCorners = 0;
    for (let t = 0; t < nt; t++) {
      for (let k = 0; k < 3; k++) {
        const v = tri[t * 3 + k];
        const px = pos[v * 3], py = pos[v * 3 + 1];
        const rad = Math.hypot(px, py);
        if (rad < 0.5) continue; // skip cap-centre corners
        const o = t * 9 + k * 3;
        const nx = nrm[o], ny = nrm[o + 1], nz = nrm[o + 2];
        // A SIDE corner (not a cap face): normal is radial (nz≈0, aligned xy).
        // A cap corner at the rim: normal is axial (nz≈±1). Detect side by nz.
        if (Math.abs(nz) < 0.5) {
          sideCorners++;
          expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 5);
          // radial: (nx,ny) points along (px,py)
          const rdot = (nx * px + ny * py) / (rad || 1);
          expect(rdot).toBeGreaterThan(0.98);
        }
      }
    }
    expect(sideCorners).toBeGreaterThan(0);
  });

  it('cylinder rim vertex is SPLIT: both a radial (side) and an axial (cap) normal', () => {
    const { pos, tri } = prism(16, 2, 4);
    const nrm = creaseAwareCornerNormals(pos, tri, 60);
    const nt = tri.length / 3;
    // Pick a rim vertex (top ring, r=0) → its corners should include a radial
    // one (from a side face) AND an axial one (from the top cap).
    const rimV = 16 + 0; // top ring vertex 0
    let hasRadial = false, hasAxial = false;
    for (let t = 0; t < nt; t++) {
      for (let k = 0; k < 3; k++) {
        if (tri[t * 3 + k] !== rimV) continue;
        const o = t * 9 + k * 3;
        if (Math.abs(nrm[o + 2]) > 0.9) hasAxial = true;   // cap face
        if (Math.abs(nrm[o + 2]) < 0.2) hasRadial = true;  // side face
      }
    }
    expect(hasRadial).toBe(true);
    expect(hasAxial).toBe(true);
  });

  it('cube faces stay FLAT — every corner normal equals its own axis-aligned face normal', () => {
    const { pos, tri } = cube();
    const nrm = creaseAwareCornerNormals(pos, tri, 60);
    const nt = tri.length / 3;
    for (let t = 0; t < nt; t++) {
      for (let k = 0; k < 3; k++) {
        const o = t * 9 + k * 3;
        const comps = [Math.abs(nrm[o]), Math.abs(nrm[o + 1]), Math.abs(nrm[o + 2])];
        const maxc = Math.max(...comps);
        // Axis-aligned unit normal → one component ≈1, the others ≈0 (no rounding
        // toward a neighbour). If corners were smoothed they'd be diagonal (~0.577).
        expect(maxc).toBeCloseTo(1, 4);
      }
    }
  });

  it('square tube (4-gon prism) side edges stay SHARP (each side face keeps its own normal)', () => {
    const { pos, tri } = prism(4, 2, 4);
    const nrm = creaseAwareCornerNormals(pos, tri, 60);
    const nt = tri.length / 3;
    for (let t = 0; t < nt; t++) {
      for (let k = 0; k < 3; k++) {
        const v = tri[t * 3 + k];
        const rad = Math.hypot(pos[v * 3], pos[v * 3 + 1]);
        if (rad < 0.5) continue;
        const o = t * 9 + k * 3;
        if (Math.abs(nrm[o + 2]) < 0.5) {
          // Side face normal must be a FLAT face normal (magnitude 1, not the
          // 45° average of two perpendicular side faces).
          expect(Math.hypot(nrm[o], nrm[o + 1])).toBeCloseTo(1, 4);
        }
      }
    }
  });
});

describe('finalizeManifold end-to-end — straight-Z sweep renders smooth', () => {
  beforeAll(async () => { await initManifold(); });

  it('straight-Z round sweep full-mesh normals are radial (smooth), not flat', () => {
    const n = 32, r = 1.5;
    const section: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      section.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    const m = sweepAlongPath([[0, 0, 0], [0, 0, 2], [0, 0, 4]], section);
    const res = finalizeManifold(m, r * 1.5, undefined, undefined, { skipCutaway: true });
    const posAttr = res.full.getAttribute('position');
    const nrmAttr = res.full.getAttribute('normal');
    expect(nrmAttr).toBeTruthy();
    const P = posAttr.array as Float32Array;
    const Nn = nrmAttr.array as Float32Array;
    const idxArr = res.full.index ? (res.full.index.array as ArrayLike<number>) : null;
    const count = idxArr ? idxArr.length : P.length / 3;
    let sideChecked = 0;
    for (let i = 0; i < count; i++) {
      const vi = idxArr ? idxArr[i] : i;
      const px = P[vi * 3], py = P[vi * 3 + 1];
      const rad = Math.hypot(px, py);
      const nx = Nn[vi * 3], ny = Nn[vi * 3 + 1], nz = Nn[vi * 3 + 2];
      if (rad > 0.5 && Math.abs(nz) < 0.5) {
        // side wall vertex → normal must be radial + unit (smooth), never zero.
        expect(Math.hypot(nx, ny, nz)).toBeGreaterThan(0.5);
        expect((nx * px + ny * py) / (rad || 1)).toBeGreaterThan(0.9);
        sideChecked++;
      }
    }
    expect(sideChecked).toBeGreaterThan(0);
  });

  it('straight-Z sweep side wall is SMOOTH: every shared circumferential position carries ONE normal (multi-normal-pos == 0)', () => {
    // Mirrors the decoded-bake repro exactly: a 24-gon section swept up a
    // straight Z path. calculateNormals returns VALID-but-PER-FACET normals here
    // (every shared side position had >1 distinct normal = flat/blocky). With the
    // ALWAYS-crease-aware trigger the side wall must collapse to ONE radial
    // normal per shared position → multi-normal-pos == 0.
    const n = 24, r = 1.5;
    const section: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      section.push([+(Math.cos(a) * r).toFixed(4), +(Math.sin(a) * r).toFixed(4)]);
    }
    const m = sweepAlongPath([[0, 0, 0], [0, 0, 2.5], [0, 0, 5]], section);
    const res = finalizeManifold(m, r * 1.5, undefined, undefined, { skipCutaway: true });
    const posAttr = res.full.getAttribute('position');
    const nrmAttr = res.full.getAttribute('normal');
    const P = posAttr.array as Float32Array;
    const N = nrmAttr.array as Float32Array;
    const idxArr = res.full.index ? (res.full.index.array as ArrayLike<number>) : null;
    const count = idxArr ? idxArr.length : P.length / 3;
    // Group DISTINCT normals per rounded side-wall position.
    const key = (x: number, y: number, z: number) => `${x.toFixed(2)}|${y.toFixed(2)}|${z.toFixed(2)}`;
    const nkey = (x: number, y: number, z: number) => `${x.toFixed(2)}|${y.toFixed(2)}|${z.toFixed(2)}`;
    const byPos = new Map<string, Set<string>>();
    for (let i = 0; i < count; i++) {
      const vi = idxArr ? idxArr[i] : i;
      const px = P[vi * 3], py = P[vi * 3 + 1], pz = P[vi * 3 + 2];
      const nx = N[vi * 3], ny = N[vi * 3 + 1], nz = N[vi * 3 + 2];
      if (Math.hypot(px, py) < 0.5) continue; // skip cap-centre
      if (Math.abs(nz) >= 0.5) continue;      // side wall only (skip cap faces)
      const k = key(px, py, pz);
      if (!byPos.has(k)) byPos.set(k, new Set());
      byPos.get(k)!.add(nkey(nx, ny, nz));
    }
    let multiNormalPos = 0;
    for (const s of byPos.values()) if (s.size > 1) multiNormalPos++;
    expect(byPos.size).toBeGreaterThan(0);
    expect(multiNormalPos).toBe(0);
  });
});

describe('finalizeManifold smoothWarp — warped parts shade fully smooth', () => {
  beforeAll(async () => { await initManifold(); });

  /** Count side-wall positions that carry >1 distinct normal (a SHARP edge
   *  reads per-facet → multiple normals; a fully-smoothed edge → one). Filters
   *  to pure side verts (nz≈0) so caps don't confuse the tally. */
  function multiNormalSidePositions(res: { full: any }): { multi: number; total: number } {
    const P = res.full.getAttribute('position').array as Float32Array;
    const N = res.full.getAttribute('normal').array as Float32Array;
    const idxArr = res.full.index ? (res.full.index.array as ArrayLike<number>) : null;
    const count = idxArr ? idxArr.length : P.length / 3;
    const byPos = new Map<string, Set<string>>();
    for (let i = 0; i < count; i++) {
      const vi = idxArr ? idxArr[i] : i;
      const px = P[vi * 3], py = P[vi * 3 + 1], pz = P[vi * 3 + 2];
      const nx = N[vi * 3], ny = N[vi * 3 + 1], nz = N[vi * 3 + 2];
      if (Math.hypot(px, py) < 0.5) continue;   // skip cap-centre corners
      if (Math.abs(nz) >= 0.5) continue;        // side wall only (skip cap faces)
      const k = `${px.toFixed(2)}|${py.toFixed(2)}|${pz.toFixed(2)}`;
      if (!byPos.has(k)) byPos.set(k, new Set());
      byPos.get(k)!.add(`${nx.toFixed(2)}|${ny.toFixed(2)}|${nz.toFixed(2)}`);
    }
    let multi = 0;
    for (const s of byPos.values()) if (s.size > 1) multi++;
    return { multi, total: byPos.size };
  }

  /** A square (4-gon) prism swept up a straight Z path (3 rings → a MID ring of
   *  pure side verts). Its 90° vertical edges exceed the 60° crease → SHARP by
   *  default; smoothWarp's 180° crease must smooth them. */
  function squarePrism(): any {
    const R = 2;
    const section: [number, number][] = [[R, R], [-R, R], [-R, -R], [R, -R]];
    return sweepAlongPath([[0, 0, 0], [0, 0, 2.5], [0, 0, 5]], section);
  }

  it('default (non-warped) keeps square-tube vertical edges SHARP', () => {
    const res = finalizeManifold(squarePrism(), 3, undefined, undefined, { skipCutaway: true });
    const { multi, total } = multiNormalSidePositions(res as any);
    expect(total).toBeGreaterThan(0);
    expect(multi).toBeGreaterThan(0); // 90° > 60° crease → per-facet, sharp
  });

  it('smoothWarp:true SMOOTHS every side-wall position (multi-normal == 0)', () => {
    const res = finalizeManifold(squarePrism(), 3, undefined, undefined, { skipCutaway: true, smoothWarp: true });
    const { multi, total } = multiNormalSidePositions(res as any);
    expect(total).toBeGreaterThan(0);
    expect(multi).toBe(0); // 180° crease → area-weighted smooth, no split
  });

  it('smoothWarp:false is BYTE-IDENTICAL to the default bake (non-warped unchanged)', () => {
    const a = finalizeManifold(squarePrism(), 3, undefined, undefined, { skipCutaway: true });
    const b = finalizeManifold(squarePrism(), 3, undefined, undefined, { skipCutaway: true, smoothWarp: false });
    const an = a.full.getAttribute('normal').array as Float32Array;
    const bn = b.full.getAttribute('normal').array as Float32Array;
    expect(bn.length).toBe(an.length);
    for (let i = 0; i < an.length; i++) expect(bn[i]).toBe(an[i]);
  });
});
