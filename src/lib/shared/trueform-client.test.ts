import { describe, it, expect } from 'vitest';
import { buildCappedMesh } from './trueform-client';

/**
 * Guards the open-sweep cap fix: `buildCappedMesh` (the PURE fan/centroid logic
 * behind `capOpenEnds`) must close every open boundary loop so the result is
 * WATERTIGHT (every undirected edge shared by exactly 2 faces) and 2-MANIFOLD
 * (no edge shared by > 2 faces). Winding is fixed at runtime by tf's
 * `positivelyOriented`, so here we assert the topology only (which is
 * winding-independent). No WASM needed — this is the reason the logic was
 * factored out of `capOpenEnds`.
 */

/** Count undirected edges over a flat [F*3] triangle index buffer. */
function edgeCounts(faces: ArrayLike<number>): Map<string, number> {
  const m = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f], b = faces[f + 1], c = faces[f + 2];
    for (const [x, y] of [[a, b], [b, c], [c, a]] as const) {
      const k = key(x, y);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
  }
  return m;
}

/** Count DIRECTED half-edges. In a consistently-oriented closed 2-manifold every
 *  directed edge appears exactly once (its twin runs the other way). */
function directedCounts(faces: ArrayLike<number>): Map<string, number> {
  const m = new Map<string, number>();
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f], b = faces[f + 1], c = faces[f + 2];
    for (const [x, y] of [[a, b], [b, c], [c, a]] as const) {
      const k = `${x}>${y}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
  }
  return m;
}

/** An OPEN square tube: 8 verts (z=0 ring 0-3, z=1 ring 4-7), 4 side quads as
 *  8 tris, both ends open. Boundary loops = bottom [0,1,2,3], top [4,5,6,7]. */
function openSquareTube() {
  const points = [
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, // 0..3 bottom ring
    0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, // 4..7 top ring
  ];
  // Each side is a quad (bottom_i, bottom_i+1, top_i+1, top_i) → 2 tris.
  const faces = [
    0, 1, 5, 0, 5, 4, // front
    1, 2, 6, 1, 6, 5, // right
    2, 3, 7, 2, 7, 6, // back
    3, 0, 4, 3, 4, 7, // left
  ];
  return { points, faces, loops: [[0, 1, 2, 3], [4, 5, 6, 7]] };
}

describe('buildCappedMesh', () => {
  it('closes both open ends → watertight 2-manifold (every edge shared by 2 faces)', () => {
    const { points, faces, loops } = openSquareTube();
    const out = buildCappedMesh(points, faces, loops);
    // +1 centroid vertex per loop, +L triangles per loop (4 each).
    expect(out.points.length / 3).toBe(8 + 2);
    expect(out.faces.length / 3).toBe(8 + 4 + 4);
    const counts = edgeCounts(out.faces);
    for (const [edge, n] of counts) {
      expect(n, `edge ${edge} shared by ${n} faces`).toBe(2); // watertight + manifold
    }
    // Explicitly: no boundary edges remain (would be count === 1).
    expect([...counts.values()].filter((n) => n === 1).length).toBe(0);
  });

  it('winds caps to agree with the walls → a consistently-oriented surface', () => {
    // The openSquareTube walls are consistently wound; direction-aware fan
    // winding must keep the WHOLE capped mesh consistent, i.e. every directed
    // half-edge appears exactly once (a fixed winding would leave some twice).
    const { points, faces, loops } = openSquareTube();
    const out = buildCappedMesh(points, faces, loops);
    const dir = directedCounts(out.faces);
    for (const [edge, n] of dir) {
      expect(n, `directed edge ${edge} appears ${n}×`).toBe(1);
    }
  });

  it('returns the mesh unchanged when there are no open loops (already closed)', () => {
    const { points, faces } = openSquareTube();
    const out = buildCappedMesh(points, faces, []);
    expect(out.points.length).toBe(points.length);
    expect(out.faces.length).toBe(faces.length);
  });

  it('de-duplicates a closed-path loop (first index repeated at the end)', () => {
    const { points, faces } = openSquareTube();
    // boundaryPaths may repeat the first vertex to close the loop — must not add
    // a degenerate zero-length fan edge or an extra triangle.
    const out = buildCappedMesh(points, faces, [[0, 1, 2, 3, 0], [4, 5, 6, 7, 4]]);
    expect(out.points.length / 3).toBe(8 + 2); // still just 2 centroids
    expect(out.faces.length / 3).toBe(8 + 4 + 4); // 4 fan tris per loop, not 5
    for (const n of edgeCounts(out.faces).values()) expect(n).toBe(2);
  });

  it('skips a degenerate loop with < 3 distinct verts', () => {
    const { points, faces } = openSquareTube();
    const out = buildCappedMesh(points, faces, [[0, 1]]);
    expect(out.points.length).toBe(points.length); // no centroid added
    expect(out.faces.length).toBe(faces.length); // no fan added
  });
});
