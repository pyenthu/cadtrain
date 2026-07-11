/**
 * brep-warp.test.ts — E4: BREP-native deviated-well warp via spline sweep.
 *
 * OFFLINE pins (no network / no volume): each case is a self-contained inline
 * part whose only dep is the local `r_revolve` engine, reconstructing the SHAPE
 * of the real deviated parts (w_deviated_casing / w1_oh_warp). It bakes through
 * the Manifold pipeline (oracle) AND OCCT/BREP (brepFromSource). We assert the
 * swept B-rep is valid, is LEANER than MF, and actually FOLLOWS the spline
 * (bbox curves far past a straight tube's radial extent).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as helpers from '$lib/cad/manifold-helpers';
import { bakeMF, bakeBREP, meshStats, defaultParamObject } from './brep-audit';
import { brepFromSource } from './brep-occt';

const stdFetch = (async (url: any): Promise<any> => {
  const m = String(url).match(/[?&]name=([^&]+)/);
  if (m) {
    const { stdlibSource } = await import('$lib/server/stdlib');
    const s = stdlibSource(decodeURIComponent(m[1]));
    if (s) return { ok: true, status: 200, json: async () => ({ source: s }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
}) as unknown as typeof fetch;

beforeAll(async () => { await helpers.initManifold(); });

// bw_casing SHAPE, inline: 24-gon annulus (od/2 minus od/2−wall) + 180° section
// cut, then warp along the survey spline. `path`/`opts` interpolated so cases
// share one template.
const casingWarp = (path: string, opts: string, od = 7, wall = 0.4, length = 30) => `
export const meta = { id: 'w_dev_cas', name: 'w_dev_cas', kind: 'asm', uses: ['r_revolve'], params: {} };
export function w_dev_cas() {
  const path = ${path};
  const A = r_revolve({ profile: [[0,0],[${od / 2},0],[${od / 2},${length}],[0,${length}]], segments: 24 });
  const B = r_revolve({ profile: [[0,0],[${od / 2 - wall},0],[${od / 2 - wall},${length}],[0,${length}]], segments: 24 });
  const half = sectionCut(A.subtract(B), { az: 180, offset: 0 });
  return warpSpline(half, path, ${opts});
}`;

const DEV_PATH = '[[0,0,0],[-0.21,2.561,11.576],[3,0,20],[9,0,30]]';

describe('brep-warp (E4): MakePipeShell sweep of a cross-section along the survey spline', () => {
  it('single-cut casing — the swept half-section FOLLOWS the deviated spline', async () => {
    const src = casingWarp(`resampleSpline(${DEV_PATH}, 32, false)`, '{ refine: 40 }');
    const brep = await bakeBREP(src, {}, stdFetch);
    const mf = await bakeMF(src, 'w_dev_cas', {}, stdFetch);

    // 1) valid solid.
    expect(brep.volume, 'BREP volume > 0').toBeGreaterThan(0);
    expect(brep.tris, 'BREP produced tris').toBeGreaterThan(0);

    // 2) it CURVED: a straight od=7 casing spans x,y ∈ [−3.5, 3.5]. The survey
    //    ends near x≈9, so the swept solid must reach WELL past a straight tube's
    //    +x radius (proves the section rode the spline, not a straight extrude).
    expect(brep.bbox.max[0], `bbox maxX ${brep.bbox.max[0].toFixed(2)} must curve past straight radius 3.5`).toBeGreaterThan(7);
    expect(brep.dims[0], `x-extent ${brep.dims[0].toFixed(2)} ≫ straight 7`).toBeGreaterThan(10);

    // 3) leaner than the Manifold oracle (OCCT's deflection-adaptive mesher).
    expect(brep.tris, `BREP ${brep.tris} tris must be < MF ${mf.tris}`).toBeLessThan(mf.tris);

    // 4) volume in the ballpark of the (faceted) half-annulus (bend perturbs it).
    const straightHalf = 0.5 * Math.PI * (3.5 * 3.5 - 3.1 * 3.1) * 30;   // ≈124
    expect(Math.abs(brep.volume - straightHalf) / straightHalf, 'warped vol within 12% of straight half-annulus').toBeLessThan(0.12);
    // eslint-disable-next-line no-console
    console.log(`[E4 casing] BREP vol=${brep.volume.toFixed(1)} tris=${brep.tris} bbox=${JSON.stringify(brep.bbox.max.map((x) => +x.toFixed(1)))} | MF vol=${mf.volume.toFixed(1)} tris=${mf.tris}`);
  });

  it('STRAIGHT survey reproduces the un-warped half-section (parity invariant)', async () => {
    const src = casingWarp('resampleSpline([[0,0,0],[0,0,15],[0,0,30]], 16, false)', '{ refine: 40 }');
    const brep = await bakeBREP(src, {}, stdFetch);
    // A straight survey down +z must NOT curve: bbox stays within a straight
    // od=7 casing's radial extent (± ~3.6 with facet slack), z spans ~[0,30].
    for (let k = 0; k < 2; k++) {
      expect(Math.abs(brep.bbox.min[k]), `axis ${k} min within straight radius`).toBeLessThan(3.6);
      expect(Math.abs(brep.bbox.max[k]), `axis ${k} max within straight radius`).toBeLessThan(3.6);
    }
    expect(brep.dims[2], 'z-extent ≈ length 30').toBeGreaterThan(29);
    expect(brep.dims[2], 'z-extent ≈ length 30').toBeLessThan(31);
    const straightHalf = 0.5 * Math.PI * (3.5 * 3.5 - 3.1 * 3.1) * 30;
    expect(Math.abs(brep.volume - straightHalf) / straightHalf, 'straight-survey vol ≈ un-warped half-annulus').toBeLessThan(0.05);
  });

  it('open-hole (solid disk) + multi-element on ONE spline (w1_oh_warp shape)', async () => {
    // Two elements swept along the same deviated survey: a section-cut casing at
    // arc-length [35,75] and an open-hole disk at [0,100] (originZ:0 → absolute
    // placement). Mirrors w1_oh_warp's `[warpSpline(mv(C)), warpSpline(A)]` list.
    const src = `
export const meta = { id: 'w1_oh', name: 'w1_oh', kind: 'asm', uses: ['r_revolve'], params: {} };
export function w1_oh() {
  const path = resampleSpline([[0,0,0],[4.414,13.783,42.892],[12.98,16.181,69.149],[27.485,45.034,74.131]], 24, false);
  const cA = r_revolve({ profile: [[0,0],[2,0],[2,40],[0,40]], segments: 24 });
  const cB = r_revolve({ profile: [[0,0],[1.6,0],[1.6,40],[0,40]], segments: 24 });
  const C = sectionCut(cA.subtract(cB), { az: 180, offset: 0 });
  const A = r_revolve({ profile: [[0,0],[3,0],[3,100],[0,100]], segments: 24 });
  return [ warpSpline(mv(C, [0,0,35]), path, { refine: 4, originZ: 0 }), warpSpline(A, path, { refine: 4, originZ: 0 }) ];
}`;
    // Per-part stats (bakeBREP sums the compound). Assert both elements bake +
    // the union bbox curves hard toward the survey end (x≈27, y≈45).
    const brep = await bakeBREP(src, {}, stdFetch);
    expect(brep.volume, 'two-element BREP vol > 0').toBeGreaterThan(0);
    expect(brep.tris, 'two-element BREP tris > 0').toBeGreaterThan(0);
    expect(brep.bbox.max[0], `union maxX ${brep.bbox.max[0].toFixed(1)} tracks survey (→x≈27)`).toBeGreaterThan(15);
    expect(brep.bbox.max[1], `union maxY ${brep.bbox.max[1].toFixed(1)} tracks survey (→y≈45)`).toBeGreaterThan(20);
    // eslint-disable-next-line no-console
    console.log(`[E4 multi] BREP vol=${brep.volume.toFixed(1)} tris=${brep.tris} bbox=${JSON.stringify(brep.bbox.max.map((x) => +x.toFixed(1)))}`);
  });

  it('curvature is monotone along the spline (centroid of each z-band tracks the survey)', async () => {
    // Slice the swept casing into z-bands; each band's centroid x must climb with
    // z (the survey drifts monotonically toward +x after its early wiggle) — a
    // straight tube would keep centroid x ≈ 0 for every band.
    const src = casingWarp(`resampleSpline(${DEV_PATH}, 32, false)`, '{ refine: 40 }');
    const mesh = await brepFromSource(src, {}, { cut: false }, stdFetch);
    expect(mesh).toBeTruthy();
    const pos = mesh!.positions;
    // gather (z, x) of every vertex; bucket by z into 4 bands; mean x per band.
    let zmin = Infinity, zmax = -Infinity;
    for (let i = 2; i < pos.length; i += 3) { if (pos[i] < zmin) zmin = pos[i]; if (pos[i] > zmax) zmax = pos[i]; }
    const bands = 4, sumX = new Array(bands).fill(0), cnt = new Array(bands).fill(0);
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], z = pos[i + 2];
      let b = Math.floor(((z - zmin) / (zmax - zmin || 1)) * bands); if (b >= bands) b = bands - 1; if (b < 0) b = 0;
      sumX[b] += x; cnt[b] += 1;
    }
    const meanX = sumX.map((s, i) => s / (cnt[i] || 1));
    // last band's centroid x must be well beyond the first (survey drifts to x≈9).
    expect(meanX[bands - 1] - meanX[0], `centroid x drift ${(meanX[bands - 1] - meanX[0]).toFixed(2)} proves the sweep bent`).toBeGreaterThan(3);
  });
});
