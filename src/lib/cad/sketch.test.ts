/**
 * Sketch engine — per-corner fillet (plan M.3, docs/plans/profile-sketcher.md).
 *
 * The M.1 first cut filleted via `chain.fillet(chain, min(radii))` — EVERY
 * filleted corner got the single smallest radius. M.3 switches to
 * `path.fillet` per corner so each vertex keeps its OWN radius and unfilleted
 * corners stay sharp. These tests pin that behaviour.
 */
import { describe, it, expect } from 'vitest';
import { compileSketch, chordToAbs, absToChord, type SketchOp } from './sketch';
import { hydrateGraph, collectEdges, type Graph } from './composition-graph';
import { validateGraph } from './composition-emit';

type Pt = [number, number];
const CORNERS: Pt[] = [[0, 0], [2, 0], [2, 2], [0, 2]];

/** A closed 2×2 square as four line ops (the degenerate all-line sketch). */
const square = (): SketchOp[] => [
  { op: 'line', r: 0, z: 0 },
  { op: 'line', r: 2, z: 0 },
  { op: 'line', r: 2, z: 2 },
  { op: 'line', r: 0, z: 2 },
];

const has = (pts: Pt[], x: number, y: number, eps = 0.05) =>
  pts.some((p) => Math.hypot(p[0] - x, p[1] - y) < eps);
const sharpCount = (pts: Pt[]) => CORNERS.filter(([x, y]) => has(pts, x, y)).length;
const nearestTo = (pts: Pt[], x: number, y: number) =>
  Math.min(...pts.map((p) => Math.hypot(p[0] - x, p[1] - y)));

describe('compileSketch — per-corner fillet (M.3)', () => {
  it('no fillet → all four corners stay sharp', () => {
    expect(sharpCount(compileSketch(square(), 64))).toBe(4);
  });

  it('a fillet at ONE corner rounds only that corner', () => {
    const ops: SketchOp[] = [
      { op: 'line', r: 0, z: 0 },
      { op: 'line', r: 2, z: 0 },
      { op: 'fillet', radius: 0.5 }, // round v1 = (2,0)
      { op: 'line', r: 2, z: 2 },
      { op: 'line', r: 0, z: 2 },
    ];
    const pts = compileSketch(ops, 64);
    expect(has(pts, 2, 0)).toBe(false); // (2,0) cut away by the fillet
    expect(sharpCount(pts)).toBe(3);    // the other three remain sharp
  });

  it('honours DIFFERENT radii at DIFFERENT corners in one sketch', () => {
    const ops: SketchOp[] = [
      { op: 'line', r: 0, z: 0 },
      { op: 'line', r: 2, z: 0 },
      { op: 'fillet', radius: 0.2 }, // small fillet at v1 = (2,0)
      { op: 'line', r: 2, z: 2 },
      { op: 'line', r: 0, z: 2 },
      { op: 'fillet', radius: 0.9 }, // big fillet at v3 = (0,2)
    ];
    const pts = compileSketch(ops, 96);
    // Both corners rounded (neither original vertex survives) …
    expect(has(pts, 2, 0)).toBe(false);
    expect(has(pts, 0, 2)).toBe(false);
    // … and the bigger radius pulls its outline FARTHER from the corner.
    // For a 90° corner the closest approach ≈ r·(√2−1), so 0.9 ≫ 0.2.
    expect(nearestTo(pts, 0, 2)).toBeGreaterThan(nearestTo(pts, 2, 0) + 0.1);
  });

  it('a spline edge bows the curve through the points (not a straight line)', () => {
    const splineOps: SketchOp[] = [
      { op: 'line', r: 0, z: 0 },
      { op: 'line', r: 2, z: 0 },
      { op: 'spline', r: 2, z: 2 }, // edge (2,0)→(2,2) is a spline
      { op: 'line', r: 0, z: 2 },
    ];
    const maxR = (pts: Pt[]) => Math.max(...pts.map((p) => p[0]));
    // The all-line square never exceeds r = 2; the spline bows outward past it.
    expect(maxR(compileSketch(square(), 96))).toBeLessThan(2.01);
    expect(maxR(compileSketch(splineOps, 96))).toBeGreaterThan(2.1);
  });

  it('chamfer + fillet coexist on the same sketch', () => {
    const ops: SketchOp[] = [
      { op: 'line', r: 0, z: 0 },
      { op: 'line', r: 2, z: 0 },
      { op: 'fillet', radius: 0.4 }, // round v1
      { op: 'line', r: 2, z: 2 },
      { op: 'chamfer', dist: 0.4 },  // bevel v2
      { op: 'line', r: 0, z: 2 },
    ];
    const pts = compileSketch(ops, 96);
    expect(pts.length).toBeGreaterThan(4); // arc + bevel add points
    expect(has(pts, 2, 0)).toBe(false);    // filleted corner gone
    expect(has(pts, 2, 2)).toBe(false);    // chamfered corner gone
    expect(has(pts, 0, 0)).toBe(true);     // untouched corner stays
  });
});

// ── Spline redesign (2026-06-13) — chord-relative through-points + handles ──

const maxR = (pts: Pt[]) => Math.max(...pts.map((p) => p[0]));
const maxZ = (pts: Pt[]) => Math.max(...pts.map((p) => p[1]));
const minR = (pts: Pt[]) => Math.min(...pts.map((p) => p[0]));

describe('compileSketch — grouped spline op', () => {
  it('chordToAbs / absToChord round-trip', () => {
    const a: Pt = [1, 2], b: Pt = [4, 6];
    const [u, v] = absToChord(a, b, chordToAbs(a, b, 0.3, -0.7));
    expect(u).toBeCloseTo(0.3, 6);
    expect(v).toBeCloseTo(-0.7, 6);
  });

  it('a through-point bows the spline toward that point', () => {
    // (2,0)→(2,2) edge as a spline; chord d=(0,2), rot90(d)=(−2,0) so
    // chordToAbs(0.5,−0.4) = (2.8, 1) — a knot the curve interpolates.
    const ops: SketchOp[] = [
      { op: 'line', r: 0, z: 0 },
      { op: 'line', r: 2, z: 0 },
      { op: 'spline', r: 2, z: 2, pts: [[0.5, -0.4]] },
      { op: 'line', r: 0, z: 2 },
    ];
    const pts = compileSketch(ops, 128);
    expect(maxR(pts)).toBeGreaterThan(2.5);       // bows past the chord + auto
    expect(nearestTo(pts, 2.8, 1)).toBeLessThan(0.15); // passes through the point
  });

  it('relative through-points scale with the endpoint (chord 2× → bulge 2×)', () => {
    const mk = (bx: number): SketchOp[] => [
      { op: 'line', r: 0, z: 0 },
      { op: 'spline', r: bx, z: 0, pts: [[0.5, 0.5]] }, // chord (0,0)→(bx,0)
      { op: 'line', r: bx, z: -1 },
    ];
    // chordToAbs(0.5,0.5) on d=(bx,0): (0.5·bx, 0.5·bx) → z bulge = 0.5·bx.
    const b2 = maxZ(compileSketch(mk(2), 128));
    const b4 = maxZ(compileSketch(mk(4), 128));
    expect(b2).toBeGreaterThan(0.9);
    expect(b4 / b2).toBeGreaterThan(1.9);
    expect(b4 / b2).toBeLessThan(2.1);
  });

  it('rotating the endpoint carries the bulge onto the new perpendicular', () => {
    // Horizontal chord (0,0)→(2,0): v=+0.5 bulges in +z.
    const horiz: SketchOp[] = [
      { op: 'line', r: 0, z: 0 },
      { op: 'spline', r: 2, z: 0, pts: [[0.5, 0.5]] },
      { op: 'line', r: 1, z: -1 },
    ];
    // Vertical chord (0,0)→(0,2): SAME (u,v), now bulges in −r.
    const vert: SketchOp[] = [
      { op: 'line', r: 0, z: 0 },
      { op: 'spline', r: 0, z: 2, pts: [[0.5, 0.5]] },
      { op: 'line', r: 1, z: 1 },
    ];
    expect(maxZ(compileSketch(horiz, 128))).toBeGreaterThan(0.9);
    expect(minR(compileSketch(vert, 128))).toBeLessThan(-0.9);
  });

  it('an end handle steers the end tangent (h1 sign flips the near-end bulge)', () => {
    // Top edge (0,0)→(2,0) is the only curved edge; the other edges sit at
    // r=2 / z=2 / r=0, so points with r∈(1.2,1.95) come ONLY from the spline.
    const mk = (h1: [number, number]): SketchOp[] => [
      { op: 'line', r: 0, z: 0 },
      { op: 'spline', r: 2, z: 0, h1 },
      { op: 'line', r: 2, z: 2 },
      { op: 'line', r: 0, z: 2 },
    ];
    // Peak z over the spline-only band — the end handle pushes the curve's
    // latter half off the chord, and h1's sign sets which way.
    const bandZ = (pts: Pt[], pick: (...n: number[]) => number) =>
      pick(...pts.filter((p) => p[0] > 1.0 && p[0] < 1.95).map((p) => p[1]));
    const pos = compileSketch(mk([-0.3, 0.6]), 160); // c2 z>0 → bows +z near b
    const neg = compileSketch(mk([-0.3, -0.6]), 160);
    expect(bandZ(pos, Math.max)).toBeGreaterThan(0.15);
    expect(bandZ(neg, Math.min)).toBeLessThan(-0.15);
  });

  it('auto-smooth parity — no pts/handles == empty pts == pre-redesign geometry', () => {
    const auto: SketchOp[] = [
      { op: 'line', r: 0, z: 0 },
      { op: 'line', r: 2, z: 0 },
      { op: 'spline', r: 2, z: 2 },
      { op: 'line', r: 0, z: 2 },
    ];
    const emptyPts: SketchOp[] = [
      { op: 'line', r: 0, z: 0 },
      { op: 'line', r: 2, z: 0 },
      { op: 'spline', r: 2, z: 2, pts: [] },
      { op: 'line', r: 0, z: 2 },
    ];
    expect(compileSketch(emptyPts, 96)).toEqual(compileSketch(auto, 96));
    // …and still bows outward exactly as the kept pre-redesign auto path.
    expect(maxR(compileSketch(auto, 96))).toBeGreaterThan(2.1);
  });
});

describe('sketch graph — edges, validation + migration', () => {
  const splineGraph = (): any => ({
    nodes: {
      n_root: { id: 'n_root', type: 'list', children: ['n_sk'] },
      n_sk: {
        id: 'n_sk', type: 'sketch',
        ops: [
          { op: 'line', r: { kind: 'literal', value: 0 }, z: { kind: 'literal', value: 0 } },
          {
            op: 'spline', r: { kind: 'literal', value: 2 }, z: { kind: 'literal', value: 2 },
            pts: [[{ kind: 'param', param: 'bulge' }, { kind: 'literal', value: 0.3 }]],
            h1: [{ kind: 'literal', value: -0.2 }, { kind: 'param', param: 'tan' }],
          },
        ],
        segments: { kind: 'literal', value: 64 },
      },
    },
    root: 'n_root',
    params: { bulge: { default: 0.5 }, tan: { default: 0.4 } },
    imports: [], layout: {},
  });

  it('a wired pts/handle component appears in collectEdges + round-trips', () => {
    const g = hydrateGraph(splineGraph());
    const tos = collectEdges(g).map((e) => e.to);
    expect(tos).toContain('n_sk.ops.1.pts.0.u');
    expect(tos).toContain('n_sk.ops.1.h1.v');
    expect(validateGraph(g)).toEqual([]);
  });

  it('validateGraph flags a deleted param wired into a spline component', () => {
    const g = hydrateGraph(splineGraph());
    const g2 = { ...g, params: { tan: { default: 0.4 } } } as Graph; // drop `bulge`
    const errs = validateGraph(g2);
    expect(errs.some((e) => e.kind === 'missing-param' && e.badRef === 'bulge')).toBe(true);
  });

  it('migrates legacy absolute spline ctrl → chord-relative pts', () => {
    const legacy: any = {
      nodes: {
        n_root: { id: 'n_root', type: 'list', children: ['n_sk'] },
        n_sk: {
          id: 'n_sk', type: 'sketch',
          ops: [
            { op: 'line', r: { kind: 'literal', value: 0 }, z: { kind: 'literal', value: 0 } },
            {
              op: 'spline', r: { kind: 'literal', value: 2 }, z: { kind: 'literal', value: 0 },
              ctrl: [[{ kind: 'literal', value: 1 }, { kind: 'literal', value: 1 }]],
            },
          ],
        },
      },
      root: 'n_root', params: {}, imports: [], layout: {},
    };
    const g = hydrateGraph(legacy);
    const sp = (g.nodes['n_sk'] as any).ops[1];
    expect('ctrl' in sp).toBe(false);
    expect(Array.isArray(sp.pts)).toBe(true);
    // absToChord((0,0),(2,0),(1,1)) = (u=0.5, v=0.5)
    expect(sp.pts[0][0].value).toBeCloseTo(0.5, 5);
    expect(sp.pts[0][1].value).toBeCloseTo(0.5, 5);
  });
});
