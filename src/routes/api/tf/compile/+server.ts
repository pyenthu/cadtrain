import { json, error } from '@sveltejs/kit';
import { graphToTf, tfRecipeText, type TfRecipe } from '$lib/cad/graph-to-tf';

/**
 * POST /api/tf/compile — SERVER-SIDE graph→TF compile (the JS/recipe form, #48).
 *
 * The lightweight counterpart to /api/tf/compile-wasm (#49): the graph→TF
 * TRANSLATOR runs on the server and returns the compiled TF instruction RECIPE
 * (readable JS/JSON) — the client then executes it in its own TF kernel. Server
 * does NOT run TrueForm (pure translation, no WASM here). This is the ☁-server
 * half of the compile toggle vs the ⚡-client `graphToTf`; per #46 it's meant to
 * fire on a STRUCTURAL change only, not per param value.
 *
 * Body: { graph: CompositionGraph, params?: Record<string, number>, id?: string }
 * Reply: { ok, recipe: TfRecipe, text: string, ops: number }
 */
export async function POST({ request }) {
  let body: { graph?: unknown; params?: Record<string, number>; id?: string };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }
  if (!body?.graph || typeof body.graph !== 'object') {
    throw error(400, 'missing "graph"');
  }
  let recipe: TfRecipe;
  try {
    recipe = graphToTf(body.graph as any, body.params ?? {});
  } catch (e: any) {
    throw error(422, `compile failed: ${e?.message ?? e}`);
  }
  return json({
    ok: true,
    recipe,
    text: tfRecipeText(recipe, body.id),
    ops: recipe.instrs?.length ?? 0,
    notes: recipe.notes ?? [],
  });
}
