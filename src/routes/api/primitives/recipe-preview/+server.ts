import { json, error } from '@sveltejs/kit';
import * as helpers from '$lib/cad/manifold-helpers';
import { buildPrimitiveRecipe } from '$lib/server/primitive-recipe';
import { finalizeManifold, setRenderZScale } from '$lib/cad/builder';
import { serializeComponentResult } from '$lib/cad/mesh-serial';

// POST /api/primitives/recipe-preview
//   { recipe, params?, zScale? }
// Builds a PRIMITIVE COMPOSITE recipe (declarative instances + Tier-1
// bindings whose call: targets are volume primitives + mv/rot) to a
// serialized mesh. Mirrors /api/primitives/preview but for the recipe
// representation instead of a single source.ts. Local compute (NOT
// proxied) — the primitive leaves are read off the volume via the
// proxy-aware event.fetch, but the WASM build runs here.
//
// Thin-slice of the dual-control design: leaf = code (source.ts),
// composite = recipe (this).

export const POST = async ({ request, fetch }) => {
  let body: any;
  try { body = await request.json(); }
  catch { throw error(400, 'invalid JSON body'); }
  const { recipe, params, zScale } = body ?? {};
  if (!recipe || !Array.isArray(recipe.instances)) {
    throw error(400, 'recipe with instances[] required');
  }

  // Merge provided params over the recipe's declared defaults.
  const merged: Record<string, number> = {};
  for (const [k, v] of Object.entries(recipe.meta?.params ?? {})) {
    merged[k] = (v as any)?.default;
  }
  if (params && typeof params === 'object') Object.assign(merged, params);

  await helpers.initManifold();
  if (typeof zScale === 'number' && zScale > 0) setRenderZScale(zScale);

  let manifold: any;
  try { manifold = await buildPrimitiveRecipe(recipe, merged, fetch); }
  catch (e: any) { throw error(400, `recipe build failed: ${e?.message ?? e}`); }

  if (!manifold || typeof manifold.getMesh !== 'function') {
    throw error(400, 'recipe did not produce a Manifold');
  }

  const material = recipe.meta?.material;
  const result = finalizeManifold(manifold, 6, material);
  const serialized = serializeComponentResult(result);
  return json({ ok: true, full: serialized.full, cutVC: serialized.cutVC });
};
