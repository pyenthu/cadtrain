import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseWson } from '../wson';
import {
  axialSpanForSurvey, minRadiusOfCurvature, sagForSpan,
  MIN_AXIAL_SPAN, MAX_AXIAL_SPAN,
} from '../axial-density';
import type { SurveyStation } from '$lib/graph/survey/survey-to-xyz';

const vertical: SurveyStation[] = [
  { md: 0, dev: 0, az: 0 }, { md: 500, dev: 0, az: 0 }, { md: 1000, dev: 0, az: 0 },
];
/** Textbook build: 0° → 30° over 300 m of hole. R = arc/Δangle = 300 / (π/6). */
const buildUp: SurveyStation[] = [
  { md: 0, dev: 0, az: 0 }, { md: 300, dev: 30, az: 0 },
];

describe('minRadiusOfCurvature', () => {
  it('a vertical hole has infinite radius', () => {
    expect(minRadiusOfCurvature(vertical)).toBe(Infinity);
  });

  it('a build section matches arc / turned-angle', () => {
    const expected = 300 / (Math.PI / 6); // ≈ 572.96 m
    expect(minRadiusOfCurvature(buildUp)).toBeCloseTo(expected, 1);
  });

  it('takes the MINIMUM over segments — the tightest bend governs', () => {
    const mixed: SurveyStation[] = [
      { md: 0, dev: 0, az: 0 },
      { md: 300, dev: 30, az: 0 },   // gentle: R ≈ 573
      { md: 400, dev: 80, az: 0 },   // tight:  R ≈ 100 / (50°) ≈ 114.6
    ];
    expect(minRadiusOfCurvature(mixed)).toBeCloseTo(100 / (50 * Math.PI / 180), 1);
  });

  it('is degenerate-safe (empty, single station, non-increasing MD)', () => {
    expect(minRadiusOfCurvature([])).toBe(Infinity);
    expect(minRadiusOfCurvature([{ md: 0, dev: 0, az: 0 }])).toBe(Infinity);
    expect(minRadiusOfCurvature([{ md: 100, dev: 0, az: 0 }, { md: 100, dev: 30, az: 0 }])).toBe(Infinity);
  });
});

describe('axialSpanForSurvey', () => {
  it('a straight hole needs NO axial densification', () => {
    expect(axialSpanForSurvey(vertical, 5)).toBeNull();
  });

  it('satisfies the sag bound it claims: sag(h) <= tol', () => {
    const maxRadius = 5, frac = 0.004;
    const h = axialSpanForSurvey(buildUp, maxRadius, frac)!;
    expect(h).toBeGreaterThan(0);
    // Assert the PROPERTY (actual sagitta), not the formula that produced it.
    expect(sagForSpan(buildUp, h)).toBeLessThanOrEqual(maxRadius * frac * 1.001);
  });

  it('a tighter bend demands closer rings', () => {
    const gentle: SurveyStation[] = [{ md: 0, dev: 0, az: 0 }, { md: 600, dev: 30, az: 0 }];
    const tight: SurveyStation[] = [{ md: 0, dev: 0, az: 0 }, { md: 100, dev: 30, az: 0 }];
    expect(axialSpanForSurvey(tight, 5)!).toBeLessThan(axialSpanForSurvey(gentle, 5)!);
  });

  it('a fatter well tolerates coarser rings (sag is relative to its radius)', () => {
    expect(axialSpanForSurvey(buildUp, 20)!).toBeGreaterThan(axialSpanForSurvey(buildUp, 2)!);
  });

  it('clamps into [MIN, MAX]', () => {
    const hairpin: SurveyStation[] = [{ md: 0, dev: 0, az: 0 }, { md: 1, dev: 90, az: 0 }];
    expect(axialSpanForSurvey(hairpin, 0.001)).toBe(MIN_AXIAL_SPAN);
    const barelyBent: SurveyStation[] = [{ md: 0, dev: 0, az: 0 }, { md: 5000, dev: 1, az: 0 }];
    expect(axialSpanForSurvey(barelyBent, 500)).toBe(MAX_AXIAL_SPAN);
  });
});

describe('the real deviated reference well', () => {
  const wson = parseWson(
    readFileSync('src/lib/wells/samples/13-vertical-land-producer-deviated.wson', 'utf8'),
  ).wson;

  it('its J-profile is a ~403 m radius build', () => {
    const R = minRadiusOfCurvature(wson.profile as SurveyStation[]);
    expect(R).toBeGreaterThan(300);
    expect(R).toBeLessThan(500);
  });

  it('yields a span FAR coarser than the 1.5 constant, within the sag bound', () => {
    const maxRadius = 26 / 2; // the 26" surface hole, the well's widest element
    const h = axialSpanForSurvey(wson.profile as SurveyStation[], maxRadius)!;
    expect(h).toBeGreaterThan(1.5);              // the whole point
    expect(sagForSpan(wson.profile as SurveyStation[], h)).toBeLessThanOrEqual(maxRadius * 0.004 * 1.001);
  });
});
