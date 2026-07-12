import { json, error } from '@sveltejs/kit';
import * as helpers from '$lib/engines/manifold/manifold-helpers';
import { withManifoldTrapGuard } from '$lib/server/manifold-guard';
import { buildPrimitiveGeom } from '$lib/server/primitive-loader';
import { buildGlbBytes, DEFAULT_OUTER_HEX, DEFAULT_INNER_HEX, type ColorOverride } from '$lib/server/manifold-bake';
import { extractMetaFromSource } from '$lib/server/primitives-meta';
import { analyzeParts, resolveDepColors } from '$lib/server/part-colors';

// POST /api/primitives/bake-preview
//   { id, name, source, params }
// Mirrors /api/primitives/preview but returns GLB bytes (full + cut)
// instead of the serialized mesh JSON. Builds the geom via
// primitive-loader.buildPrimitiveGeom (which resolves the source's
// `meta.uses` deps), then wraps the positional primFn into the
// record-shaped geom buildGlbBytes expects, using the param order from
// the source's `export const meta`.

const handlePost = async ({ request, fetch }: { request: Request; fetch: typeof globalThis.fetch }) => {
  let body: any;
  try { body = await request.json(); }
  catch { throw error(400, 'invalid JSON body'); }
  const { id, name, source, params, args, colorOuter, colorInner } = body ?? {};
  if (typeof source !== 'string' || !source.trim()) throw error(400, 'source required');
  if (typeof name !== 'string' || !name) throw error(400, 'name required');

  // Per-part viewer colours (outside ← outer body, inside ← bore/cut). Same
  // validation as /api/primitives/preview: `#rgb` / `#rrggbb` only, anything
  // else → undefined. Both undefined → no override → byte-identical default
  // GLB (existing parts unaffected). When at least one is set, the unset side
  // falls back to the historical default so the GLB matches the live Mesh pane.
  const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  const cOuter = (typeof colorOuter === 'string' && HEX_RE.test(colorOuter.trim())) ? colorOuter.trim().toLowerCase() : undefined;
  const cInner = (typeof colorInner === 'string' && HEX_RE.test(colorInner.trim())) ? colorInner.trim().toLowerCase() : undefined;
  const override: ColorOverride | undefined = (cOuter || cInner)
    ? { outer: cOuter ?? DEFAULT_OUTER_HEX, inner: cInner ?? DEFAULT_INNER_HEX }
    : undefined;

  // Pull the param ORDER from meta in source so we can dispatch the
  // positional call. If meta is missing, fall back to whatever key
  // order the request body shipped. Also pluck the material block —
  // it's embedded in the GLB so the download carries the colors.
  let paramOrder: string[] = [];
  let material: any = undefined;
  try {
    const meta = extractMetaFromSource(source);
    paramOrder = Object.keys(meta.params);
    material = meta.material;
  } catch { /* meta-less source — handled below */ }

  // Two accepted shapes: positional `args` array (preferred when the
  // client doesn't know the param names), or a `params` record keyed
  // by actual name. Build the values record either way. Mixed types:
  // numbers for scalars, strings for polygon (JSON-encoded) params.
  let valuesRecord: Record<string, number | string> = {};
  const coerce = (v: any) => typeof v === 'string' ? v : Number(v);
  // Bundle primitives don't carry `export const meta` — their source is
  // a bare helper function in manifold-helpers.ts. When we get
  // positional args and no meta, synthesise param names so the geom
  // wrapper below can still dispatch positionally.
  if (Array.isArray(args)) {
    if (paramOrder.length === 0) {
      paramOrder = args.map((_, i) => `_${i}`);
    }
    paramOrder.forEach((k, i) => { valuesRecord[k] = coerce(args[i] ?? 0); });
  } else if (params && typeof params === 'object') {
    valuesRecord = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, coerce(v)]));
    if (paramOrder.length === 0) paramOrder = Object.keys(valuesRecord);
  } else {
    throw error(400, 'either `args` (array) or `params` (record) required');
  }

  // Build the geom (positional) via the shared loader — resolves the
  // source's meta.uses deps + injects the helper scope. Same path as
  // /api/primitives/preview.
  await helpers.initManifold();
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

  // Wrap positional → record. buildGlbBytes hands the geom a params
  // record; we translate via the meta param order. Pass strings
  // through unchanged (polygon params) and coerce others to numbers.
  const geom = (p: Record<string, number | string>) =>
    primFn(...paramOrder.map((k) => {
      const v = p[k];
      return typeof v === 'string' ? v : Number(v ?? 0);
    }));

  // #86: subpart-own colours in the GLB export too (same LUT the live Mesh uses).
  let parts: any = undefined;
  try {
    const depColors = await resolveDepColors(source, fetch);
    parts = analyzeParts(source, depColors);
  } catch { /* legacy color path */ }
  const r = await buildGlbBytes(geom, valuesRecord, material, parts, override);
  mark('bake', t); // includes the WASM geom rebuild + GLB export (full + cut)
  if (!r.ok) throw error(400, `bake failed: ${r.error}`);

  // Return JSON with base64-encoded GLB blobs. The client converts to
  // Blob URLs for <GLTFLoader> consumption. Two blobs (full + optional
  // cut) — clients with no cutaway just use full.
  const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
  return json({
    ok: true,
    full: b64(r.full),
    cut: r.cut ? b64(r.cut) : null,
    _t: T,
  });
};

// A fatal WASM trap poisons the shared Manifold singleton for EVERY later request
// (/plan #981). Reset it before responding, so one bad part costs one bake rather
// than the whole process. Non-trap errors pass through untouched.
export const POST = (event: any) => withManifoldTrapGuard(() => handlePost(event));
