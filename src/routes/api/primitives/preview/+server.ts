import { json, error } from '@sveltejs/kit';
import * as helpers from '$lib/cad/manifold-helpers';
import { buildPrimitiveGeom } from '$lib/server/primitive-loader';
import { finalizeManifold, setRenderZScale } from '$lib/cad/builder';
import { serializeComponentResult } from '$lib/cad/mesh-serial';

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
  const { source, name, params, zScale, mode } = body ?? {};
  if (typeof source !== 'string') throw error(400, 'source required');
  if (typeof name !== 'string') throw error(400, 'name required (the function to call)');
  // Args may be mixed number | string (string carries JSON-encoded
  // polygon params — the primitive function JSON.parses them inside).
  const args: (number | string)[] = Array.isArray(params)
    ? params.map((p) => typeof p === 'string' ? p : Number(p))
    : [];

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
    const r = finalizeManifold(manifold, args[0] && args[0] > 0 ? args[0] * 1.5 : 6);
    const s = serializeComponentResult(r);
    return json({ ok: true, full: s.full, cutVC: s.cutVC });
  }

  await helpers.initManifold();
  if (typeof zScale === 'number' && zScale > 0) setRenderZScale(zScale);
  let primFn: any;
  try {
    primFn = await buildPrimitiveGeom(source, name, fetch);
  } catch (e: any) {
    throw error(400, `primitive build failed: ${e?.message ?? e}`);
  }

  let manifold: any;
  try { manifold = primFn(...args); }
  catch (e: any) { throw error(400, `primitive call failed: ${e?.message ?? e}`); }

  if (!manifold || typeof manifold.getMesh !== 'function') {
    throw error(400, 'primitive did not return a Manifold');
  }
  const result = finalizeManifold(manifold, args[0] && args[0] > 0 ? args[0] * 1.5 : 6);
  const serialized = serializeComponentResult(result);
  return json({ ok: true, full: serialized.full, cutVC: serialized.cutVC });
};
