/// <reference lib="webworker" />
/**
 * wells-bake-worker — the per-element geometry worker behind `WellBakePool`
 * (#42b-A, `docs/plans/wells-build-architecture.md` §3c).
 *
 * ONE of these runs per pool worker (N = clamp(hardwareConcurrency-1,1,4)),
 * each holding its OWN Manifold WASM instance → true parallelism, no shared-
 * singleton contention, per-worker crash isolation.
 *
 * A `shell` job builds a procedural tube / cylinder / sphere by calling the
 * EXISTING `manifoldCut` builders (`cutTube` / `cutCylinder` / `cutSphere`) —
 * UNCHANGED. The one wrinkle those builders need is a `WellDirection` (to pick
 * the deviated strategy + drive the parallel-transport warp), and a
 * `WellDirection` is NOT structured-clone-safe (`@math.gl` quaternions). Rather
 * than pre-sampling the centreline, we ship the cloneable survey
 * (`{profile, td}`) and REBUILD the `WellDirection` in-worker via
 * `buildWellDirection` — min-curvature is cheap, pure JS, and calling the same
 * builders guarantees byte-identical geometry to the main-thread reference path.
 * A tiny per-worker memo avoids rebuilding it for every sibling element.
 *
 * WASM locate: same `?url` `locateFile` trick as `bake-worker.ts` — Vite emits
 * `manifold.wasm` as a served asset (CORP-clean under COEP) and Emscripten is
 * pointed at it. `manifoldCut.initManifold()` already threads that URL.
 *
 * The pure scheduling lives in `well-bake-pool.ts` (unit-tested with a mock
 * worker); this file is only ever instantiated AS a Worker, so its wasm-asset
 * import never leaks into the main bundle or the tests.
 */

import * as THREE from 'three';
import { serializeGeometry } from '$lib/cad/mesh-serial';
import { initManifold, cutTube, cutCylinder, cutSphere } from './manifoldCut';
import { buildWellDirection, type WellDirection } from './index';
import type {
  WellBakeRequest, ShellBakeRequest, SurveyRequest, WellShellResult,
} from '../well-bake-protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/** Envelope the pool wraps each job in. */
interface PoolMessage { jobId: number; payload: WellBakeRequest }

// Warm the Manifold singleton once per worker (deduped).
let initPromise: Promise<unknown> | null = null;
function ensureInit(): Promise<unknown> {
  if (!initPromise) initPromise = initManifold();
  return initPromise;
}

// ── Per-worker WellDirection memo — a well has many elements sharing ONE survey.
// Rebuild only when the survey fingerprint changes.
let _dirKey = '';
let _dir: WellDirection | null = null;
function surveyFingerprint(s: SurveyRequest): string {
  return JSON.stringify(s.profile ?? null) + '|' + s.td;
}
function wellDirFor(s: SurveyRequest): WellDirection {
  const key = surveyFingerprint(s);
  if (key !== _dirKey || !_dir) {
    _dir = buildWellDirection(s.profile ?? null, s.td);
    _dirKey = key;
  }
  return _dir;
}

/** Build the shell geometry by delegating to the unmodified manifoldCut builders. */
function bakeShell(req: ShellBakeRequest): THREE.BufferGeometry | null {
  const dir = wellDirFor(req.survey);
  const style = { cutColor: req.cutColor, cutVariance: req.cutVariance };
  if (req.form === 'sphere') {
    const c = req.center ?? [0, 0, 0];
    return cutSphere({ x: c[0], y: c[1], z: c[2] }, req.radius ?? req.outerR, req.cutAxis, req.color, style);
  }
  if (req.form === 'cylinder') {
    return cutCylinder(req.top, req.bot, req.outerR, req.cutAxis, req.color, style, dir, req.cutAzimuthDeg, req.cutDeg);
  }
  // tube (annulus)
  return cutTube(req.top, req.bot, req.innerR, req.outerR, req.cutAxis, req.color, style, dir, req.cutAzimuthDeg, req.cutDeg);
}

/** Serialize a single geometry onto TRANSFERABLE typed-array buffers (zero-copy).
 *  Mirrors `bake-worker-core.packTransferable`'s packGeo for the single-geometry
 *  wells shape. */
function packShellResult(geo: THREE.BufferGeometry): { data: WellShellResult; transfer: ArrayBuffer[] } {
  const s = serializeGeometry(geo);
  const transfer: ArrayBuffer[] = [];
  const pos = new Float32Array(s.positions); transfer.push(pos.buffer);
  const out: WellShellResult['geo'] = { positions: pos as unknown as number[] };
  if (s.normals) { const n = new Float32Array(s.normals); out.normals = n as unknown as number[]; transfer.push(n.buffer); }
  if (s.colors) { const c = new Float32Array(s.colors); out.colors = c as unknown as number[]; transfer.push(c.buffer); }
  if (s.index) { const i = new Uint32Array(s.index); out.index = i as unknown as number[]; transfer.push(i.buffer); }
  const tris = out.index ? out.index.length / 3 : out.positions.length / 9;
  return { data: { geo: out, tris }, transfer };
}

ctx.onmessage = async (ev: MessageEvent<PoolMessage>) => {
  const { jobId, payload } = ev.data ?? ({} as PoolMessage);
  try {
    await ensureInit();
    if (!payload || (payload.type !== 'shell' && payload.type !== 'part')) {
      throw new Error(`unknown well bake request type: ${(payload as any)?.type}`);
    }
    if (payload.type === 'part') {
      // Forward-declared in the protocol; the compiled-g_* path is P3.
      throw new Error('well bake "part" jobs are not wired yet (P3 — completions via runCompiledManifold)');
    }
    const geo = bakeShell(payload);
    if (!geo || !(geo.getAttribute('position')?.count)) {
      throw new Error(`shell bake produced empty geometry (form=${payload.form}, top=${payload.top}, bot=${payload.bot})`);
    }
    const { data, transfer } = packShellResult(geo);
    geo.dispose();
    ctx.postMessage({ jobId, ok: true, data }, transfer);
  } catch (e: any) {
    ctx.postMessage({ jobId, ok: false, error: String(e?.message ?? e) });
  }
};
