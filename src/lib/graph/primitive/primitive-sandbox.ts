/**
 * primitive-sandbox — the single source of truth for what's in scope
 * inside a /primitives sandbox `new Function`.
 *
 * The primitive editor strips imports and evaluates source via
 * `new Function(...names, body)(...values)`, so a primitive's `source.ts`
 * can only reference names injected here. Previously these lists were
 * duplicated across primitives/preview (main + fallback paths) and
 * primitives/bake-preview, which drifts. Centralize them: `NAMES` and
 * `values()` stay index-aligned, and adding a helper is a one-line edit
 * that reaches every primitive endpoint at once.
 *
 * The geometry surface: bundle CSG helpers (cyl/tube/mv/rot/helix_band/
 * revolve/profile_extrude) + the welded raw-mesh toolkit (gridPatch/
 * capFan/weldAndBuild from manifold-mesh.ts) + `M` (Manifold module
 * proxy), `G` (globalThis, for `G.__cadtrain_manifold__.wasm`), `Math`.
 */
import * as helpers from '$lib/engines/manifold/manifold-helpers';
import { gridPatch, capFan, weldAndBuild, revolveProfile, sweepAlongPath, sweepAnnular, boredSweep, loftStations } from '$lib/engines/manifold/manifold-mesh';
import { resampleSpline } from '$lib/graph/spline/spline-resample';
import { surveyToXYZ } from '$lib/graph/survey/survey-to-xyz';
import { resolveProfile } from '$lib/shared/profiles/profile-presets';
import { warpManifoldAlongSpline, densifyProfileAxial, type DtxLut } from '$lib/engines/manifold/warp-spline';
import { cs, extrude_csg, ext, resample } from '$lib/graph/csg/csg-2d';
import { compileSketch } from '$lib/graph/sketch/sketch';
import * as mathLib from '$lib/graph/expr/math-lib';

// Math primitives injected as BARE names — `cos(x)`, `sin(x)`, `PI`, etc.
// Single source of truth in math-lib.ts; the order here is whatever
// Object.keys returns (stable across same-version Node/Bun, consistent
// with sandboxArgValues spreading the same keys).
const MATH_NAMES = Object.keys(mathLib);
const MATH_VALUES = MATH_NAMES.map((n) => (mathLib as any)[n]);

/** Argument NAMES passed to `new Function(...NAMES, body)`. Must stay
 *  index-aligned with `values()`. */
export const SANDBOX_ARG_NAMES: string[] = [
  'M', 'CS', 'cyl', 'tube', 'mv', 'rot', 'place', 'zMin', 'zMax', 'zLen', 'ref', 'head', 'tail', 'mate', 'align', 'stack', 'overlay', 'withStackRef', 'CIRCULAR_SEGMENTS_DEFAULT', 'CIRCULAR_SEGMENTS_COMPOSE',
  'initManifold', 'setCircularSegmentMode', 'getCutBox', 'empty',
  'helix_band', 'revolve', 'profile_extrude',
  'gridPatch', 'capFan', 'weldAndBuild', 'revolveProfile', 'sweepAlongPath', 'sweepAnnular', 'boredSweep', 'loftStations', 'resampleSpline', 'surveyToXYZ', 'resolveProfile', 'warpSpline', 'sectionCut', 'densifyProfileAxial',
  'cs', 'extrude_csg', 'ext', 'resample',
  'sketch',
  '__tag', '__tagNest',
  'G', 'Math',
  ...MATH_NAMES,
];

/** Argument VALUES, index-aligned with `SANDBOX_ARG_NAMES`.
 *
 * `viewScale` (optional) is the NON-PERSISTED display exaggeration for warped
 * parts (Problem 2, spline-aware scale): `radial` fattens the section (⊥ the
 * tangent), `depth` scales the spline UNIFORMLY (shape kept, length ∝) + the
 * arc-length. It multiplies whatever the warp node already carries, so a bake
 * with no viewScale (or 1,1) injects the plain `warpManifoldAlongSpline` and is
 * byte-identical. Applied here so BOTH the client worker (`bake-worker-core`)
 * and the server loader inject it from the same place. */
// `verticalDtx`/`verticalMaxDepth` are carried on the shared warpViewScale shape but
// are IGNORED here — they drive a POST-BAKE vertical warp in bake-worker-core (a part
// with no `warpSpline` never invokes the injected warpFn), not the warp-fn injection.
export function sandboxArgValues(viewScale?: { radial?: number; depth?: number; dtx?: DtxLut; verticalDtx?: boolean; verticalMaxDepth?: number }): any[] {
  const vr = (Number.isFinite(viewScale?.radial) && (viewScale!.radial as number) > 0) ? (viewScale!.radial as number) : 1;
  const vd = (Number.isFinite(viewScale?.depth) && (viewScale!.depth as number) > 0) ? (viewScale!.depth as number) : 1;
  // AUTOSCALE (DTX) COMPOSES with the manual scale (user 2026-07-27): the DTX
  // reparametrizes the along-hole station (normalizes the DISTRIBUTION — magnify short,
  // compress long, total preserved), and the manual Z-depth (vd) then scales that
  // normalized LENGTH overall (`s = lerpDtxLut(dtx, z) * yScale` in warp-spline), while
  // splineScale (vd) stretches the trajectory to match. So vd applies in BOTH the DTX and
  // the plain path; the DTX is just ADDED when present. Radial (vr) always applies too.
  // No dtx + {1,1} → byte-identical to the un-scaled warp.
  const dtx = (viewScale?.dtx && Array.isArray(viewScale.dtx.depth) && Array.isArray(viewScale.dtx.depthTx) && viewScale.dtx.depth.length >= 2)
    ? viewScale.dtx : undefined;
  const warpFn = (vr !== 1 || vd !== 1 || dtx)
    ? (m: any, cp: any, opts: any = {}) => warpManifoldAlongSpline(m, cp, {
        ...opts,
        xDiaScale: (Number.isFinite(opts?.xDiaScale) ? opts.xDiaScale : 1) * vr,
        yScale: (Number.isFinite(opts?.yScale) ? opts.yScale : 1) * vd,
        splineScale: (Number.isFinite(opts?.splineScale) ? opts.splineScale : 1) * vd,
        ...(dtx ? { dtx } : {}),
      })
    : warpManifoldAlongSpline;
  return [
    helpers.M, helpers.CS, helpers.cyl, helpers.tube, helpers.mv, helpers.rot, helpers.place, helpers.zMin, helpers.zMax, helpers.zLen, helpers.ref, helpers.head, helpers.tail, helpers.mate, helpers.align, helpers.stack, helpers.overlay, helpers.withStackRef,
    helpers.CIRCULAR_SEGMENTS_DEFAULT, helpers.CIRCULAR_SEGMENTS_COMPOSE,
    helpers.initManifold, helpers.setCircularSegmentMode, helpers.getCutBox, helpers.empty,
    helpers.helix_band, helpers.revolve, helpers.profile_extrude,
    gridPatch, capFan, weldAndBuild, revolveProfile, sweepAlongPath, sweepAnnular, boredSweep, loftStations, resampleSpline, surveyToXYZ, resolveProfile, warpFn, helpers.sectionCut, densifyProfileAxial,
    cs, extrude_csg, ext, resample,
    compileSketch,
    helpers.tagManifold, helpers.tagManifoldNested,
    globalThis, Math,
    ...MATH_VALUES,
  ];
}
