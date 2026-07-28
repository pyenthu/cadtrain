import { describe, it, expect, beforeAll } from 'vitest';
import { buildLoftGrid, buildLoftMesh, loftScaleAt, type Pt2 } from '../loft';
import { executeTfRecipe, recipeHasUnsupported } from '../execute';
import { graphToTf, type TfInstr, type TfRecipe } from '$lib/engines/trueform/graph-to-tf';
import type { Graph } from '$lib/graph/composition/composition-graph-types';
import * as helpers from '$lib/engines/manifold/manifold-helpers';
import { r_loft as mfLoft } from '$lib/graph/stdlib/r_loft';

/**
 * Guards the PURE welded-LOFT builder `buildLoftMesh` (behind `tfLoftProfile`) —
 * the native TF analogue of Manifold's `r_loft`. Sweeping a closed 2D section
 * down Z while SCALING it by a smooth shape-along-length curve (barrel / waist /
 * flare / …) must yield a WATERTIGHT 2-MANIFOLD (every undirected edge shared by
 * exactly 2 triangles, every directed half-edge exactly once → orientable), χ=2
 * (genus-0), of the expected volume. No WASM for the topology/volume checks —
 * same split as `extrude.test.ts`. The absolute in/out SIGN is fixed at runtime
 * by tf's `positivelyOriented`, so we assert |volume| + winding-independent
 * topology.
 *
 * THE FAT-MIDDLE PROPERTY: a barrel is fatter in the MIDDLE than at BOTH ends —
 * a MONOTONIC end-scale (r_weld_extrude's taper) can't fake it. We pin the
 * mid-section radius > end radius, on both the section stack and the built mesh.
 *
 * PLUS a real MANIFOLD ORACLE: the same recipe baked through the stdlib `r_loft`
 * (which uses the manifold-mesh gridPatch build) must have the SAME volume + bbox
 * within tolerance — so the TF loft matches the reference geometry, not just
 * "some closed solid". AND the graph→TF lowering emits a native `loft` instr (not
 * UNSUPPORTED), which the executor walks into `tf.mesh` + `positivelyOriented`.
 */

// ─── topology + volume helpers (mirrors extrude.test.ts) ─────────────────────

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

/** Signed volume of a closed triangle mesh = Σ (v0 · (v1 × v2)) / 6. The SIGN is
 *  winding-dependent (fixed outward by tf's positivelyOriented at runtime); we
 *  assert its MAGNITUDE. */
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

interface Bbox { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number; }
function bboxOf(points: ArrayLike<number>, numProp = 3): Bbox {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i + 2 < points.length; i += numProp) {
    const x = points[i], y = points[i + 1], z = points[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

/** Max radial extent hypot(x,y) among the mesh points whose z is within `tol` of
 *  `targetZ` (the "section radius" at a Z-station). */
function maxRadiusAtZ(points: Float32Array, targetZ: number, tol: number): number {
  let r = 0;
  for (let i = 0; i + 2 < points.length; i += 3) {
    const z = points[i + 2];
    if (Math.abs(z - targetZ) <= tol) r = Math.max(r, Math.hypot(points[i], points[i + 1]));
  }
  return r;
}

/** Max radial extent of a section-stack RING. */
function ringMaxRadius(ring: readonly (readonly [number, number, number])[]): number {
  let r = 0;
  for (const [x, y] of ring) r = Math.max(r, Math.hypot(x, y));
  return r;
}

// A centred square section (t_barrel's `sq` with size=2), CCW.
const SQUARE: Pt2[] = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
// The t_barrel recipe: length 8, 48 divs, no twist, bulge 0.4, barrel, 8 segs.
const BARREL = { length: 8, divs: 48, twist: 0, bulge: 0.4, shape: 'barrel', segments: 8 } as const;

describe('buildLoftMesh — native TF barrel loft', () => {
  it('barrel loft is a watertight genus-0 solid (χ=2), positive volume, sane bbox', () => {
    const { points, faces } = buildLoftMesh(SQUARE, BARREL);
    assertClosedManifold(points, faces);
    expect(euler(points, faces)).toBe(2);
    const vol = Math.abs(signedVolume(points, faces));
    // ∫₀⁸ 16·s(t)² dz with s = 1 + 0.4·sin(πt) ≈ 203 (sanity band).
    expect(vol).toBeGreaterThan(190);
    expect(vol).toBeLessThan(215);
    // Bbox: z spans [0, length]; the mid ring's corner x = 2·s(0.5) = 2·1.4 = 2.8.
    const bb = bboxOf(points);
    expect(bb.minZ).toBeCloseTo(0, 5);
    expect(bb.maxZ).toBeCloseTo(8, 5);
    expect(bb.maxX).toBeCloseTo(2.8, 4);
    expect(bb.minX).toBeCloseTo(-2.8, 4);
  });

  it('FAT MIDDLE: the mid section radius exceeds BOTH end radii (a monotonic end-scale cannot)', () => {
    // 1) the shape curve itself: barrel bulges at t=0.5, equal (=1) at both ends.
    expect(loftScaleAt('barrel', 0.4, 0.5)).toBeCloseTo(1.4, 6);
    expect(loftScaleAt('barrel', 0.4, 0)).toBeCloseTo(1.0, 6);
    expect(loftScaleAt('barrel', 0.4, 1)).toBeCloseTo(1.0, 6);

    // 2) the section STACK: mid ring wider than either end ring.
    const grid = buildLoftGrid(SQUARE, BARREL);
    const mid = ringMaxRadius(grid[Math.round(grid.length / 2)]);
    const top = ringMaxRadius(grid[0]);
    const bot = ringMaxRadius(grid[grid.length - 1]);
    expect(mid).toBeGreaterThan(top * 1.3);
    expect(mid).toBeGreaterThan(bot * 1.3);
    expect(top).toBeCloseTo(bot, 6); // equal ends — the barrel signature

    // 3) the BUILT MESH: max radial at mid-z > max radial at either end-z.
    const { points } = buildLoftMesh(SQUARE, BARREL);
    const rMid = maxRadiusAtZ(points, 4, 0.05);
    const rTop = maxRadiusAtZ(points, 0, 0.05);
    const rBot = maxRadiusAtZ(points, 8, 0.05);
    expect(rMid).toBeGreaterThan(rTop * 1.3);
    expect(rMid).toBeGreaterThan(rBot * 1.3);
  });

  it('waist / flare shapes also build watertight genus-0 solids (other curves sane)', () => {
    for (const shape of ['waist', 'flare', 'ogive', 'scurve'] as const) {
      const { points, faces } = buildLoftMesh(SQUARE, { ...BARREL, shape });
      assertClosedManifold(points, faces);
      expect(euler(points, faces), `${shape} χ`).toBe(2);
      expect(Math.abs(signedVolume(points, faces)), `${shape} volume`).toBeGreaterThan(0.1);
    }
  });
});

describe('buildLoftMesh — parity with the Manifold r_loft oracle', () => {
  beforeAll(async () => { await helpers.initManifold(); });

  it('barrel: TF loft volume + bbox match the MF gridPatch r_loft within tolerance', () => {
    // MF oracle: the SAME recipe baked through stdlib r_loft (gridPatch build).
    const mf = mfLoft(JSON.stringify(SQUARE), BARREL.length, BARREL.divs, BARREL.twist, BARREL.bulge, BARREL.shape, BARREL.segments);
    const mfVol = mf.volume();
    const mfMesh = mf.getMesh();
    const mfBox = bboxOf(mfMesh.vertProperties as ArrayLike<number>, mfMesh.numProp ?? 3);

    // TF native pure mesh for the identical recipe.
    const { points, faces } = buildLoftMesh(SQUARE, BARREL);
    const tfVol = Math.abs(signedVolume(points, faces));
    const tfBox = bboxOf(points);

    const relVol = Math.abs(tfVol - mfVol) / mfVol;
    expect(relVol, `TF vol ${tfVol.toFixed(3)} vs MF ${mfVol.toFixed(3)} (rel ${(relVol * 100).toFixed(2)}%)`).toBeLessThanOrEqual(0.02);
    // Bbox parity (same section stack → same extents).
    expect(tfBox.minZ).toBeCloseTo(mfBox.minZ, 3);
    expect(tfBox.maxZ).toBeCloseTo(mfBox.maxZ, 3);
    expect(tfBox.maxX).toBeCloseTo(mfBox.maxX, 3);
    expect(tfBox.maxY).toBeCloseTo(mfBox.maxY, 3);
  });
});

// ─── graph → TF lowering (r_loft → op:'loft', not UNSUPPORTED) ────────────────

function mkGraph(nodes: Record<string, any>, root: string, params: Record<string, any> = {}): Graph {
  return { nodes, root, params, edges: [], imports: [], layout: {} } as unknown as Graph;
}

describe('graphToTf lowers r_loft → a native loft instr', () => {
  it('a barrel r_loft Call → a loft instr with concrete section + shape/bulge args', () => {
    const g = mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_call'] },
        n_poly: {
          id: 'n_poly', type: 'polygon',
          points: [
            { kind: 'point', r: { kind: 'literal', value: -2 }, z: { kind: 'literal', value: -2 } },
            { kind: 'point', r: { kind: 'literal', value: 2 }, z: { kind: 'literal', value: -2 } },
            { kind: 'point', r: { kind: 'literal', value: 2 }, z: { kind: 'literal', value: 2 } },
            { kind: 'point', r: { kind: 'literal', value: -2 }, z: { kind: 'literal', value: 2 } },
          ],
        },
        n_call: {
          id: 'n_call', type: 'call', src: 'r_loft', alias: 'A',
          args: {
            profile: { kind: 'expr', expr: '__POLY__n_poly' },
            length: { kind: 'param', param: 'length' },
            divs: { kind: 'literal', value: 48 },
            twist: { kind: 'literal', value: 0 },
            bulge: { kind: 'literal', value: 0.4 },
            shape: { kind: 'literal', value: 'barrel' },
            segments: { kind: 'literal', value: 8 },
          },
        },
      },
      'n_root',
      { length: { default: 8 } },
    );
    const recipe = graphToTf(g);
    expect(recipe.instrs).toHaveLength(1); // polygon consumed via __POLY__
    const inst = recipe.instrs[0] as Extract<TfInstr, { op: 'loft' }>;
    expect(inst.op).toBe('loft');
    expect(inst.length).toBe(8);
    expect(inst.divs).toBe(48);
    expect(inst.twist).toBe(0);
    expect(inst.bulge).toBe(0.4);
    expect(inst.shape).toBe('barrel');
    expect(inst.segments).toBe(8);
    expect(inst.profile).toEqual([[-2, -2], [2, -2], [2, 2], [-2, 2]]);
    expect(recipe.notes.some((n) => n.includes('UNSUPPORTED'))).toBe(false);
    expect(recipeHasUnsupported(recipe)).toBe(false);
  });

  it('r_loft with no wired profile → falls back to the engine default ngon (still a loft)', () => {
    const g = mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_call'] },
        n_call: { id: 'n_call', type: 'call', src: 'r_loft', alias: 'B', args: { length: { kind: 'literal', value: 6 } } },
      },
      'n_root',
    );
    const inst = graphToTf(g).instrs[0] as Extract<TfInstr, { op: 'loft' }>;
    expect(inst.op).toBe('loft');
    expect(inst.length).toBe(6);
    expect(inst.shape).toBe('barrel');       // default shape
    expect(inst.profile.length).toBeGreaterThanOrEqual(3); // default ngon
  });
});

// ─── executor walks the loft recipe (mock kernel, no WASM) ────────────────────

function makeMockTf() {
  const calls: { fn: string; args: any[] }[] = [];
  const rec = (fn: string, ...args: any[]) => { calls.push({ fn, args }); };
  let idc = 0;
  const handle = (tag: string, extra: Record<string, any> = {}) => ({
    __tag: tag, __id: idc++,
    numberOfFaces: 12, numberOfPoints: 8,
    points: { data: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) },
    faces: { data: new Int32Array([0, 1, 2]) },
    transformation: null as any,
    ...extra,
  });
  const t: any = {
    calls,
    boxMesh: (w: number, h: number, d: number) => { rec('boxMesh', w, h, d); return handle('box'); },
    mesh: (faces: any, points: any) => { rec('mesh', faces, points); return handle('mesh'); },
    booleanUnion: (obj: any, arg: any) => { rec('booleanUnion', obj, arg); return { mesh: handle('union') }; },
    booleanDifference: (obj: any, arg: any) => { rec('booleanDifference', obj, arg); return { mesh: handle('diff') }; },
    positivelyOriented: (m: any) => { rec('positivelyOriented', m); return m; },
    isClosed: () => true, isManifold: () => true, eulerCharacteristic: () => 2,
    boundaryPaths: () => ({ length: 0 }), signedVolume: () => 1, volume: () => 3.14,
  };
  return t;
}

const recipe = (instrs: TfInstr[]): TfRecipe => ({ instrs, notes: [] });

describe('executeTfRecipe — loft', () => {
  it('walks a loft recipe → tfLoftProfile builds via t.mesh + positivelyOriented (no boxMesh)', () => {
    const t = makeMockTf();
    const out = executeTfRecipe(t, t, recipe([
      { op: 'loft', profile: SQUARE, length: 8, divs: 48, twist: 0, bulge: 0.4, shape: 'barrel', segments: 8 },
    ]));
    const fns = t.calls.map((c: any) => c.fn);
    expect(fns).toContain('mesh');               // tfLoftProfile → t.mesh(faces, points)
    expect(fns).toContain('positivelyOriented'); // outward-orient the welded loft
    expect(fns).not.toContain('boxMesh');
    expect(out.stats.closed).toBe(true);
  });

  it('a loft with < 3 section points is flagged UNSUPPORTED (fall back, don\'t build garbage)', () => {
    expect(recipeHasUnsupported(recipe([
      { op: 'loft', profile: [[0, 0], [1, 0]], length: 8, divs: 48, twist: 0, bulge: 0.4, shape: 'barrel', segments: 8 },
    ]))).toBe(true);
    expect(recipeHasUnsupported(recipe([
      { op: 'loft', profile: SQUARE, length: 8, divs: 48, twist: 0, bulge: 0.4, shape: 'barrel', segments: 8 },
    ]))).toBe(false);
  });
});
