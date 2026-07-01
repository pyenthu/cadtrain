/**
 * wire-check.ts — structural wire-checking for the graph editor
 * (typed-expression-outputs, Phase B, item 2).
 *
 * The keystone of "the graph knows what can connect to what": given a wire being
 * dragged from an expr OUTPUT toward a consumer INPUT slot, decide whether the
 * connection is structurally legal and, when it isn't, return a PLAIN-LANGUAGE
 * reason ("this needs 3D points like [x, y, z], but the output is a list of 2D
 * points"). It never speaks type jargon.
 *
 * Two pure pieces:
 *   • `slotExpectedType(src, key)` — the consumer table. What STRUCTURE a given
 *     engine's call-arg slot expects (r_sweep.path → list<point3>,
 *     r_sweep.section → list<point2>, …). Plus `POLYGON_POINTS` for the polygon
 *     points / expr-list-ref slot.
 *   • `inferGraphOutputStruct(graph, nodeId, out)` — resolve an expr instance's
 *     def-output formula and infer its structure (shared with the live badge).
 *
 * The compatibility verdict + reason come from `struct-type.checkFeed`; this
 * module only LOCATES the two structures to compare. Conservative throughout:
 * an unknown structure / un-modelled slot is NOT blocked (Phase B item 3).
 */
import {
  checkFeed,
  inferStructure,
  listOfPoints,
  type FeedCheck,
  type StructType,
} from './struct-type';
import { isImperative } from './expr-imperative';
import type { Graph, NodeId, ExprNode } from './composition-graph-types';

// ── consumer slot table ───────────────────────────────────────────────────────

/** The polygon `points` slot (and `r_sweep.section`) — a list of 2D [x, y]
 *  points. */
export const POLYGON_POINTS: StructType = listOfPoints(2);

/**
 * What STRUCTURE does call `src`'s arg `key` expect? Returns null for args we
 * don't model — the caller treats null as "allow" (don't over-block). Keyed by
 * the engine's volume id + the meta.params key.
 *
 * Currently modelled (the Phase-B target slots):
 *   • r_sweep.path    → list<point3>  (the 3D spine)
 *   • r_sweep.section → list<point2>  (the 2D cross-section)
 */
export function slotExpectedType(src: string, key: string): StructType | null {
  if (src === 'r_sweep') {
    if (key === 'path') return listOfPoints(3);
    if (key === 'section') return listOfPoints(2);
  }
  return null;
}

// ── infer an expr instance's output structure ─────────────────────────────────

/**
 * Resolve an expr INSTANCE node's def-output and infer the STRUCTURE its formula
 * produces. Returns null when it can't be determined (no def / no output / empty
 * formula) — callers treat null as "unknown ⇒ allow".
 *
 * An IMPERATIVE formula (the visual loop builder) always materialises a flat
 * point list, so it types as a generic `list<point>` (any arity). Otherwise the
 * structure comes straight from `inferStructure`. When inference yields nothing
 * but the output is explicitly annotated `shape:'list'`, fall back to a generic
 * point list so an annotated-but-unparsed output still reads as a list.
 */
export function inferGraphOutputStruct(
  graph: Graph,
  nodeId: NodeId,
  outName: string,
): StructType | null {
  const node = graph.nodes[nodeId] as ExprNode | undefined;
  if (!node || node.type !== 'expr') return null;
  const def = (graph.exprDefs ?? []).find((d) => d.id === node.defId);
  const out = def?.outputs?.find((o) => o.name === outName);
  if (!out) return null;

  if (isImperative(out.formula)) return listOfPoints();          // loop builder → point list
  const inferred = inferStructure(out.formula).type;
  if (inferred) return inferred;
  if (out.shape === 'list') return listOfPoints();               // annotated list, unparsed
  return null;
}

// ── the verdict ───────────────────────────────────────────────────────────────

/**
 * Can the expr output `(nodeId, outName)` feed a slot that expects `expect`?
 * Locates the source structure, then defers to `checkFeed` for the verdict +
 * plain-language reason. `expect == null` (un-modelled slot) ⇒ always allowed.
 */
export function checkOutputFeeds(
  graph: Graph,
  nodeId: NodeId,
  outName: string,
  expect: StructType | null,
): FeedCheck {
  if (!expect) return { ok: true, reason: null };
  const src = inferGraphOutputStruct(graph, nodeId, outName);
  return checkFeed(src, expect);
}
