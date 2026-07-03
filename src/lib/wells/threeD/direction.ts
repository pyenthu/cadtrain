/**
 * WellDirection — interpolates position, tangent, normal at any MD along a
 * directional well, using quaternion slerp on the segment control pts.
 *
 * PORTED from SVTC `src/lib/apps/wson/threeD/direction.ts` (pyenthu/wellnew).
 *
 * SAMPLING is the durable use here: `getInterNode(md)` gives the wellbore
 * position + tangent + normal for centreline sampling and for the
 * parallel-transport warp in `manifoldCut.ts`.
 *
 * ⚠ `dirWarp3D` is retained for reference/parity but is NOT used for 3D
 * geometry — SVTC abandoned it because it twists planar (constant-azimuth)
 * wells (local Y is treated as along-tangent depth, so a vertex at local (0,R)
 * shrinks by cos(inc) instead of staying perpendicular). Use
 * `warpGeometry(geo, wellDir)` (parallel-transport frame) in `manifoldCut.ts`
 * for warping. `dirWarp` (2D) is kept for a possible top-down projection view.
 */

import { Quaternion as glQuat, Vector3 as glVec3 } from '@math.gl/core';
import { multiply, rotate, acos, add, cross, atan } from 'mathjs';
import type { Segment } from './profile';

function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (n === 0) return v.slice();
  return v.map(x => x / n);
}

const qPt = new glQuat();
const qTangent = new glQuat();
const vProj = new glVec3();
const qPtFlat = new glQuat();
const qZ = new glQuat(0, 0, 1, 0);

interface HydratedSegment extends Segment {
  glQ1: glQuat;
  glQ2: glQuat;
  qPivot: glQuat;
  qRotAxis: glQuat;
  dirMult: number;
}

export interface InterNode {
  md: number;
  pt: number[];       // [x, y, z] in profile space (z = depth down)
  norm: number[];     // unit normal
  tangent: number[];  // unit tangent
  segment: HydratedSegment;
}

export class WellDirection {
  segments: HydratedSegment[];
  glQT = new glQuat();
  maxDepth: number;
  // Fallback azimuth used when the local tangent is vertical (its horizontal
  // projection has length zero). Without this, `acos(zeroVec.dot(xHat)) = π/2`
  // silently defaults the vertical section to a 90° cross-section rotation,
  // which produces a visible twist at the KOP where the deviated section's
  // real azimuth kicks in. Populated from the first segment that has a
  // non-vertical mid-segment tangent; defaults to +X for all-vertical wells.
  _refAzimuth: [number, number] = [1, 0];

  constructor(segments: Segment[], maxDepth: number) {
    this.maxDepth = maxDepth;
    this.segments = segments.map(s => {
      const hs = s as HydratedSegment;
      hs.glQ1 = new glQuat(s.q1[0], s.q1[1], s.q1[2], 0);
      hs.glQ2 = new glQuat(s.q2[0], s.q2[1], s.q2[2], 0);
      hs.qPivot = new glQuat(s.ptPivot[0], s.ptPivot[1], s.ptPivot[2], 0);
      hs.qRotAxis = new glQuat(s.rotAxis[0], s.rotAxis[1], s.rotAxis[2], 0);
      hs.glQ1.normalize();
      hs.glQ2.normalize();
      hs.dirMult = s.rotAxis[1] > 0 ? 1 : -1;
      return hs;
    });
    this._refAzimuth = this._findReferenceAzimuth();
    this.dirWarp3D = this.dirWarp3D.bind(this);
    this.dirWarp = this.dirWarp.bind(this);
  }

  // Walk segments and pick the first whose mid-segment tangent has a
  // non-degenerate horizontal projection — that direction serves as the
  // consistent azimuth for any vertical sections of the well.
  private _findReferenceAzimuth(): [number, number] {
    const qT = new glQuat();
    for (const seg of this.segments) {
      qT.slerp(seg.glQ1, seg.glQ2, 0.5).scale(-1).multiply(seg.qRotAxis).normalize();
      const hx = qT[0], hy = qT[1];
      const hlen = Math.sqrt(hx * hx + hy * hy);
      if (hlen > 1e-4) return [hx / hlen, hy / hlen];
    }
    return [1, 0];
  }

  /** Warp a straight-extrusion vertex to follow the wellbore path.
   *  Mutates the input vector in place.
   *  ⚠ Retained for parity only — NOT used for 3D geometry (twists planar
   *  wells). Use `warpGeometry` in manifoldCut.ts. */
  dirWarp3D(v: number[] | Float32Array): void {
    try {
      const segment = this.getSegment(v[1]);
      if (!segment) return;
      const t = (v[1] - segment.md1) / (segment.md2 - segment.md1);
      qTangent
        .slerp(segment.glQ1, segment.glQ2, t)
        .scale(-1)
        .multiply(segment.qRotAxis)
        .normalize();

      // Horizontal projection of the tangent = azimuth direction. When the
      // tangent is vertical (qTangent has ~zero horizontal component), the
      // projection collapses to the zero vector and `.normalize()` silently
      // returns zero — dotting with xHat yields 0, so `acos` defaults to
      // π/2, which ROTATES THE CROSS-SECTION BY 90° on vertical sections.
      // At the KOP this jumps discontinuously to the deviated section's
      // real azimuth, producing a visible twist. Fall back to the precomputed
      // reference azimuth so qTheta stays continuous across the boundary.
      vProj.set(qTangent[0], qTangent[1], 0);
      const hLen = Math.sqrt(vProj[0] * vProj[0] + vProj[1] * vProj[1]);
      if (hLen < 1e-6) vProj.set(this._refAzimuth[0], this._refAzimuth[1], 0);
      else vProj.normalize();
      const qTheta = (acos as any)(vProj.dot(new glVec3(1, 0, 0)));
      const qDev = (acos as any)(qTangent.dot(qZ));
      qPtFlat.set(v[0], v[2], 0, 0).rotateZ(qTheta);

      qPt.slerp(segment.glQ1, segment.glQ2, t)
        .scale(segment.radCurvature)
        .add(segment.qPivot);

      // Same class of bug as the _refAzimuth fallback above — exact `=== 0`
      // on a float silently builds a near-degenerate axis when qTangent[1]
      // lands at 1e-15 instead of true zero. Result: rotate() returns NaN
      // and the geometry vanishes for that azimuth band. Use a tolerance.
      const dirRt =
        Math.abs(qTangent[1]) < 1e-9
          ? [1, 0, 0]
          : normalize([qTangent[1], 0, -qTangent[0]]);

      const rad = (rotate as any)([qPtFlat[0], 0, qPtFlat[1]], qDev, dirRt) as number[];

      v[0] = rad[0] + qPt.x;
      v[1] = rad[1] + qPt.z;
      v[2] = rad[2] + qPt.y;
    } catch (err) {
      console.warn('[WellDirection.dirWarp3D]', err);
    }
  }

  /** 2D variant — for top-down projection. Returns [x, z] in profile space. */
  dirWarp([x, y]: [number, number]): [number, number] {
    try {
      const segment = this.getSegment(y);
      if (!segment) return [x, y];
      const t = (y - segment.md1) / (segment.md2 - segment.md1);
      const q2DPtFlat = new glQuat();
      q2DPtFlat
        .slerp(segment.glQ1, segment.glQ2, t)
        .scale(segment.radCurvature - segment.dirMult * x)
        .add(segment.qPivot);
      return [q2DPtFlat[0], q2DPtFlat[2]];
    } catch (err) {
      console.warn('[WellDirection.dirWarp]', err);
      return [x, y];
    }
  }

  /** Find the segment covering a given MD. Returns null if outside all segments. */
  getSegment(md: number): HydratedSegment | null {
    for (const segment of this.segments) {
      if (md >= segment.md1 && md < segment.md2) return segment;
    }
    return null;
  }

  /** Sample the wellbore at a specific MD — returns position + tangent + normal. */
  getInterNode(md: number): InterNode | null {
    const segment = this.getSegment(md);
    if (!segment) return null;

    const t = (md - segment.md1) / (segment.md2 - segment.md1);
    this.glQT.slerp(segment.glQ1, segment.glQ2, t);

    const pt = (add as any)(
      (multiply as any)([this.glQT[0], this.glQT[1], this.glQT[2]], segment.radCurvature),
      segment.ptPivot,
    ) as number[];

    const norm = normalize([-this.glQT[0], -this.glQT[1], -this.glQT[2]]);
    const tangent = normalize((cross as any)(norm, segment.rotAxis) as number[]);

    return { md, pt, norm, tangent, segment };
  }

  get lastPtNode(): { dirParaSweep: number[]; pt: number[]; tangent: number[] } | null {
    const nodeLast = this.getInterNode(this.maxDepth);
    if (!nodeLast) return null;
    const pt = [nodeLast.pt[0], nodeLast.pt[2], nodeLast.pt[1]];
    const tangent = [nodeLast.tangent[0], nodeLast.tangent[2], nodeLast.tangent[1]];
    const dirParaSweep =
      0 === tangent[2] ? [0, 0, -1] : normalize([1, 0, -tangent[0] / tangent[2]]);
    return { dirParaSweep, pt, tangent };
  }

  get endPoint(): number[] {
    return this.segments.at(-1)!.p2;
  }

  get viewPlaneAngle(): number {
    return (atan as any)(this.endPoint[0] / this.endPoint[1]);
  }
}
