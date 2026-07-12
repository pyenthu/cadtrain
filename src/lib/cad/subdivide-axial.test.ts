import { describe, expect, it } from 'vitest';
import { planAxialStations, subdivideAxialAdaptive, warpMeshJS } from '$lib/engines/manifold/warp-spline';

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const facetNormal = (a: V3, b: V3, c: V3): V3 => norm(cross(sub(b, a), sub(c, a)));

/** Read triangle f's three vertices out of a non-indexed / indexed mesh. */
function tri(positions: Float32Array, faces: Uint32Array | Int32Array, f: number): [V3, V3, V3] {
  const g = (k: number): V3 => {
    const idx = faces[3 * f + k];
    return [positions[3 * idx], positions[3 * idx + 1], positions[3 * idx + 2]];
  };
  return [g(0), g(1), g(2)];
}

/** The warped spline centerline as a dense polyline: warp a column of on-axis
 *  points (0,0,z), z∈[0,10], in ONE call so warpMeshJS sees the full z-range
 *  (a single point would collapse z0=z1 → s≡0). */
function splineCenterline(cp: [number, number][], nSamp = 600): V3[] {
  const pts = new Float32Array(3 * (nSamp + 1));
  for (let k = 0; k <= nSamp; k++) pts[3 * k + 2] = (k / nSamp) * 10;
  const { positions } = warpMeshJS(pts, null, cp);
  const out: V3[] = [];
  for (let k = 0; k <= nSamp; k++) out.push([positions[3 * k], positions[3 * k + 1], positions[3 * k + 2]]);
  return out;
}

function distToLine(p: V3, line: V3[]): number {
  let best = Infinity;
  for (const c of line) {
    const d = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
    if (d < best) best = d;
  }
  return best;
}

/** Deviation of a warped mesh's surface from the spline = max distance of every
 *  triangle-edge midpoint from the spline centerline (verts are ~on-axis). */
function meshDeviation(positions: Float32Array, faces: Uint32Array | Int32Array, line: V3[]): number {
  let worst = 0;
  const nTri = Math.floor(faces.length / 3);
  for (let f = 0; f < nTri; f++) {
    const [a, b, c] = tri(positions, faces, f);
    for (const [p, q] of [[a, b], [b, c], [c, a]] as [V3, V3][]) {
      const mid: V3 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
      const d = distToLine(mid, line);
      if (d > worst) worst = d;
    }
  }
  return worst;
}

// A thin near-axis wall spanning z∈[0,10]: two columns (y=0, y=δ), 2 triangles.
function thinWall(): { positions: Float32Array; faces: Uint32Array } {
  const d = 0.001;
  // verts: 0:(0,0,0) 1:(0,d,0) 2:(0,0,10) 3:(0,d,10)
  const positions = new Float32Array([0, 0, 0, 0, d, 0, 0, 0, 10, 0, d, 10]);
  const faces = new Uint32Array([0, 1, 2, 1, 3, 2]);
  return { positions, faces };
}

describe('planAxialStations — curvature-driven station selection', () => {
  it('straight spline barely subdivides (count near minStations)', () => {
    const stations = planAxialStations([[0, 0], [0, 10]], 0, 10, { minStations: 1, maxStations: 64 });
    expect(stations.length).toBeLessThanOrEqual(2); // ~minStations
    // all interior + sorted
    for (const z of stations) { expect(z).toBeGreaterThan(0); expect(z).toBeLessThan(10); }
  });

  it('sharp curve yields MORE stations than a gentle one', () => {
    const gentle = planAxialStations([[0, 0], [0.4, 5], [0, 10]], 0, 10, { minStations: 1, maxStations: 128 });
    const sharp = planAxialStations([[0, 0], [5, 5], [0, 10]], 0, 10, { minStations: 1, maxStations: 128 });
    expect(sharp.length).toBeGreaterThan(gentle.length);
  });

  it('respects maxStations as a hard cap', () => {
    const s = planAxialStations([[0, 0], [8, 3], [-8, 7], [0, 10]], 0, 10, { minStations: 1, maxStations: 12 });
    expect(s.length).toBeLessThanOrEqual(12);
  });
});

describe('warpMeshJS — originZ absolute placement (TODO #36b)', () => {
  it('originZ shifts an offset part along the spline; absent = legacy z−z0', () => {
    // On-axis column already at z∈[30,33] on a long vertical spline.
    const col = (): Float32Array => {
      const p = new Float32Array(3 * 4);
      p[3 * 0 + 2] = 30; p[3 * 1 + 2] = 31; p[3 * 2 + 2] = 32; p[3 * 3 + 2] = 33;
      return p;
    };
    const cp: [number, number][] = [[0, 0], [0, 60]]; // vertical, total ≈ 60
    const abs = warpMeshJS(col(), null, cp, { originZ: 0 });   // s = z → arc-length 30..33
    const shifted = warpMeshJS(col(), null, cp, { originZ: 30 }); // s = z−30 → 0..3
    for (let k = 0; k < 4; k++) {
      expect(abs.positions[3 * k + 2] - shifted.positions[3 * k + 2]).toBeCloseTo(30, 2);
    }
    // originZ absent must equal originZ=z0 (=30) exactly — byte-identical gate.
    const legacy = warpMeshJS(col(), null, cp);
    for (let i = 0; i < legacy.positions.length; i++) {
      expect(legacy.positions[i]).toBe(shifted.positions[i]);
    }
  });
});

describe('subdivideAxialAdaptive — mesh split', () => {
  it('straight spline → output ≈ input (few triangles, identity-ish)', () => {
    const { positions, faces } = thinWall();
    const out = subdivideAxialAdaptive(positions, null, faces, [[0, 0], [0, 10]], { minStations: 1, maxStations: 64 });
    const inTri = faces.length / 3;
    const outTri = out.faces.length / 3;
    expect(outTri).toBeGreaterThanOrEqual(inTri);
    expect(outTri).toBeLessThanOrEqual(inTri * 3); // barely subdivided
  });

  it('sharp curve → more triangles than gentle', () => {
    const { positions, faces } = thinWall();
    // Explicit epsilon + high maxStations so neither saturates the cap and the
    // curvature signal (not the thin wall's ~0 radial extent) drives the count.
    const o = { epsilon: 0.08, minStations: 1, maxStations: 512 };
    const gentle = subdivideAxialAdaptive(positions, null, faces, [[0, 0], [0.4, 5], [0, 10]], o);
    const sharp = subdivideAxialAdaptive(positions, null, faces, [[0, 0], [5, 5], [0, 10]], o);
    expect(sharp.faces.length).toBeGreaterThan(gentle.faces.length);
  });

  it('output faces are valid, sequential (non-indexed), winding preserved', () => {
    // Single tall triangle so every output tri derives from ONE known winding.
    const positions = new Float32Array([0, 0, 0, 3, 0, 0, 0, 0, 10]);
    const faces = new Uint32Array([0, 1, 2]);
    const cp: [number, number][] = [[0, 0], [4, 5], [0, 10]];
    const inNormal = facetNormal(
      [positions[0], positions[1], positions[2]],
      [positions[3], positions[4], positions[5]],
      [positions[6], positions[7], positions[8]],
    );
    const out = subdivideAxialAdaptive(positions, null, faces, cp);
    const nTri = out.faces.length / 3;
    expect(nTri).toBeGreaterThanOrEqual(1);
    // sequential non-indexed
    for (let i = 0; i < out.faces.length; i++) expect(out.faces[i]).toBe(i);
    // valid indices
    const maxIdx = out.positions.length / 3;
    for (const idx of out.faces) expect(idx).toBeLessThan(maxIdx);
    // winding preserved: every non-degenerate sub-triangle faces the same way
    let checked = 0;
    for (let f = 0; f < nTri; f++) {
      const [a, b, c] = tri(out.positions, out.faces, f);
      const n = facetNormal(a, b, c);
      if (!Number.isFinite(n[0])) continue; // degenerate sliver — skip
      if (Math.hypot(...cross(sub(b, a), sub(c, a))) < 1e-9) continue;
      expect(dot(n, inNormal)).toBeGreaterThan(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('sagitta: subdivide THEN warp deviates LESS from the spline than warp alone', () => {
    const { positions, faces } = thinWall();
    const cp: [number, number][] = [[0, 0], [1.2, 5], [0, 10]]; // curved span
    const line = splineCenterline(cp);

    // (1) warp WITHOUT subdivision
    const plainWarp = warpMeshJS(positions, null, cp);
    const devNo = meshDeviation(plainWarp.positions, faces, line);

    // (2) subdivide THEN warp
    const dense = subdivideAxialAdaptive(positions, null, faces, cp);
    const denseWarp = warpMeshJS(dense.positions, null, cp);
    const devYes = meshDeviation(denseWarp.positions, dense.faces, line);

    expect(dense.faces.length).toBeGreaterThan(faces.length); // it did subdivide
    expect(devYes).toBeLessThan(devNo * 0.5); // markedly closer to the spline
  });
});
