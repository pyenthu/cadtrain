/**
 * bake-worker-core — the PURE run → finalize → serialize core of the
 * client-side Manifold executor (PR2 of docs/plans/client-side-execution.md).
 *
 * Factored OUT of `bake-worker.ts` (the Web Worker entry) so it has ZERO
 * worker/DOM/Vite-asset dependencies and can be unit-tested directly in vitest
 * (which runs Manifold in Node, loading the same `manifold.wasm` off disk). The
 * worker is a thin shell around `runCompiledManifold`; the test drives this
 * function — that's the sanctioned "factor the core into a testable function"
 * path from the task brief, and it doubles as the executable contract.
 *
 * THE CONTRACT (mirrors /api/primitives/preview EXACTLY):
 *   1. A compiled Manifold script (from /api/primitives/compile) is run the
 *      SAME way the server executor runs `wrapper`:
 *        new Function(...SANDBOX_ARG_NAMES, script)(...sandboxArgValues()) → geomFn
 *   2. geomFn(...params) → a Manifold.
 *   3. finalizeManifold(...) + serializeComponentResult(...) → { full, cutVC,
 *      instanced } — byte-identical render output to the server preview.
 *
 * Render options (zScale / cutaway / segments / warp / colours / crease /
 * instanced) are validated + applied with the SAME race-safe segment/axial
 * lever discipline /preview uses (set immediately before the SYNC geom call,
 * restore right after — no await in between).
 */

import * as helpers from './manifold-helpers';
import { setAxialMaxZSpan, getAxialMaxZSpan } from './manifold-mesh';
import { SANDBOX_ARG_NAMES, sandboxArgValues } from './primitive-sandbox';
import { finalizeManifold, type RenderMaterial } from './builder';
import { serializeComponentResult, type SerializedComponentResult, type SerializedGeometry } from './mesh-serial';

/** Pinned kernel identity — folded into the IndexedDB cache key so a client on
 *  an upgraded WASM build never serves a mesh baked by the old kernel (plan §8
 *  "bust the IndexedDB cache on kernel-version change"). */
export const KERNEL_VERSION = 'manifold-3d@3.4.1+nrm2'; // +nrm2: degenerate-normal recompute (2026-06-17) busts stale zero-normal caches

/** Render options — the subset of /api/primitives/preview's request body that
 *  affects the baked geometry. All optional; absent → the byte-identical default
 *  bake. `material` is an optional passthrough (the compiled script strips meta,
 *  so the client can't read it from the script alone — PR3 may supply it). */
export interface BakeOptions {
  /** Render-time Z compression (preview `zScale`). >0 → applied; else 1.0. */
  zScale?: number;
  /** true = force-compute the half-section cutaway, false = force-skip,
   *  undefined = threshold auto (matches preview's `skipCutaway` tri-state). */
  cutaway?: boolean;
  /** Coarse circular-segment override (8..256). undefined → full default. */
  segments?: number;
  /** Sinusoidal warp baked into the geometry. */
  warp?: { amp: number; freq: number; axis: 'x' | 'y' };
  /** Per-part outer colour override `#rrggbb`/`#rgb`. */
  colorOuter?: string;
  /** Per-part inner (bore/cut) colour override. */
  colorInner?: string;
  /** calculateNormals crease angle (1..180; 60 == default). */
  creaseAngle?: number;
  /** Opt-in GPU instancing of a uniform Stack/Repeat. */
  instanced?: boolean;
  /** Optional appearance passthrough (PR3 may thread meta.material here). */
  material?: RenderMaterial;
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Validate + normalise BakeOptions exactly like preview/+server.ts so a bake
 *  here keys/behaves identically. Returns the coerced render-affecting values. */
function coerceOptions(options: BakeOptions = {}) {
  const { zScale, cutaway, segments, warp, colorOuter, colorInner, creaseAngle, instanced } = options;
  const segArg = (typeof segments === 'number' && Number.isFinite(segments) && segments >= 8 && segments <= 256)
    ? Math.round(segments)
    : undefined;
  const zArg = (typeof zScale === 'number' && zScale > 0) ? zScale : undefined;
  const cOuter = (typeof colorOuter === 'string' && HEX_RE.test(colorOuter.trim())) ? colorOuter.trim().toLowerCase() : undefined;
  const cInner = (typeof colorInner === 'string' && HEX_RE.test(colorInner.trim())) ? colorInner.trim().toLowerCase() : undefined;
  const warpArg = (warp && typeof warp === 'object'
    && Number.isFinite(warp.amp) && Number(warp.amp) !== 0
    && Number.isFinite(warp.freq)
    && (warp.axis === 'x' || warp.axis === 'y'))
    ? { amp: Number(warp.amp), freq: Number(warp.freq), axis: warp.axis as 'x' | 'y' }
    : undefined;
  const creaseArg = (typeof creaseAngle === 'number' && Number.isFinite(creaseAngle)
    && creaseAngle >= 1 && creaseAngle <= 180 && Math.round(creaseAngle) !== 60)
    ? Math.round(creaseAngle)
    : undefined;
  return { segArg, zArg, cOuter, cInner, warpArg, creaseArg, instanced: instanced === true, cutaway };
}

/**
 * Run a compiled Manifold script client-side and return serialized
 * `{ full, cutVC, instanced }` — the SAME shape /api/primitives/preview
 * returns. Pure + isomorphic (no worker/DOM); the worker calls this, the test
 * calls this.
 *
 * @param script  self-contained text from /api/primitives/compile.
 * @param params  positional args (number | string) OR a single object — the
 *                compiled script's `__adapt` boundary bridges both shapes.
 */
export async function runCompiledManifold(
  script: string,
  params: Array<number | string> | Record<string, unknown>,
  options: BakeOptions = {},
): Promise<SerializedComponentResult> {
  // Reuse the shared manifold-helpers init path → one WASM singleton. In the
  // worker this is a no-op (the worker pre-inits with a locateFile pointing at
  // the Vite-served asset); in vitest/Node it loads manifold.wasm off disk.
  await helpers.initManifold();

  // Build the geom fn EXACTLY like the server executor: inject the 44 sandbox
  // helpers by name, run the script, get back the adapted geom function.
  let geomFn: (...args: any[]) => any;
  try {
    const factory = new Function(...SANDBOX_ARG_NAMES, script);
    geomFn = factory(...sandboxArgValues());
  } catch (e: any) {
    throw new Error(`compiled script failed to evaluate: ${e?.message ?? e}`);
  }
  if (typeof geomFn !== 'function') {
    throw new Error('compiled script did not return a geom function');
  }

  const { segArg, zArg, cOuter, cInner, warpArg, creaseArg, instanced, cutaway } = coerceOptions(options);

  // maxOD heuristic — mirror preview: first positional param * 1.5, else 6.
  const a0 = Array.isArray(params) ? params[0] : undefined;
  const maxOD = (typeof a0 === 'number' && a0 > 0) ? a0 * 1.5 : 6;

  // ── Race-safe segment / axial levers (see preview/+server.ts) ────────────
  // Set immediately before the SYNCHRONOUS geom call, restore right after —
  // NO await between, so a concurrent bake can't observe the coarse setting.
  const segPrev = segArg !== undefined ? helpers.getCircularSegmentCount() : undefined;
  const capPrev = segArg !== undefined ? helpers.getCircularSegmentCap() : undefined;
  if (segArg !== undefined) { helpers.setCircularSegmentCount(segArg); helpers.setCircularSegmentCap(segArg); }
  const axialPrev = (warpArg && warpArg.freq > 0) ? getAxialMaxZSpan() : undefined;
  if (warpArg && warpArg.freq > 0) setAxialMaxZSpan((2 * Math.PI / warpArg.freq) / 16);

  const _now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const _tBuild0 = _now();
  let manifold: any;
  try {
    manifold = Array.isArray(params) ? geomFn(...params) : geomFn(params);
  } catch (e: any) {
    throw new Error(`primitive call failed: ${e?.message ?? e}`);
  } finally {
    if (segArg !== undefined) { helpers.setCircularSegmentCount(segPrev as number); helpers.setCircularSegmentCap(capPrev as number | null); }
    if (axialPrev !== undefined) setAxialMaxZSpan(axialPrev);
  }
  const _tBuild = _now() - _tBuild0;

  if (!manifold || typeof manifold.getMesh !== 'function') {
    throw new Error('primitive did not return a Manifold');
  }

  const _tFin0 = _now();
  const result = finalizeManifold(
    manifold,
    maxOD,
    options.material,
    undefined,
    {
      skipCutaway: typeof cutaway === 'boolean' ? !cutaway : 'auto',
      zScale: zArg,
      colorOuter: cOuter,
      colorInner: cInner,
      instanced,
      warp: warpArg,
      creaseAngle: creaseArg,
    },
  );
  const _tFin = _now() - _tFin0;
  const _tSer0 = _now();
  const out = serializeComponentResult(result);
  const _tSer = _now() - _tSer0;
  // Timing breakdown (perf): build (script→Manifold) · finalize (mesh+cutaway,
  // split inside finalizeManifold's own log) · serialize. Logged when
  // globalThis.__bakeTimings is set; also attached for the client to surface.
  const fin = (result as any).timings ?? { full: 0, cut: 0 };
  if ((globalThis as any).__bakeTimings) {
    try { console.log(`[bake-worker] build=${_tBuild.toFixed(1)} · mesh=${(fin.full ?? 0).toFixed(1)} · cutaway=${(fin.cut ?? 0).toFixed(1)} · finalize=${_tFin.toFixed(1)} · serialize=${_tSer.toFixed(1)} ms`); } catch {}
  }
  (out as any).timings = { build: _tBuild, mesh: fin.full ?? 0, cutaway: fin.cut ?? 0, finalize: _tFin, serialize: _tSer };
  return out;
}

/** A serialized result re-packed onto TRANSFERABLE typed-array buffers so the
 *  worker can postMessage it with a transfer list (zero-copy hand-off). The
 *  main thread feeds this straight back through `deserializeComponentResult`
 *  (its `new Float32Array(s.positions)` accepts a typed array unchanged). */
export interface TransferableComponentResult {
  full: SerializedGeometry;
  cutVC: SerializedGeometry;
  instanced?: { instances: number[][]; count: number };
}

/** Pack a SerializedComponentResult (plain number[] arrays) onto typed-array
 *  buffers + collect the transfer list. Returns the packed object and the
 *  ArrayBuffers to pass as postMessage's 2nd arg. */
export function packTransferable(
  s: SerializedComponentResult,
): { payload: TransferableComponentResult; transfer: ArrayBuffer[] } {
  const transfer: ArrayBuffer[] = [];
  const packGeo = (g: SerializedGeometry): SerializedGeometry => {
    const out: SerializedGeometry = { positions: [] };
    const pos = new Float32Array(g.positions);
    out.positions = pos as unknown as number[];
    transfer.push(pos.buffer);
    if (g.normals) { const n = new Float32Array(g.normals); out.normals = n as unknown as number[]; transfer.push(n.buffer); }
    if (g.colors) { const c = new Float32Array(g.colors); out.colors = c as unknown as number[]; transfer.push(c.buffer); }
    if (g.index) { const i = new Uint32Array(g.index); out.index = i as unknown as number[]; transfer.push(i.buffer); }
    return out;
  };
  const payload: TransferableComponentResult = {
    full: packGeo(s.full),
    cutVC: packGeo(s.cutVC),
  };
  if (s.instanced) payload.instanced = s.instanced;
  if ((s as any).timings) (payload as any).timings = (s as any).timings;
  return { payload, transfer };
}

/** IndexedDB / in-flight cache key — the same key discipline as the server
 *  script cache: scriptHash already folds in every resolved dep, so a dep edit
 *  changes the hash → no stale-dep recurrence. KERNEL_VERSION busts the cache
 *  across a WASM upgrade (plan §8). Params + options are JSON-stable. */
export function bakeCacheKey(
  scriptHash: string,
  params: Array<number | string> | Record<string, unknown>,
  options: BakeOptions = {},
): string {
  return `${KERNEL_VERSION} ${scriptHash} ${JSON.stringify(params)} ${stableStringify(options)}`;
}

/** Deterministic JSON for the options object (sorted keys) so two logically
 *  equal option sets produce the SAME key regardless of property order. */
function stableStringify(o: unknown): string {
  if (o === null || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return `[${o.map(stableStringify).join(',')}]`;
  const keys = Object.keys(o as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((o as any)[k])}`).join(',')}}`;
}
