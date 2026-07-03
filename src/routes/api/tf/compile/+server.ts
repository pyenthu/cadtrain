import { json, error } from '@sveltejs/kit';
import { graphToTf, tfRecipeText, isEngineSrc, type TfRecipe, type ResolveComposite } from '$lib/cad/graph-to-tf';
import { extractMetaFromSource } from '$lib/server/primitives-meta';

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
 * COMPOSITE INLINING: a Call to another volume part (not an engine) is resolved
 * by recursively fetching that part's source (the same `/api/primitives/source`
 * the Manifold `/compile` endpoint uses) + parsing its `meta.graph`, so the recipe
 * comes back FULLY INLINED — `s_tube_demo` (→ `sweep_tube_demo` → `r_sweep`) lowers
 * to native `sweep`/`booleanDifference` instrs instead of UNSUPPORTED. All deps are
 * pre-fetched (async) into a map so the pure, synchronous `graphToTf` can resolve
 * them without awaiting.
 *
 * Body: { graph: CompositionGraph, params?: Record<string, number>, id?: string }
 * Reply: { ok, recipe: TfRecipe, text: string, ops: number, notes }
 */

const NAME_RE = /^[a-z_][a-z0-9_]*$/i;

/** Numeric defaults from a meta.params schema — a fallback param scope for a
 *  resolved composite (graphToTf also reads the sub-graph's own `graph.params`). */
function numericDefaults(params: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    const d = (v as any)?.default;
    if (Number.isFinite(Number(d))) out[k] = Number(d);
  }
  return out;
}

/** Composite Call `src`s referenced directly in a graph (Call nodes whose src is
 *  NOT an engine — those are the sub-parts to fetch + inline). */
function compositeSrcsOf(graph: any): string[] {
  const out: string[] = [];
  for (const n of Object.values(graph?.nodes ?? {})) {
    const node = n as any;
    if (node?.type === 'call' && typeof node.src === 'string' && !isEngineSrc(node.src)) out.push(node.src);
  }
  return out;
}

/** Recursively fetch every composite dep reachable from `rootGraph` → a sync map
 *  `id → { graph, params }`. BFS over Call srcs; each fetched part's OWN composite
 *  Calls are queued too. Fully tolerant — a missing / unparseable dep is skipped
 *  (that Call then stays UNSUPPORTED). */
async function buildCompositeMap(
  rootGraph: any,
  fetch: typeof globalThis.fetch,
): Promise<Map<string, { graph: any; params: Record<string, number> }>> {
  const map = new Map<string, { graph: any; params: Record<string, number> }>();
  const seen = new Set<string>();
  const pending = compositeSrcsOf(rootGraph);
  let guard = 0;
  while (pending.length && guard++ < 500) {
    const id = pending.pop()!;
    if (seen.has(id) || !NAME_RE.test(id)) continue;
    seen.add(id);
    try {
      const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!r.ok) continue;
      const data = await r.json();
      const src = typeof data?.source === 'string' ? data.source : '';
      if (!src) continue;
      const meta = extractMetaFromSource(src);
      if (!meta?.graph) continue;
      map.set(id, { graph: meta.graph, params: numericDefaults(meta.params) });
      for (const s of compositeSrcsOf(meta.graph)) if (!seen.has(s)) pending.push(s);
    } catch {
      /* skip — the Call stays UNSUPPORTED */
    }
  }
  return map;
}

export async function POST({ request, fetch }) {
  let body: { graph?: unknown; params?: Record<string, number>; id?: string };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }
  if (!body?.graph || typeof body.graph !== 'object') {
    throw error(400, 'missing "graph"');
  }

  // Pre-fetch composite deps so the pure, synchronous compiler can inline them.
  let resolveComposite: ResolveComposite | undefined;
  try {
    const compositeMap = await buildCompositeMap(body.graph, fetch);
    resolveComposite = (id: string) => compositeMap.get(id) ?? null;
  } catch {
    resolveComposite = undefined; // degrade — composites stay UNSUPPORTED
  }

  let recipe: TfRecipe;
  try {
    recipe = graphToTf(body.graph as any, body.params ?? {}, resolveComposite);
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
