/**
 * survey-to-xyz — THE one minimum-curvature survey → trajectory converter.
 *
 * A well's path is specified as `(md, dev, az)` stations (measured depth,
 * inclination = deviation from vertical in degrees, azimuth in degrees). Turning
 * that into an `[x, y, z]` polyline is the *minimum-curvature* method — the
 * industry standard, dogleg-severity aware (a ratio factor derived from the
 * dogleg angle bends each segment as a circular arc, not two straight legs).
 *
 * BEFORE this module there were TWO implementations of that walk in the tree:
 *   • `src/lib/wells/threeD/profile.ts` `WellProfile` — the SVTC-ported
 *     min-curvature segment builder used by the wells 3D path (via
 *     `WellDirection`'s quaternion slerp);
 *   • `src/lib/wells/assemble.ts` `buildTrajectory` — an *average-angle* walk
 *     (a DIFFERENT method) used by the simple assembler + `wson-to-graph`.
 * The graph CAD spline node knew about neither. This module is the single home
 * of the min-curvature math: `WellProfile` now sources its segment positions
 * from `minCurvatureStep` here (so the wells 3D path and this share ONE
 * formula), and the graph spline node's `mode:'survey'` calls `surveyToXYZ`
 * (injected into the bake sandbox by name, exactly like `resampleSpline`).
 *
 * Convention (matches `WellProfile.sphPoint`, so the wells frame is unchanged):
 * Z-DOWN — `dev=0` → the unit direction `[0,0,1]` (straight down the +z axis).
 * `x = sin(inc)·cos(az)`, `y = sin(inc)·sin(az)`, `z = cos(inc)`. The trajectory
 * starts at `[0, 0, md₀]` (the first station's depth on the z axis).
 *
 * Pure JS (no mathjs / three.js) so it is safe to inject into the Manifold bake
 * sandbox, mirroring `spline-resample.ts`.
 */

export interface SurveyStation {
  /** Measured depth (metres, monotonic non-decreasing after cleaning). */
  md: number;
  /** Inclination / deviation from vertical, DEGREES (0 = straight down). */
  dev: number;
  /** Azimuth, DEGREES. */
  az: number;
}

export type XYZ = [number, number, number];

const DEG = Math.PI / 180;

// ── vector helpers (plain, sandbox-safe) ──────────────────────────────────────
const dot = (a: XYZ, b: XYZ): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: XYZ, b: XYZ): XYZ => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * Unit direction vector of a station. Z-DOWN: `dev=0` → `[0,0,1]`.
 * `x = sin(inc)·cos(az)`, `y = sin(inc)·sin(az)`, `z = cos(inc)`. Identical to
 * `WellProfile.sphPoint`, kept in ONE place so the two callers share the frame.
 */
export function sphPoint(dev: number, az: number): XYZ {
  const phi = DEG * dev;
  const theta = DEG * az;
  const sp = Math.sin(phi);
  return [sp * Math.cos(theta), sp * Math.sin(theta), Math.cos(phi)];
}

/** The min-curvature step between two stations, expressed via their UNIT
 *  directions. Faithful to `WellProfile.controlSegment` (same tangent-length
 *  form), so `WellProfile` can consume it verbatim while `surveyToXYZ` chains
 *  only `.delta`. `rotAxis` is the UN-normalised `cross(dir1, dir2)` the
 *  quaternion path expects.
 *
 *  Textbook equivalence: `delta = (ΔMD/2)·RF·(dir1+dir2)` with the ratio factor
 *  `RF = (2/β)·tan(β/2)` (β = dogleg angle) — here written as
 *  `delTang·(dir1+dir2)` with `delTang = (ΔMD/β)·tan(β/2)`, which is the same
 *  value. `β = 0` (collinear) degrades to a straight segment (`delTang = ΔMD/2`).
 */
export function minCurvatureStep(
  md1: number,
  dir1: XYZ,
  md2: number,
  dir2: XYZ,
): {
  angPsi: number;
  rotAxis: XYZ;
  radCurvature: number;
  delTang: number;
  relP1Mid: XYZ;
  relMidP2: XYZ;
  delta: XYZ;
} {
  const dMD = md2 - md1;
  // Clamp the dot into [-1,1] so identical / near-identical directions never
  // feed acos a value >1 (→ NaN). WellProfile's cleanSurvey keeps dirs distinct,
  // so this clamp is a no-op there; it makes surveyToXYZ robust on raw surveys.
  let cdot = dot(dir1, dir2);
  if (cdot > 1) cdot = 1; else if (cdot < -1) cdot = -1;
  const angPsi = Math.acos(cdot);
  const rotAxis = cross(dir1, dir2);
  const radCurvature = angPsi === 0 ? 999999 : dMD / angPsi;
  const delTang = angPsi === 0 ? dMD / 2 : radCurvature * Math.tan(angPsi / 2);
  const relP1Mid: XYZ = [delTang * dir1[0], delTang * dir1[1], delTang * dir1[2]];
  const relMidP2: XYZ = [delTang * dir2[0], delTang * dir2[1], delTang * dir2[2]];
  const delta: XYZ = [relP1Mid[0] + relMidP2[0], relP1Mid[1] + relMidP2[1], relP1Mid[2] + relMidP2[2]];
  return { angPsi, rotAxis, radCurvature, delTang, relP1Mid, relMidP2, delta };
}

/** Clean + sort raw stations: keep finite-MD rows, sort ascending by MD. Does
 *  NOT nudge (that is a WellProfile quaternion concern, not a position one) —
 *  a vertical survey (`dev=0`) therefore stays EXACTLY on the z axis. */
function cleanStations(stations: SurveyStation[]): SurveyStation[] {
  return (stations ?? [])
    .filter((s) => s && Number.isFinite(s.md) && Number.isFinite(s.dev) && Number.isFinite(s.az))
    .slice()
    .sort((a, b) => a.md - b.md);
}

/**
 * Convert a `(md, dev, az)` survey table into an `[x,y,z]` polyline by minimum
 * curvature — ONE point per input station, starting at `[0, 0, md₀]`. This is
 * the shared function the graph spline node (`mode:'survey'`) and the wells
 * min-curvature path both use.
 *
 * A vertical survey (`dev=0` everywhere) returns points straight down the z axis
 * (`[0,0,mdᵢ]`); a monotonic MD in yields a monotonic arc length out. Returns
 * `[]` for < 1 usable station.
 */
export function surveyToXYZ(stations: SurveyStation[]): XYZ[] {
  const clean = cleanStations(stations);
  if (clean.length === 0) return [];
  const out: XYZ[] = [[0, 0, clean[0].md]];
  let dirPrev = sphPoint(clean[0].dev, clean[0].az);
  for (let i = 1; i < clean.length; i++) {
    const dirCur = sphPoint(clean[i].dev, clean[i].az);
    const { delta } = minCurvatureStep(clean[i - 1].md, dirPrev, clean[i].md, dirCur);
    const p = out[i - 1];
    out.push([p[0] + delta[0], p[1] + delta[1], p[2] + delta[2]]);
    dirPrev = dirCur;
  }
  return out;
}

/**
 * A min-curvature `at(md)` sampler: the trajectory position at ANY MD, linearly
 * interpolating between the min-curvature station points and extending straight
 * along the last tangent past TD. Mirrors `assemble.ts`'s `buildTrajectory`
 * interface so a caller can swap the average-angle walk for min curvature
 * without restructuring. Used by wells consumers that need arbitrary-MD samples
 * (not just the station points).
 */
export function buildMinCurvatureSampler(stations: SurveyStation[]): (md: number) => XYZ {
  const clean = cleanStations(stations);
  if (clean.length < 2) {
    return (md) => [0, 0, md];
  }
  const pts = surveyToXYZ(clean);
  const mds = clean.map((s) => s.md);
  return (md) => {
    if (md <= mds[0]) return [0, 0, md];
    for (let i = 1; i < mds.length; i++) {
      if (md <= mds[i]) {
        const a = pts[i - 1], b = pts[i];
        const t = (md - mds[i - 1]) / (mds[i] - mds[i - 1] || 1);
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      }
    }
    // Below TD: extend straight along the final tangent direction.
    const last = pts[pts.length - 1], prev = pts[pts.length - 2];
    const dir: XYZ = [last[0] - prev[0], last[1] - prev[1], last[2] - prev[2]];
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const ext = md - mds[mds.length - 1];
    return [last[0] + (dir[0] / len) * ext, last[1] + (dir[1] / len) * ext, last[2] + (dir[2] / len) * ext];
  };
}
