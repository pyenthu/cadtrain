/**
 * brep-render-normals.test.ts — #993: the crease-aware smooth normals E5 computes
 * must REACH the BREP material render path.
 *
 * brep-normals.test.ts pins the crease-aware pass in isolation; this pins the
 * END-TO-END render boundary: it runs an OCCT bake through the SAME adapter the
 * canvas uses (`brepResponseToGeo` → PrimitiveDualScene, material `flatShading =
 * !smoothShade` with smoothShade forced true for BREP), and asserts the
 * geometry handed to the material carries SMOOTH per-vertex normals — a curved
 * revolve wall's welded positions each resolve to ONE interpolated normal — NOT
 * the raw per-facet OCCT normals in the response. (The "reads smooth" pixel check
 * is a human visual step; this pins the data that drives it.)
 *
 * OFFLINE: a self-contained inline ogive revolve (smooth curved wall + a hard rim
 * crease), only dep the local r_revolve engine. Same shape as brep-normals.test.ts.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as helpers from '$lib/engines/manifold/manifold-helpers';
import { brepFromSource } from '../brep-occt';
import { defaultParamObject } from '../brep-audit';
import { brepResponseToGeo, type BrepPreviewResponse } from '../brep-adapter';

const stdFetch = (async (url: any): Promise<any> => {
  const m = String(url).match(/[?&]name=([^&]+)/);
  if (m) {
    const { stdlibSource } = await import('$lib/server/stdlib');
    const s = stdlibSource(decodeURIComponent(m[1]));
    if (s) return { ok: true, status: 200, json: async () => ({ source: s }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
}) as unknown as typeof fetch;

// R=4 ogive outer wall (smooth curve z 0.2→1.5), steep shoulder (hard crease),
// bore r=1.5, 90° bottom rim (hard). Mirrors brep-normals.test.ts.
const SRC = `export const meta = { id: 'hn', name: 'hn', kind: 'asm', uses: ['r_revolve'], params: {} };
export function hn(p) {
  const prof = [[1.5, 0], [4, 0]];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const z = 0.2 + t * 1.3;
    const r = 4 - 0.5 * (1 - Math.cos(t * Math.PI / 2));
    prof.push([r, z]);
  }
  prof.push([2.0, 1.6]);
  prof.push([1.5, 1.6]);
  return r_revolve({ profile: prof, segments: 48 });
}`;

const key = (x: number, y: number, z: number) => `${x.toFixed(2)}|${y.toFixed(2)}|${z.toFixed(2)}`;
const isWall = (px: number, py: number, pz: number) => {
  const rad = Math.hypot(px, py);
  return rad > 3.45 && rad < 4.05 && pz > 0.25 && pz < 1.45;
};

describe('BREP render-path normals reach the material (#993)', () => {
  let data: BrepPreviewResponse;
  beforeAll(async () => {
    await helpers.initManifold();
    data = (await brepFromSource(SRC, defaultParamObject(SRC), { cut: false }, stdFetch)) as BrepPreviewResponse;
    expect(data, 'brepFromSource must produce a solid').toBeTruthy();
  }, 60000);

  it('the RAW OCCT response IS faceted on the curved wall (so the adapter has work to do)', () => {
    const pos = data.positions as number[];
    const occtN = data.normals as number[] | undefined;
    expect(occtN, 'OCCT response carries per-vertex normals').toBeTruthy();
    const byPos = new Map<string, Set<string>>();
    for (let v = 0; v < pos.length / 3; v++) {
      const px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2];
      if (!isWall(px, py, pz)) continue;
      const kk = key(px, py, pz);
      if (!byPos.has(kk)) byPos.set(kk, new Set());
      byPos.get(kk)!.add(key(occtN![v * 3], occtN![v * 3 + 1], occtN![v * 3 + 2]));
    }
    let faceted = 0;
    for (const s of byPos.values()) if (s.size > 1) faceted++;
    expect(byPos.size, 'sampled curved-wall positions').toBeGreaterThan(0);
    expect(faceted, 'raw OCCT wall is faceted (multi-normal positions)').toBeGreaterThan(0);
  });

  it('brepResponseToGeo hands the material SMOOTH per-vertex normals (crease-aware, not faceted)', () => {
    const geo = brepResponseToGeo(data);
    expect(geo.full, 'uncut solid → { full } geometry').toBeTruthy();
    const nAttr = geo.full!.getAttribute('normal');
    const pAttr = geo.full!.getAttribute('position');
    expect(nAttr, 'material geometry carries a per-vertex normal attribute').toBeTruthy();
    expect(nAttr!.count, 'one normal per position vertex').toBe(pAttr!.count);

    const pos = pAttr!.array as ArrayLike<number>;
    const nrm = nAttr!.array as ArrayLike<number>;
    const byPos = new Map<string, Set<string>>();
    const wallNormals = new Set<string>();
    let unit = 0, wallCount = 0;
    for (let v = 0; v < nAttr!.count; v++) {
      const px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2];
      const nx = nrm[v * 3], ny = nrm[v * 3 + 1], nz = nrm[v * 3 + 2];
      if (Math.abs(Math.hypot(nx, ny, nz) - 1) < 0.01) unit++;
      if (!isWall(px, py, pz) || Math.abs(nz) >= 0.5) continue; // curved wall faces only
      const kk = key(px, py, pz);
      if (!byPos.has(kk)) byPos.set(kk, new Set());
      byPos.get(kk)!.add(key(nx, ny, nz));
      wallNormals.add(key(nx, ny, nz));
      wallCount++;
    }
    // SMOOTH: every welded curved-wall position resolves to ONE (averaged) normal
    // — no per-facet split (that is what makes the material interpolate smooth).
    let multi = 0;
    for (const s of byPos.values()) if (s.size > 1) multi++;
    expect(byPos.size, 'curved-wall positions present in the material geometry').toBeGreaterThan(0);
    expect(multi, 'no welded wall position keeps >1 distinct normal (smoothed)').toBe(0);
    // NOT all-flat: the normal SWEEPS around the surface of revolution (many
    // distinct directions), i.e. it interpolates rather than one flat facet normal.
    expect(wallNormals.size, 'wall normals vary around the revolve (interpolate)').toBeGreaterThan(8);
    // Every normal is unit length (a valid shading normal for the material).
    expect(unit, 'all corner normals are unit length').toBe(nAttr!.count);
    expect(wallCount).toBeGreaterThan(0);
  });
});
