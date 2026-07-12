/**
 * sweep-self-intersection.test.ts — the pre-build section sanity check.
 *
 * Pins `sectionSelfIntersects`: the cheap 2D segment×segment test that WARNS
 * when an r_sweep cross-section is not a simple polygon (degenerate/sliver caps
 * + wrong genus otherwise). Simple loops (convex, non-convex, stars) must NOT
 * flag; the two real failure shapes — a transversal crossing (figure-8) and the
 * ACTUAL author bug (a circle expr that wraps the loop twice: `tau*i/12` while
 * looping 24 points) — MUST flag. Detection only; geometry output is unchanged.
 * See memory todo_sweep_self_intersection_check.
 */
import { describe, it, expect } from 'vitest';
import { sectionSelfIntersects } from '$lib/engines/manifold/manifold-mesh';

type V2 = [number, number];

function circle(n: number, r = 1, laps = 1): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * laps * i) / n;
    out.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return out;
}
// n-point star built by alternating outer/inner radius — a SIMPLE non-convex loop.
function star(n = 5, rOut = 2, rIn = 0.8): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n;
    out.push([(i % 2 === 0 ? rOut : rIn) * Math.cos(a), (i % 2 === 0 ? rOut : rIn) * Math.sin(a)]);
  }
  return out;
}

describe('sectionSelfIntersects — simple polygons pass', () => {
  const L: V2[] = [[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]]; // one reflex vertex
  const square: V2[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [name, poly] of [
    ['24-gon circle', circle(24)],
    ['square', square],
    ['non-convex L-shape', L],
    ['5-point star', star()],
  ] as const) {
    it(`${name}: NOT self-intersecting`, () => {
      expect(sectionSelfIntersects(poly as V2[])).toBe(false);
    });
  }

  it('degenerate input (< 4 verts) never flags', () => {
    expect(sectionSelfIntersects([])).toBe(false);
    expect(sectionSelfIntersects([[0, 0], [1, 0]])).toBe(false);
    expect(sectionSelfIntersects([[0, 0], [1, 0], [0, 1]])).toBe(false); // triangle
  });
});

describe('sectionSelfIntersects — non-simple polygons flag', () => {
  it('figure-8 / bowtie (a transversal edge crossing) flags', () => {
    // 0→1 bottom, 1→2 diagonal, 2→3 top, 3→0 diagonal — the two diagonals cross.
    const bowtie: V2[] = [[0, 0], [2, 0], [0, 2], [2, 2]];
    expect(sectionSelfIntersects(bowtie)).toBe(true);
  });

  it('THE author bug: a circle expr wrapping the loop TWICE flags', () => {
    // 24 points but the angle divides by 12 → points 0-11 and 12-23 trace the
    // same circle → coincident (overlapping) edges = a non-simple loop. This is
    // exactly the sweep_tube_demo defect (`tau*i/12` vs `tau*i/num_pts`).
    expect(sectionSelfIntersects(circle(24, 1, 2))).toBe(true);
  });

  it('open polyline that crosses itself flags even without the wrap-around edge', () => {
    // An X drawn as an open path: (0,0)→(2,2) then (0,2)→(2,0) cross at (1,1).
    const openX: V2[] = [[0, 0], [2, 2], [0, 2], [2, 0]];
    expect(sectionSelfIntersects(openX, false)).toBe(true);
  });
});
