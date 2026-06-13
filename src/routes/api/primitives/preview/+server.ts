import { json, error } from '@sveltejs/kit';
import * as helpers from '$lib/cad/manifold-helpers';
import { buildPrimitiveGeom } from '$lib/server/primitive-loader';
import { finalizeManifold, setRenderZScale } from '$lib/cad/builder';
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
  const { source, name, params, zScale, mode, cutaway } = body ?? {};
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
  };
  // Numeric params only — string params (e.g. JSON polygons) don't round
  // trip identically across calls.
  const cacheableParams = args.every((a) => typeof a === 'number') ? (args as number[]) : null;
  let cacheHash: string | null = null;
  const cacheable = cacheableParams !== null && /^[a-z_][a-z0-9_]*$/i.test(name) && mode !== 'bundle';
  if (cacheable) {
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
    if (typeof zScale === 'number' && zScale > 0) setRenderZScale(zScale);
    let manifold: any;
    try { manifold = directFn(...args); }
    catch (e: any) { throw error(400, `primitive call failed: ${e?.message ?? e}`); }
    if (!manifold || typeof manifold.getMesh !== 'function') {
      throw error(400, 'primitive did not return a Manifold');
    }
    const r = finalizeManifold(manifold, args[0] && args[0] > 0 ? args[0] * 1.5 : 6, material);
    const s = serializeComponentResult(r);
    return json({ ok: true, full: s.full, cutVC: s.cutVC });
  }

  await helpers.initManifold();
  if (typeof zScale === 'number' && zScale > 0) setRenderZScale(zScale);
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
  try { manifold = primFn(...args); }
  catch (e: any) {
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
      { skipCutaway: typeof cutaway === 'boolean' ? !cutaway : 'auto' },
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
    cutawaySkipped,
    cached: false,
    cacheHash,
    _t: T,
  });
};
