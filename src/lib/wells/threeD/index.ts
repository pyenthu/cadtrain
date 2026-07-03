/**
 * Entry point for WSON 3D machinery (PORTED from SVTC
 * `src/lib/apps/wson/threeD/index.ts`). Handles the WSON profile → WellDirection
 * conversion plus a straight-vertical fallback for non-deviated wells.
 */

import { WellProfile, type RawSurveyStation } from './profile';
import { WellDirection } from './direction';
import * as THREE from 'three';

export { WellProfile, WellDirection };
export type { InterNode } from './direction';
export type { Segment, RawSurveyStation } from './profile';

/**
 * Accept a WSON's profile[] array (possibly empty or missing) and a TD, return
 * a ready-to-query WellDirection. For non-deviated wells (no survey) we
 * synthesise a straight vertical survey so downstream renderers can call
 * getInterNode/warpGeometry uniformly.
 */
export function buildWellDirection(
  profile: Array<{ md?: number; MD?: number; inc?: number; dev?: number; INC?: number; DEV?: number; az?: number; azi?: number; AZ?: number; AZI?: number }> | undefined | null,
  td: number,
): WellDirection {
  let survey: RawSurveyStation[];

  if (Array.isArray(profile) && profile.length >= 2) {
    survey = profile
      .map(p => ({
        md: Number(p.md ?? p.MD ?? 0),
        dev: Number(p.dev ?? p.inc ?? p.DEV ?? p.INC ?? 0),
        az: Number(p.az ?? p.azi ?? p.AZ ?? p.AZI ?? 0),
      }))
      .filter(s => Number.isFinite(s.md))
      .sort((a, b) => a.md - b.md);
  } else {
    survey = [
      { md: 0, dev: 0, az: 0 },
      { md: td > 0 ? td : 1000, dev: 0, az: 0 },
    ];
  }

  const profileBuilder = new WellProfile(survey);
  return new WellDirection(profileBuilder.segments as any, td || survey.at(-1)!.md);
}

/**
 * Sample the wellbore centreline at regular MD intervals. Output is a
 * THREE.Vector3 array suitable for CatmullRomCurve3.
 *
 * Convention: industry axis mapping — X/Y are surface (easting/northing)
 * coordinates and Z is depth (positive down). The scene sets camera.up =
 * [0,0,-1] so screen-up = shallow end. No y↔z swap — pt[] already matches
 * (cadtrain is Z-down too).
 */
export function sampleCentreline(dir: WellDirection, fromMd: number, toMd: number, stepMd = 10): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const lo = Math.max(fromMd, 0);
  const hi = Math.min(toMd, dir.maxDepth);
  for (let md = lo; md < hi; md += stepMd) {
    const n = dir.getInterNode(md);
    if (n) pts.push(new THREE.Vector3(n.pt[0], n.pt[1], n.pt[2]));
  }
  const last = dir.getInterNode(hi);
  if (last) pts.push(new THREE.Vector3(last.pt[0], last.pt[1], last.pt[2]));
  return pts;
}
