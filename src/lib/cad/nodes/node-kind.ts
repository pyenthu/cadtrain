/**
 * node-kind.ts — the NodeKind descriptor interface (the "abstract base class" of
 * the composition-graph node model) + the shared helpers its descriptors call.
 *
 * Phase 0 of docs/plans/hierarchical-class-design.md: instead of ~7 hand-written
 * `switch (node.type)` sites scattered across emit/validate/consumed-set/layout,
 * each node type gets ONE stateless descriptor that owns its behaviour. This
 * module is PURE TS — no Svelte, no `$state`, no worker-hostile imports — so
 * both the CAD kernel and the editor (`geom.ts`) can import `kindOf` freely.
 *
 * Phase 0 registers only the 3 leaf kinds (method/txfmn/material) and routes
 * `validate` + `nodeSize` through them; every other path keeps its legacy switch
 * (the registry returns `undefined` for unregistered types, so callers fall
 * through). Emit is NOT rerouted in Phase 0 — descriptors carry `emitExpr` for
 * their unit tests + as the verbatim source Phase 1 will wire in.
 */
import type { Graph, GraphNode, NodeId, ArgValue } from '../composition-graph-types';

/** Emit context threaded through every node's emitExpr — replaces the closure
 *  vars (`ref`, `emitValueExpr`, `varNames`, `listProducers`, `nodes`) currently
 *  captured inside emitNodeExpr (composition-emit.ts). */
export interface EmitCtx {
  ref(id: NodeId, slot: string): string;   // var name or missingRef sentinel
  emitValue(v: ArgValue): string;          // ArgValue → JS expr (was emitValueExpr)
  /** src + args → the call expression (was emitCallExpr in composition-emit).
   *  Provided by makeEmitCtx so the CallKind descriptor stays in the cad layer
   *  without importing emit internals (which would cycle). */
  emitCall(src: string, args: Record<string, ArgValue>): string;
  varNames: ReadonlyMap<NodeId, string>;
  listProducers: ReadonlySet<NodeId>;
  nodes: Readonly<Record<NodeId, GraphNode>>;
}

/** Structurally identical to composition-emit.ts's GraphValidationError so
 *  descriptor output splices straight into validateGraph's `errs` array. */
export interface ValidationError {
  nodeId: NodeId;
  slot: string;
  badRef: string;
  kind: 'missing-node' | 'missing-param';
}

/** Width policy stays centralised in geom.ts's nodeSize wrapper (savedW override
 *  → cardAutoWidth → cardMinWidth clamp); descriptors receive the resolved
 *  content width + the root id and return the final {w,h}. Kinds with a FIXED
 *  width (method/material) ignore `ctx.width`. Keeping `size` a pure function of
 *  (node, ctx) — no `graph` handle, no Svelte import — makes it worker-safe. */
export interface SizeCtx { width: number; root: NodeId; }

/** The editor-facing socket schema (input slots + output arity) — lets
 *  NodeCard.svelte eventually render generically instead of a {#if} arm. */
export interface SocketSchema { inputs: string[]; output: boolean | 'material'; }

/** One entry per node.type. Stateless — the node DATA is the first arg. This is
 *  the "abstract base class": every variant implements it. */
export interface NodeKind<N extends GraphNode = GraphNode> {
  readonly type: N['type'];
  /** N copies of the hand-written switch arms, now co-located per kind. */
  emitExpr(node: N, ctx: EmitCtx): string | null;      // was emitNodeExpr case
  validate(node: N, graph: Graph): ValidationError[];  // was validateGraph case
  /** NodeIds this node consumes as inputs (drives computeConsumedSet + the
   *  Output-root filter + delete-button greying). */
  inputRefs(node: N): NodeId[];
  /** Canvas footprint for auto-layout (was geom.ts nodeSize). Returns the SAME
   *  {w,h} the current if-chain does — verified byte-for-byte per kind. */
  size(node: N, ctx: SizeCtx): { w: number; h: number };
  /** Optional one-way hydrate migration for legacy files of this kind. */
  migrate?(raw: any): N | null;
  /** Editor socket schema (input slots + output arity). */
  sockets(node: N): SocketSchema;
}

// ── shared helpers (lifted verbatim out of validateGraph's / emit's closures so
//    the descriptors are self-contained) ──────────────────────────────────────

/** was validateGraph's `has` (composition-emit.ts:109). */
export const has = (g: Graph, id: NodeId): boolean =>
  Object.prototype.hasOwnProperty.call(g.nodes, id);

/** ValidationError literal builder. */
export const err = (
  nodeId: NodeId, slot: string, badRef: string, kind: ValidationError['kind'],
): ValidationError => ({ nodeId, slot, badRef, kind });

/** Single-value missing-param check — validateGraph's `checkArg`
 *  (composition-emit.ts:111) for a slot that is ONE ArgValue (call args use
 *  `args.<key>`, no index). */
export const checkArg = (nodeId: NodeId, slot: string, v: ArgValue, g: Graph): ValidationError[] =>
  v.kind === 'param' && !Object.prototype.hasOwnProperty.call(g.params, v.param)
    ? [err(nodeId, slot, v.param, 'missing-param')] : [];

/** Per-array missing-param check — was validateGraph's `checkArg`
 *  (composition-emit.ts:111) applied over a triple via `.forEach((v,i) => …)`.
 *  Produces the SAME `slot[i]` naming. */
export const checkArgs = (
  nodeId: NodeId, slot: string, vs: readonly ArgValue[], g: Graph,
): ValidationError[] =>
  vs.flatMap((v, i) =>
    v.kind === 'param' && !Object.prototype.hasOwnProperty.call(g.params, v.param)
      ? [err(nodeId, `${slot}[${i}]`, v.param, 'missing-param')]
      : []);

/** the emit-side helper (composition-emit.ts:979) — replicated (it is not
 *  exported) so the txfmn descriptor's identity-elision is self-contained. */
export const isLiteralZero = (v: ArgValue): boolean =>
  v.kind === 'literal' && Number(v.value) === 0;
