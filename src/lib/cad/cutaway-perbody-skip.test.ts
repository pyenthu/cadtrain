/**
 * finalizeManifold — the cutaway auto-skip must be judged on the LARGEST
 * connected body, not the monolith total (docs/plans/svtc-section-cutaway.md
 * Tier 1). `cutawayVC` decomposes and cuts each body ≈linearly, so a many-body
 * assembly whose SUM exceeds the 120k tri guard must STILL get its per-part
 * cross-section — only a genuinely huge SINGLE connected body may skip.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as helpers from './manifold-helpers';
import { cyl, mv, place, setCircularSegmentCount, getCircularSegmentCount } from './manifold-helpers';
import { finalizeManifold } from './render-helpers';

function nVerts(g: any): number {
  const a = g?.getAttribute?.('position');
  return a ? a.count : 0;
}

// The two big cases build 150k–160k tris and cut them. Alone that fits vitest's
// 5s default, but under the full suite the parallel workers contend for CPU and
// it runs ~9s → timeout. The tri counts ARE the assertions here, so raise the
// budget rather than shrink the meshes.
const HEAVY_CSG_TIMEOUT_MS = 60_000;

describe('finalizeManifold cutaway skip — per-body, not monolith total', () => {
  let seg0 = 0;
  beforeAll(async () => { await helpers.initManifold(); seg0 = getCircularSegmentCount(); });
  afterEach(() => { setCircularSegmentCount(seg0); });

  it('small single body → cutaway computed; auto == force-compute (byte-identical)', () => {
    setCircularSegmentCount(64);
    const m = cyl(4, 1, 1);
    const auto = finalizeManifold(m, 1.5, undefined, undefined, {}) as any;
    const forced = finalizeManifold(m, 1.5, undefined, undefined, { skipCutaway: false }) as any;
    expect(auto.cutawaySkipped).toBe(false);
    expect(nVerts(auto.cutVC)).toBeGreaterThan(0);
    // The auto path for a small mesh is the SAME as force-compute → identical verts.
    expect(nVerts(auto.cutVC)).toBe(nVerts(forced.cutVC));
  });

  it('MANY small bodies whose SUM > 120k tris → cutaway STILL computed (the fix)', () => {
    // ~2.5k tris/cyl at seg 640; 60 bodies ≈ 150k total, each body ≪ 120k.
    setCircularSegmentCount(640);
    const parts: any[] = [];
    for (let i = 0; i < 60; i++) parts.push(mv(cyl(2, 1, 1), [i * 5, 0, 0]));
    const m = place(parts);
    const bodies = m.decompose();
    const total = m.numTri();
    expect(bodies.length).toBe(60);
    expect(total).toBeGreaterThan(120_000);           // sum trips the old guard
    expect(Math.max(...bodies.map((b: any) => b.numTri()))).toBeLessThan(120_000); // but each body is small
    const res = finalizeManifold(m, 1.5, undefined, undefined, {}) as any;
    expect(res.cutawaySkipped).toBe(false);           // OLD code skipped here; NEW code cuts per-body
    expect(nVerts(res.cutVC)).toBeGreaterThan(0);
  }, HEAVY_CSG_TIMEOUT_MS);

  it('single HUGE connected body > 120k tris → still skips (per-body win cannot apply)', () => {
    // One cylinder at very high segments → a single connected body > 120k tris.
    setCircularSegmentCount(40_000); // ~160k tris, one body
    const m = cyl(4, 1, 1);
    expect(m.decompose().length).toBe(1);
    expect(m.numTri()).toBeGreaterThan(120_000);
    const res = finalizeManifold(m, 1.5, undefined, undefined, {}) as any;
    expect(res.cutawaySkipped).toBe(true);
    expect(nVerts(res.cutVC)).toBe(0);
  }, HEAVY_CSG_TIMEOUT_MS);
});
