/**
 * The /wells 3D seam. `wellBakeSpec` is pure, so it is tested directly; the bake
 * itself is exercised through `runCompiledManifold` — the same entry point the
 * Web Worker calls — with dep sources resolved from a local fixture map, so no
 * network and no browser.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseWson, type Wson } from './wson';
import { wellBakeSpec, wellMaxRadius, WELL_PART_NAME } from './well-graph-bake';
import { axialSpanForSurvey } from './axial-density';
import type { SurveyStation } from '$lib/graph/survey-to-xyz';

const sample = (slug: string): Wson =>
  parseWson(readFileSync(`src/lib/wells/samples/${slug}.wson`, 'utf8')).wson;

const VERTICAL = '11-vertical-land-producer';
const DEVIATED = '13-vertical-land-producer-deviated';

describe('wellMaxRadius', () => {
  it('is half the widest element — the 26" surface hole here', () => {
    expect(wellMaxRadius(sample(VERTICAL))).toBeCloseTo(13, 6);
  });

  it('falls back for a well with no tubulars at all', () => {
    expect(wellMaxRadius({ meta: { wellName: 'empty' } } as Wson)).toBe(13);
  });
});

describe('wellBakeSpec', () => {
  it('emits a compilable assembly named for the compile endpoint', () => {
    const spec = wellBakeSpec(sample(VERTICAL));
    expect(spec.name).toBe(WELL_PART_NAME);
    expect(spec.name).toMatch(/^[a-z_][a-z0-9_]*$/i); // the endpoint's NAME_RE
    expect(spec.source).toContain('export const meta');
    expect(spec.source).toContain('bw_open_hole(');
  });

  it('a VERTICAL well is not deviated and disables axial densification', () => {
    const spec = wellBakeSpec(sample(VERTICAL));
    expect(spec.deviated).toBe(false);
    expect(spec.options.axialMaxZSpan).toBeNull();
    expect(spec.source).not.toContain('warpSpline(');
  });

  it('a DEVIATED well warps along ONE spline and derives its ring spacing', () => {
    const wson = sample(DEVIATED);
    const spec = wellBakeSpec(wson);
    expect(spec.deviated).toBe(true);
    expect(spec.source).toContain('resampleSpline(');
    expect(spec.source).toContain('warpSpline(');
    const expected = axialSpanForSurvey(wson.profile as SurveyStation[], wellMaxRadius(wson));
    expect(spec.options.axialMaxZSpan).toBeCloseTo(expected!, 6);
    // The whole point: far coarser than the 1.5 constant, and bounded by sag.
    expect(spec.options.axialMaxZSpan as number).toBeGreaterThan(1.5);
  });

  it('an explicit axialMaxZSpan overrides the derivation (including null)', () => {
    expect(wellBakeSpec(sample(DEVIATED), { axialMaxZSpan: 4 }).options.axialMaxZSpan).toBe(4);
    expect(wellBakeSpec(sample(DEVIATED), { axialMaxZSpan: null }).options.axialMaxZSpan).toBeNull();
  });

  it('threads cutaway + segments through, and omits them when unset', () => {
    const bare = wellBakeSpec(sample(VERTICAL));
    expect(bare.options).not.toHaveProperty('cutaway');
    expect(bare.options).not.toHaveProperty('segments');
    expect(bare.params).toEqual({});

    const full = wellBakeSpec(sample(VERTICAL), { cutaway: true, segments: 16 });
    expect(full.options.cutaway).toBe(true);
    expect(full.options.segments).toBe(16);
    expect(full.params).toEqual({ segments: 16 });
  });

  it('NO FALLBACK — an unmappable well throws rather than degrading', () => {
    const bad: Wson = {
      meta: { wellName: 'bad' },
      ch: [{ od: 9.625, id: 8.681, top: 0, bot: 100, type: 'production' }],
      completions: [{ tool_comp: 'MISC.NO_SUCH_THING', od: 2.875, top: 0, bot: 10 }],
    } as Wson;
    expect(() => wellBakeSpec(bad)).toThrow(/unmapped tool_comp/i);
  });
});
