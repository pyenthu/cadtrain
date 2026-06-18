import { json, error } from '@sveltejs/kit';
import * as helpers from '$lib/cad/manifold-helpers';
import { setAxialMaxZSpan, getAxialMaxZSpan, setCircSegCap, getCircSegCap } from '$lib/cad/manifold-mesh';
import { buildPrimitiveGeom, hashDepSources } from '$lib/server/primitive-loader';
import { finalizeManifold } from '$lib/cad/builder';
import { serializeComponentResult } from '$lib/cad/mesh-serial';
import { extractMetaFromSource } from '$lib/server/primitives-meta';
import { analyzeParts } from '$lib/server/part-colors';
import { hashBakeKey, readBakeCache, writeBakeCache, type BakeCacheOptions } from '$lib/server/bake-cache';

// POST /api/primitives/preview
//   { source, name, params: number[], zScale?, mode? }
// Builds the source's geom via primitive-loader.buildPrimitiveGeom (strip
// imports → transpile → resolve the source's `meta.uses` dependencies
// (read each dep's source from the volume, build + inject by name) →
// new Function with the helper scope), calls the named function with
// positional `params`, finalizes the Manifold + serializes mesh JSON for
// the client to rehydrate via deserializeComponentResult.
//
// `mode:'bundle'` skips the sandbox and invokes the bundle helper directly
// (avoids wasm-instance quirks for in-sync-with-bundle primitives).
//
// Stage G v4 — see ~/.claude/plans/components-primitives-split.md.

export const POST = async ({ request, fetch }) => {
  let body: any;
  try { body = await request.json(); }
  catch { throw error(400, 'invalid JSON body'); }
  const { source, name, params, zScale, mode, cutaway, colorOuter, colorInner, segments, segmentsFloor, instanced, warp, creaseAngle } = body ?? {};
  // OPT-IN GPU instancing (LIVE-mesh path only). When true, finalize tries to
  // detect a Stack/Repeat of N identical bodies and returns the canonical child
  // mesh ONCE + N transforms (response carries `instanced`). When the body
  // isn't a uniform repeat, finalize falls back to the merged mesh transparently
  // → the response is the normal merged shape. Absent/false → byte-identical to
  // the pre-instancing behaviour (SVG tab, GLB, typed builders never send it).
  const instancedReq = instanced === true;
  // Optional per-request circular-segment override (the SVG tab asks for a
  // coarse 32 so the vector drawing renders fast + below the high-poly warning).
  // Clamp to a sane range; non-finite / out-of-range → undefined → full default
  // (256) bake, so the 3D/GLB panes are unaffected and the default cache key is
  // unchanged. Applied for THIS bake only (set immediately before the sync geom
  // build, restored right after — see below).
  const segArg = (typeof segments === 'number' && Number.isFinite(segments) && segments >= 8 && segments <= 256)
    ? Math.round(segments)
    : undefined;
  // Optional segment FLOOR — RAISES a part's (and its deps') explicit `segments`
  // param UP to this value for THIS bake. The SVG "high" drawing sends 256 so an
  // assembly whose deps hard-code segments:32 (e.g. dt_tube → g_shaft) renders
  // its curved bores smooth instead of 32-faceted. Same clamp range + race-safe
  // set/restore window as segArg; undefined → no floor → byte-identical default.
  const segFloorArg = (typeof segmentsFloor === 'number' && Number.isFinite(segmentsFloor) && segmentsFloor >= 8 && segmentsFloor <= 256)
    ? Math.round(segmentsFloor)
    : undefined;
  // Request-local Z-scale — passed into finalizeManifold (no shared global to
  // race on between concurrent previews). undefined → finalize uses 1.0.
  const zArg = (typeof zScale === 'number' && zScale > 0) ? zScale : undefined;
  // Per-part viewer colours (outside ← outer body, inside ← bore/cut). Validated
  // to `#rrggbb`/`#rgb`; anything else → undefined → legacy red/grey heuristic.
  // Both undefined → byte-identical default bake (cache key unchanged too).
  const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  const cOuter = (typeof colorOuter === 'string' && HEX_RE.test(colorOuter.trim())) ? colorOuter.trim().toLowerCase() : undefined;
  const cInner = (typeof colorInner === 'string' && HEX_RE.test(colorInner.trim())) ? colorInner.trim().toLowerCase() : undefined;
  // Optional sinusoidal warp baked into the geometry (`amp·sin(z·freq)` on x|y).
  // Validate fully: finite amp/freq, axis ∈ {x,y}, and amp ≠ 0 (a zero-amp warp
  // is a no-op → treat as absent so the bake + cache key stay byte-identical to
  // the un-warped default). Anything malformed → undefined → no warp.
  const warpArg = (warp && typeof warp === 'object'
    && Number.isFinite(warp.amp) && Number(warp.amp) !== 0
    && Number.isFinite(warp.freq)
    && (warp.axis === 'x' || warp.axis === 'y'))
    ? { amp: Number(warp.amp), freq: Number(warp.freq), axis: warp.axis as 'x' | 'y' }
    : undefined;
  // Optional crease angle (minSharpAngle, deg) for the baked smooth normals.
  // Clamp to [1, 180]; the default 60 is treated as ABSENT so the bake + cache
  // key stay byte-identical to the legacy default (existing cache entries hit).
  // Anything non-finite / out of range / ===60 → undefined → calculateNormals(3,60).
  const creaseArg = (typeof creaseAngle === 'number' && Number.isFinite(creaseAngle)
    && creaseAngle >= 1 && creaseAngle <= 180 && Math.round(creaseAngle) !== 60)
    ? Math.round(creaseAngle)
    : undefined;
  if (typeof source !== 'string') throw error(400, 'source required');
  if (typeof name !== 'string') throw error(400, 'name required (the function to call)');
  // Args may be mixed number | string (string carries JSON-encoded
  // polygon params — the primitive function JSON.parses them inside).
  const args: (number | string)[] = Array.isArray(params)
    ? params.map((p) => typeof p === 'string' ? p : Number(p))
    : [];

  // ─── Bake cache lookup ──────────────────────────────────────────────────
  // Hash(body, params, options). If hit, serve immediately and skip the
  // whole buildPrimitiveGeom → primFn → finalize → serialize chain.
  // Only the numeric/string params bake-relevant — skip hashing for the
  // mode==='bundle' fast path (different code path entirely).
  // ?bust=1 query bypasses the cache lookup (forces a fresh bake).
  const url = new URL(request.url);
  const bust = url.searchParams.get('bust') === '1';
  const cacheOpts: BakeCacheOptions = {
    cutaway: typeof cutaway === 'boolean' ? cutaway : undefined,
    zScale: typeof zScale === 'number' ? zScale : undefined,
    mode: typeof mode === 'string' ? mode : undefined,
    // Colour overrides change the baked vertex colours → must key the cache
    // so a colour change re-bakes (undefined keys are dropped by hashBakeKey).
    colorOuter: cOuter,
    colorInner: cInner,
    // Coarse-segment override keys the cache so a coarse (SVG) bake stores
    // separately from the full bake; undefined → dropped → default key unchanged.
    segments: segArg,
    // Segment FLOOR (SVG "high") likewise keys the cache so a high-res bake
    // stores separately; undefined → dropped → default key unchanged.
    segmentsFloor: segFloorArg,
    // Warp bakes into the vertex positions → must key the cache so a warped
    // bake stores separately; undefined → dropped → default key unchanged.
    warp: warpArg,
    // Crease angle bakes into the per-vertex normals + crease split → must key
    // the cache so a crease change re-bakes; undefined (default 60) → dropped →
    // default key unchanged (existing default-bake entries still hit).
    creaseAngle: creaseArg,
  };
  // Numeric params only — string params (e.g. JSON polygons) don't round
  // trip identically across calls.
  const cacheableParams = args.every((a) => typeof a === 'number') ? (args as number[]) : null;
  let cacheHash: string | null = null;
  // Instanced requests bypass the persistent bake cache: the cached payload
  // schema predates the `instanced` field, and the client fetch-cache already
  // memoises the instanced response. Keeps the non-instanced cache byte-identical.
  const cacheable = cacheableParams !== null && /^[a-z_][a-z0-9_]*$/i.test(name) && mode !== 'bundle' && !instancedReq;
  if (cacheable) {
    // DEP-AWARE KEY — fold a hash of the resolved `meta.uses` dep sources
    // (transitive) into the key so editing a DEP busts this parent's cache
    // even when the parent's OWN body is byte-identical (the "deja-vu"
    // stale-mesh bug). Reuses the loader's TTL dep-source cache, so the
    // fetches dedupe with buildPrimitiveGeom's below. undefined (leaf part /
    // bundle-only deps) → dropped by hashBakeKey → legacy key byte-identical.
    // Tolerant: a resolution failure here just leaves the dep hash off — the
    // real error surfaces from buildPrimitiveGeom on the miss path.
    try { cacheOpts.depSourcesHash = await hashDepSources(source, fetch); }
    catch { /* dep resolution error → surfaces in buildPrimitiveGeom below */ }
    cacheHash = hashBakeKey(source, name, cacheableParams as number[], cacheOpts);
    // bust=1 skips the lookup but we still compute the hash + write to cache
    // so the rebuild flow leaves the next call ready for a cache hit.
    if (!bust) {
      const hit = await readBakeCache(name, cacheHash);
      if (hit) {
        return json({
          ok: true,
          full: hit.full,
          cutVC: hit.cutVC,
          cutawaySkipped: hit.cutawaySkipped === true,
          cached: true,
          cacheHash,
          _t: { cache_hit: 0 },
        });
      }
    }
  }

  // Pull the optional appearance block from the source meta — same way
  // bake-preview does — so the live Mesh pane honours material.outer /
  // material.inner instead of the legacy red/grey heuristic. Meta-less
  // (bundle) sources just leave it undefined → legacy look preserved.
  let material: any = undefined;
  try { material = extractMetaFromSource(source).material; }
  catch { /* meta-less source — legacy red/grey */ }

  // Fast path — when the client says `mode: "bundle"` we skip the
  // sandbox + esbuild + new Function dance and invoke the exported
  // bundle helper directly. Avoids subtle wasm-instance issues that
  // surface inside `new Function` (e.g. M.union of many cubes raised
  // "table index is out of bounds" on helix_band). Used by /primitives
  // when the editor source is in-sync-with-bundle; switches to the
  // sandbox path the moment the user edits.
  if (mode === 'bundle') {
    const directFn = (helpers as any)[name];
    if (typeof directFn !== 'function') {
      throw error(404, `bundle primitive "${name}" not found`);
    }
    await helpers.initManifold();
    let manifold: any;
    try { manifold = directFn(...args); }
    catch (e: any) { throw error(400, `primitive call failed: ${e?.message ?? e}`); }
    if (!manifold || typeof manifold.getMesh !== 'function') {
      throw error(400, 'primitive did not return a Manifold');
    }
    const r = finalizeManifold(manifold, args[0] && args[0] > 0 ? args[0] * 1.5 : 6, material, undefined, { zScale: zArg, colorOuter: cOuter, colorInner: cInner, warp: warpArg, creaseAngle: creaseArg });
    const s = serializeComponentResult(r);
    return json({ ok: true, full: s.full, cutVC: s.cutVC });
  }

  await helpers.initManifold();
  // Phase timings (ms) — returned as `_t` so we can break down where a
  // preview spends its time: deps+sandbox build vs WASM geom vs cutaway vs
  // mesh serialize. Client ignores the field.
  const T: Record<string, number> = {};
  const mark = (k: string, t: number) => { T[k] = +(performance.now() - t).toFixed(1); };
  let t = performance.now();
  let primFn: any;
  try {
    primFn = await buildPrimitiveGeom(source, name, fetch);
  } catch (e: any) {
    throw error(400, `primitive build failed: ${e?.message ?? e}`);
  }
  mark('buildFn', t); t = performance.now();

  let manifold: any;
  // ── Coarse-segment override (SVG tab) ──────────────────────────────────
  // Set the circular-segment levers IMMEDIATELY before the SYNCHRONOUS geom
  // call and restore them right after, with NO `await` in between (WASM is
  // sync). This is the race-safe pattern: a concurrent full bake can't observe
  // the coarse setting because nothing yields the event loop between set →
  // build → restore. `buildPrimitiveGeom` (the only await above) only builds
  // dep FACTORY functions; the dep GEOMETRY executes lazily INSIDE this
  // synchronous `primFn(...args)` call, so setting the levers here reaches the
  // deps too.
  //
  // TWO levers, because circular resolution is plumbed two ways:
  //  1. `setCircularSegmentCount(n)` → module-local `currentSegments` + the
  //     WASM global. Reaches the RAW helpers (cyl/tube/revolve), which pass
  //     `currentSegments` explicitly to M.cylinder / cs.revolve.
  //  2. `setCircularSegmentCap(n)` → a cap the part loader applies to each
  //     part's explicit `segments` param. Reaches the ENGINE primitives
  //     (r_revolve / r_tube / r_cylinder, …) — which IGNORE both globals and
  //     take segments as a param — and therefore the ASSEMBLIES composed from
  //     them. This is the half that the original SVG-coarse feature missed:
  //     an assembly's circular geometry lives entirely in those engine-prim
  //     deps, so without the cap the override was a no-op (byte-identical
  //     30 MB bake at segments:32 vs 256).
  const segActive = segArg !== undefined || segFloorArg !== undefined;
  const segPrev = segActive ? helpers.getCircularSegmentCount() : undefined;
  const capPrev = segArg !== undefined ? helpers.getCircularSegmentCap() : undefined;
  const floorPrev = segFloorArg !== undefined ? helpers.getCircularSegmentFloor() : undefined;
  const weldCapPrev = segArg !== undefined ? getCircSegCap() : undefined;
  if (segArg !== undefined) { helpers.setCircularSegmentCount(segArg); helpers.setCircularSegmentCap(segArg); setCircSegCap(segArg); }
  // High-res FLOOR (SVG "high"): raise the raw-helper segment count AND set the
  // engine-prim floor, so deps that hard-code a low `segments` get lifted UP.
  if (segFloorArg !== undefined) { helpers.setCircularSegmentCount(segFloorArg); helpers.setCircularSegmentFloor(segFloorArg); }
  // Build-time axial Z-densification (smooth warp) — ONLY when a warp option is
  // present, so non-warp revolves stay light. Drive the target Z-edge length
  // from the warp frequency (period 2π/freq, ~16 samples/cycle). Same race-safe
  // window as the segment levers: set right before the SYNC build, restore after.
  const axialPrev = (warpArg && warpArg.freq > 0) ? getAxialMaxZSpan() : undefined;
  if (warpArg && warpArg.freq > 0) setAxialMaxZSpan((2 * Math.PI / warpArg.freq) / 16);
  try { manifold = primFn(...args); }
  catch (e: any) {
    if (segActive) helpers.setCircularSegmentCount(segPrev as number);
    if (segArg !== undefined) { helpers.setCircularSegmentCap(capPrev as number | null); setCircSegCap(weldCapPrev ?? null); }
    if (segFloorArg !== undefined) helpers.setCircularSegmentFloor(floorPrev as number | null);
    if (axialPrev !== undefined) setAxialMaxZSpan(axialPrev);
    // Surface the structured fail-trail buildPrimitiveGeom's dep wrapper
    // attached when the crash came out of a sub-call. Keeps the legacy
    // string shape for non-decorated errors (raw helper calls, bad params,
    // etc.) so existing callers don't break.
    const msg = String(e?.message ?? e ?? '');
    const depChain = (e as any)?.depChain;
    // ManifoldCAD's "memory access out of bounds" is the WASM bus error —
    // bubble up a structured payload with chain + hint instead of the
    // bare string so the editor can highlight the failing dep node.
    if (/memory access out of bounds/.test(msg)) {
      const tail = depChain
        ? ` (in ${depChain.join(' → ')}; common causes: NaN/undefined param into a sub-call, compose of N copies of a non-manifold body, cutaway on a self-overlapping result)`
        : ' (the WASM Manifold core hit an invalid pointer — usually a NaN/undefined coord upstream)';
      const full = msg + tail;
      // Match SvelteKit's error-body shape (`message`) so legacy clients
      // that read `j.message` keep working, AND add the structured fields
      // (errorKind, depChain) so the editor's error pane can highlight
      // the failing dep node specifically.
      return json({
        message: full,
        error: full,
        errorKind: 'wasm-oob',
        depChain: depChain ?? null,
      }, { status: 400 });
    }
    throw error(400, `primitive call failed: ${msg}`);
  }
  // Restore both segment levers right after the sync build (success path). The
  // catch arms above already restored before throwing/returning.
  if (segActive) helpers.setCircularSegmentCount(segPrev as number);
  if (segArg !== undefined) { helpers.setCircularSegmentCap(capPrev as number | null); setCircSegCap(weldCapPrev ?? null); }
  if (segFloorArg !== undefined) helpers.setCircularSegmentFloor(floorPrev as number | null);
  if (axialPrev !== undefined) setAxialMaxZSpan(axialPrev);
  mark('geom', t); t = performance.now();

  if (!manifold || typeof manifold.getMesh !== 'function') {
    throw error(400, 'primitive did not return a Manifold');
  }
  // Per-part color table (color-by-source). Matches the hashId stamping
  // buildPrimitiveGeom applied; inactive for leaves / unrecognized sources
  // → finalizeManifold falls back to the material / legacy path.
  let parts: any = undefined;
  try { parts = analyzeParts(source); } catch { /* legacy color path */ }
  // cutaway: undefined → threshold-based auto-skip (default)
  //          true       → force compute (caller wants the slice)
  //          false      → force skip (fast path)
  // finalizeManifold can throw — the empty-solid guard (a CSG/subtract that
  // removed all geometry), a cutaway OOB on a self-overlapping body, etc. It
  // used to sit OUTSIDE this try, so those throws escaped as a 500 "Internal
  // Error" (uncatchable by the client → no clean error, harder recovery).
  // Catch + return a structured 400 with errorKind so the editor shows a
  // proper geometry message and re-bakes cleanly once params are fixed.
  let result: any, serialized: any, cutawaySkipped: boolean;
  try {
    result = finalizeManifold(
      manifold,
      args[0] && args[0] > 0 ? args[0] * 1.5 : 6,
      material,
      parts,
      { skipCutaway: typeof cutaway === 'boolean' ? !cutaway : 'auto', zScale: zArg, colorOuter: cOuter, colorInner: cInner, instanced: instancedReq, warp: warpArg, creaseAngle: creaseArg },
    );
    mark('finalize', t); t = performance.now();
    serialized = serializeComponentResult(result);
    mark('serialize', t);
    cutawaySkipped = (result as any).cutawaySkipped === true;
  } catch (e: any) {
    const msg = String(e?.message ?? e ?? '');
    const kind = /EMPTY solid/i.test(msg) ? 'empty-solid'
      : /memory access out of bounds/.test(msg) ? 'wasm-oob'
      : 'finalize-failed';
    return json({ message: msg, error: msg, errorKind: kind }, { status: 400 });
  }

  // Best-effort cache write. Errors here don't break the response — we'd
  // rather serve the bake and miss the cache than fail the whole call.
  if (cacheHash && cacheableParams !== null) {
    writeBakeCache(name, cacheHash, {
      full: serialized.full,
      cutVC: serialized.cutVC,
      cutawaySkipped,
      _t: T,
    }, cacheableParams, cacheOpts).catch((e) => {
      console.warn('[bake-cache] write failed:', e?.message ?? e);
    });
  }

  return json({
    ok: true,
    full: serialized.full,
    cutVC: serialized.cutVC,
    // Present only when instancing was requested AND applied (uniform repeat):
    // full/cutVC are then the canonical child + this carries the N transforms.
    // Omitted entirely otherwise → response shape is the normal merged mesh.
    ...(serialized.instanced ? { instanced: serialized.instanced } : {}),
    cutawaySkipped,
    cached: false,
    cacheHash,
    _t: T,
  });
};
