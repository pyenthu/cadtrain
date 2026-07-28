/**
 * composition-graph.ts — graph as the source of truth for assemblies.
 *
 * Per docs/plans/composition-architecture.md (signed off 2026-06-06).
 *
 * The composition graph replaces composition-tree.ts (which round-tripped
 * through source text on every edit). This file is pure data + pure
 * functions: every mutation returns a new graph (immutable shape so the
 * editor can use Svelte 5 $state with shallow reactivity).
 *
 * Companion: composition-emit.ts (graph → meta + body). The reverse
 * direction (parse body → graph) does NOT exist by design — edits go to
 * the graph, the body is regenerated.
 *
 * Companion: composition-bake.ts (graph → Manifold) — Phase B; not yet.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * BARREL. This module was split (plan modularize.md P4) into three files —
 * importers keep using `$lib/graph/composition-graph` unchanged:
 *   • composition-graph-types.ts   — leaf: types + value constructors
 *   • composition-graph-hydrate.ts — newGraph / setViewport / hydrateGraph
 *   • composition-graph-mutate.ts  — mutators + queries + topoOrder
 */

export * from '$lib/graph/composition/composition-graph-types';
export * from '$lib/graph/composition/composition-graph-hydrate';
export * from '$lib/graph/composition/composition-graph-mutate';
