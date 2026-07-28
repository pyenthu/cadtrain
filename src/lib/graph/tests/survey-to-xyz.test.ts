/**
 * survey-to-xyz.test — N3b. The ONE minimum-curvature survey→trajectory
 * converter, shared by the wells 3D path (WellProfile) and the graph spline
 * node's `mode:'survey'`. Headless (bun run test).
 *
 * Covers: a vertical survey → a straight z-axis path; a textbook build-up
 * section reproduces its known TVD/northing; monotonic MD → monotonic arc
 * length; and `surveyToXYZ` of the real 11-station J-medium survey round-trips
 * to the same trajectory the wells 3D path (WellProfile) draws today. Plus the
 * spline node emits `surveyToXYZ(...)` for survey mode and NOT for xyz mode.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { surveyToXYZ, buildMinCurvatureSampler, minCurvatureStep, sphPoint, type SurveyStation, type XYZ } from '$lib/graph/survey/survey-to-xyz';
import { WellProfile } from '$lib/wells/threeD/profile';
import { emitSplineBlocks } from '$lib/graph/composition/composition-emit';
import type { Graph, SplineNode } from '$lib/graph/composition/composition-graph-types';

const len = (a: XYZ) => Math.hypot(a[0], a[1], a[2]);
const dist = (a: XYZ, b: XYZ) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('surveyToXYZ — vertical survey stays on the z axis', () => {
  it('dev=0 everywhere → straight down z, x=y=0, z=md', () => {
    const stations: SurveyStation[] = [
      { md: 0, dev: 0, az: 0 },
      { md: 500, dev: 0, az: 137 }, // azimuth is irrelevant while vertical
      { md: 1200, dev: 0, az: 42 },
    ];
    const pts = surveyToXYZ(stations);
    expect(pts).toHaveLength(3);
    for (let i = 0; i < pts.length; i++) {
      expect(pts[i][0]).toBeCloseTo(0, 9);
      expect(pts[i][1]).toBeCloseTo(0, 9);
      expect(pts[i][2]).toBeCloseTo(stations[i].md, 9);
    }
  });

  it('a single station returns one point at [0,0,md]', () => {
    expect(surveyToXYZ([{ md: 30, dev: 12, az: 90 }])).toEqual([[0, 0, 30]]);
  });

  it('drops non-finite rows and sorts by MD', () => {
    const pts = surveyToXYZ([
      { md: 100, dev: 0, az: 0 },
      { md: Number.NaN, dev: 5, az: 0 },
      { md: 0, dev: 0, az: 0 },
    ]);
    expect(pts).toHaveLength(2);
    expect(pts[0][2]).toBe(0);
    expect(pts[1][2]).toBeCloseTo(100, 9);
  });
});

describe('surveyToXYZ — textbook build-up section (known TVD / lateral)', () => {
  // A single segment building from vertical (0°) to 30° over 100 m of MD, az=0.
  // Minimum curvature: R = ΔMD/θ, ΔTVD = R·sinθ, lateral = R·(1−cosθ).
  it('reproduces the closed-form circular-arc build', () => {
    const theta = 30 * (Math.PI / 180);
    const dMD = 100;
    const R = dMD / theta;
    const expTVD = R * Math.sin(theta);          // 95.4915…
    const expLat = R * (1 - Math.cos(theta));     // 25.5875…  (az=0 ⇒ x carries cos(az))

    const pts = surveyToXYZ([
      { md: 0, dev: 0, az: 0 },
      { md: dMD, dev: 30, az: 0 },
    ]);
    expect(pts[0]).toEqual([0, 0, 0]);
    expect(pts[1][0]).toBeCloseTo(expLat, 6);   // lateral (x, az=0)
    expect(pts[1][1]).toBeCloseTo(0, 9);        // no easting at az=0
    expect(pts[1][2]).toBeCloseTo(expTVD, 6);   // TVD
  });

  it('the dogleg (angPsi) equals the inclination change for az=0', () => {
    const step = minCurvatureStep(0, sphPoint(10, 0), 100, sphPoint(40, 0));
    expect(step.angPsi).toBeCloseTo(30 * (Math.PI / 180), 9);
  });

  it('azimuth rotates the lateral into the x/y plane, TVD unchanged', () => {
    const straight = surveyToXYZ([{ md: 0, dev: 0, az: 0 }, { md: 100, dev: 30, az: 0 }]);
    const turned = surveyToXYZ([{ md: 0, dev: 0, az: 90 }, { md: 100, dev: 30, az: 90 }]);
    // az=90 sends the lateral onto +y; TVD (z) is identical to the az=0 case.
    expect(turned[1][2]).toBeCloseTo(straight[1][2], 9);
    expect(turned[1][1]).toBeCloseTo(straight[1][0], 6); // x-lateral → y-lateral
    expect(turned[1][0]).toBeCloseTo(0, 6);
  });
});

describe('surveyToXYZ — monotonic MD → monotonic arc length', () => {
  it('cumulative arc length strictly increases down a J-shape survey', () => {
    const stations: SurveyStation[] = [
      { md: 0, dev: 0, az: 20 },
      { md: 400, dev: 0, az: 20 },
      { md: 700, dev: 20, az: 20 },
      { md: 1000, dev: 45, az: 20 },
      { md: 1600, dev: 45, az: 20 },
    ];
    const pts = surveyToXYZ(stations);
    let cum = 0, prev = 0;
    for (let i = 1; i < pts.length; i++) {
      cum += dist(pts[i - 1], pts[i]);
      expect(cum).toBeGreaterThan(prev);
      prev = cum;
    }
    // Chord length between stations never exceeds the MD span (min curvature is a
    // circular arc; the straight-line chord is ≤ the arc = ΔMD).
    for (let i = 1; i < pts.length; i++) {
      const chord = dist(pts[i - 1], pts[i]);
      expect(chord).toBeLessThanOrEqual(stations[i].md - stations[i - 1].md + 1e-6);
    }
  });
});

describe('surveyToXYZ — round-trips to the wells 3D path (WellProfile)', () => {
  const jMedium = (): SurveyStation[] => {
    const raw = readFileSync(
      `${process.env.HOME}/code/SVTC/.dev-volume/samples/schematics/deviated/01-vertical-land-producer-J-medium.wson`,
      'utf8',
    );
    return (JSON.parse(raw).profile as SurveyStation[]);
  };

  it('agrees with WellProfile station positions across all 11 stations', () => {
    const stations = jMedium();
    expect(stations).toHaveLength(11);
    const mine = surveyToXYZ(stations);

    // WellProfile is the min-curvature builder the 3D scene draws through. Its
    // per-station positions: segment[0].p1, then each segment[i].p2.
    const segs = new WellProfile(stations).segments;
    const wp: XYZ[] = [segs[0].p1 as XYZ, ...segs.slice(0, stations.length - 1).map((s) => s.p2 as XYZ)];
    expect(wp).toHaveLength(11);

    // They match to within a few cm — the ONLY difference is WellProfile's
    // quaternion-stability inc-nudge (dev += 0.02° on the vertical top section),
    // a deliberate sub-cm perturbation, not a different trajectory.
    let maxDiff = 0;
    for (let i = 0; i < 11; i++) maxDiff = Math.max(maxDiff, dist(mine[i], wp[i]));
    expect(maxDiff).toBeLessThan(0.2); // metres, on a 1070 m / ~380 m-lateral well

    // And the endpoints agree on the load-bearing numbers: TVD + lateral at TD.
    const myTD = mine[10], wpTD = wp[10];
    expect(myTD[2]).toBeCloseTo(wpTD[2], 0);                                  // TVD (within 0.5 m)
    expect(Math.hypot(myTD[0], myTD[1])).toBeCloseTo(Math.hypot(wpTD[0], wpTD[1]), 0); // lateral (within 0.5 m)
    // The J well is genuinely deviated — lateral departure is large.
    expect(Math.hypot(myTD[0], myTD[1])).toBeGreaterThan(100);
  });

  it('buildMinCurvatureSampler(md) matches surveyToXYZ at the stations', () => {
    const stations = jMedium();
    const at = buildMinCurvatureSampler(stations);
    const pts = surveyToXYZ(stations);
    for (let i = 0; i < stations.length; i++) {
      expect(dist(at(stations[i].md), pts[i])).toBeLessThan(1e-6);
    }
    // vertical fallback for <2 stations
    expect(buildMinCurvatureSampler([{ md: 0, dev: 0, az: 0 }])(500)).toEqual([0, 0, 500]);
  });
});

describe('spline node — explicit survey vs xyz mode emit', () => {
  const splineGraph = (spline: SplineNode): Graph => ({
    nodes: { [spline.id]: spline },
    root: 'n_root',
    params: {},
    edges: [],
    imports: [],
    layout: {},
  });

  it("mode:'survey' wraps the points in surveyToXYZ(...)", () => {
    const g = splineGraph({
      id: 'n_sp',
      type: 'spline',
      mode: 'survey',
      points: [[0, 0, 0], [1000, 0, 0], [1600, 45, 30]], // [md,dev,az]
      samples: { kind: 'literal', value: 48 },
      closed: false,
    });
    const [line] = emitSplineBlocks(g);
    expect(line).toContain('surveyToXYZ([[0, 0, 0], [1000, 0, 0], [1600, 45, 30]])');
    expect(line).toContain('resampleSpline(surveyToXYZ(');
    expect(line).toContain(', 48, false)');
  });

  it("mode:'xyz' (and absent) emits the literal points, NO surveyToXYZ", () => {
    const g = splineGraph({
      id: 'n_sp',
      type: 'spline',
      points: [[0, 0, 0], [1, 1, 1], [0, 0, 3]],
      samples: { kind: 'literal', value: 32 },
      closed: false,
    });
    const [line] = emitSplineBlocks(g);
    expect(line).not.toContain('surveyToXYZ');
    expect(line).toContain('resampleSpline([[0, 0, 0], [1, 1, 1], [0, 0, 3]], 32, false)');
  });
});
