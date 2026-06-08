/**
 * composition-emit.ts — graph → { meta, body }.
 *
 * Per docs/plans/composition-architecture.md. Deterministic; one direction
 * only. The reverse (body → graph) does not exist by design — the editor
 * mutates the graph directly, this module regenerates the `.asm.ts` text
 * for human-readable git diff + grep.
 *
 * Companion: composition-graph.ts (the data layer).
 *
 * The emitted file looks like:
 *
 *   export const meta = {
 *     id: 'dt_mule_compose',
 *     kind: 'asm',
 *     uses: ['dt_mule_shoe'],
 *     params: { … },
 *     graph: { … FULL JSON LITERAL … },
 *   };
 *
 *   // AUTO-GENERATED from meta.graph by composition-emit.ts. Do not hand-edit.
 *   export function dt_mule_compose() {
 *     const A = dt_mule_shoe({ pipeOD: 3.56, … });
 *     const B = dt_mule_shoe({ pipeOD: 4.5,  … });
 *     return [A, B];
 *   }
 */

import {
  type Graph,
  type GraphNode,
  type ArgValue,
  type NodeId,
  topoOrder,
} from './composition-graph';

export interface EmitOptions {
  /** The assembly id (becomes meta.id + the export function name). */
  id: string;
  /** Optional description for meta.description. */
  description?: string;
}

export interface EmitResult {
  /** The full `.asm.ts` file content — meta block + body. */
  source: string;
  /** Just the meta object (for callers that want to splice into an existing file). */
  meta: Record<string, unknown>;
  /** Just the function body (everything between `{` and `}`). */
  body: string;
  /** The variable bound at root, used by the function's `return` statement. */
  rootVar: string;
}

/** Top-level entry — graph + id → file content. */
export function emitGraph(graph: Graph, opts: EmitOptions): EmitResult {
  // Walk nodes in topological order; each non-leaf emits a `const <var> = ...` line.
  const order = topoOrder(graph);
  const varNames = assignVarNames(graph, order);

  // OUTPUT FILTERING: a node referenced as input to ANOTHER node (method's
  // obj/arg, mv/rot/method's child, etc.) is an intermediate value — emitted
  // as a const but NOT part of the returned list. The root list's natural
  // output is the set of root children NOT consumed by anything else, which
  // matches the user's intent: A and B feeding A.subtract(B) means the cut
  // is the output, not [A, B, cut]. Singleton outputs unwrap to the bare
  // value (no [x] wrapper).
  const consumed = computeConsumedSet(graph);

  const lines: string[] = [];
  let returnExpr = 'undefined';
  for (const id of order) {
    const node = graph.nodes[id];
    if (!node) continue;
    const v = varNames.get(id);
    if (!v) continue;
    if (id === graph.root && node.type === 'list') {
      // Skip the root-list's const entirely. Instead, derive the return
      // statement from its UNCONSUMED children:
      //   0 children → return undefined; (legal but unusual)
      //   1 child    → return <varName>; (singleton — no [x] wrapper)
      //   N children → return [v1, v2, ...]; (multi-output composition)
      const visible = node.children.filter((c) => !consumed.has(c));
      const exprs = visible.map((c) => varNames.get(c) ?? '/* missing */');
      if (exprs.length === 0)      returnExpr = 'undefined';
      else if (exprs.length === 1) returnExpr = exprs[0]!;
      else                         returnExpr = `[${exprs.join(', ')}]`;
      continue;
    }
    const expr = emitNodeExpr(node, varNames);
    if (expr == null) continue;
    lines.push(`  const ${v} = ${expr};`);
  }
  lines.push(`  return ${returnExpr};`);
  const rootVar = returnExpr;

  const usesSet = new Set<string>();
  for (const n of Object.values(graph.nodes)) {
    if (n.type === 'call') usesSet.add(n.src);
  }
  for (const i of graph.imports) usesSet.add(i);

  const meta: Record<string, unknown> = {
    id: opts.id,
    name: opts.id,
    kind: 'asm',
    ...(opts.description ? { description: opts.description } : {}),
    uses: [...usesSet].sort(),
    params: graph.params,
    graph: serialiseGraph(graph),
  };

  const metaText = `export const meta = ${stringifyTyped(meta, 0)};`;
  // The assembly contract (K.63) is `fn(p)` where `p` is the params object —
  // `p.<name>` refs in expression ArgValues + the loader's param expansion
  // both assume it. Emit the signature with `p` whenever ANY param is declared,
  // otherwise omit (a paramless assembly is also valid for the trivial case).
  const sig = Object.keys(graph.params).length > 0 ? 'p' : '';
  const fnText =
    `// AUTO-GENERATED from meta.graph by composition-emit.ts.\n` +
    `// Edits to this body are DISCARDED — the editor regenerates from the graph on every save.\n` +
    `export function ${opts.id}(${sig}) {\n${lines.join('\n')}\n}\n`;

  const source = `${metaText}\n\n${fnText}`;
  return { source, meta, body: lines.join('\n'), rootVar };
}

// ─── node → expression ────────────────────────────────────────────────────

function emitNodeExpr(node: GraphNode, varNames: Map<NodeId, string>): string | null {
  switch (node.type) {
    case 'call':
      return emitCallExpr(node.src, node.args);
    case 'list':
    case 'group':
      return `[${node.children.map((c) => varNames.get(c) ?? '/* missing */').join(', ')}]`;
    case 'stack': {
      // Sequential stack — mate via tail/head datum (manifold-helpers.stack
      // takes an ARRAY of children, not positional args; see
      // src/lib/cad/manifold-helpers.ts line 308: `function stack(children: any[])`).
      const args = node.children.map((c) => varNames.get(c) ?? '/* missing */').join(', ');
      return `stack([${args}])`;
    }
    case 'method': {
      const obj = varNames.get(node.obj) ?? '/* missing */';
      const arg = varNames.get(node.arg) ?? '/* missing */';
      return `${obj}.${node.op}(${arg})`;
    }
    case 'mv': {
      const child = varNames.get(node.child) ?? '/* missing */';
      const o = node.offset.map(emitValueExpr).join(', ');
      return `mv(${child}, [${o}])`;
    }
    case 'rot': {
      const child = varNames.get(node.child) ?? '/* missing */';
      const r = node.rot.map(emitValueExpr).join(', ');
      return `rot(${child}, [${r}])`;
    }
  }
}

function emitCallExpr(src: string, args: Record<string, ArgValue>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return `${src}({})`;
  const lines = keys.map((k) => `${k}: ${emitValueExpr(args[k]!)}`);
  return `${src}({ ${lines.join(', ')} })`;
}

function emitValueExpr(v: ArgValue): string {
  switch (v.kind) {
    case 'literal':
      if (typeof v.value === 'string') return tsString(v.value);
      return String(v.value);
    case 'expr':
      return v.expr;
    case 'param':
      return `p.${v.param}`;
  }
}

// ─── consumed-set (output filtering) ──────────────────────────────────────
//
// A node is "consumed" when another node references it as an input slot:
//   method.obj / method.arg
//   mv.child   / rot.child
// Nodes consumed by a CONTAINER (root list, group, stack) are NOT counted —
// container membership is structural, not a value-consumption. The set is
// used to filter the root list's children: only unconsumed nodes are the
// composition's outputs.

function computeConsumedSet(graph: Graph): Set<NodeId> {
  const consumed = new Set<NodeId>();
  for (const n of Object.values(graph.nodes)) {
    if (n.type === 'method') {
      if (n.obj) consumed.add(n.obj);
      if (n.arg) consumed.add(n.arg);
    } else if (n.type === 'mv' || n.type === 'rot') {
      if (n.child) consumed.add(n.child);
    } else if (n.type === 'stack' || n.type === 'group') {
      // Stack + group are EXPRESSIONS that operate on their children
      // (`stack(a, b, c)` / `group(a, b, c)`). The children are inputs,
      // not outputs — mark them consumed so the root-list filter drops them.
      for (const c of n.children) consumed.add(c);
    } else if (n.type === 'list' && n.id !== graph.root) {
      // A NESTED list literal is also a single expression `[a, b, c]` whose
      // children are inputs. The ROOT list is special — its children ARE
      // the function's return value (filtered downstream).
      for (const c of n.children) consumed.add(c);
    }
  }
  return consumed;
}

// ─── variable name assignment ────────────────────────────────────────────

/** Map each node to a JS variable name. Calls use their alias; other nodes
 *  get a numbered name derived from their type. */
function assignVarNames(graph: Graph, order: NodeId[]): Map<NodeId, string> {
  const out = new Map<NodeId, string>();
  const taken = new Set<string>();
  const counters: Record<string, number> = {};
  for (const id of order) {
    const node = graph.nodes[id];
    if (!node) continue;
    let name: string;
    if (node.type === 'call') {
      name = node.alias;
    } else {
      const prefix =
        node.type === 'list'   ? 'list' :
        node.type === 'stack'  ? 'stack' :
        node.type === 'group'  ? 'group' :
        node.type === 'method' ? `${node.op}_obj` :
        node.type === 'mv'     ? 'mv_obj' :
                                  'rot_obj';
      counters[prefix] = (counters[prefix] ?? 0) + 1;
      name = `_${prefix}_${counters[prefix]}`;
    }
    while (taken.has(name)) name = `${name}_`;
    out.set(id, name);
    taken.add(name);
  }
  return out;
}

// ─── meta.graph JSON literal ──────────────────────────────────────────────

/** Strip the denormalised `edges` field on emit — it's rebuildable from the
 *  args via composition-graph.collectEdges, so we keep the JSON compact +
 *  avoid serialise/parse mismatches. */
function serialiseGraph(graph: Graph): Record<string, unknown> {
  return {
    nodes: graph.nodes,
    root: graph.root,
    params: graph.params,
    imports: graph.imports,
  };
}

/** Pretty-print a value as TypeScript-ish source (object/array literals,
 *  not JSON.stringify which uses double-quoted keys). Used for the meta
 *  block. Recursive. */
function stringifyTyped(v: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  const pad1 = '  '.repeat(indent + 1);
  if (v === null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return tsString(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    const parts = v.map((x) => pad1 + stringifyTyped(x, indent + 1));
    return `[\n${parts.join(',\n')},\n${pad}]`;
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const parts = entries.map(([k, val]) => `${pad1}${unquotedKeyIfSafe(k)}: ${stringifyTyped(val, indent + 1)}`);
    return `{\n${parts.join(',\n')},\n${pad}}`;
  }
  return JSON.stringify(v);
}

/** Object keys that match /^[a-zA-Z_$][a-zA-Z0-9_$]*$/ can be emitted
 *  unquoted in TS source for readability. Everything else gets single-quoted. */
function unquotedKeyIfSafe(k: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : tsString(k);
}

/** Single-quoted TS string literal (escapes single quotes + backslashes + newlines). */
function tsString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}
