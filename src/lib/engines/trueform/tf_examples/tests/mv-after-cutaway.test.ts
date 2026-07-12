import { describe, it, expect } from 'vitest';
import { graphToTf } from '$lib/engines/trueform/graph-to-tf';
import { executeTfRecipe } from '../execute';
import { ensureTf } from '$lib/engines/trueform/trueform-client';
import type { Graph, ArgValue } from '$lib/graph/composition-graph-types';

/**
 * REGRESSION (mv-after-cutaway TF bug). A translate/rotate that WRAPS a whole ROOT
 * output — `mv(sectionCut(solid), …)` — set a LAZY `transformation` on the mesh
 * handle that no downstream boolean baked, so the render (`tfMeshData`, raw local
 * buffer) dropped the move: the cutaway shifted correctly on Manifold but stayed
 * put on TrueForm. The mv as the cutaway's CHILD (`sectionCut(mv(solid), …)`) always
 * worked because the cutaway's own booleanDifference bakes it. Both must now agree,
 * matching Manifold (which bakes transforms into vertices eagerly).
 *
 * Uses a synthetic in-memory graph (r_cuboid + cutaway + mv) executed on the REAL
 * TF kernel (Node) — no volume part fetched. The oracle is the analytic rigid-shift
 * invariant `OUTER == BASE + V` (a wrapping mv is a pure translation of the exact
 * cut solid), which is precisely what the Manifold bake of the same graph yields.
 */

const lit = (value: number): ArgValue => ({ kind: 'literal', value } as any);
const V: [number, number, number] = [3, 0, 6];
const AZ = 90;

function boxCall(id: string): any {
  return { id, type: 'call', src: 'r_cuboid', alias: 'A', args: { w: lit(4), h: lit(4), d: lit(10) } };
}
function cutaway(id: string, child: string): any {
  return { id, type: 'cutaway', child, az: lit(AZ), offset: lit(0) };
}
function mv(id: string, child: string, off: [number, number, number]): any {
  return { id, type: 'mv', child, offset: [lit(off[0]), lit(off[1]), lit(off[2])] };
}
function graphOf(root: string, nodes: any[]): Graph {
  const map: Record<string, any> = {};
  for (const n of nodes) map[n.id] = n;
  return { nodes: map, root, params: {}, edges: [], imports: [], layout: {} } as any;
}

function bbox(pts: Float32Array) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1], z = pts[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ] as [number, number, number], max: [maxX, maxY, maxZ] as [number, number, number] };
}

describe('mv wrapping a cutaway is applied on TrueForm', () => {
  it('mv(sectionCut(box)) shifts the whole cut solid by the mv vector', async () => {
    const tf = await ensureTf();

    const base = bbox(executeTfRecipe(tf, tf, graphToTf(
      graphOf('cut', [boxCall('box'), cutaway('cut', 'box')]),
    )).data.points);

    const outer = bbox(executeTfRecipe(tf, tf, graphToTf(
      graphOf('mv', [boxCall('box'), cutaway('cut', 'box'), mv('mv', 'cut', V)]),
    )).data.points);

    // The wrapping mv must translate the exact BASE cut solid by V (what Manifold does).
    for (let i = 0; i < 3; i++) {
      expect(outer.min[i]).toBeCloseTo(base.min[i] + V[i], 3);
      expect(outer.max[i]).toBeCloseTo(base.max[i] + V[i], 3);
    }
  }, 120000);

  it('mv as the cutaway CHILD stays honoured (unchanged, matches the wrapping case)', async () => {
    const tf = await ensureTf();

    // sectionCut(mv(box, V)) — the mv is baked by the cutaway's boolean; a pure-Z
    // move commutes with a Z-axis wedge cut, so its extent equals BASE + [0,0,z].
    const Z: [number, number, number] = [0, 0, 6];
    const base = bbox(executeTfRecipe(tf, tf, graphToTf(
      graphOf('cut', [boxCall('box'), cutaway('cut', 'box')]),
    )).data.points);
    const inner = bbox(executeTfRecipe(tf, tf, graphToTf(
      graphOf('cut', [boxCall('box'), mv('mv', 'box', Z), cutaway('cut', 'mv')]),
    )).data.points);

    for (let i = 0; i < 3; i++) {
      expect(inner.min[i]).toBeCloseTo(base.min[i] + Z[i], 3);
      expect(inner.max[i]).toBeCloseTo(base.max[i] + Z[i], 3);
    }
  }, 120000);
});
