import { json, error } from '@sveltejs/kit';
import { transformSync } from 'esbuild';
import * as helpers from '$lib/cad/manifold-helpers';
import { CIRCULAR_SEGMENTS_DEFAULT } from '$lib/cad/manifold-helpers';
import { SANDBOX_ARG_NAMES, sandboxArgValues } from '$lib/cad/primitive-sandbox';
import { buildGlbBytes } from '$lib/server/manifold-bake';
import { extractMetaFromSource } from '$lib/server/primitives-meta';

// POST /api/primitives/bake-preview
//   { id, name, source, params }
// Mirrors /api/primitives/preview but returns GLB bytes (full + cut)
// instead of the serialized mesh JSON. Used by the /primitives canvas
// GLB sub-pane to show what bakeGlb() would write to disk WITHOUT
// touching the filesystem.
//
// Same sandbox layers as /preview: stripImports → esbuild → new Function
// with the manifold helpers in scope. We wrap the positional primFn
// into a record-shaped geom (the shape buildGlbBytes expects) by
// pulling the param order from the source's `export const meta`.

const IMPORT_RE = /import\s+(?:type\s+)?(?:\{([^}]*)\})?\s*(?:from\s*)?['"]([^'"]+)['"]\s*;?/g;
function stripImports(src: string): string {
  let stripped = src;
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src)) !== null) stripped = stripped.replace(m[0], '');
  return stripped;
}

export const POST = async ({ request }) => {
  let body: any;
  try { body = await request.json(); }
  catch { throw error(400, 'invalid JSON body'); }
  const { id, name, source, params, args } = body ?? {};
  if (typeof source !== 'string' || !source.trim()) throw error(400, 'source required');
  if (typeof name !== 'string' || !name) throw error(400, 'name required');

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

  // Build the sandbox factory and pull primFn (positional). Same
  // approach as /api/primitives/preview's sandbox path.
  const stripped = stripImports(source);
  let js: string;
  try {
    js = transformSync(stripped, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  } catch (e: any) {
    throw error(400, `esbuild transform failed: ${e?.message ?? e}`);
  }
  const wrapper = `
    "use strict";
    const module = { exports: {} };
    const exports = module.exports;
    const currentSegments = CIRCULAR_SEGMENTS_DEFAULT;
    ${js}
    return module.exports;
  `;
  await helpers.initManifold();
  let allExports: any;
  try {
    const factory = new Function(...SANDBOX_ARG_NAMES, wrapper);
    allExports = factory(...sandboxArgValues());
  } catch (e: any) {
    throw error(400, `factory build failed: ${e?.message ?? e}`);
  }
  let primFn: any = allExports?.[name];
  if (typeof primFn !== 'function') {
    primFn = Object.values(allExports ?? {}).find((v) => typeof v === 'function');
  }
  if (typeof primFn !== 'function') {
    throw error(400, `no callable export found in source (looked for "${name}")`);
  }

  // Wrap positional → record. buildGlbBytes hands the geom a params
  // record; we translate via the meta param order. Pass strings
  // through unchanged (polygon params) and coerce others to numbers.
  const geom = (p: Record<string, number | string>) =>
    primFn(...paramOrder.map((k) => {
      const v = p[k];
      return typeof v === 'string' ? v : Number(v ?? 0);
    }));

  const r = await buildGlbBytes(geom, valuesRecord, material);
  if (!r.ok) throw error(400, `bake failed: ${r.error}`);

  // Return JSON with base64-encoded GLB blobs. The client converts to
  // Blob URLs for <GLTFLoader> consumption. Two blobs (full + optional
  // cut) — clients with no cutaway just use full.
  const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
  return json({
    ok: true,
    full: b64(r.full),
    cut: r.cut ? b64(r.cut) : null,
  });
};
