/**
 * port-suggest.ts — the GENERATIVE hook of the typed-ports system (#13, PR5).
 *
 * The payoff the plan (docs/plans/typed-ports.md, "Generative capability") flags:
 * once every socket is typed, the graph is *machine-reasonable*. This module
 * enumerates the typed OUTPUTS + the open INPUT slots across a graph and returns
 * the type-compatible (output → open-slot) pairs — the substrate an auto-wire /
 * ✨ AI UI consumes later. "A list<point> output + a polygon with an empty points
 * slot is a mechanical match."
 *
 * PURE + DOM-free: importable by the editor AND emit. Compatibility is REUSED
 * wholesale from the registry (`canWire` → `canFeed`); this module never
 * re-implements type rules, it only ENUMERATES candidates and filters by them.
 *
 * Coverage (be honest — see the per-function notes):
 *   OUTPUTS  — expr-instance def outputs (scalar / list<elem>)  ✅ end-to-end
 *            — call / method geometry outputs ('geometry')      ✅ enumerated
 *   SLOTS    — polygon `points` accepts list<point>             ✅ end-to-end
 *            — call-arg scalar slots, method geometry slots      ⏸ DEFERRED (noted)
 * So the ONLY pair that currently yields suggestions is expr-list → polygon. The
 * geometry outputs are enumerated for completeness but have no open slot to match
 * yet, so they produce nothing — that's intentional, not a silent gap.
 */

import { canWire, listOf, portType } from '$lib/graph/port/port-types';
import type {
  Graph,
  ExprOut,
  ExprNode,
  PolygonNode,
  PolygonExprListRef,
} from '$lib/graph/composition/composition-graph-types';

// ── 1. expr output → registry PortType id ─────────────────────────────────────

/**
 * Map an expr DEF output to a registry PortType id.
 *   • `shape:'list'` → `list<${elem}>` (e.g. `list<point>` = PT_LIST_POINT),
 *     registering the derived list type on demand via `listOf` (idempotent;
 *     a no-op when the element type isn't registered — the id string is still
 *     returned so callers can reason about it, and `canWire` will simply reject
 *     an unregistered id).
 *   • else → the elem (`'scalar'` default). A plain scalar output has no `elem`,
 *     so it maps to `'scalar'`.
 */
export function portTypeOfExprOutput(out: ExprOut): string {
  if (out.shape === 'list') {
    const elem = out.elem ?? 'scalar';
    const id = `list<${elem}>`;
    // Register the derived list type if its element type is known and the list
    // isn't already in the registry (list<point> already exists as PT_LIST_POINT).
    if (!portType(id)) listOf(elem);
    return id;
  }
  return out.elem ?? 'scalar';
}

// ── 2. enumerate typed OUTPUTS ────────────────────────────────────────────────

/** A wireable typed output port discovered in a graph. */
export interface GraphOutput {
  nodeId: string;
  /** The output's NAME (an expr def output name; 'out' for a geometry node). */
  output: string;
  /** Its registry PortType id (the wire-compat key). */
  typeId: string;
}

/**
 * Enumerate every wireable typed OUTPUT in the graph.
 *
 * Concrete, real cases covered:
 *   • every expr INSTANCE node's DEF outputs — each → a typeId via
 *     `portTypeOfExprOutput`. (Resolve the def by `node.defId`.)
 *   • every geometry-producing node (call / method) → a single `'geometry'`
 *     output named `'out'`. Cheap + honest; included so the output side is
 *     complete. (These have no matching open slot yet — see `openInputSlots`.)
 *
 * Deferred: container / repeat / txfmn geometry outputs (also geometry, but
 * redundant with the call/method coverage for matching purposes today).
 */
export function graphOutputs(graph: Graph): GraphOutput[] {
  const outs: GraphOutput[] = [];
  const defs = graph.exprDefs ?? [];
  for (const node of Object.values(graph.nodes)) {
    if (node.type === 'expr') {
      const inst = node as ExprNode;
      const def = defs.find((d) => d.id === inst.defId);
      if (!def) continue; // dangling instance — no def, no outputs
      for (const out of def.outputs) {
        outs.push({ nodeId: inst.id, output: out.name, typeId: portTypeOfExprOutput(out) });
      }
    } else if (node.type === 'call' || node.type === 'method') {
      // Geometry producers — a single baked-solid output. Enumerated for
      // completeness; geometry INPUT slots are deferred so these match nothing yet.
      outs.push({ nodeId: node.id, output: 'out', typeId: 'geometry' });
    }
  }
  return outs;
}

// ── 3. enumerate open INPUT slots ─────────────────────────────────────────────

/** An input slot that can accept a typed output. */
export interface OpenInputSlot {
  nodeId: string;
  /** Slot label (e.g. 'points' for a polygon's vertex list). */
  slot: string;
  /** The registry PortType id this slot accepts. */
  acceptsTypeId: string;
}

/**
 * Enumerate INPUT slots that can accept a typed output.
 *
 * Concrete, real case covered:
 *   • a `polygon` node accepts a `list<point>` into its `points` slot (an
 *     `expr-list-ref` entry). The slot stays "open" even when it already holds
 *     entries — points interleave — so we always list it; `autoWireSuggestions`
 *     skips a source/output that's ALREADY wired into it (no dup).
 *
 * DEFERRED (noted, not silently covered):
 *   • Call args that accept `scalar` — would need each call's param-name → port
 *     type, which isn't on the graph yet (args carry ArgValue, not a port type).
 *   • Method `obj`/`arg` geometry slots, container children, repeat children —
 *     geometry consumers; enumerable once geometry slots get port types.
 *   • Sketch ops accepting `list<op>`, repeat accepting `list<transform>` — the
 *     other list-element consumers, not yet wired through the registry.
 */
export function openInputSlots(graph: Graph): OpenInputSlot[] {
  const slots: OpenInputSlot[] = [];
  for (const node of Object.values(graph.nodes)) {
    if (node.type === 'polygon') {
      slots.push({ nodeId: node.id, slot: 'points', acceptsTypeId: 'list<point>' });
    }
  }
  return slots;
}

// ── 4. the generative hook ────────────────────────────────────────────────────

/** A type-compatible (output → open-slot) wiring candidate. */
export interface Suggestion {
  sourceId: string;
  output: string;
  targetId: string;
  slot: string;
  /** The output's PortType id (passed `canWire` against the slot's accept type). */
  typeId: string;
}

/**
 * Is `(sourceId, output) → (targetId, slot)` ALREADY wired in the graph? Skips
 * the only wired slot kind that exists today: a polygon `points` slot holding an
 * `expr-list-ref` from that exact source + output. (Extend this per slot kind as
 * new typed consumers land — it's the dedup gate, kept beside the slot list.)
 */
function isAlreadyWired(graph: Graph, s: { sourceId: string; output: string; targetId: string; slot: string }): boolean {
  const target = graph.nodes[s.targetId];
  if (!target) return false;
  if (target.type === 'polygon' && s.slot === 'points') {
    const poly = target as PolygonNode;
    return poly.points.some(
      (e) =>
        e.kind === 'expr-list-ref' &&
        (e as PolygonExprListRef).sourceId === s.sourceId &&
        (e as PolygonExprListRef).output === s.output,
    );
  }
  return false;
}

/**
 * The machine-reasonable "what could wire to what" list: the cross-product of
 * typed OUTPUTS × open INPUT slots, filtered by registry compatibility
 * (`canWire(outputTypeId, slotAcceptsTypeId)`) and de-duped against pairs that
 * are ALREADY wired. This is the substrate for an auto-wire / ✨ AI UI.
 *
 * Today the only yielding pair is a `list<point>` expr output → a polygon's
 * `points` slot (geometry outputs are enumerated but have no open slot yet).
 */
export function autoWireSuggestions(graph: Graph): Suggestion[] {
  const outputs = graphOutputs(graph);
  const slots = openInputSlots(graph);
  const suggestions: Suggestion[] = [];
  for (const out of outputs) {
    for (const slot of slots) {
      if (out.nodeId === slot.nodeId) continue;             // no self-wiring
      if (!canWire(out.typeId, slot.acceptsTypeId)) continue;
      if (isAlreadyWired(graph, { sourceId: out.nodeId, output: out.output, targetId: slot.nodeId, slot: slot.slot }))
        continue;
      suggestions.push({
        sourceId: out.nodeId,
        output: out.output,
        targetId: slot.nodeId,
        slot: slot.slot,
        typeId: out.typeId,
      });
    }
  }
  return suggestions;
}
