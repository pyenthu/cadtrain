/**
 * TRACK B repro — horizontal well 04 (deviated) "fails to bake in Manifold,
 * bakes in TrueForm". KEEP or delete after review.
 *
 * ROOT CAUSE (verified, not theorised): every `bw_*` well element embeds an
 * internal half-section `sectionCut`, whose `refineToLength(getAxialMaxZSpan())`
 * is an UNCAPPED global edge refine (unlike subdivideProfileAxial's per-edge cap
 * of 64, and unlike TF's densifiers which cap TOTAL stations at 128). When the
 * /wells GRAPH view bakes the deviated well through the generic GraphEditorPane
 * it never threads the survey-derived axialMaxZSpan (well-graph-bake.ts is
 * unwired), so `smoothWarp` falls back to the absolute WARP_AXIAL_MAX_ZSPAN=1.5.
 * On km-scale tubulars (production casing = 3500 m) that is length/1.5 ≈ 2333
 * rings/part × 14 parts → ~20M+ verts held at once → the Manifold WASM heap
 * OOB-traps in the bake worker. TF renders because its axial densifier caps the
 * station COUNT regardless of length.
 *
 * FIX: cap the total axial rings in sectionCut (manifold-helpers.ts,
 * AXIAL_REFINE_CAP=256). This test pins the numbers the fix relies on and proves
 * (a) the translator DOES handle this well (the probe that threw
 * `WsonTranslateError` passed the wrong shape — parseWson returns `{wson,issues}`)
 * and (b) the derived-span bake stays bounded.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as helpers from '$lib/cad/manifold-helpers';
import { runCompiledManifold } from '$lib/cad/bake-worker-core';
import { parseWson, type Wson } from './wson';
import { wsonToGraph } from './wson-to-graph';
import { wellBakeSpec, wellMaxRadius } from './well-graph-bake';
import { axialSpanForSurvey, minRadiusOfCurvature } from './axial-density';
import { analyzeParts } from '$lib/server/part-colors';
import type { SurveyStation } from '$lib/cad/survey-to-xyz';

const MAIN = '/Users/neerajsethi/code/cadtrain';
// The CURRENT dep-resolved compiled MF script for well 4 (14 elements, warped).
const WELL_SCRIPT = `${MAIN}/.dev-volume/cache/scripts/w_sample_4_horizontal_shale_producer_plug_and_pe/b890e42f0b3808993fe03c5ce24a7b4c88e945ca351c7387d8a85f28c9260d6b.js`;
const sample = (slug: string): Wson =>
  parseWson(readFileSync(resolve('src/lib/wells/samples', `${slug}.wson`), 'utf8')).wson;

beforeAll(async () => { await helpers.initManifold(); });

describe('Track B — the translator DOES handle this well', () => {
  it('wsonToGraph on the PARSED well (not the {wson,issues} wrapper) translates', () => {
    const wson = sample('04-horizontal-shale-pnp');
    const graph = wsonToGraph(wson);                 // does NOT throw
    expect(Object.keys(graph.nodes).length).toBeGreaterThan(0);
    // The failing probe was `wsonToGraph(parseWson(raw))` — parseWson returns an
    // OBJECT, so `.oh/.ch/.cementing` were undefined → "no structural sections".
    expect(() => wsonToGraph(parseWson(readFileSync(
      resolve('src/lib/wells/samples', '04-horizontal-shale-pnp.wson'), 'utf8')) as any))
      .toThrow(/no structural sections/);
  });
});

describe('Track B — the survey-derived numbers', () => {
  it('derives a sane axial span; the well is long enough to blow up at the 1.5 default', () => {
    const wson = sample('04-horizontal-shale-pnp');
    const prof = wson.profile as SurveyStation[];
    expect(minRadiusOfCurvature(prof)).toBeGreaterThan(500);       // ~818 m
    const span = axialSpanForSurvey(prof, wellMaxRadius(wson))!;
    expect(span).toBeGreaterThan(10);                              // ~15.14 m
    // The graph-editor default (WARP_AXIAL_MAX_ZSPAN=1.5) is ~10x denser than the
    // derived value — on the 3500 m casing that is the OOM.
    expect(span / 1.5).toBeGreaterThan(9);
  });
});

describe('Track B — MF bake stays bounded (fix in effect)', () => {
  const script = readFileSync(WELL_SCRIPT, 'utf8');
  const wson = sample('04-horizontal-shale-pnp');
  const spec = wellBakeSpec(wson);
  const lut = analyzeParts(spec.source, {});

  it('bakes at the DERIVED span with separate parts + cutaway', async () => {
    const out = await runCompiledManifold(script, {}, { ...spec.options, parts: lut, cutaway: true });
    expect(out.parts?.length).toBe(14);
    // With the AXIAL_REFINE_CAP fix no single part exceeds ~256 rings worth of
    // geometry; the worst tubular stays well under 1M floats.
    const worst = Math.max(...(out.parts ?? []).map((p: any) => p.geo?.positions?.length ?? 0));
    expect(worst).toBeLessThan(1_000_000);
  }, 120000);

  it('bakes at the DEFAULT 1.5 span (the un-threaded graph-editor path) WITHOUT OOM', async () => {
    // options WITHOUT axialMaxZSpan → smoothWarp forces WARP_AXIAL_MAX_ZSPAN=1.5.
    // Before the fix this never returned (SIGKILL / >386 s hang). With the cap it
    // completes and every part is bounded.
    const out = await runCompiledManifold(script, {}, { parts: lut, cutaway: true });
    expect(out.parts?.length).toBe(14);
    const worst = Math.max(...(out.parts ?? []).map((p: any) => p.geo?.positions?.length ?? 0));
    expect(worst).toBeLessThan(1_000_000);
  }, 180000);
});
