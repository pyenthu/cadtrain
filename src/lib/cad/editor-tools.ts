/**
 * editor-tools.ts — the PURE dispatcher for the graph editor's ✨ AI tools
 * (Phase 1). Mirrors SVTC's `ai/tools.js` (`dispatchToolCall`) but stays
 * Graph-in → Graph-out: no Svelte stores, no DOM, no fetch. That keeps it
 *   (a) unit-testable with a plain Graph (see editor-tools.test.ts), and
 *   (b) reusable by both the /api/rag/assist client loop AND a future
 *       offline/headless path.
 *
 * `dispatchEditorTool(name, args, graph, ctx?)`:
 *   • routes each tool name to the matching pure fn in composition-graph.ts,
 *   • resolves a node `alias` (A, B, …) → its NodeId before the call,
 *   • coerces the model's ArgValue input (and bare scalars) into a real
 *     ArgValue,
 *   • returns `{ graph: nextGraph, result }` on success or
 *     `{ graph: <unchanged>, error }` on a validation miss — so the model gets
 *     actionable feedback and the loop can recover.
 *
 * Read tools (`getEditorState`) return data via `result` and never mutate.
 */

import {
  type Graph,
  type NodeId,
  type ArgValue,
  type ParamSchema,
  type CallNode,
  type PolygonNode,
  asLiteral,
  addParam,
  setParamSchema,
  wireArg,
  setCallArg,
  addPolygonPoint,
  setPolygonCoord,
  addCall,
  removeNode,
} from './composition-graph';

/** Optional UI context the pure graph can't carry (selection + active tab). */
export type EditorContext = {
  selectedId?: NodeId | null;
  activeTab?: string | null;
  partId?: string | null;
};

export type DispatchResult = {
  graph: Graph;
  result?: unknown;
  error?: string;
};

// ─── helpers ────────────────────────────────────────────────────────────────

/** Resolve a node reference (a NodeId like "n_ab12cd" OR a Call alias like "A")
 *  to a concrete NodeId. Returns undefined when nothing matches. */
function resolveNodeId(graph: Graph, ref: unknown): NodeId | undefined {
  if (typeof ref !== 'string' || !ref) return undefined;
  if (graph.nodes[ref]) return ref;
  const lower = ref.trim().toLowerCase();
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.type === 'call' && node.alias && node.alias.toLowerCase() === lower) return id;
  }
  return undefined;
}

/** Coerce the model's input into an ArgValue. Accepts a proper union object
 *  ({kind:'literal'|'expr'|'param', …}) OR a bare scalar (→ literal). Returns
 *  an error STRING (not a value) when the shape is unusable, so callers can
 *  surface it to the model. */
function coerceArgValue(v: unknown): ArgValue | string {
  if (v == null) return 'value is required';
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
    return asLiteral(v);
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    switch (o.kind) {
      case 'literal':
        if (typeof o.value === 'number' || typeof o.value === 'string' || typeof o.value === 'boolean') {
          return { kind: 'literal', value: o.value };
        }
        return 'literal ArgValue needs a number/string/boolean `value`';
      case 'expr':
        if (typeof o.expr === 'string' && o.expr.trim()) return { kind: 'expr', expr: o.expr };
        return 'expr ArgValue needs a non-empty `expr` string';
      case 'param':
        if (typeof o.param === 'string' && o.param.trim()) return { kind: 'param', param: o.param };
        return 'param ArgValue needs a non-empty `param` name';
      default:
        return 'ArgValue must have kind "literal" | "expr" | "param" (or be a bare number/string/boolean)';
    }
  }
  return 'unrecognised value shape for an ArgValue';
}

/** Build a ParamSchema from flat tool args. `default` is required. */
function buildParamSchema(args: Record<string, unknown>): ParamSchema | string {
  const def = args.default;
  if (typeof def !== 'number' && typeof def !== 'string' && typeof def !== 'boolean') {
    return '`default` is required (number/string/boolean)';
  }
  const schema: ParamSchema = { default: def };
  if (typeof args.min === 'number') schema.min = args.min;
  if (typeof args.max === 'number') schema.max = args.max;
  if (typeof args.step === 'number') schema.step = args.step;
  if (typeof args.unit === 'string') schema.unit = args.unit;
  if (typeof args.label === 'string') schema.label = args.label;
  return schema;
}

/** Read-only snapshot of the editor for the model to orient against. Pure —
 *  `selectedId`/`activeTab`/`partId` come from the UI context (the graph alone
 *  doesn't know them). */
export function readEditorState(graph: Graph, ctx: EditorContext = {}) {
  const params = Object.entries(graph.params).map(([name, schema]) => ({ name, schema }));
  const nodes = Object.values(graph.nodes).map((n) => {
    const base: { id: NodeId; type: string; alias?: string; src?: string } = { id: n.id, type: n.type };
    if (n.type === 'call') {
      base.alias = n.alias;
      base.src = n.src;
    }
    return base;
  });
  return {
    partId: ctx.partId ?? null,
    root: graph.root,
    params,
    nodes,
    selectedId: ctx.selectedId ?? null,
    activeTab: ctx.activeTab ?? null,
  };
}

// ─── dispatcher ───────────────────────────────────────────────────────────────

/**
 * Run one tool call against a Graph. PURE: returns a NEW graph (or the same one
 * on a read/no-op/error). `ctx` supplies UI-only state (selection, active tab)
 * that the graph can't carry — optional so the 3-arg signature in the plan
 * still works.
 */
export function dispatchEditorTool(
  name: string,
  args: Record<string, unknown> | null | undefined,
  graph: Graph,
  ctx: EditorContext = {},
): DispatchResult {
  const a = args ?? {};
  try {
    switch (name) {
      // ── read ─────────────────────────────────────────────────────────────
      case 'getEditorState': {
        return { graph, result: readEditorState(graph, ctx) };
      }

      // ── params ───────────────────────────────────────────────────────────
      case 'addParam': {
        const pname = a.name;
        if (typeof pname !== 'string' || !pname.trim()) return { graph, error: '`name` is required' };
        const schema = buildParamSchema(a);
        if (typeof schema === 'string') return { graph, error: schema };
        const already = Object.prototype.hasOwnProperty.call(graph.params, pname);
        const next = addParam(graph, pname, schema);
        return { graph: next, result: { added: !already, param: pname, idempotent: already } };
      }

      case 'setParamSchema': {
        const pname = a.name;
        if (typeof pname !== 'string' || !pname.trim()) return { graph, error: '`name` is required' };
        if (!graph.params[pname]) return { graph, error: `no param named "${pname}" (add it with addParam first)` };
        const schema = buildParamSchema(a);
        if (typeof schema === 'string') return { graph, error: schema };
        const next = setParamSchema(graph, pname, schema);
        return { graph: next, result: { updated: pname } };
      }

      // ── wiring ───────────────────────────────────────────────────────────
      case 'wireArgToParam': {
        const nodeId = resolveNodeId(graph, a.node);
        if (!nodeId) return { graph, error: `node not found: ${String(a.node)}` };
        const node = graph.nodes[nodeId];
        if (!node || node.type !== 'call') return { graph, error: `node ${nodeId} is not a call` };
        const key = a.key;
        if (typeof key !== 'string' || !key.trim()) return { graph, error: '`key` is required' };
        const param = a.param;
        if (typeof param !== 'string' || !param.trim()) return { graph, error: '`param` is required' };
        const next = wireArg(graph, nodeId, key, param);
        const note = graph.params[param] ? undefined : `param "${param}" does not exist yet — add it with addParam`;
        return { graph: next, result: { node: nodeId, key, wiredTo: param, note } };
      }

      case 'setCallArg': {
        const nodeId = resolveNodeId(graph, a.node);
        if (!nodeId) return { graph, error: `node not found: ${String(a.node)}` };
        const node = graph.nodes[nodeId];
        if (!node || node.type !== 'call') return { graph, error: `node ${nodeId} is not a call` };
        const key = a.key;
        if (typeof key !== 'string' || !key.trim()) return { graph, error: '`key` is required' };
        const value = coerceArgValue(a.value);
        if (typeof value === 'string') return { graph, error: value };
        const next = setCallArg(graph, nodeId, key, value);
        return { graph: next, result: { node: nodeId, key, value } };
      }

      // ── polygon / points ───────────────────────────────────────────────────
      case 'addPolygonPoint': {
        const polyId = resolveNodeId(graph, a.polygon);
        if (!polyId) return { graph, error: `polygon not found: ${String(a.polygon)}` };
        const node = graph.nodes[polyId];
        if (!node || node.type !== 'polygon') return { graph, error: `node ${polyId} is not a polygon` };
        const afterIdx = typeof a.afterIdx === 'number' ? a.afterIdx : undefined;
        const next = addPolygonPoint(graph, polyId, afterIdx);
        const newCount = (next.nodes[polyId] as PolygonNode).points.length;
        return { graph: next, result: { polygon: polyId, points: newCount } };
      }

      case 'setPolygonCoord': {
        const polyId = resolveNodeId(graph, a.polygon);
        if (!polyId) return { graph, error: `polygon not found: ${String(a.polygon)}` };
        const node = graph.nodes[polyId] as PolygonNode | undefined;
        if (!node || node.type !== 'polygon') return { graph, error: `node ${polyId} is not a polygon` };
        const idx = a.idx;
        if (typeof idx !== 'number' || idx < 0 || idx >= node.points.length) {
          return { graph, error: `idx out of range (0..${node.points.length - 1})` };
        }
        if (a.axis !== 'r' && a.axis !== 'z') return { graph, error: '`axis` must be "r" or "z"' };
        const value = coerceArgValue(a.value);
        if (typeof value === 'string') return { graph, error: value };
        const next = setPolygonCoord(graph, polyId, idx, a.axis, value);
        return { graph: next, result: { polygon: polyId, idx, axis: a.axis, value } };
      }

      // ── structural (Phase 2) ────────────────────────────────────────────────
      case 'addCall': {
        const src = String(a.src ?? '').trim();
        if (!src) return { graph, error: '`src` (the part id to instance) is required' };
        const { graph: next, id } = addCall(graph, src);
        return { graph: next, result: { added: id, src, alias: (next.nodes[id] as CallNode)?.alias } };
      }

      case 'removeNode': {
        const nodeId = resolveNodeId(graph, a.node);
        if (!nodeId) return { graph, error: `node not found: ${String(a.node)}` };
        if (nodeId === graph.root) return { graph, error: 'the root node cannot be removed' };
        const next = removeNode(graph, nodeId);
        return { graph: next, result: { removed: nodeId } };
      }

      default:
        return { graph, error: `unknown tool: ${name}` };
    }
  } catch (e) {
    return { graph, error: e instanceof Error ? e.message : String(e) };
  }
}

// re-export the types a caller commonly wants alongside the dispatcher
export type { Graph, NodeId, CallNode };
