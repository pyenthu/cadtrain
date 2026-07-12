import { describe, it, expect } from 'vitest';
import { buildExtrudeMesh, buildExtrudeGrid, type Pt2 } from '../extrude';
import { graphToTf, type TfInstr } from '$lib/engines/trueform/graph-to-tf';
import type { Graph } from '$lib/graph/composition-graph-types';

/**
 * Guards the PURE welded-extrude builder `buildExtrudeMesh` (behind
 * `tfExtrudeProfile`) — the native TF analogue of Manifold's `r_weld_extrude`.
 * Extruding a closed 2D section along Z (with twist + top-scale taper + `divs`
 * rings) must yield a WATERTIGHT 2-MANIFOLD (every undirected edge shared by
 * exactly 2 triangles, every directed half-edge exactly once → orientable), χ=2
 * (genus-0), enclosing a non-zero volume of the expected magnitude. No WASM —
 * same split as `buildRevolveMesh` / `buildWeldGrid`. The absolute in/out SIGN is
 * fixed at runtime by tf's `positivelyOriented`, so we assert |volume| here and
 * winding-independent topology (matching revolve.test.ts / mandrel.test.ts).
 *
 * PLUS: the twist + scaleTop morph actually moves the BOTTOM ring (rotated /
 * scaled vs the untwisted top ring), and the graph→TF lowering builds the g_*
 * consumers (g_cube / g_spiral / g_star) natively instead of UNSUPPORTED.
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

/** Signed volume of a closed triangle mesh = Σ (v0 · (v1 × v2)) / 6. The SIGN is
 *  winding-dependent (fixed outward by tf's positivelyOriented at runtime); we
 *  assert its MAGNITUDE, like mandrel.test.ts. */
function signedVolume(points: Float32Array, faces: Int32Array): number {
  let vol = 0;
  const g = (i: number, k: number) => points[i * 3 + k];
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f], b = faces[f + 1], c = faces[f + 2];
    const ax = g(a, 0), ay = g(a, 1), az = g(a, 2);
    const bx = g(b, 0), by = g(b, 1), bz = g(b, 2);
    const cx = g(c, 0), cy = g(c, 1), cz = g(c, 2);
    // a · (b × c)
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

// A centred hexagon (the r_weld_extrude default ngon n=6, r=0.6), CCW.
const HEX: Pt2[] = Array.from({ length: 6 }, (_, i) => {
  const a = (i / 6) * Math.PI * 2;
  return [0.6 * Math.cos(a), 0.6 * Math.sin(a)] as Pt2;
});

// A NON-CONVEX 5-point star, centred (alternating outer 1.0 / inner 0.4), CCW.
const STAR: Pt2[] = Array.from({ length: 10 }, (_, i) => {
  const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
  const r = i % 2 === 0 ? 1.0 : 0.4;
  return [r * Math.cos(a), r * Math.sin(a)] as Pt2;
});

describe('buildExtrudeMesh — welded linear extrude', () => {
  it('default hex, no morph: watertight genus-0 solid (χ=2) of the right volume', () => {
    const { points, faces } = buildExtrudeMesh(HEX, { length: 2 });
    assertClosedManifold(points, faces);
    expect(euler(points, faces)).toBe(2);
    // Hexagon area = (3√3/2) r² ; volume = area × length.
    const area = (3 * Math.sqrt(3) / 2) * 0.6 * 0.6;
    expect(Math.abs(signedVolume(points, faces))).toBeCloseTo(area * 2, 3);
  });

  it('NON-CONVEX star section: still watertight genus-0 (χ=2), non-zero volume', () => {
    const { points, faces } = buildExtrudeMesh(STAR, { length: 3, segments: 20 });
    assertClosedManifold(points, faces);
    expect(euler(points, faces)).toBe(2);
    expect(Math.abs(signedVolume(points, faces))).toBeGreaterThan(0.1);
  });

  it('a twisted + tapered extrude is still watertight genus-0 (χ=2)', () => {
    const { points, faces } = buildExtrudeMesh(HEX, {
      length: 4, divs: 16, twist: 90, scaleTop: [0.5, 0.5], segments: 24,
    });
    assertClosedManifold(points, faces);
    expect(euler(points, faces)).toBe(2);
    expect(Math.abs(signedVolume(points, faces))).toBeGreaterThan(0);
  });
});

describe('buildExtrudeGrid — twist + scaleTop actually morph the section', () => {
  it('no morph → exactly 2 rings (top + bottom), bottom == top translated in Z', () => {
    const grid = buildExtrudeGrid(HEX, { length: 5 });
    expect(grid.length).toBe(2); // 1 segment
    const top = grid[0], bot = grid[grid.length - 1];
    for (let i = 0; i < HEX.length; i++) {
      expect(top[i][0]).toBeCloseTo(HEX[i][0], 6);
      expect(top[i][1]).toBeCloseTo(HEX[i][1], 6);
      expect(top[i][2]).toBeCloseTo(0, 6);       // top at z=0
      expect(bot[i][0]).toBeCloseTo(HEX[i][0], 6); // same xy (no twist/scale)
      expect(bot[i][1]).toBeCloseTo(HEX[i][1], 6);
      expect(bot[i][2]).toBeCloseTo(5, 6);        // bottom at z=length
    }
  });

  it('twist rotates the bottom ring by `twist`° vs the untwisted top', () => {
    const grid = buildExtrudeGrid(HEX, { length: 2, divs: 8, twist: 90 });
    expect(grid.length).toBe(9); // divs+1 rings
    const top = grid[0], bot = grid[grid.length - 1];
    // Top ring is the raw section (untwisted).
    expect(top[0][0]).toBeCloseTo(HEX[0][0], 6);
    expect(top[0][1]).toBeCloseTo(HEX[0][1], 6);
    // Bottom ring vertex 0 is HEX[0] rotated +90° about Z: (x,y) → (-y, x).
    expect(bot[0][0]).toBeCloseTo(-HEX[0][1], 6);
    expect(bot[0][1]).toBeCloseTo(HEX[0][0], 6);
  });

  it('scaleTop shrinks the bottom ring uniformly (top face unchanged)', () => {
    const grid = buildExtrudeGrid(HEX, { length: 2, divs: 4, scaleTop: [0.5, 0.5] });
    const top = grid[0], bot = grid[grid.length - 1];
    for (let i = 0; i < HEX.length; i++) {
      expect(top[i][0]).toBeCloseTo(HEX[i][0], 6);        // top unscaled
      expect(bot[i][0]).toBeCloseTo(HEX[i][0] * 0.5, 6);  // bottom halved
      expect(bot[i][1]).toBeCloseTo(HEX[i][1] * 0.5, 6);
    }
  });
});

// ─── g_* consumers lower natively (no UNSUPPORTED for r_weld_extrude) ────────

function mkGraph(nodes: Record<string, any>, root: string, params: Record<string, any> = {}): Graph {
  return { nodes, root, params, edges: [], imports: [], layout: {} } as unknown as Graph;
}

/** Deep-scan a recipe's instrs for any weld_extrude / UNSUPPORTED referencing r_weld_extrude. */
function hasUnsupportedWeld(instrs: TfInstr[]): boolean {
  const walk = (i: TfInstr): boolean => {
    if (i.op === 'UNSUPPORTED') return String(i.nodeType).includes('r_weld_extrude');
    if ('child' in i && i.child) return walk(i.child as TfInstr);
    if ('obj' in i && 'arg' in i) return walk(i.obj as TfInstr) || walk(i.arg as TfInstr);
    if ('children' in i && Array.isArray((i as any).children)) return (i as any).children.some(walk);
    return false;
  };
  return instrs.some(walk);
}
function firstWeld(instrs: TfInstr[]): Extract<TfInstr, { op: 'weld_extrude' }> | null {
  let found: any = null;
  const walk = (i: TfInstr) => {
    if (found) return;
    if (i.op === 'weld_extrude') { found = i; return; }
    if ('child' in i && (i as any).child) walk((i as any).child);
    if ('obj' in i && 'arg' in i) { walk((i as any).obj); walk((i as any).arg); }
    if ('children' in i && Array.isArray((i as any).children)) (i as any).children.forEach(walk);
  };
  instrs.forEach(walk);
  return found;
}

describe('g_* consumers of r_weld_extrude lower to a native weld_extrude (not UNSUPPORTED)', () => {
  it('g_cube shape: a rect polygon → weld_extrude with a 4-pt section', () => {
    const g = mkGraph(
      {
        n_root: { id: 'n_root', type: 'list', children: ['n_poly', 'n_call'] },
        n_poly: {
          id: 'n_poly', type: 'polygon',
          points: [
            { kind: 'point', r: { kind: 'expr', expr: '-p.w/2' }, z: { kind: 'expr', expr: '-p.w/2' } },
            { kind: 'point', r: { kind: 'expr', expr: 'p.w/2' }, z: { kind: 'expr', expr: '-p.w/2' } },
            { kind: 'point', r: { kind: 'expr', expr: 'p.w/2' }, z: { kind: 'expr', expr: 'p.w/2' } },
            { kind: 'point', r: { kind: 'expr', expr: '-p.w/2' }, z: { kind: 'expr', expr: 'p.w/2' } },
          ],
        },
        n_call: {
          id: 'n_call', type: 'call', src: 'r_weld_extrude', alias: 'A',
          args: {
            profile: { kind: 'expr', expr: '__POLY__n_poly' },
            length: { kind: 'param', param: 'length' },
            divs: { kind: 'literal', value: 12 }, twist: { kind: 'literal', value: 0 },
            taper: { kind: 'literal', value: 0 }, segments: { kind: 'literal', value: 32 },
          },
        },
      },
      'n_root',
      { w: { default: 2 }, length: { default: 2 } },
    );
    const recipe = graphToTf(g);
    expect(hasUnsupportedWeld(recipe.instrs)).toBe(false);
    const w = firstWeld(recipe.instrs);
    expect(w).not.toBeNull();
    expect(w!.profile).toEqual([[-1, -1], [1, -1], [1, 1], [-1, 1]]);
  });

  it('g_spiral shape: a polygon with TWO poly_repeat loops expands to a full section', () => {
    const g = mkGraph(
      {
        n_gspr1: { id: 'n_gspr1', type: 'list', children: ['n_gspr2', 'n_gspr5'] },
        n_gspr2: {
          id: 'n_gspr2', type: 'polygon',
          points: [
            { kind: 'repeat-ref', sourceId: 'n_gspr3' },
            { kind: 'repeat-ref', sourceId: 'n_gspr4' },
          ],
        },
        n_gspr3: {
          id: 'n_gspr3', type: 'poly_repeat', count: { kind: 'param', param: 'NPts' }, loopVar: 'i',
          r: { kind: 'expr', expr: 'R * cos(theta)' }, z: { kind: 'expr', expr: 'R * sin(theta)' },
          bindings: [
            { name: 'R0', value: { kind: 'param', param: 'r0' } },
            { name: 'dr', value: { kind: 'param', param: 'growth' } },
            { name: 'turns', value: { kind: 'param', param: 'turns' } },
            { name: 'theta', value: { kind: 'expr', expr: 'i * turns * tau / NPts' } },
            { name: 'R', value: { kind: 'expr', expr: 'R0 + dr * i / NPts' } },
          ],
        },
        n_gspr4: {
          id: 'n_gspr4', type: 'poly_repeat', count: { kind: 'param', param: 'NPts' }, loopVar: 'j',
          r: { kind: 'expr', expr: 'R * cos(theta)' }, z: { kind: 'expr', expr: 'R * sin(theta)' },
          bindings: [
            { name: 'R0', value: { kind: 'param', param: 'r0' } },
            { name: 'dr', value: { kind: 'param', param: 'growth' } },
            { name: 'turns', value: { kind: 'param', param: 'turns' } },
            { name: 'width', value: { kind: 'param', param: 'width' } },
            { name: 'idx', value: { kind: 'expr', expr: 'NPts - 1 - j' } },
            { name: 'theta', value: { kind: 'expr', expr: 'idx * turns * tau / NPts' } },
            { name: 'R', value: { kind: 'expr', expr: 'R0 + dr * idx / NPts + width' } },
          ],
        },
        n_gspr5: {
          id: 'n_gspr5', type: 'call', src: 'r_weld_extrude', alias: 'A',
          args: {
            profile: { kind: 'expr', expr: '__POLY__n_gspr2' },
            length: { kind: 'param', param: 'length' },
            divs: { kind: 'literal', value: 12 }, twist: { kind: 'literal', value: 0 },
            taper: { kind: 'literal', value: 0 }, segments: { kind: 'literal', value: 32 },
          },
        },
      },
      'n_gspr1',
      { NPts: { default: 12 }, r0: { default: 0.4 }, growth: { default: 1 }, turns: { default: 2 }, width: { default: 0.06 }, length: { default: 0.4 } },
    );
    const recipe = graphToTf(g);
    expect(hasUnsupportedWeld(recipe.instrs)).toBe(false);
    const w = firstWeld(recipe.instrs);
    expect(w).not.toBeNull();
    // Two 12-pt loops → a 24-pt section, all finite.
    expect(w!.profile.length).toBe(24);
    for (const [r, z] of w!.profile) {
      expect(Number.isFinite(r)).toBe(true);
      expect(Number.isFinite(z)).toBe(true);
    }
  });

  it('g_star shape: single poly_repeat with a conditional binding → alternating radii', () => {
    const g = mkGraph(
      {
        n_gstar1: { id: 'n_gstar1', type: 'list', children: ['n_gstar2', 'n_gstar4'] },
        n_gstar2: { id: 'n_gstar2', type: 'polygon', points: [{ kind: 'repeat-ref', sourceId: 'n_gstar3' }] },
        n_gstar3: {
          id: 'n_gstar3', type: 'poly_repeat', count: { kind: 'expr', expr: '2 * p.points' }, loopVar: 'i',
          r: { kind: 'expr', expr: 'R * cos(theta)' }, z: { kind: 'expr', expr: 'R * sin(theta)' },
          bindings: [
            { name: 'rOut', value: { kind: 'param', param: 'r_outer' } },
            { name: 'rIn', value: { kind: 'param', param: 'r_inner' } },
            { name: 'theta', value: { kind: 'expr', expr: 'i * tau / NPts' } },
            { name: 'R', value: { kind: 'expr', expr: 'i % 2 === 0 ? rOut : rIn' } },
          ],
        },
        n_gstar4: {
          id: 'n_gstar4', type: 'call', src: 'r_weld_extrude', alias: 'A',
          args: {
            profile: { kind: 'expr', expr: '__POLY__n_gstar2' },
            length: { kind: 'param', param: 'length' },
            divs: { kind: 'literal', value: 12 }, twist: { kind: 'literal', value: 0 },
            taper: { kind: 'literal', value: 0 }, segments: { kind: 'literal', value: 32 },
          },
        },
      },
      'n_gstar1',
      { points: { default: 6 }, r_outer: { default: 1 }, r_inner: { default: 0.4 }, length: { default: 0.6 } },
    );
    const recipe = graphToTf(g);
    expect(hasUnsupportedWeld(recipe.instrs)).toBe(false);
    const w = firstWeld(recipe.instrs);
    expect(w).not.toBeNull();
    expect(w!.profile.length).toBe(12); // 2 * points
    // Even vertices sit at r_outer=1, odd at r_inner=0.4 (radius from origin).
    const rad = (p: [number, number]) => Math.hypot(p[0], p[1]);
    expect(rad(w!.profile[0])).toBeCloseTo(1.0, 6);
    expect(rad(w!.profile[1])).toBeCloseTo(0.4, 6);
    // A native welded solid of that section is watertight.
    const { points, faces } = buildExtrudeMesh(w!.profile as Pt2[], { length: w!.length, segments: w!.segments });
    assertClosedManifold(points, faces);
    expect(euler(points, faces)).toBe(2);
  });
});
