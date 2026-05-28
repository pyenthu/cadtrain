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
import * as helpers from './manifold-helpers';
import { gridPatch, capFan, weldAndBuild, revolveProfile } from './manifold-mesh';
import { resolveProfile } from '$lib/shared/profile-presets';
import { warpManifoldAlongSpline } from './warp-spline';
import { cs, extrude_csg } from './csg-2d';

/** Argument NAMES passed to `new Function(...NAMES, body)`. Must stay
 *  index-aligned with `values()`. */
export const SANDBOX_ARG_NAMES: string[] = [
  'M', 'CS', 'cyl', 'tube', 'mv', 'rot', 'place', 'zMin', 'zMax', 'zLen', 'ref', 'head', 'tail', 'mate', 'align', 'CIRCULAR_SEGMENTS_DEFAULT', 'CIRCULAR_SEGMENTS_COMPOSE',
  'initManifold', 'setCircularSegmentMode', 'getCutBox', 'empty',
  'helix_band', 'revolve', 'profile_extrude',
  'gridPatch', 'capFan', 'weldAndBuild', 'revolveProfile', 'resolveProfile', 'warpSpline',
  'cs', 'extrude_csg',
  '__tag',
  'G', 'Math',
];

/** Argument VALUES, index-aligned with `SANDBOX_ARG_NAMES`. */
export function sandboxArgValues(): any[] {
  return [
    helpers.M, helpers.CS, helpers.cyl, helpers.tube, helpers.mv, helpers.rot, helpers.place, helpers.zMin, helpers.zMax, helpers.zLen, helpers.ref, helpers.head, helpers.tail, helpers.mate, helpers.align,
    helpers.CIRCULAR_SEGMENTS_DEFAULT, helpers.CIRCULAR_SEGMENTS_COMPOSE,
    helpers.initManifold, helpers.setCircularSegmentMode, helpers.getCutBox, helpers.empty,
    helpers.helix_band, helpers.revolve, helpers.profile_extrude,
    gridPatch, capFan, weldAndBuild, revolveProfile, resolveProfile, warpManifoldAlongSpline,
    cs, extrude_csg,
    helpers.tagManifold,
    globalThis, Math,
  ];
}
