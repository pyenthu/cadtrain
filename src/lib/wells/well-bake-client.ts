/**
 * well-bake-client — the MAIN-THREAD integration seam between the /wells 3D
 * scene and the parallel `WellBakePool` (#42b-A, `docs/plans/
 * wells-build-architecture.md` §3d/3e).
 *
 * This is the documented ENTRY POINT `WellSchematic3D.svelte` calls to move the
 * per-element shell build off the UI thread. It owns:
 *   • a lazy pool singleton (`getWellBakePool`) — bounded worker count shared
 *     across the app, disposed on demand;
 *   • the element → `WellBakeJobSpec` mapping (`shellJobSpec`) with a complete
 *     geometry cache key (`shellCacheKey`) that folds in EVERY geometry-
 *     affecting input incl. the survey fingerprint (so a survey edit busts
 *     warped meshes but a colour-only edit does not — the deja-vu guard);
 *   • the reply → `THREE.BufferGeometry` deserialize (`shellReplyToGeometry`);
 *   • a streaming reconcile helper (`bakeWellShells`) the scene drives on every
 *     element-list change — keep-all, so only the changed elements re-bake.
 *
 * THREE lives here (deserialize), NOT in the pure scheduling pool.
 *
 * INTEGRATION (the WellSchematic3D wiring — the P2 follow-on that needs BROWSER
 * verification, per the plan):
 *   1. Build the element list (already exists as `buildBundle` in
 *      WellSchematic3D — lift the shell descriptors into `ShellElement[]`).
 *   2. `const pool = getWellBakePool();`
 *   3. On the element list changing (a `$derived` of the stable element specs):
 *        const specs = elements.map((el) => shellJobSpec(el.id, buildShellRequest(el, survey)));
 *        bakeWellShells(pool, specs, (id, geo) => { built[id] = geo; }, (id, err) => { … });
 *   4. Render a STABLE-keyed `{#each elements as el (el.id)}` reading `built[el.id]`
 *      — dropping the `{#key geomKey}` full-remount (design §3d). Meshes stay
 *      mounted; only `geometry` swaps as each bake lands (progressive render).
 */

import * as THREE from 'three';
import { deserializeGeometry, type SerializedGeometry } from '$lib/cad/mesh-serial';
import {
  WellBakePool, WELL_BAKE_CANCELLED, type WellBakeJobSpec, type WellBakeReply,
} from './well-bake-pool';
import type { ShellBakeRequest, SurveyRequest, WellShellResult } from './well-bake-protocol';

// ── Lazy pool singleton ───────────────────────────────────────────────────────
// One pool for the app keeps the worker count bounded even with multiple mounted
// well tabs. Element ids should be namespaced per tab/well when several wells
// share the pool (the scene owns id assignment).
let _pool: WellBakePool | null = null;
export function getWellBakePool(): WellBakePool {
  if (!_pool) _pool = new WellBakePool();
  return _pool;
}
/** Dispose + drop the shared pool (e.g. a full teardown / HMR). */
export function disposeWellBakePool(): void {
  _pool?.dispose();
  _pool = null;
}

// ── Element → request ─────────────────────────────────────────────────────────

/** The minimal, cloneable descriptor of one procedural shell element the scene
 *  hands to the pool. Mirrors the fields `WellSchematic3D` already computes for
 *  each oh / casing / cement / tubing / perf row. */
export interface ShellElement {
  /** STABLE id across rebuilds (e.g. `oh:0`, `ch:2`, `perf:1`). */
  id: string;
  form: 'tube' | 'cylinder' | 'sphere';
  top: number;
  bot: number;
  innerR: number;
  outerR: number;
  center?: [number, number, number];
  radius?: number;
  color: number[];
  cutColor?: number[];
  cutVariance?: number;
  cutAxis: 'x' | 'y' | 'z';
  cutAzimuthDeg: number;
  cutDeg: number;
}

/** Build the worker request for one shell element + the shared survey. */
export function buildShellRequest(el: ShellElement, survey: SurveyRequest): ShellBakeRequest {
  return {
    type: 'shell',
    form: el.form,
    top: el.top,
    bot: el.bot,
    innerR: el.innerR,
    outerR: el.outerR,
    ...(el.center ? { center: el.center } : {}),
    ...(el.radius != null ? { radius: el.radius } : {}),
    cutAxis: el.cutAxis,
    cutAzimuthDeg: el.cutAzimuthDeg,
    cutDeg: el.cutDeg,
    color: el.color,
    ...(el.cutColor ? { cutColor: el.cutColor } : {}),
    ...(el.cutVariance != null ? { cutVariance: el.cutVariance } : {}),
    survey,
  };
}

/** A fingerprint of the sampled survey — a survey edit busts every warped mesh,
 *  a completion/colour edit does not. */
export function surveyFingerprint(s: SurveyRequest): string {
  return `${JSON.stringify(s.profile ?? null)}|${s.td}`;
}

/** Deterministic cache/dedup key covering EVERY geometry-affecting input for a
 *  shell (design §3e — omitting one = a stale mesh, the deja-vu class the editor
 *  already solved with scriptHash). Colour/cut styling IS baked into vertex
 *  colours, so it belongs in the key. */
export function shellCacheKey(req: ShellBakeRequest): string {
  return [
    'shell', req.form,
    req.top, req.bot, req.innerR, req.outerR,
    req.center ? req.center.join(',') : '-', req.radius ?? '-',
    req.cutAxis, req.cutAzimuthDeg, req.cutDeg,
    req.color.join(','), req.cutColor ? req.cutColor.join(',') : '-', req.cutVariance ?? '-',
    surveyFingerprint(req.survey),
  ].join('|');
}

/** Element → pool job spec (id + geometry key + request payload). */
export function shellJobSpec(el: ShellElement, survey: SurveyRequest): WellBakeJobSpec {
  const req = buildShellRequest(el, survey);
  return { id: el.id, key: shellCacheKey(req), payload: req };
}

// ── Reply → THREE ─────────────────────────────────────────────────────────────

/** Rehydrate a shell reply into a `THREE.BufferGeometry` (position + baked
 *  vertex colours + normals; non-indexed). Feeds a `MeshStandardMaterial`
 *  `{vertexColors:true}` mesh unchanged. */
export function shellReplyToGeometry(reply: WellBakeReply): THREE.BufferGeometry {
  const data = reply.data as WellShellResult;
  return deserializeGeometry(data.geo as SerializedGeometry);
}

// ── Streaming reconcile helper ────────────────────────────────────────────────

/**
 * Reconcile the pool to the current element set + stream finished geometries.
 * Keep-all: unchanged elements are not re-baked; changed ones re-bake; removed
 * ones are cancelled. `onGeo(id, geometry)` fires per element as its worker
 * finishes (progressive render); `onError(id, err)` surfaces a failed bake (no
 * fallback — project rule). Returns an unsubscribe fn — call it when the scene
 * unmounts (it does NOT dispose the shared pool).
 */
export function bakeWellShells(
  pool: WellBakePool,
  specs: WellBakeJobSpec[],
  onGeo: (id: string, geometry: THREE.BufferGeometry) => void,
  onError?: (id: string, err: Error) => void,
): () => void {
  const offResult = pool.onResult((r) => onGeo(r.id, shellReplyToGeometry(r)));
  const offError = onError ? pool.onError(onError) : () => {};
  pool.reconcile(specs);
  return () => { offResult(); offError(); };
}

export { WELL_BAKE_CANCELLED };
