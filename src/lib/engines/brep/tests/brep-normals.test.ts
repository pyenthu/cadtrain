/**
 * brep-normals.test.ts — E5: BREP render shades SMOOTH at parity with MF/TF.
 *
 * OFFLINE (default suite): bakes a self-contained inline revolve part through
 * OCCT (brepFromSource, no network/volume) and decodes the normals the BREP
 * render adapter would build.
 *
 * The bug E5 fixes: OCCT tessellates a surface of revolution as one CONICAL face
 * per profile segment and DUPLICATES the ring verts per face, each with its own
 * per-face normal → a curved/revolved B-rep renders FACETED (every curved-wall
 * ring position holds MULTIPLE distinct normals). MF + TF avoid this by running
 * their triangles through a crease-aware corner-normal pass; the BREP adapter
 * used to skip it. The adapter now routes OCCT triangles through the SAME shared
 * `crease-normals:creaseAwareCornerNormals` (tolerance-weld variant).
 *
 * This is a bw_hanger analog: a revolve with a SMOOTH curved (ogive) outer wall
 * AND a HARD shoulder/rim crease. Pins:
 *   • RAW OCCT normals ARE faceted on the curved wall (the problem is real),
 *   • crease-aware collapses every welded wall position to ONE (averaged) normal,
 *   • the wall↔bottom-cap rim (>60° dihedral) stays SPLIT (hard) — not blurred.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as helpers from '$lib/engines/manifold/manifold-helpers';
import { brepFromSource } from '$lib/engines/brep/brep-occt';
import { defaultParamObject } from '$lib/engines/brep/brep-audit';
import { creaseAwareCornerNormals } from '$lib/engines/trueform/crease-normals';

// BREP injects the stdlib engines directly, but pass a stdlib fetch anyway so a
// dep lookup never escapes to the network.
const stdFetch = (async (url: any): Promise<any> => {
  const m = String(url).match(/[?&]name=([^&]+)/);
  if (m) {
    const { stdlibSource } = await import('$lib/server/stdlib');
    const s = stdlibSource(decodeURIComponent(m[1]));
    if (s) return { ok: true, status: 200, json: async () => ({ source: s }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
}) as unknown as typeof fetch;

// R=4 outer wall: a short vertical base (z 0→0.2) then a smooth ogive curve
// (r 4→3.5 over z 0.2→1.5), then a steep shoulder (>60° crease) to a flat top.
// Bore r=1.5. The vertical base meets the bottom cap at a 90° rim (hard crease).
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
  prof.push([2.0, 1.6]);   // steep shoulder → HARD crease
  prof.push([1.5, 1.6]);   // flat top ring
  return r_revolve({ profile: prof, segments: 48 });
}`;

const R = 4;
const keyPos = (x: number, y: number, z: number) => `${x.toFixed(2)}|${y.toFixed(2)}|${z.toFixed(2)}`;
const keyNrm = (x: number, y: number, z: number) => `${x.toFixed(2)}|${y.toFixed(2)}|${z.toFixed(2)}`;
// A point on the curved outer wall (radius near R, above the base, below the shoulder).
const isWall = (px: number, py: number, pz: number) => {
  const rad = Math.hypot(px, py);
  return rad > 3.45 && rad < 4.05 && pz > 0.25 && pz < 1.45;
};

describe('BREP crease-aware normals (E5)', () => {
  let pos: number[];
  let idx: number[];
  let occtN: number[] | undefined;

  beforeAll(async () => {
    await helpers.initManifold();
    const mesh = await brepFromSource(SRC, defaultParamObject(SRC), { cut: false }, stdFetch);
    expect(mesh, 'brepFromSource must produce a solid').toBeTruthy();
    pos = mesh!.positions as number[];
    idx = mesh!.index as number[];
    occtN = mesh!.normals as number[] | undefined;
  }, 60000);

  it('raw OCCT normals ARE faceted on the curved revolve wall (the problem)', () => {
    expect(occtN, 'OCCT returns per-vertex normals').toBeTruthy();
    // OCCT is indexed but duplicates ring verts per conical face, so a rounded
    // curved-wall POSITION carries multiple distinct raw normals when faceted.
    const byPos = new Map<string, Set<string>>();
    for (let v = 0; v < pos.length / 3; v++) {
      const px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2];
      if (!isWall(px, py, pz)) continue;
      const nx = occtN![v * 3], ny = occtN![v * 3 + 1], nz = occtN![v * 3 + 2];
      const k = keyPos(px, py, pz);
      if (!byPos.has(k)) byPos.set(k, new Set());
      byPos.get(k)!.add(keyNrm(nx, ny, nz));
    }
    let faceted = 0;
    for (const s of byPos.values()) if (s.size > 1) faceted++;
    expect(byPos.size, 'curved wall must have sampled positions').toBeGreaterThan(0);
    expect(faceted, 'raw OCCT wall is faceted (multi-normal positions)').toBeGreaterThan(0);
  });

  it('crease-aware SMOOTHS the curved wall — every welded position → ONE averaged normal', () => {
    const nrm = creaseAwareCornerNormals(pos, idx, 60);
    const nt = idx.length / 3;
    const byPos = new Map<string, Set<string>>();
    let unit = 0, tot = 0;
    for (let t = 0; t < nt; t++) {
      for (let k = 0; k < 3; k++) {
        const v = idx[t * 3 + k];
        const px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2];
        const o = t * 9 + k * 3;
        const nx = nrm[o], ny = nrm[o + 1], nz = nrm[o + 2];
        if (!isWall(px, py, pz) || Math.abs(nz) >= 0.5) continue; // wall faces only
        const kk = keyPos(px, py, pz);
        if (!byPos.has(kk)) byPos.set(kk, new Set());
        byPos.get(kk)!.add(keyNrm(nx, ny, nz));
        tot++;
        if (Math.abs(Math.hypot(nx, ny, nz) - 1) < 0.01) unit++;
      }
    }
    let multi = 0;
    for (const s of byPos.values()) if (s.size > 1) multi++;
    expect(byPos.size, 'curved wall must have welded positions').toBeGreaterThan(0);
    expect(multi, 'smooth: no welded wall position keeps >1 distinct normal').toBe(0);
    expect(unit, 'all wall corner normals are unit length').toBe(tot);
  });

  it('the wall↔bottom-cap rim (90° crease) stays HARD — SPLIT, not blurred', () => {
    const nrm = creaseAwareCornerNormals(pos, idx, 60);
    const nt = idx.length / 3;
    // Collect corner normals at the z≈0 outer rim (r≈R) grouped by position.
    const byPos = new Map<string, Set<string>>();
    let axialCorners = 0, radialCorners = 0;
    for (let t = 0; t < nt; t++) {
      for (let k = 0; k < 3; k++) {
        const v = idx[t * 3 + k];
        const px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2];
        const rad = Math.hypot(px, py);
        if (Math.abs(rad - R) > 0.06 || pz > 0.05) continue; // z=0 outer rim
        const o = t * 9 + k * 3;
        const nx = nrm[o], ny = nrm[o + 1], nz = nrm[o + 2];
        const kk = keyPos(px, py, pz);
        if (!byPos.has(kk)) byPos.set(kk, new Set());
        byPos.get(kk)!.add(keyNrm(nx, ny, nz));
        if (Math.abs(nz) > 0.7) axialCorners++;                 // bottom-cap face
        else if (Math.abs(nz) < 0.3) radialCorners++;           // wall face
      }
    }
    // The rim carries BOTH a cap (axial) and a wall (radial) normal → the crease
    // did NOT average them into a single blurred slope.
    expect(axialCorners, 'rim has cap-axial corner normals').toBeGreaterThan(0);
    expect(radialCorners, 'rim has wall-radial corner normals').toBeGreaterThan(0);
    let split = 0;
    for (const s of byPos.values()) if (s.size > 1) split++;
    expect(split, 'at least one rim position keeps SPLIT normals (hard crease)').toBeGreaterThan(0);
  });
});
