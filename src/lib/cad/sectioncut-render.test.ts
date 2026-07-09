/**
 * sectioncut-render.test.ts — the AUTHORED angular cutaway (`sectionCut`) must
 * render a CAPPED cross-section in the 3D-bake tab, matching the TF tab.
 *
 * BUG (2026-07-09): in /primitives the 3D-bake ✂ section cutaway read as an
 * OPEN CLIP (hollow, no cap on the cut face) while the TF tab showed a proper
 * capped CSG cut on the SAME graph.
 *
 * ROOT CAUSE (established here, not assumed): the Manifold `sectionCut` IS a
 * real, capped, watertight `solid.subtract(wedge)` (Part A proves it). But the
 * wedge is UNTAGGED, so the NEW cross-section faces the subtract creates carry
 * the wedge's auto Manifold originalID — an id that is NOT in the color-by-source
 * LUT. When color-by-source is active the scene renders `geo.parts[]` /
 * `cutParts[]` (built by `buildSourceParts`), which DROPPED every triangle whose
 * id was not a known part → the authored cut face vanished → "hollow / open clip".
 * The MERGED `full`/`cutVC` path (`colorBySourceGeo`) never dropped it (unknown id
 * → body colour), so the two paths disagreed. TF has no per-source drop → capped.
 *
 * FIX: `buildSourceParts` now buckets an UNKNOWN-id triangle into the BODY (like
 * `colorBySourceGeo` + TF) instead of dropping it, in BOTH full and cut modes.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initManifold, cyl, tube, sectionCut, tagManifold } from './manifold-helpers';
import { finalizeManifold } from './render-helpers';
import { triSourceIds, partHashId, SECTION_ID } from './part-id';
import type { PartColorLUT } from './part-lut-types';
import { compilePrimitiveScript } from '$lib/server/primitive-loader';
import { analyzeParts, resolveDepColors } from '$lib/server/part-colors';
import { runCompiledManifold } from './bake-worker-core';

beforeAll(async () => {
  await initManifold();
});

const EPS = 1e-3;

/** Count triangles lying ON the y=0 cut plane in a NON-INDEXED positions buffer
 *  (9 floats / tri, [x,y,z]×3). For an az=180/offset=0 cut the removed wedge is
 *  the y≥0 half, so the new cap face sits at y≈0. Zero of these = the cap was
 *  dropped (an "open clip"). */
function countCutPlaneTrisPos(positions: ArrayLike<number>): number {
  let n = 0;
  const nt = (positions.length / 9) | 0;
  for (let t = 0; t < nt; t++) {
    const o = t * 9;
    if (
      Math.abs(positions[o + 1]) < EPS &&
      Math.abs(positions[o + 4]) < EPS &&
      Math.abs(positions[o + 7]) < EPS
    ) n++;
  }
  return n;
}

/** Same, decoding an INDEXED Manifold mesh (vertProperties + triVerts). */
function countCutPlaneTrisManifold(m: any): number {
  const mesh = m.getMesh();
  const vp = mesh.vertProperties as Float32Array;
  const tri = mesh.triVerts as Uint32Array;
  const np = mesh.numProp;
  let n = 0;
  for (let t = 0; t < tri.length / 3; t++) {
    const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
    if (
      Math.abs(vp[a * np + 1]) < EPS &&
      Math.abs(vp[b * np + 1]) < EPS &&
      Math.abs(vp[c * np + 1]) < EPS
    ) n++;
  }
  return n;
}

// ─────────────────────────────────────────────────────────────────────────────
// Part A — the MANIFOLD sectionCut is a real, capped, watertight subtraction.
// (Proves the geometry/maths is fine; the defect is purely in the render path.)
// ─────────────────────────────────────────────────────────────────────────────
describe('sectionCut — the Manifold subtraction is a real capped CSG', () => {
  it('solid cylinder: watertight, genus 0, POSITIVE volume ~halved, cap present', () => {
    const solid = cyl(20, 3);           // length 20, r 3, along +Z
    const cut = sectionCut(solid, { az: 180 });
    // Valid closed solid — not "Not manifold", not inverted.
    expect(cut.numTri()).toBeGreaterThan(0);
    expect(cut.genus()).toBe(0);
    const vFull = solid.volume();
    const vCut = cut.volume();
    expect(vCut).toBeGreaterThan(0);                    // positive sign → not inverted CSG
    expect(vCut).toBeCloseTo(vFull / 2, 0);             // half removed
    // The cut face EXISTS (a clip would leave a hole → 0 cap tris).
    const cap = countCutPlaneTrisManifold(cut);
    // eslint-disable-next-line no-console
    console.log(`[sectionCut render] solid-cyl cap tris = ${cap}, volume ${vCut.toFixed(1)} of ${vFull.toFixed(1)}`);
    expect(cap).toBeGreaterThan(0);
  }, 20_000);

  it('hollow tube: still capped (annular cross-section) + watertight', () => {
    const t = tube(3, 1.5, 20);
    const cut = sectionCut(t, { az: 180 });
    expect(cut.numTri()).toBeGreaterThan(0);
    expect(cut.volume()).toBeGreaterThan(0);
    expect(countCutPlaneTrisManifold(cut)).toBeGreaterThan(0);
  }, 20_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Part B — under COLOR-BY-SOURCE the untagged wedge face carries an id that is
// NOT in the LUT. Establish that fact, then assert the render KEEPS the cap.
// ─────────────────────────────────────────────────────────────────────────────
describe('sectionCut — the wedge cut face is untagged (id not in the LUT)', () => {
  it('the cross-section triangles carry an id outside the part-hash band', () => {
    const bodyId = partHashId('body');
    const solid = cyl(20, 3);
    const cut = sectionCut(solid, { az: 180 });
    const mesh = cut.getMesh();
    const ids = triSourceIds(mesh);
    const vp = mesh.vertProperties as Float32Array;
    const tri = mesh.triVerts as Uint32Array;
    const np = mesh.numProp;
    const capIds = new Set<number>();
    for (let t = 0; t < tri.length / 3; t++) {
      const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
      if (Math.abs(vp[a * np + 1]) < EPS && Math.abs(vp[b * np + 1]) < EPS && Math.abs(vp[c * np + 1]) < EPS) {
        capIds.add(ids[t]);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[sectionCut render] cap-face ids = ${[...capIds].map((x) => '0x' + x.toString(16))}, bodyId = 0x${bodyId.toString(16)}`);
    expect(capIds.size).toBeGreaterThan(0);
    // The cap ids are NEITHER the body's hash NOR SECTION_ID — that's why the
    // per-part classifier dropped them.
    for (const id of capIds) {
      expect(id).not.toBe(bodyId);
      expect(id).not.toBe(SECTION_ID);
    }
  }, 20_000);
});

/** Minimal ACTIVE color-by-source LUT for a single tagged body. */
function bodyLut(name: string): PartColorLUT {
  const id = partHashId(name);
  return {
    outer: { [id]: '#cc0000' },
    inner: { [id]: '#661111' },
    opacity: {},
    subtractive: [],
    bodyId: id,
    bodyInner: '#888888',
    bodyColor: '#cc0000',
    bodyName: name,
    bodyCall: null,
    active: true,
    names: { [id]: name },
    appearance: { [id]: { colorOuter: '#cc0000', colorInner: '#661111' } },
  };
}

describe('sectionCut — finalizeManifold keeps the cap in the per-part meshes', () => {
  it('full view: geo.parts[] retains the authored cross-section (not dropped)', () => {
    // Emulate the emitted composite geom: a NAMED body (tagged the way the
    // loader's tagInstanceSources stamps it), section-cut, with an active
    // color-by-source LUT (what the scene renders as geo.parts[]).
    const solid = tagManifold(cyl(20, 3), partHashId('body'));
    const cut = sectionCut(solid, { az: 180 });
    const lut = bodyLut('body');
    const res: any = finalizeManifold(cut, 6, undefined, lut, { skipCutaway: false });

    // The MERGED full path (colorBySourceGeo) always kept the cap — sanity anchor.
    const fullCap = countCutPlaneTrisPos(res.full.getAttribute('position').array);
    expect(fullCap).toBeGreaterThan(0);

    // The PER-PART path (buildSourceParts) is what the scene actually renders.
    expect(res.parts?.length).toBeGreaterThan(0);
    let partCap = 0;
    for (const p of res.parts) partCap += countCutPlaneTrisPos(p.geo.getAttribute('position').array);
    // eslint-disable-next-line no-console
    console.log(`[sectionCut render] full cap=${fullCap}  parts cap=${partCap}`);
    expect(partCap).toBeGreaterThan(0); // FAILS before the fix (cap dropped → hollow)
  }, 20_000);

  it('cut view: cutParts[] also retains the cross-section', () => {
    const cut = sectionCut(tagManifold(cyl(20, 3), partHashId('body')), { az: 180 });
    const res: any = finalizeManifold(cut, 6, undefined, bodyLut('body'), { skipCutaway: false });
    expect(res.cutParts?.length).toBeGreaterThan(0);
    let cutCap = 0;
    for (const p of res.cutParts) cutCap += countCutPlaneTrisPos(p.geo.getAttribute('position').array);
    expect(cutCap).toBeGreaterThan(0);
  }, 20_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Part C — full end-to-end through the CLIENT bake pipeline (compile → run),
// the exact path /primitives uses: composite + color-by-source + authored cut.
// ─────────────────────────────────────────────────────────────────────────────
const sources: Record<string, string> = {
  sc_body: `export const meta = { id:'sc_body', name:'body', params:{ r:{value:3}, h:{value:20} }, colorOuter:'#cc0000', colorInner:'#661111' };\nexport function sc_body(r, h){ return cyl(h, r); }`,
  sc_asm: `export const meta = { id:'sc_asm', name:'sc', params:{}, uses:['sc_body'] };\nexport function sc_asm(){ const body = sc_body(3, 20); return sectionCut(body, { az: 180 }); }`,
};
const fakeFetch = (async (url: any) => {
  const name = new URL(String(url), 'http://x').searchParams.get('name') ?? '';
  const source = sources[name];
  if (source == null) return { ok: false, status: 404, json: async () => ({}) } as any;
  return { ok: true, status: 200, json: async () => ({ source }) } as any;
}) as any;

describe('sectionCut — client bake end-to-end (compile → runCompiledManifold)', () => {
  it('a composite with an authored cutaway keeps its cap in geo.parts[]', async () => {
    const { script } = await compilePrimitiveScript(sources.sc_asm, 'sc_asm', fakeFetch);
    const lut = analyzeParts(sources.sc_asm, await resolveDepColors(sources.sc_asm, fakeFetch));
    expect(lut.active).toBe(true);
    const out: any = await runCompiledManifold(script, [], { parts: lut, cutaway: false });

    const fullCap = countCutPlaneTrisPos(out.full.positions);
    let partCap = 0;
    for (const p of out.parts ?? []) partCap += countCutPlaneTrisPos(p.geo.positions);
    // eslint-disable-next-line no-console
    console.log(`[sectionCut render] e2e full cap=${fullCap}  parts cap=${partCap}`);
    expect(fullCap).toBeGreaterThan(0);       // merged path was always fine
    expect(out.parts?.length).toBeGreaterThan(0);
    expect(partCap).toBeGreaterThan(0);        // the fix: parts path keeps the cap
  }, 30_000);
});
