/**
 * primitive-recipe — the PRIMITIVE composition layer (parallel store).
 *
 * A primitive composite is a `recipe.json` (same shape as a library
 * PartRecipe) whose `call:` targets are VOLUME PRIMITIVES (r_revolve,
 * r_extrude, r_cylinder, …) plus the recipe operators (mv/rot). It reuses
 * the library recipe ENGINE wholesale — `buildRecipe` + `evalExpr` from
 * part-recipe.ts — and only swaps the dependency resolver
 * (`createPrimitiveResolveDep`). No forked interpreter.
 *
 * Why this exists (see the dual-control design): primitives offer BOTH
 * source control (a leaf is authored as source.ts in the sandbox + weld
 * toolkit) AND json control (a composite is a declarative recipe). The
 * leaf = code, the composite = recipe. This module is the composite half.
 *
 * The interpreter's resolveDep is synchronous, but building a volume
 * primitive's geom fn is async (it reads the source + its `meta.uses`
 * deps off the volume). So we PRE-RESOLVE every distinct primitive call
 * into a sync-lookup map first, then hand that to buildRecipe.
 */
import { buildRecipe, createPrimitiveResolveDep, type PartRecipe } from './part-recipe';
import { buildPrimitiveGeom } from './primitive-loader';
import { extractMetaFromSource } from './primitives-meta';

const OPERATORS = new Set(['mv', 'rot']);

/** Read a primitive's source.ts off the volume — flat location first,
 *  then the tests/ sub-category (location = category). */
async function readPrimitiveSource(name: string, fetchFn: typeof fetch): Promise<string> {
  for (const rel of [`primitives/${name}/source.ts`, `primitives/tests/${name}/source.ts`]) {
    const r = await fetchFn(`/api/volume?path=${encodeURIComponent(rel)}`, { cache: 'no-store' });
    if (r.ok) return r.text();
  }
  throw new Error(`primitive "${name}" not found on the volume`);
}

/**
 * Build a primitive composite recipe to a single Manifold.
 *
 * @param recipe   the recipe.json (meta.params + instances[] + composition[])
 * @param params   resolved param bag (caller merges defaults + overrides)
 * @param fetchFn  SvelteKit event.fetch (proxy-aware /api/volume reads)
 */
export async function buildPrimitiveRecipe(
  recipe: PartRecipe,
  params: Record<string, number>,
  fetchFn: typeof fetch,
): Promise<any> {
  // Distinct primitive call names (operators resolve from the runtime).
  const callNames = new Set<string>();
  for (const inst of recipe.instances) {
    if (!OPERATORS.has(inst.call)) callNames.add(inst.call);
  }

  // Pre-resolve each primitive: source → meta param order + built geom fn.
  const primMap = new Map<string, { propNames: string[]; fn: (...a: any[]) => any }>();
  for (const name of callNames) {
    const src = await readPrimitiveSource(name, fetchFn);
    const meta = extractMetaFromSource(src);
    const propNames = Object.keys(meta.params ?? {});
    const fn = await buildPrimitiveGeom(src, name, fetchFn);
    primMap.set(name, { propNames, fn });
  }

  return buildRecipe(recipe, params, createPrimitiveResolveDep(primMap));
}
