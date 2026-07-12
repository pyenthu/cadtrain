/**
 * S4 (sample ladder, TODO #42e) — the DEVIATED rung's payoff, asserted on real
 * geometry: a HALF-SECTIONED `bw_casing` warped along `13-vertical-land-producer-
 * deviated`'s J-medium survey must bend as a smooth arc, with NO bridging
 * triangle (the #64 defect).
 *
 * This is the geometric property S4 exists to prove, and it was UNBLOCKED by the
 * #64 fix that landed 2026-07-10: `sectionCut` now refines the CUT RESULT (not
 * just the wedge), so the mesh boolean's retriangulated cut faces no longer carry
 * a full-height spanning edge that the warp would bend into a straight chord.
 *
 * The defect is a SPANNING EDGE — a triangle edge whose |Δz| crosses most of the
 * part. Warp only moves existing vertices, so a full-height edge bends into a
 * chord across the cut face. Assert the property directly (edge span), not a
 * proxy: the pre-fix build ALSO satisfied "more verts + still manifold".
 *
 * Metric + geometry reuse the #64 describe block in
 * `src/lib/graph/sectioncut-warp-axial.test.ts` (`edgeSpan()`), on the same
 * 40-long hollow casing (RO 3.5 / RI 3.1) — but the warp spline is derived from
 * S4's ACTUAL survey trajectory, so this is the deviated rung, not a synthetic
 * curve. Headless (CLAUDE.md Rule 26): Manifold runs in Node, no browser.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initManifold, sectionCut } from '$lib/engines/manifold/manifold-helpers';
import { setAxialMaxZSpan } from '$lib/engines/manifold/manifold-mesh';
import { warpManifoldAlongSpline } from '$lib/engines/manifold/warp-spline';
import { r_revolve } from '$lib/graph/stdlib/r_revolve';
import { buildTrajectory } from '../assemble';
import { parseWson, type Wson } from '../wson';

beforeAll(async () => { await initManifold(); });
// Restore the shipped default (OFF) so test ordering can't leak the dial.
afterEach(() => setAxialMaxZSpan(null));

// The #64 casing + dial, verbatim, so the before/after numbers are comparable.
const H = 40, RO = 3.5, RI = 3.1, SEG = 24, DIAL = 1.5;
const SOLID = (R: number, h: number): [number, number][] => [[0, 0], [R, 0], [R, h], [0, h]];
/** `bw_casing` on the volume: hollow = r_revolve(outer) − r_revolve(inner). */
const casing = () => r_revolve(SOLID(RO, H), SEG).subtract(r_revolve(SOLID(RI, H), SEG));

/** Largest |Δz| over every triangle edge, and how many exceed `limit`. Copied
 *  from the #64 `edgeSpan()` — the metric that actually catches the bridge. */
function edgeSpan(m: any, limit: number): { max: number; over: number } {
  const mesh = m.getMesh();
  const vp = mesh.vertProperties, tv = mesh.triVerts, np = mesh.numProp ?? 3;
  const z = (i: number) => vp[i * np + 2];
  let max = 0, over = 0;
  for (let t = 0; t < tv.length / 3; t++) {
    const [i, j, k] = [tv[t * 3], tv[t * 3 + 1], tv[t * 3 + 2]];
    for (const [p, q] of [[i, j], [j, k], [k, i]]) {
      const dz = Math.abs(z(p) - z(q));
      if (dz > max) max = dz;
      if (dz > limit) over++;
    }
  }
  return { max, over };
}

/** Derive a PLANAR warp spline `[x=lateral, z=depth]` from S4's REAL survey:
 *  sample the average-angle trajectory (`buildTrajectory`, the same walk
 *  `wson-to-graph` uses) across the build-up section, project to (lateral, tvd),
 *  and rebase depth to span [-5, 45] so a 40-long casing sits inside it. This is
 *  S4's J-medium curvature, not an invented arc. */
function s4WarpSpline(wson: Wson): [number, number][] {
  const at = buildTrajectory(wson.profile);
  const raw = [300, 380, 460, 540].map((md) => {
    const p = at(md);
    return { lat: Math.hypot(p[0], p[1]), tvd: p[2] };
  });
  const tvd0 = raw[0].tvd;
  const sc = 50 / (raw[raw.length - 1].tvd - raw[0].tvd); // tvd window → 50 units
  return raw.map((r) => [r.lat * sc, -5 + (r.tvd - tvd0) * sc] as [number, number]);
}

const S4 = (): Wson =>
  parseWson(readFileSync('src/lib/wells/samples/13-vertical-land-producer-deviated.wson', 'utf8')).wson;

describe('S4 warp — half-sectioned bw_casing bends smoothly, no bridging triangle', () => {
  it('the S4 survey yields a genuinely curved lateral spline over the casing window', () => {
    const spline = s4WarpSpline(S4());
    expect(spline).toHaveLength(4);
    // Spans the 40-long casing (z 0..40) with margin, and deviates laterally.
    expect(spline[0][1]).toBeLessThanOrEqual(0);
    expect(spline[spline.length - 1][1]).toBeGreaterThanOrEqual(40);
    const maxLateral = Math.max(...spline.map((p) => Math.abs(p[0])));
    expect(maxLateral).toBeGreaterThan(1);
  });

  it('CLEAN BY CONSTRUCTION — dial OFF carries NO full-height spanning edge (arc revolve, not wedge)', () => {
    // Old bug: the wedge SUBTRACT retriangulated the cut faces into full-height
    // edges, needing a post-subtract refine. The arc revolve never creates them,
    // so even dial-OFF (no refine) the cut carries zero spanning edges.
    setAxialMaxZSpan(DIAL);
    const body = casing();
    setAxialMaxZSpan(null);
    const cutUnrefined = sectionCut(body, { az: 180 });
    const { over, max } = edgeSpan(cutUnrefined, 10);
    expect(over).toBe(0);
    expect(max).toBeLessThan(H * 0.5);
  });

  it('#64 FIX — dial ON → ZERO edges with Δz > 5 on the 40-long casing, before AND after the warp', () => {
    setAxialMaxZSpan(DIAL);
    const cut = sectionCut(casing(), { az: 180 });
    const preWarp = edgeSpan(cut, 5);
    expect(preWarp.over).toBe(0); // the cut result carries no spanning edge

    const warped = warpManifoldAlongSpline(cut, s4WarpSpline(S4()), { validate: true });
    // Valid closed solid — the warp did not throw "Not manifold".
    expect(warped.numTri()).toBeGreaterThan(0);
    expect(warped.volume()).toBeGreaterThan(0);
    expect(Number.isFinite(warped.genus())).toBe(true);

    const post = edgeSpan(warped, 5);
    // eslint-disable-next-line no-console
    console.log(`[S4 warp] preWarp over5=${preWarp.over} | warped over5=${post.over} max=${post.max.toFixed(2)} (pre-#64: 104 over Δz10, max 40.49)`);
    // THE assertion: no bridging triangle survives the cut+warp. Pre-fix this was
    // 104 edges over Δz 10, max 40.49 — a chord across the entire 40-long part.
    expect(post.over).toBe(0);
    expect(edgeSpan(warped, 10).max).toBeLessThan(H * 0.25);
  });

  it('the dense warp preserves volume; the lean (dial-off) warp loses it to chords', () => {
    setAxialMaxZSpan(DIAL);
    const dense = warpManifoldAlongSpline(sectionCut(casing(), { az: 180 }), s4WarpSpline(S4()), {});
    const denseVol = dense.volume();

    setAxialMaxZSpan(null);
    const lean = warpManifoldAlongSpline(sectionCut(casing(), { az: 180 }), s4WarpSpline(S4()), {});
    const leanVol = lean.volume();

    const trueVol = 163.99; // the unwarped sectioned casing (#64 baseline)
    expect(Math.abs(denseVol - trueVol) / trueVol).toBeLessThan(0.01);
    expect(Math.abs(leanVol - trueVol) / trueVol).toBeGreaterThan(0.02);
  });
});
