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
import { setAxialMaxZSpan, getAxialMaxZSpan, setCircSegCap, getCircSegCap } from './manifold-mesh';
import { SANDBOX_ARG_NAMES, sandboxArgValues } from './primitive-sandbox';
import { finalizeManifold, type RenderMaterial, type PartColorLUT } from './render-helpers';
import { serializeComponentResult, type SerializedComponentResult, type SerializedGeometry } from './mesh-serial';

/** Pinned kernel identity — folded into the IndexedDB cache key so a client on
 *  an upgraded WASM build never serves a mesh baked by the old kernel (plan §8
 *  "bust the IndexedDB cache on kernel-version change"). */
export const KERNEL_VERSION = 'manifold-3d@3.4.1+cut2'; // +cap1: ear-clip r_sweep end caps (fanCap3D, manifold-mesh) — a transitive engine import NOT in scriptHash, so its fix needs a manual kernel bump to bust the stale-cap IndexedDB cache. +nrm4: crease-aware render normals under vert ceiling. +cut2: sectionCut refines the CUT RESULT, not just the wedge (#64 bridging triangle) — same transitive-import problem, same manual bump

/** Max profile Z-span (world units) a WARP-NODE bake allows before re-lathing an
 *  extra axial ring — the density source for a lean revolve under `warpSpline`.
 *  Constant heuristic (spike-validated on a 30-long tube: ~20 rings, smooth).
 *  TODO: curvature-adaptive via planAxialStations for long/gently-curved wells. */
const WARP_AXIAL_MAX_ZSPAN = 1.5;

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
  /** Build-time "true round silhouette" smoothing (smoothOut+refineToTolerance).
   *  Present → on; absent → byte-identical default bake. */
  smooth?: { minSharpAngle?: number; tolerance?: number };
  /** Opt-in GPU instancing of a uniform Stack/Repeat. */
  instanced?: boolean;
  /** Optional appearance passthrough (PR3 may thread meta.material here). */
  material?: RenderMaterial;
  /** #86 — per-source colour LUT (color-by-source). Computed server-side by
   *  /api/primitives/compile (analyzeParts + resolveDepColors) and threaded in
   *  so the CLIENT bake tints each subpart in its own colour, exactly like the
   *  server /preview path. Absent / inactive → the single colorOuter/colorInner
   *  override or the legacy red/grey heuristic (byte-identical to before). */
  parts?: PartColorLUT;
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Validate the build-time "round silhouette" smoothing option, identically to
 *  preview/+server.ts. Truthy `smooth` → `{ minSharpAngle?, tolerance? }` with
 *  only the finite/in-range fields kept (finalizeManifold supplies the defaults:
 *  minSharpAngle 60, tolerance ≈ 0.4% of maxOD). Falsy / malformed → undefined =
 *  byte-identical default bake. Shared shape exported for the server to mirror. */
export function coerceSmooth(smooth: unknown): { minSharpAngle?: number; tolerance?: number } | undefined {
  if (!smooth || typeof smooth !== 'object') return undefined;
  const s = smooth as { minSharpAngle?: unknown; tolerance?: unknown };
  const out: { minSharpAngle?: number; tolerance?: number } = {};
  if (typeof s.minSharpAngle === 'number' && Number.isFinite(s.minSharpAngle)
    && s.minSharpAngle >= 1 && s.minSharpAngle <= 180) out.minSharpAngle = Math.round(s.minSharpAngle);
  if (typeof s.tolerance === 'number' && Number.isFinite(s.tolerance) && s.tolerance > 0) out.tolerance = s.tolerance;
  return out;
}

/** Validate + normalise BakeOptions exactly like preview/+server.ts so a bake
 *  here keys/behaves identically. Returns the coerced render-affecting values. */
function coerceOptions(options: BakeOptions = {}) {
  const { zScale, cutaway, segments, warp, colorOuter, colorInner, creaseAngle, smooth, instanced } = options;
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
  const smoothArg = coerceSmooth(smooth);
  return { segArg, zArg, cOuter, cInner, warpArg, creaseArg, smoothArg, instanced: instanced === true, cutaway };
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

  const { segArg, zArg, cOuter, cInner, warpArg, creaseArg, smoothArg, instanced, cutaway } = coerceOptions(options);

  // A part that bends a solid via the warp NODE emits `warpSpline(...)` into the
  // compiled script body → the warp is baked into the Manifold, invisible to
  // finalize's opts.warp (the SCENE warp). Detect it from the script text and
  // pass `smoothWarp` so finalize re-derives fully-smooth (crease-free) render
  // normals for the warped mesh instead of the 60°-crease-split faceted ones —
  // matching the server /preview path. Absent → byte-identical non-warped bake.
  const smoothWarp = typeof script === 'string' && script.includes('warpSpline(');

  // maxOD heuristic — mirror preview: first positional param * 1.5, else 6.
  const a0 = Array.isArray(params) ? params[0] : undefined;
  const maxOD = (typeof a0 === 'number' && a0 > 0) ? a0 * 1.5 : 6;

  // ── Race-safe segment / axial levers (see preview/+server.ts) ────────────
  // Set immediately before the SYNCHRONOUS geom call, restore right after —
  // NO await between, so a concurrent bake can't observe the coarse setting.
  const segPrev = segArg !== undefined ? helpers.getCircularSegmentCount() : undefined;
  const capPrev = segArg !== undefined ? helpers.getCircularSegmentCap() : undefined;
  const weldCapPrev = segArg !== undefined ? getCircSegCap() : undefined;
  if (segArg !== undefined) { helpers.setCircularSegmentCount(segArg); helpers.setCircularSegmentCap(segArg); setCircSegCap(segArg); }
  // Axial-density dial. A warp bends POSITIONS on the already-built mesh, so the
  // axial rings must exist BEFORE the warp (Manifold can't subdivide post-bake —
  // Rule 25). r_revolve is now LEAN by default (g_shaft zSegments 0), so a warp
  // NODE part (`warpSpline(...)`, detected as smoothWarp) supplies its density
  // here via the SAME `_axialMaxZSpan` dial the sine-warp path uses: cap each
  // profile Z-span at WARP_AXIAL_MAX_ZSPAN so a straight wall re-laths into enough
  // rings to bend smoothly (spike: span 1.5 → ~20 rings on a 30-long tube, matched
  // the old zSegments-10 reference at 3.2× fewer tris). NON-warp bakes never touch
  // the dial → byte-identical + lean (the 5.5× straight-part win).
  const useAxialDial = (warpArg && warpArg.freq > 0) || smoothWarp;
  const axialPrev = useAxialDial ? getAxialMaxZSpan() : undefined;
  if (warpArg && warpArg.freq > 0) setAxialMaxZSpan((2 * Math.PI / warpArg.freq) / 16);
  else if (smoothWarp) setAxialMaxZSpan(WARP_AXIAL_MAX_ZSPAN);

  const _now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const _tBuild0 = _now();
  let manifold: any;
  try {
    manifold = Array.isArray(params) ? geomFn(...params) : geomFn(params);
  } catch (e: any) {
    throw new Error(`primitive call failed: ${e?.message ?? e}`);
  } finally {
    if (segArg !== undefined) { helpers.setCircularSegmentCount(segPrev as number); helpers.setCircularSegmentCap(capPrev as number | null); setCircSegCap(weldCapPrev ?? null); }
    if (axialPrev !== undefined) setAxialMaxZSpan(axialPrev);
  }
  const _tBuild = _now() - _tBuild0;

  if (!manifold || typeof manifold.getMesh !== 'function') {
    throw new Error('primitive did not return a Manifold');
  }

  const _tFin0 = _now();
  // #86: activate color-by-source on the client bake when the compile step
  // supplied a usable LUT (a composed part whose subparts carry colours). A
  // single-part override (colorOuter/colorInner) still wins inside finalize.
  const partsLut = options.parts && options.parts.active ? options.parts : undefined;
  const result = finalizeManifold(
    manifold,
    maxOD,
    options.material,
    partsLut,
    {
      skipCutaway: typeof cutaway === 'boolean' ? !cutaway : 'auto',
      zScale: zArg,
      colorOuter: cOuter,
      colorInner: cInner,
      instanced,
      warp: warpArg,
      creaseAngle: creaseArg,
      smoothWarp,
      smooth: smoothArg,
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
  parts?: import('./mesh-serial').SerializedPartMesh[];
  cutParts?: import('./mesh-serial').SerializedPartMesh[];
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
  if (s.parts?.length) payload.parts = s.parts.map((p) => ({ geo: packGeo(p.geo), ...(p.appearance ? { appearance: p.appearance } : {}), ...(p.id ? { id: p.id } : {}) }));
  if (s.cutParts?.length) payload.cutParts = s.cutParts.map((p) => ({ geo: packGeo(p.geo), ...(p.appearance ? { appearance: p.appearance } : {}), ...(p.id ? { id: p.id } : {}) }));
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
  return `${KERNEL_VERSION}\u0000${scriptHash}\u0000${JSON.stringify(params)}\u0000${stableStringify(options)}`;
}

/** Deterministic JSON for the options object (sorted keys) so two logically
 *  equal option sets produce the SAME key regardless of property order. */
function stableStringify(o: unknown): string {
  if (o === null || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return `[${o.map(stableStringify).join(',')}]`;
  const keys = Object.keys(o as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((o as any)[k])}`).join(',')}}`;
}
