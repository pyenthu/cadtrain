/**
 * well-bake-protocol — the structured-clone-safe request/reply shapes that flow
 * between the main thread and `wells-bake-worker.ts` through the `WellBakePool`.
 *
 * Kept in its OWN module (no THREE, no Manifold, no `?url` asset imports) so
 * both the worker AND the main-thread client can import the types without the
 * worker's wasm asset leaking into the main bundle. The pool itself treats the
 * payload as opaque `unknown`; these types are the contract the worker + the
 * consumer agree on.
 *
 * Design ref: `docs/plans/wells-build-architecture.md` §3b/3c. This foundation
 * ships the SHELL job (procedural tube/cylinder/sphere via `manifoldCut`); the
 * `part` job (compiled `g_*` completion via `runCompiledManifold`) is the P3
 * follow-on and is declared here as a forward-compatible variant so the pool +
 * worker envelope never has to change to add it.
 */

import type { SerializedGeometry } from '$lib/cad/mesh-serial';

/** A cloneable survey — the worker rebuilds a `WellDirection` from this (min-
 *  curvature is cheap, pure JS) rather than receiving the un-cloneable
 *  `@math.gl`-quaternion `WellDirection` object. `profile` is the DISPLAY-DEPTH
 *  remapped survey (raw MD already run through DTX × zScale, exactly as
 *  `WellSchematic3D` builds `remappedProfile`); `null` ⇒ straight vertical. */
export interface SurveyRequest {
  profile: Array<{ md: number; dev: number; az: number }> | null;
  td: number;
}

/** Shell = a procedural tube / cylinder / sphere fully described by numbers —
 *  the well strings + perfs. Baked by the existing `manifoldCut` builders in the
 *  worker (byte-identical to the main-thread path; the worker calls the SAME
 *  functions). The cutaway + warp run off-thread. */
export interface ShellBakeRequest {
  type: 'shell';
  form: 'tube' | 'cylinder' | 'sphere';
  /** Display-depth top/bot (already remapped) for tube/cylinder. */
  top: number;
  bot: number;
  /** tube: inner + outer radius; cylinder: outerR (innerR ignored). */
  innerR: number;
  outerR: number;
  /** sphere: world-placed centre + radius (spheres are NOT warped). */
  center?: [number, number, number];
  radius?: number;
  /** Cut plane orientation — mirrors the `manifoldCut` builder args. */
  cutAxis: 'x' | 'y' | 'z';
  cutAzimuthDeg: number;
  /** 180 = half-section, 90 = quarter wedge (completions/tubing). */
  cutDeg: number;
  /** main body colour, 0..1 rgb. */
  color: number[];
  /** optional cut-face styling (cement uses a beige speckle). */
  cutColor?: number[];
  cutVariance?: number;
  /** Survey → rebuild `WellDirection` in the worker (drives deviated strategy +
   *  warp). Omitted / `profile:null` ⇒ vertical fast path, no warp. */
  survey: SurveyRequest;
}

/** Part = a detailed `g_*` completion baked from a compiled Manifold script —
 *  the SAME pipeline the graph editor uses (`runCompiledManifold`). FORWARD-
 *  DECLARED for P3; the current worker rejects it with a clear "not yet wired"
 *  error so the envelope is stable but the geometry path lands later. */
export interface PartBakeRequest {
  type: 'part';
  /** self-contained script from /api/primitives/compile. */
  script: string;
  scriptHash: string;
  params: Array<number | string>;
  /** BakeOptions passthrough (kept loose here to avoid importing bake-worker-core
   *  types into the protocol module). */
  options?: Record<string, unknown>;
  /** optional survey to warp the baked part along the trajectory. */
  survey?: SurveyRequest;
}

export type WellBakeRequest = ShellBakeRequest | PartBakeRequest;

/** The worker's reply payload (the `data` field of a `WellBakeReply`). A single
 *  vertex-coloured geometry (position + color + normals; NON-indexed — the
 *  cut-face grey is baked into per-vertex colours, so there is no separate
 *  `cutVC` the way `/preview` returns). Packed onto transferable buffers by the
 *  worker for zero-copy hand-off. */
export interface WellShellResult {
  geo: SerializedGeometry;
  /** triangle count — a cheap sanity/telemetry field. */
  tris: number;
}
