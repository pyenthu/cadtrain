import { json, error } from '@sveltejs/kit';
import { graphToTf } from '$lib/engines/trueform/graph-to-tf';
import { recipeToWasm, recipeToBytes, recipeOpCount, RECIPE_FMT } from '$lib/cad/tf-wat-emit';

// POST /api/tf/compile-wasm — compile a part's composition GRAPH → a TrueForm
// instruction RECIPE (graphToTf) → an OPAQUE WASM module carrying that recipe
// (see src/lib/cad/tf-wat-emit.ts for the wire format + honest concealment note).
//
// Request  : { graph: Graph, params?: Record<string, number> }
// Response : the WASM binary as `application/wasm` bytes. A small JSON header is
//            carried in response HEADERS (a WASM body can't also be JSON):
//              X-TF-Recipe-Ops    — op-count in the recipe tree (coverage)
//              X-TF-Recipe-Bytes  — the WASM byte size
//              X-TF-Json-Bytes    — the raw recipe-JSON byte size (size tradeoff)
//              X-TF-Recipe-Fmt    — wire-format version (RECIPE_FMT)
//              X-TF-Recipe-Notes  — count of coverage notes (unsupported/approx nodes)
//
// LOCAL, stateless-compute endpoint — no volume, no WASM Manifold core, just the
// pure `graphToTf` walk + a wabt (wat2wasm) assembly. Env, if ever needed, via
// `$env/dynamic/private` (Rule 3) — none needed here.
//
// ISOLATION CONTRACT (mirrors /api/brep/preview + /api/primitives/compile): a bad
// GRAPH must never 500 — a malformed/empty body throws 400, but a graph that just
// won't lower returns 200 with graphToTf's own `notes` (surfaced via the header
// count). Only an internal assembler failure escapes as a 500.
export const POST = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }

  const { graph, params } = body ?? {};
  if (!graph || typeof graph !== 'object' || !graph.nodes || typeof graph.nodes !== 'object') {
    throw error(400, 'body.graph must be a composition Graph ({ nodes, root, ... })');
  }
  const paramVals =
    params && typeof params === 'object' ? (params as Record<string, number>) : {};

  const recipe = graphToTf(graph, paramVals);
  const wasm = await recipeToWasm(recipe);
  const jsonBytes = recipeToBytes(recipe).length;

  // Return a fresh, correctly-typed ArrayBuffer slice (avoid handing a view over
  // a possibly-shared buffer to the Response).
  const out = new Uint8Array(wasm.length);
  out.set(wasm);

  return new Response(out, {
    status: 200,
    headers: {
      'content-type': 'application/wasm',
      'content-length': String(out.length),
      'cache-control': 'no-store',
      'x-tf-recipe-ops': String(recipeOpCount(recipe)),
      'x-tf-recipe-bytes': String(out.length),
      'x-tf-json-bytes': String(jsonBytes),
      'x-tf-recipe-fmt': String(RECIPE_FMT),
      'x-tf-recipe-notes': String(recipe.notes.length),
    },
  });
};
