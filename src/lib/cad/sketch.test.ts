/**
 * Sketch engine — per-corner fillet (plan M.3, docs/plans/profile-sketcher.md).
 *
 * The M.1 first cut filleted via `chain.fillet(chain, min(radii))` — EVERY
 * filleted corner got the single smallest radius. M.3 switches to
 * `path.fillet` per corner so each vertex keeps its OWN radius and unfilleted
 * corners stay sharp. These tests pin that behaviour.
 */
import { describe, it, expect } from 'vitest';
import { compileSketch, type SketchOp } from './sketch';

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
