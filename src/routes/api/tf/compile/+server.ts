import { json, error } from '@sveltejs/kit';
import { graphToTf, tfRecipeText, isEngineSrc, type TfRecipe, type ResolveComposite } from '$lib/engines/trueform/graph-to-tf';
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

type DepEntry = { graph: any; params: Record<string, number> } | null;

/** #1 — module-level composite-dep SOURCE cache (id → resolved graph/params).
 *  A dep's SOURCE is invariant to the top-level part's param values (only the
 *  numbers you scrub change; the sub-part's graph doesn't), yet /api/tf/compile
 *  re-fetched every dep on EVERY edit — and each fetch is prod-proxied
 *  (`/api/primitives/source` ∈ VOLUME_PROXY_PATHS), so a spline drag paid one
 *  network round-trip per dep every tick (the ~302 ms "compile" for bw_open_hole).
 *  Caching by id makes a repeat resolve ~0. TTL bounds staleness after a dep is
 *  edited+saved; a 🔄 `bust` bypasses the cache read for an immediate fresh resolve.
 *  NEGATIVE entries (null) are cached too so a missing/broken dep isn't re-fetched
 *  every tick. Keyed by id only (source is the same regardless of caller).
 *  #1 (this) kills the hot repeat-resolve cost; #2 (the level-parallel BFS in
 *  buildCompositeMap below) is the cold-start win. Both shipped. */
const SRC_CACHE = new Map<string, { entry: DepEntry; at: number }>();
const SRC_TTL_MS = 60_000; // 60s — dep edits show within a minute (or instantly via 🔄 bust)

/** A dep fetch failed for a reason that says nothing about the dep itself: the
 *  upstream volume was down (5xx), rate-limited (429), or the socket died. In dev
 *  `/api/primitives/source` proxies to the Railway origin, which returns 502 for
 *  the ~30s of every redeploy — so this is routine, not exceptional. */
function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

/** Fetch + parse ONE composite dep's source, honouring the module cache.
 *
 *  NEVER negative-cache a TRANSIENT failure. A cached `null` means "this Call has
 *  no composite to inline", so a single 502 during a Railway redeploy used to
 *  pin `bw_casing` as UNSUPPORTED for the full 60s TTL — the TF tab then reported
 *  "TrueForm has no native builder for: call:bw_casing" long after prod was
 *  healthy again, and a 🔄 was the only way out. A definitive 404 or unparseable
 *  meta IS cached (that answer is stable and worth not re-asking). */
async function fetchDep(id: string, fetch: typeof globalThis.fetch, bust: boolean): Promise<DepEntry> {
  if (!bust) {
    const hit = SRC_CACHE.get(id);
    if (hit && Date.now() - hit.at < SRC_TTL_MS) return hit.entry; // fresh (incl. cached null)
  }
  let entry: DepEntry = null;
  let transient = false;
  try {
    const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (r.ok) {
      const data = await r.json();
      const src = typeof data?.source === 'string' ? data.source : '';
      const meta = src ? extractMetaFromSource(src) : null;
      if (meta?.graph) entry = { graph: meta.graph, params: numericDefaults(meta.params) };
    } else {
      transient = isTransientStatus(r.status);
    }
  } catch {
    transient = true; // network / socket error — the dep is not at fault
  }
  // Skip the cache write entirely on a transient failure so the NEXT compile
  // re-asks. Returning null still leaves this one Call unsupported for this run.
  if (!transient) SRC_CACHE.set(id, { entry, at: Date.now() });
  return entry;
}

/** Max concurrent dep fetches per BFS level. Each is a prod-proxied round-trip;
 *  a wide fan-out (a well: 8 `bw_*` at level 0) should overlap, but not open an
 *  unbounded number of sockets against the Railway origin. */
const DEP_CONCURRENCY = 8;

/** Total dep fetches per compile — the old `guard` on the serial while-loop,
 *  kept so a pathological graph can't fan out forever. */
const MAX_DEPS = 500;

/** Recursively fetch every composite dep reachable from `rootGraph` → a sync map
 *  `id → { graph, params }`. BFS over Call srcs; each fetched part's OWN composite
 *  Calls are queued too. Fully tolerant — a missing / unparseable dep is skipped
 *  (that Call then stays UNSUPPORTED). Reads through SRC_CACHE (#1); `bust` forces
 *  a fresh fetch for every dep.
 *
 *  #2 — LEVEL-PARALLEL (was serial, one `await fetchDep` per dep). Deps within a
 *  level are independent, so they fetch together; only DEPTH is sequential, since
 *  a part's own composite Calls aren't known until its source lands. A cold well
 *  (8 `bw_*` deps, each ~0.5s prod-proxied) cost ~5s serially and now costs about
 *  one round-trip. Order-independent: `map` is keyed by id and `seen` is claimed
 *  BEFORE the await, so a dep reachable from two parents is still fetched once. */
async function buildCompositeMap(
  rootGraph: any,
  fetch: typeof globalThis.fetch,
  bust = false,
): Promise<Map<string, { graph: any; params: Record<string, number> }>> {
  const map = new Map<string, { graph: any; params: Record<string, number> }>();
  const seen = new Set<string>();
  let level = compositeSrcsOf(rootGraph).filter((id) => NAME_RE.test(id));
  let fetched = 0;

  while (level.length && fetched < MAX_DEPS) {
    // Claim the whole level up front so a dep shared by two parents in the SAME
    // level is not fetched twice by the two concurrent branches below.
    const todo = level.filter((id) => !seen.has(id));
    todo.forEach((id) => seen.add(id));
    if (!todo.length) break;

    const next: string[] = [];
    for (let i = 0; i < todo.length; i += DEP_CONCURRENCY) {
      const slice = todo.slice(i, i + DEP_CONCURRENCY);
      fetched += slice.length;
      const entries = await Promise.all(slice.map((id) => fetchDep(id, fetch, bust)));
      slice.forEach((id, k) => {
        const entry = entries[k];
        if (!entry) return; // missing / unparseable → Call stays UNSUPPORTED
        map.set(id, entry);
        for (const s of compositeSrcsOf(entry.graph)) {
          if (!seen.has(s) && NAME_RE.test(s)) next.push(s);
        }
      });
      if (fetched >= MAX_DEPS) break;
    }
    level = next;
  }
  return map;
}

export async function POST({ request, fetch }) {
  let body: { graph?: unknown; params?: Record<string, number>; id?: string; bust?: boolean };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }
  if (!body?.graph || typeof body.graph !== 'object') {
    throw error(400, 'missing "graph"');
  }

  // Pre-fetch composite deps so the pure, synchronous compiler can inline them.
  // `bust` (from a 🔄 rebake) bypasses the dep SOURCE cache for a fresh resolve.
  let resolveComposite: ResolveComposite | undefined;
  try {
    const compositeMap = await buildCompositeMap(body.graph, fetch, body.bust === true);
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
