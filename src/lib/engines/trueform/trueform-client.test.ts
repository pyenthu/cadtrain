import { describe, it, expect } from 'vitest';
import {
  buildCappedMesh,
  weldMeshByPosition,
  isTfFatalTrap,
  describeTfError,
  runTfGuarded,
  resetTf,
  tfGeneration,
} from './trueform-client';

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

/**
 * Guards `weldMeshByPosition` (the PURE weld behind the "actual" TF-import path).
 * cadtrain's render geometry is usually a NON-INDEXED triangle soup (crease-aware
 * normals split every corner), so feeding it straight to tf.mesh would make every
 * edge unshared → a clean solid falsely reads open + non-manifold. Welding by
 * position must reconstruct the shared-edge topology so tf's verdict is honest,
 * WITHOUT hiding a genuinely open mesh. No WASM needed.
 */
describe('weldMeshByPosition', () => {
  // A unit CUBE as a NON-INDEXED soup: 12 tris × 3 verts = 36 duplicated corners.
  function cubeSoup(): { positions: Float32Array; indices: null } {
    // 8 corners
    const c = [
      [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
      [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
    ];
    // 12 triangles (2 per face), CCW outward
    const tris = [
      [0, 2, 1], [0, 3, 2], // bottom z=0
      [4, 5, 6], [4, 6, 7], // top z=1
      [0, 1, 5], [0, 5, 4], // y=0
      [2, 3, 7], [2, 7, 6], // y=1
      [1, 2, 6], [1, 6, 5], // x=1
      [0, 4, 7], [0, 7, 3], // x=0
    ];
    const pos: number[] = [];
    for (const t of tris) for (const vi of t) pos.push(c[vi][0], c[vi][1], c[vi][2]);
    return { positions: Float32Array.from(pos), indices: null };
  }

  it('welds a non-indexed cube soup back to 8 shared verts, closed + 2-manifold', () => {
    const { positions } = cubeSoup();
    const out = weldMeshByPosition(positions, null);
    expect(out.points.length / 3).toBe(8);   // 36 soup corners → 8 unique verts
    expect(out.faces.length / 3).toBe(12);   // all 12 tris kept
    // Every undirected edge shared by exactly 2 faces → watertight 2-manifold.
    for (const n of edgeCounts(out.faces).values()) expect(n).toBe(2);
    // χ = V − E + F = 8 − 12 + 12 = 2 (closed genus-0 solid).
    const E = edgeCounts(out.faces).size;
    expect(8 - E + 12).toBe(2);
  });

  it('honours an explicit index buffer (no soup synthesis)', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint32Array([0, 1, 2]);
    const out = weldMeshByPosition(positions, indices);
    expect(out.points.length / 3).toBe(3);
    expect(Array.from(out.faces)).toEqual([0, 1, 2]);
  });

  it('drops triangles that collapse to a line after welding', () => {
    // Two coincident corners (same position) → the tri degenerates.
    const positions = new Float32Array([0, 0, 0, 0, 0, 0, 1, 0, 0]);
    const out = weldMeshByPosition(positions, null);
    expect(out.faces.length).toBe(0); // collapsed tri dropped
  });

  it('leaves a genuinely OPEN mesh open (weld does not fabricate topology)', () => {
    // A single triangle: 3 unique verts, 3 boundary edges each used once.
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const out = weldMeshByPosition(positions, null);
    for (const n of edgeCounts(out.faces).values()) expect(n).toBe(1); // still open
  });
});

/**
 * Guards the TF kernel SELF-HEAL (the "one bad op → every later TF bake fails"
 * fix). A WASM `unreachable` trap poisons tf's shared singleton; `runTfGuarded`
 * must recognise the trap, {@link resetTf} the singleton (so the next `ensureTf`
 * re-imports a FRESH kernel), and rethrow a READABLE reason — while ordinary
 * validation errors pass through untouched (no needless kernel re-init). All
 * pure logic, no 31 MB WASM needed.
 */
describe('isTfFatalTrap', () => {
  it('matches emscripten WASM traps (unreachable / OOB / bad indirect call)', () => {
    expect(isTfFatalTrap(new Error('unreachable'))).toBe(true);
    expect(isTfFatalTrap(new Error('RuntimeError: unreachable executed'))).toBe(true);
    expect(isTfFatalTrap(new Error('memory access out of bounds'))).toBe(true);
    expect(isTfFatalTrap(new Error('null function or function signature mismatch'))).toBe(true);
    expect(isTfFatalTrap(new Error('Aborted(). Build with -sASSERTIONS'))).toBe(true);
  });
  it('matches a WebAssembly.RuntimeError instance', () => {
    expect(isTfFatalTrap(new WebAssembly.RuntimeError('unreachable'))).toBe(true);
  });
  it('matches a BARE numeric heap-pointer throw (emscripten C++ exception)', () => {
    expect(isTfFatalTrap(123456)).toBe(true);
    expect(isTfFatalTrap(9007199254740991n)).toBe(true);
  });
  it('does NOT match an ordinary validation error (no reset warranted)', () => {
    expect(isTfFatalTrap(new Error('mesh is not watertight'))).toBe(false);
    expect(isTfFatalTrap(new Error("TrueForm cannot build node 'call:r_loft' natively"))).toBe(false);
  });
});

describe('describeTfError', () => {
  it('turns the opaque "unreachable" trap into an actionable reason', () => {
    const msg = describeTfError(new Error('unreachable'));
    expect(msg).toMatch(/unreachable/i);
    expect(msg).toMatch(/reset/i); // tells the user the kernel self-healed
    expect(msg).not.toBe('unreachable'); // not the bare opaque string
  });
  it('passes an ordinary message through unchanged', () => {
    expect(describeTfError(new Error('bad profile'))).toBe('bad profile');
  });
});

describe('runTfGuarded — TF singleton self-heal', () => {
  it('resets the kernel + rethrows a readable reason on a WASM trap', () => {
    const gen0 = tfGeneration();
    expect(() => runTfGuarded(() => { throw new Error('unreachable'); }))
      .toThrow(/unreachable[\s\S]*reset|reset/i);
    // The self-heal bumped the import generation → next ensureTf re-imports fresh.
    expect(tfGeneration()).toBe(gen0 + 1);
  });

  it('rethrows a non-trap error UNCHANGED and does NOT reset the kernel', () => {
    const gen0 = tfGeneration();
    const ordinary = new Error('mesh is not watertight');
    expect(() => runTfGuarded(() => { throw ordinary; })).toThrow(ordinary);
    expect(tfGeneration()).toBe(gen0); // no needless re-init
  });

  it('returns the value unchanged on success (no reset)', () => {
    const gen0 = tfGeneration();
    expect(runTfGuarded(() => 42)).toBe(42);
    expect(tfGeneration()).toBe(gen0);
  });

  it('resetTf bumps the generation so the next import is cache-busted', () => {
    const gen0 = tfGeneration();
    resetTf();
    expect(tfGeneration()).toBe(gen0 + 1);
  });
});
