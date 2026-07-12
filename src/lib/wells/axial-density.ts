/**
 * Axial ring spacing for a warped well bake — derived from the SURVEY, not from
 * an absolute constant.
 *
 * A `warpSpline` bake bends positions on an already-built mesh, so the axial
 * rings must exist BEFORE the warp (Rule 25). `bake-worker-core`'s default is
 * `WARP_AXIAL_MAX_ZSPAN = 1.5` world units, which is sized for a ~40-unit CAD
 * part. A well is three orders of magnitude longer: on the deviated reference
 * well that constant forces ~713 rings on the 1070 m production casing —
 * 468k triangles, ~8 s — to buy a chordal sag of 7e-4 units against a 4.8-unit
 * casing radius.
 *
 * The honest bound is geometric. A chord of length `h` across a circular arc of
 * radius `R` departs from the arc by a sagitta
 *
 *     sag = R − √(R² − h²/4)  ≈  h² / (8R)      (h ≪ R)
 *
 * so for a tolerable sag `tol`, the ring spacing is `h = √(8·R·tol)`. Straight
 * hole is `R = ∞` ⇒ no densification is needed at all.
 *
 * Pure — no Manifold, no DOM. Tested headless.
 */
import { minCurvatureStep, sphPoint, type SurveyStation } from '$lib/graph/survey-to-xyz';

/** Sagitta tolerance as a fraction of the well's largest radius. 0.4% matches
 *  the `refineToTolerance` convention already used for round-silhouette
 *  smoothing (`maxOD * 0.004`), and is far below one screen pixel at any sane
 *  camera distance. */
export const DEFAULT_SAG_FRACTION = 0.004;

/** Ring spacing is clamped into this range: below `MIN` we are refining past the
 *  point of visible return, above `MAX` a long gentle bend would get too few
 *  rings to read as a curve at all regardless of the sag bound. */
export const MIN_AXIAL_SPAN = 0.5;
export const MAX_AXIAL_SPAN = 25;

/** Below this turned angle (radians) a segment is straight for our purposes: a
 *  1e-6 rad dogleg over even a 1 km segment bends the hole by under a millimetre.
 *  Decided on the ANGLE, never on `minCurvatureStep`'s radius — that returns a
 *  `999999` SENTINEL (not `Infinity`) at exactly-zero dogleg, which would sail
 *  through a `Number.isFinite` check and silently make a vertical well "curved". */
const STRAIGHT_ANGLE_EPS = 1e-6;

/** Smallest radius of curvature over the survey, in survey units (metres).
 *  `Infinity` when every station is collinear (a straight or vertical hole). */
export function minRadiusOfCurvature(stations: SurveyStation[]): number {
  if (!stations || stations.length < 2) return Infinity;
  let rMin = Infinity;
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i]!, b = stations[i + 1]!;
    const dMD = b.md - a.md;
    if (!(dMD > 0)) continue; // non-increasing MD contributes no curvature
    const { angPsi } = minCurvatureStep(a.md, sphPoint(a.dev, a.az), b.md, sphPoint(b.dev, b.az));
    if (!Number.isFinite(angPsi) || angPsi <= STRAIGHT_ANGLE_EPS) continue; // straight run
    const r = dMD / angPsi; // arc / turned angle — do NOT read radCurvature (sentinel)
    if (r > 0 && r < rMin) rMin = r;
  }
  return rMin;
}

/**
 * Ring spacing for this survey, or `null` when the hole is straight (⇒ tell the
 * bake to skip axial densification entirely).
 *
 * @param stations survey stations `{md, dev, az}` (dev/az in DEGREES)
 * @param maxRadius the well's largest RADIAL half-size, in the same units the
 *        geometry uses. Sets the absolute sag budget via `sagFraction`.
 * @param sagFraction tolerable sag as a fraction of `maxRadius`
 */
export function axialSpanForSurvey(
  stations: SurveyStation[],
  maxRadius: number,
  sagFraction: number = DEFAULT_SAG_FRACTION,
): number | null {
  const R = minRadiusOfCurvature(stations);
  if (!Number.isFinite(R)) return null;              // straight hole — no rings needed
  const tol = Math.abs(maxRadius) * Math.abs(sagFraction);
  if (!(tol > 0)) return MIN_AXIAL_SPAN;
  const h = Math.sqrt(8 * R * tol);
  return Math.min(MAX_AXIAL_SPAN, Math.max(MIN_AXIAL_SPAN, h));
}

/** The sag a given ring spacing actually incurs on the tightest bend — the
 *  inverse of the formula above, for asserting the bound rather than trusting it. */
export function sagForSpan(stations: SurveyStation[], span: number): number {
  const R = minRadiusOfCurvature(stations);
  if (!Number.isFinite(R)) return 0;
  const half = span / 2;
  if (half >= R) return R;                            // degenerate: chord ≥ diameter
  return R - Math.sqrt(R * R - half * half);
}
