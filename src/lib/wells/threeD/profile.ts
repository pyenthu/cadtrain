/**
 * WellProfile — builds quaternion-slerp-ready segments from raw survey stations.
 *
 * PORTED (function + field names preserved) from SVTC
 * `src/lib/apps/wson/threeD/profile.ts`, itself from pyenthu/wellnew. The
 * minimum-curvature segment math with the nuances wellnew handles: inc-equality
 * nudge, a virtual 2000-unit tail past the last station for downstream queries
 * that go beyond TD, and the q1/q2/ptPivot/rotAxis quadruple that WellDirection
 * needs for slerp + warping.
 *
 * Input survey station shape: { md, dev, az } — dev = inclination (degrees),
 * az = azimuth (degrees). Local convention matches the source file (not
 * "inc"/"azi" as some other parts of the codebase use).
 *
 * cadtrain adaptation: none to the math. Z-down is already shared with SVTC —
 * pt[] is [x, y, z] with z = depth positive-down.
 */

import { dot, cross, acos, tan, add, multiply, sqrt, subtract } from 'mathjs';

function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (n === 0) return v.slice();
  return v.map(x => x / n);
}

function dirsEqual(a: number[], b: number[]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 &&
         Math.abs(a[1] - b[1]) < 1e-9 &&
         Math.abs(a[2] - b[2]) < 1e-9;
}

export interface RawSurveyStation {
  md: number;
  dev: number;
  az: number;
}

interface CleanedStation {
  md: number;
  dir: number[];
}

export interface Segment {
  md1: number;
  md2: number;
  radCurvature: number;
  p1: number[];
  p2: number[];
  q1: number[];
  q2: number[];
  ptPivot: number[];
  rotAxis: number[];
  ampQ1: number;
  ampQ2: number;
}

export class WellProfile {
  survey: CleanedStation[];

  constructor(survey: RawSurveyStation[]) {
    this.survey = this.cleanSurvey(survey);
  }

  private cleanSurvey(survey: RawSurveyStation[]): CleanedStation[] {
    // Nudge each subsequent station so its DIRECTION VECTOR (post-sphPoint)
    // is never identical to the previous CLEANED station's direction.
    //
    // Comparing raw (dev, az) was insufficient: at dev=0, sphPoint collapses
    // to [0, 0, 1] for any az — so (dev=0, az=0) and (dev=0, az=10) produce
    // byte-identical directions, raw equality misses them, and the resulting
    // segment ends up with `cross(d1,d2) = [0,0,0]` → q1 = [0,0,0] → NaN
    // quaternion normalisation in WellDirection → entire well vanishes.
    //
    // Walk forward and compare the cleaned directions, accumulating ε in dev
    // until the direction differs.
    const clSurv: CleanedStation[] = [];
    let prevDev = survey[0].dev;
    let prevAz  = survey[0].az;
    let prevDir = this.sphPoint(prevDev, prevAz);
    clSurv.push({ md: survey[0].md, dir: prevDir });
    for (let i = 1; i < survey.length; i++) {
      let dev = survey[i].dev;
      let az  = survey[i].az;
      let dir = this.sphPoint(dev, az);
      let guard = 0;
      while (dirsEqual(dir, prevDir) && guard++ < 100) {
        dev += 0.02;
        dir = this.sphPoint(dev, az);
      }
      clSurv.push({ md: survey[i].md, dir });
      prevDev = dev;
      prevAz  = az;
      prevDir = dir;
    }
    const last = survey.at(-1)!;
    clSurv.push({ md: last.md + 2000, dir: this.sphPoint(prevDev + 0.5, prevAz) });
    return clSurv;
  }

  private sphPoint(dev: number, az: number): number[] {
    const d2r = Math.PI / 180;
    const phi = d2r * dev;
    const theta = d2r * az;
    return normalize([
      Math.sin(phi) * Math.cos(theta),
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi),
    ]);
  }

  private controlSegment(spt1: CleanedStation, spt2: CleanedStation, p1: number[]): Segment {
    const angPsi = (acos as any)((dot as any)(spt1.dir, spt2.dir));
    const rotAxis = (cross as any)(spt1.dir, spt2.dir) as number[];
    const radCurvature = 0 === angPsi ? 999999 : (spt2.md - spt1.md) / angPsi;
    const delTang = 0 === angPsi ? (spt2.md - spt1.md) / 2 : radCurvature * (tan as any)(angPsi / 2);
    const relP1Mid = (multiply as any)(delTang, spt1.dir) as number[];
    const relMidP2 = (multiply as any)(delTang, spt2.dir) as number[];
    const relP12 = (add as any)(relP1Mid, relMidP2) as number[];
    const p2 = (add as any)(p1, relP12) as number[];
    const q1 = (multiply as any)(normalize((cross as any)(relP1Mid, rotAxis) as number[]), radCurvature) as number[];
    const ptPivot = (subtract as any)(p1, q1) as number[];
    const q2 = (subtract as any)(p2, ptPivot) as number[];
    const ampQ1 = (sqrt as any)((dot as any)(q1, q1));
    const ampQ2 = (sqrt as any)((dot as any)(q2, q2));
    return { md1: spt1.md, md2: spt2.md, radCurvature, p2, p1, q1, q2, ptPivot, rotAxis, ampQ1, ampQ2 };
  }

  get segments(): Segment[] {
    const segs: Segment[] = [];
    const len = this.survey.length;
    for (let i = 0, p1 = [0, 0, this.survey[0].md]; i < len - 1; i++) {
      const segment = this.controlSegment(this.survey[i], this.survey[i + 1], [...p1]);
      segs.push(segment);
      p1 = segment.p2;
    }
    return segs;
  }
}
