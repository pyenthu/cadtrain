import { describe, expect, it } from 'vitest';
import { warpMeshJS } from '$lib/engines/manifold/warp-spline';

const unit = (v: number[]) => Math.hypot(v[0], v[1], v[2]);

describe('warpMeshJS — pure-JS warp of positions + normals', () => {
  it('straight vertical spline → near-identity (pos + normal unchanged)', () => {
    // Mesh spans z∈[0,10] (z0=0) so the z=5 vertex maps to spline arc-length 5.
    const pos = new Float32Array([1, 0, 0, 1, 0, 5, 1, 0, 10]);
    const nrm = new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]);
    const { positions, normals } = warpMeshJS(pos, nrm, [[0, 0], [0, 10]]);
    expect(positions[3]).toBeCloseTo(1, 5);   // middle vertex x
    expect(positions[5]).toBeCloseTo(5, 5);   // middle vertex z
    expect(normals![3]).toBeCloseTo(1, 5);    // still +x
  });

  it('bent spline → the top normal ROTATES + stays unit length', () => {
    const cp: [number, number][] = [[0, 0], [0, 6], [4, 10]];  // up, then bends +x
    const pos = new Float32Array([1, 0, 0, 1, 0, 10]);         // z0=0; check the top vertex
    const nrm = new Float32Array([1, 0, 0, 1, 0, 0]);
    const { normals } = warpMeshJS(pos, nrm, cp);
    expect(normals![5]).not.toBeCloseTo(0, 2);                 // top normal gained a z-component
    expect(unit([normals![3], normals![4], normals![5]])).toBeCloseTo(1, 5);
  });

  it('normal length preserved for every vertex (orthonormal frame)', () => {
    const pos = new Float32Array([1, 0, 0, 0, 1, 5, -1, 0, 10]);
    const nrm = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const { normals } = warpMeshJS(pos, nrm, [[0, 0], [3, 5], [0, 10]]);
    for (let i = 0; i < normals!.length; i += 3) {
      expect(unit([normals![i], normals![i + 1], normals![i + 2]])).toBeCloseTo(1, 5);
    }
  });
});
