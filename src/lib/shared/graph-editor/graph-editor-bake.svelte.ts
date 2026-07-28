/**
 * graph-editor-bake.svelte.ts — the EXPECTED-PARAMS cache (drift detection) for
 * the graph editor (modularize K.65, Phase B). Re-exports the PURE parsers +
 * drift comparator from the sibling `graph-editor-bake.ts` so callers have one
 * import; the rune-bearing state lives here (a `.svelte.ts` so `$state` compiles).
 *
 * A Call node carries its OWN args; the underlying primitive's CURRENT
 * meta.params may have drifted (key added/removed). We cache each primitive's
 * params (keyed by `src`) so the editor can flag drift (⚠) + one-click refresh.
 *
 * `expected` is a MODULE-LEVEL `$state` singleton — intentionally shared across
 * every GraphEditorPane instance (/primitives mounts N tabs). The cache is
 * keyed by primitive `src` and is globally idempotent (r_revolve's params are
 * the same in every tab), so sharing is correct AND saves refetches. Mirrors
 * the `scene-state.svelte.ts` shared-singleton pattern.
 *
 * The graph-touching fns take it as an explicit arg (and `refreshCallArgs`
 * RETURNS the new graph) so this module stays free of any single pane's `graph`
 * $state — the caller does `graph = refreshCallArgs(graph, id)`.
 */
import { asLiteral, finalize, type Graph, type NodeId } from '$lib/graph/composition/composition-graph';
import { callDrift, publicParamKeys } from './graph-editor-bake';

export { extractGraphFromSource, extractDrawingMdFromSource, callDrift, publicParamKeys } from './graph-editor-bake';

export interface ExpectedParams {
  /** src → ordered meta.params keys. */
  params: Record<string, string[]>;
  /** src → ordered PUBLIC meta.params keys (the caller-facing INTERFACE subset —
   *  every key whose schema is NOT `public: false`; absent-`public` ⇒ public).
   *  Caller editors (Call args, parts_stack row popover, parts_table columns)
   *  read THIS instead of `params` so private internals stay hidden. A src that
   *  was ingested by an OLDER build (no publicParams entry) falls back to `params`
   *  at the read site → treated as all-public. */
  publicParams: Record<string, string[]>;
  /** src → key → default numeric value. */
  defaults: Record<string, Record<string, number>>;
  /** src → set of profile-typed arg keys (#119 chip). */
  profileKeys: Record<string, Set<string>>;
  /** src → which profile set its profile arg expects (revolve r,z vs cartesian x,y). */
  profileSet: Record<string, 'revolve' | 'cartesian'>;
  /** src → key → human tooltip (meta `desc` ?? `label`). Surfaced as the arg
   *  key button's title in NodeCard so an engine's bare arg keys (od, tpi, …)
   *  are self-explanatory on hover. */
  tips: Record<string, Record<string, string>>;
}

export const expected = $state<ExpectedParams>({
  params: {},
  publicParams: {},
  defaults: {},
  profileKeys: {},
  profileSet: {},
  tips: {},
});

// Attempted-once guard — without it a `src` that 404s (renamed/missing
// dependency) never lands in `expected.params`, so the reactive effect that
// drives loadExpectedParamsFor re-fires and re-fetches on every graph change →
// a tight loop that floods /api/primitives/source (hammered prod, 2026-06-13).
// Record the attempt FIRST so failures don't retry.
const attemptedParams = new Set<string>();

/** Populate the `expected` maps for `src` from a meta.params record. Shared by
 *  dropCall (which already fetched the source to build the new node's args) and
 *  loadExpectedParamsFor (lazy fetch). Idempotent + cheap. */
export function ingestMeta(src: string, params: Record<string, any> | undefined) {
  const p = params ?? {};
  const keys = Object.keys(p);
  const defaults: Record<string, number> = {};
  const profileKeys = new Set<string>();
  const tips: Record<string, string> = {};
  for (const [k, v] of Object.entries(p as Record<string, any>)) {
    defaults[k] = Number(v?.default ?? 0);
    if (v && typeof v === 'object' && v.type === 'profile') profileKeys.add(k);
    // Tooltip text for the bare arg key: prefer the authored one-line `desc`,
    // else the short `label`. Only stored when one exists so the key falls
    // back to its own name in NodeCard.
    const tip = (v && typeof v === 'object') ? (v.desc ?? v.label) : undefined;
    if (typeof tip === 'string' && tip.trim()) tips[k] = tip;
  }
  expected.params = { ...expected.params, [src]: keys };
  // PUBLIC/PRIVATE — the caller-facing interface subset (every key not marked
  // `public: false`; absent ⇒ public). Derived via the pure `publicParamKeys`.
  expected.publicParams = { ...expected.publicParams, [src]: publicParamKeys(p) };
  expected.defaults = { ...expected.defaults, [src]: defaults };
  expected.tips = { ...expected.tips, [src]: tips };
  // Infer the profile "set" from the primitive name: r_revolve → revolve (r,z);
  // r_extrude / r_weld_extrude → cartesian (x,y). Only when there ARE profile keys.
  if (profileKeys.size > 0) {
    expected.profileKeys = { ...expected.profileKeys, [src]: profileKeys };
    expected.profileSet = { ...expected.profileSet, [src]: src === 'r_revolve' ? 'revolve' : 'cartesian' };
  }
}

/** Lazy-load expected params for any Call whose src we haven't fetched yet
 *  (URL hydrate, paste-in, etc.). Idempotent — fetches each src once per
 *  session (attempted-once guard above). */
export async function loadExpectedParamsFor(src: string) {
  if (!src || expected.params[src] || attemptedParams.has(src)) return;
  attemptedParams.add(src);
  try {
    const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(src)}`);
    if (!r.ok) return;
    const d = await r.json() as any;
    ingestMeta(src, d.params ?? {});
  } catch { /* skip */ }
}

/** A Call is "drifted" when its args keys differ from the underlying
 *  primitive's CURRENT meta.params keys (uses the pure `callDrift`). */
export function isCallDrifted(graph: Graph, callId: NodeId): boolean {
  const node = graph.nodes[callId] as any;
  if (!node || node.type !== 'call') return false;
  return callDrift(node, expected.params[node.src]);
}

/** Sync a drifted Call's args back to the primitive's CURRENT params:
 *    • keep existing arg values for keys that survive
 *    • add new keys with the primitive's default values
 *    • drop orphan keys
 *  Wholesale args replacement (one transaction) + finalize() so graph.edges +
 *  imports rebuild (a raw node-spread left edges stale → phantom wires). Returns
 *  the new graph (caller assigns); no-op returns the same graph reference. */
export function refreshCallArgs(graph: Graph, callId: NodeId): Graph {
  const node = graph.nodes[callId] as any;
  if (!node || node.type !== 'call') return graph;
  const exp = expected.params[node.src];
  const defaults = expected.defaults[node.src] ?? {};
  if (!exp) return graph;
  const newArgs: Record<string, any> = {};
  for (const k of exp) {
    const existing = node.args?.[k];
    newArgs[k] = existing ?? asLiteral(defaults[k] ?? 0);
  }
  const updated = { ...node, args: { ...newArgs } };
  return finalize({ ...graph, nodes: { ...graph.nodes, [callId]: updated } });
}
