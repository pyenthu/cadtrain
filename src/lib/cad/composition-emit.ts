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
  STACK_REF_PARAM,
} from './composition-graph';

export interface EmitOptions {
  /** The assembly id (becomes meta.id + the export function name). */
  id: string;
  /** Optional description for meta.description. */
  description?: string;
  /** Ghost set — node IDs whose emitted Manifold is ALSO appended to
   *  the return list so the bake renders them alongside the normal
   *  result. The editor's per-card 👁 toggle drives this; saved files
   *  never get a non-empty set (only /preview ever sees it). The bake
   *  cache keys on source content so the ghost variant has its own
   *  cache entry, doesn't interfere with the saved bake. */
  ghosts?: string[];
  /** Drawing-descriptor markdown — hand-authored "how to draw it"
   *  reference. Serialised as `meta.drawingMd` so it round-trips through
   *  save → reload. Empty / absent = no MD on the saved file. */
  drawingMd?: string;
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
  /** Any broken references the graph still has — orphan nodes, deleted
   *  params, etc. The editor reads this to render error chips on nodes;
   *  /save + /preview refuse to commit the source when this is non-empty
   *  (silent /​*​ missing *​/ strings used to surface downstream as a cryptic
   *  WASM "memory access out of bounds"). */
  validationErrors: GraphValidationError[];
}

/** One broken reference inside a node — used by validateGraph + thrown by
 *  emitGraph when the graph is internally inconsistent. */
export interface GraphValidationError {
  /** The node holding the bad reference. */
  nodeId: NodeId;
  /** Which slot on the node is bad — `child`, `obj`, `arg`, `children[2]`, … */
  slot: string;
  /** The missing reference. For node-id slots: the orphan id. For param-arg
   *  slots: the param name that's no longer declared in graph.params. */
  badRef: string;
  kind: 'missing-node' | 'missing-param';
}

/** Walk every node, return a list of broken references. Emit/save/bake
 *  should refuse to proceed when this returns anything — silently writing
 *  a "missing" placeholder into the source explodes downstream as a
 *  cryptic WASM "memory access out of bounds" (the placeholder becomes
 *  undefined and undefined.boundingBox() blows up the Manifold proxy chain).
 *
 *  Surfaces TWO classes of breakage:
 *    1. node-id references that point at a deleted node (orphans)
 *    2. param ArgValues that name a param no longer in graph.params */
export function validateGraph(graph: Graph): GraphValidationError[] {
  const errs: GraphValidationError[] = [];
  const has = (id: NodeId) => Object.prototype.hasOwnProperty.call(graph.nodes, id);
  const hasParam = (name: string) => Object.prototype.hasOwnProperty.call(graph.params, name);
  const checkArg = (nodeId: NodeId, slot: string, v: ArgValue) => {
    if (v.kind === 'param' && !hasParam(v.param)) {
      errs.push({ nodeId, slot, badRef: v.param, kind: 'missing-param' });
    }
  };
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (!node) continue;
    switch (node.type) {
      case 'call':
        for (const [k, v] of Object.entries(node.args)) checkArg(id, `args.${k}`, v);
        break;
      case 'list':
      case 'stack':
      case 'group':
        node.children.forEach((c, i) => {
          if (!has(c)) errs.push({ nodeId: id, slot: `children[${i}]`, badRef: c, kind: 'missing-node' });
        });
        break;
      case 'method':
        if (!has(node.obj)) errs.push({ nodeId: id, slot: 'obj', badRef: node.obj, kind: 'missing-node' });
        if (!has(node.arg)) errs.push({ nodeId: id, slot: 'arg', badRef: node.arg, kind: 'missing-node' });
        break;
      case 'mv':
        if (!has(node.child)) errs.push({ nodeId: id, slot: 'child', badRef: node.child, kind: 'missing-node' });
        node.offset.forEach((v, i) => checkArg(id, `offset[${i}]`, v));
        break;
      case 'rot':
        if (!has(node.child)) errs.push({ nodeId: id, slot: 'child', badRef: node.child, kind: 'missing-node' });
        node.rot.forEach((v, i) => checkArg(id, `rot[${i}]`, v));
        break;
      case 'repeat':
        if (!has(node.child)) errs.push({ nodeId: id, slot: 'child', badRef: node.child, kind: 'missing-node' });
        checkArg(id, 'count', node.count);
        break;
      case 'sketch':
        // Mirror the polygon path: every per-op ArgValue component is checked
        // so a wired-then-deleted param surfaces as `missing-param`.
        (node.ops as any[]).forEach((o, i) => {
          if (o.op === 'line' || o.op === 'spline') {
            checkArg(id, `ops[${i}].r`, o.r);
            checkArg(id, `ops[${i}].z`, o.z);
          }
          if (o.op === 'spline') {
            (o.pts ?? []).forEach((pt: any, k: number) => {
              if (pt?.[0]) checkArg(id, `ops[${i}].pts[${k}].u`, pt[0]);
              if (pt?.[1]) checkArg(id, `ops[${i}].pts[${k}].v`, pt[1]);
            });
            if (o.h0?.[0]) checkArg(id, `ops[${i}].h0.u`, o.h0[0]);
            if (o.h0?.[1]) checkArg(id, `ops[${i}].h0.v`, o.h0[1]);
            if (o.h1?.[0]) checkArg(id, `ops[${i}].h1.u`, o.h1[0]);
            if (o.h1?.[1]) checkArg(id, `ops[${i}].h1.v`, o.h1[1]);
          }
          if (o.op === 'fillet')  checkArg(id, `ops[${i}].radius`, o.radius);
          if (o.op === 'chamfer') checkArg(id, `ops[${i}].dist`, o.dist);
        });
        if ((node as any).segments) checkArg(id, 'segments', (node as any).segments);
        break;
    }
  }
  return errs;
}

/** Format a list of validation errors into one human-readable message —
 *  the exact text shown to the user via the /preview error / /save 400. */
export function formatValidationErrors(errs: GraphValidationError[]): string {
  if (errs.length === 0) return '';
  const lines = errs.map((e) => {
    const what = e.kind === 'missing-node'
      ? `references a deleted node id "${e.badRef}"`
      : `references a deleted param "${e.badRef}"`;
    return `  • node ${e.nodeId} (slot ${e.slot}) ${what}`;
  });
  return `graph has ${errs.length} broken reference${errs.length === 1 ? '' : 's'} — fix in the editor before saving:\n${lines.join('\n')}`;
}

/** Top-level entry — graph + id → file content.
 *
 *  NEVER throws on a broken graph (the editor's `$derived emitted` would
 *  blow up the whole UI). Instead returns the validation errors alongside
 *  the source — callers refuse to commit a non-empty error list (the
 *  save endpoint + the bake endpoint + the editor's error pane). The
 *  body still gets generated so the user can see what would have been
 *  emitted, with bad refs surfacing as a `throw new Error(...)` line so
 *  it explodes IMMEDIATELY at call time with a precise message instead
 *  of silently producing `/* missing *​/` → undefined → cryptic WASM
 *  out-of-bounds downstream. */
export function emitGraph(graph: Graph, opts: EmitOptions): EmitResult {
  const validationErrors = validateGraph(graph);
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
  // List producers — nodes whose emitted value is a bare JS array (not a
  // Manifold). Used by stack to spread (...) them into the outer array,
  // so a Repeat-with-op-list child of a Stack flattens cleanly.
  const listProducers = computeListProducers(graph);

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
      // Same loud-throw treatment as emitNodeExpr — a missing root child
      // surfaces as an explicit throw instead of a silent placeholder that
      // compiles to undefined and crashes WASM downstream.
      const exprs = visible.map((c, i) => varNames.get(c) ?? missingRef(id, `children[${i}]`, c));
      if (exprs.length === 0)      returnExpr = 'undefined';
      else if (exprs.length === 1) returnExpr = exprs[0]!;
      else                         returnExpr = `[${exprs.join(', ')}]`;
      continue;
    }
    const expr = emitNodeExpr(node, varNames, listProducers, graph.nodes);
    if (expr == null) continue;
    lines.push(`  const ${v} = ${expr};`);
  }
  // STACK REFERENCE stamp — when this part opted into the reserved
  // `stack_ref` param, stamp the RESOLVED value onto the returned manifold as
  // `_stackRef` so a PARENT assembly's stack() can read how this part mates
  // (mirrors the `_refHead`/`_refTail` datum stamping pattern). Falls back to
  // the part's OWN default when a caller omits the arg (`p.stack_ref ?? def`)
  // so the part's intended mate survives even unwired. Parts without the param
  // emit nothing → no behaviour change. An array return is composed via
  // place() FIRST so the stamp survives the loader's autoPlace boundary.
  if (Object.prototype.hasOwnProperty.call(graph.params, STACK_REF_PARAM) && returnExpr !== 'undefined') {
    const rawDef = (graph.params as any)[STACK_REF_PARAM]?.default;
    const def = Number.isFinite(Number(rawDef)) ? Number(rawDef) : 0;
    const primary = returnExpr.startsWith('[') ? `place(${returnExpr})` : returnExpr;
    lines.push(`  const _stackOut = ${primary};`);
    lines.push(`  if (_stackOut && typeof _stackOut === 'object') _stackOut._stackRef = (p.${STACK_REF_PARAM} ?? ${def});`);
    returnExpr = '_stackOut';
  }

  // Ghost mode — APPEND the emitted var of every node id in opts.ghosts
  // to the returned array so the bake renders them alongside the normal
  // result. Each card carries its own 👁 toggle in the editor; the
  // returned cutter renders in its native colour (color-by-source) so
  // the user can eyeball where the subtraction is removing material.
  // Saved files never get this (opts.ghosts is editor-only — /preview
  // sets it, /save doesn't).
  if (opts.ghosts && opts.ghosts.length > 0) {
    // For each ghost id, walk FORWARD through any mv/rot wrappers so the
    // overlay shows the PLACED part (rotated + translated to where it
    // actually sits in the composition), not the raw call at the origin.
    // Stop at the last mv/rot in the chain — anything beyond (method
    // subtract/add/intersect, container) is consumed differently.
    const consumersOf = new Map<NodeId, NodeId>();
    for (const n of Object.values(graph.nodes)) {
      if (n?.type === 'mv' || n?.type === 'rot') {
        if (n.child) consumersOf.set(n.child, n.id);
      }
    }
    const resolveGhostNode = (id: NodeId): NodeId => {
      let cur = id;
      const seen = new Set<NodeId>();
      while (consumersOf.has(cur) && !seen.has(cur)) {
        seen.add(cur);
        cur = consumersOf.get(cur)!;
      }
      return cur;
    };
    const ghostVars: string[] = [];
    const seenVars = new Set<string>();
    for (const ghostId of opts.ghosts) {
      const resolved = resolveGhostNode(ghostId);
      const v = varNames.get(resolved);
      if (!v || seenVars.has(v)) continue;
      // Skip vars already in the output expression (no point doubling
      // up; would only inflate the bake).
      if (returnExpr === v) continue;
      if (new RegExp(`\\b${v}\\b`).test(returnExpr)) continue;
      ghostVars.push(v);
      seenVars.add(v);
    }
    if (ghostVars.length > 0) {
      const base = returnExpr === 'undefined' ? '[]'
        : returnExpr.startsWith('[') ? returnExpr
        : `[${returnExpr}]`;
      returnExpr = `[...${base}, ${ghostVars.join(', ')}]`;
    }
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
    ...(opts.drawingMd ? { drawingMd: opts.drawingMd } : {}),
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

  // ── Polygon sentinel substitution ─────────────────────────────────────
  // Polygon nodes get a varName like `_poly_1` from assignVarNames; when a
  // downstream Call (r_revolve, r_weld_extrude) references them, its
  // `profile` arg carries an expr like `__POLY__<polygonId>`. After all
  // lines emit, rewrite the sentinel to the polygon's actual varName so
  // the generated body is valid JS.
  let bodyText = lines.join('\n');
  for (const [id, varName] of varNames.entries()) {
    const node = graph.nodes[id];
    if (!node || (node.type !== 'polygon' && node.type !== 'sketch')) continue;
    bodyText = bodyText.split(`__POLY__${id}`).join(varName);
  }

  const fnText =
    `// AUTO-GENERATED from meta.graph by composition-emit.ts.\n` +
    `// Edits to this body are DISCARDED — the editor regenerates from the graph on every save.\n` +
    `export function ${opts.id}(${sig}) {\n${bodyText}\n}\n`;

  const source = `${metaText}\n\n${fnText}`;
  return { source, meta, body: bodyText, rootVar, validationErrors };
}

// ─── node → expression ────────────────────────────────────────────────────

/** Loud placeholder for a missing node ref. Emits a JS expression that
 *  THROWS at evaluation time with a precise message — replaces the old
 *  silent comment which compiled to nothing and surfaced downstream as a
 *  cryptic WASM out-of-bounds. The expression is an IIFE so it can live
 *  inside any slot (mv child, repeat child, stack arg, …) without breaking
 *  the surrounding shape — but it throws before any consumer touches its
 *  (non-)value. */
function missingRef(nodeId: NodeId, slot: string, badRef: NodeId): string {
  const msg = `node ${nodeId}.${slot} references missing node "${badRef}" — fix in the editor`;
  return `(() => { throw new Error(${JSON.stringify(msg)}); })()`;
}

function emitNodeExpr(node: GraphNode, varNames: Map<NodeId, string>, listProducers: Set<NodeId> | undefined, nodes: Record<NodeId, GraphNode>): string | null {
  const ref = (id: NodeId, slot: string) => varNames.get(id) ?? missingRef(node.id, slot, id);
  switch (node.type) {
    case 'call':
      return emitCallExpr(node.src, node.args);
    case 'list':
    case 'group':
      return `[${node.children.map((c, i) => ref(c, `children[${i}]`)).join(', ')}]`;
    case 'stack': {
      // Sequential stack — mate via tail/head datum (manifold-helpers.stack
      // takes an ARRAY of children, not positional args; see
      // src/lib/cad/manifold-helpers.ts line 308: `function stack(children: any[])`).
      //
      // Mixed-input support: when a child is a Repeat with op='list' it
      // produces a bare array; we SPREAD it (...) into the outer array so
      // stack receives one flat list. Single items emit bare; spread
      // emits with the leading `...`. Lets the user mix single parts +
      // list-producing Repeats in the same stack (e.g. [box, ...joints, pin]).
      const args = node.children.map((c, i) => {
        const slot = `children[${i}]`;
        const nm = ref(c, slot);
        return listProducers?.has(c) ? `...${nm}` : nm;
      }).join(', ');
      return `stack([${args}])`;
    }
    case 'method': {
      const obj = ref(node.obj, 'obj');
      const arg = ref(node.arg, 'arg');
      return `${obj}.${node.op}(${arg})`;
    }
    case 'mv': {
      const child = ref(node.child, 'child');
      const o = node.offset.map(emitValueExpr).join(', ');
      return `mv(${child}, [${o}])`;
    }
    case 'rot': {
      const child = ref(node.child, 'child');
      const r = node.rot.map(emitValueExpr).join(', ');
      return `rot(${child}, [${r}])`;
    }
    case 'repeat': {
      // Instantiate the child N times. The `op` field decides how the N
      // copies are combined:
      //   'stack' (default) — mate end-to-end via stack()
      //   'list'            — bare array; caller decides
      //   'place'           — combine without mating (overlap at origin)
      // Default 'stack' so existing graphs without an op field keep the
      // historical drilling-string idiom (every BUILD_ORDER part works).
      const count = emitValueExpr(node.count);
      const child = ref(node.child, 'child');
      const array = `Array.from({ length: ${count} }, () => ${child})`;
      const op = node.op ?? 'stack';
      if (op === 'list')  return array;
      if (op === 'place') return `place(${array})`;
      return `stack(${array})`;
    }
    case 'polygon': {
      // A polygon embedded in a part graph emits its points array directly
      // (so callers like r_revolve / r_extrude / r_weld_extrude that take
      // a profile arg can `__POLY__<id>` it). #157 repeat-ref entries
      // chase their sourceId to the corresponding PolyRepeatNode + emit
      // an Array.from spread with the loop's expressions. Bindings (#157)
      // emit as `const` lines inside the arrow body.
      const rows = node.points.map((entry: any) => {
        if (entry?.kind === 'repeat-ref') {
          const src = nodes[entry.sourceId] as any;
          if (!src || src.type !== 'poly_repeat') return '';
          const count = emitValueExpr(src.count);
          const loopVar = /^[A-Za-z_$][\w$]*$/.test(String(src.loopVar || ''))
            ? String(src.loopVar) : 'i';
          const rExpr = emitValueExpr(src.r);
          const zExpr = emitValueExpr(src.z);
          const bindings: Array<{ name: string; value: any }> = Array.isArray(src.bindings) ? src.bindings : [];
          const valid = bindings.filter((b) =>
            b && typeof b.name === 'string' && /^[A-Za-z_$][\w$]*$/.test(b.name)
          );
          const bindLines = valid.map((b) => `const ${b.name} = ${emitValueExpr(b.value)};`).join(' ');
          const preamble = bindLines ? `const NPts = ${count}; ${bindLines}` : `const NPts = ${count};`;
          return `...Array.from({ length: ${count} }, (_, ${loopVar}) => { ${preamble} return [${rExpr}, ${zExpr}]; })`;
        }
        if (entry?.kind === 'repeat') {
          const count = emitValueExpr(entry.count);
          const loopVar = /^[A-Za-z_$][\w$]*$/.test(String(entry.loopVar || ''))
            ? String(entry.loopVar) : 'i';
          return `...Array.from({ length: ${count} }, (_, ${loopVar}) => [${emitValueExpr(entry.r)}, ${emitValueExpr(entry.z)}])`;
        }
        return `[${emitValueExpr(entry.r)}, ${emitValueExpr(entry.z)}]`;
      }).filter(Boolean);
      return `[${rows.join(', ')}]`;
    }
    case 'sketch': {
      // Emit a runtime `sketch([...ops], segments)` call — compileSketch is
      // injected into the part sandbox. Each op's coord/radius/dist field is
      // an ArgValue so it can be param/expr-driven. (plan M.1)
      const ops = ((node as any).ops ?? []).map((o: any) => {
        if (o.op === 'line' || o.op === 'spline') {
          // `mode:'rel'` → compileSketch accumulates (r,z) as a Δ from the
          // previous vertex; emitted verbatim so the bake matches the editor.
          const modePart = o.mode === 'rel' ? `, mode: 'rel'` : '';
          if (o.op === 'spline') {
            const parts = [`op: 'spline'`, `r: ${emitValueExpr(o.r)}`, `z: ${emitValueExpr(o.z)}`];
            if (Array.isArray(o.pts) && o.pts.length) {
              parts.push(`pts: [${o.pts.map((c: any[]) => `[${emitValueExpr(c[0])}, ${emitValueExpr(c[1])}]`).join(', ')}]`);
            }
            if (Array.isArray(o.h0)) parts.push(`h0: [${emitValueExpr(o.h0[0])}, ${emitValueExpr(o.h0[1])}]`);
            if (Array.isArray(o.h1)) parts.push(`h1: [${emitValueExpr(o.h1[0])}, ${emitValueExpr(o.h1[1])}]`);
            if (o.mode === 'rel') parts.push(`mode: 'rel'`);
            return `{ ${parts.join(', ')} }`;
          }
          return `{ op: 'line', r: ${emitValueExpr(o.r)}, z: ${emitValueExpr(o.z)}${modePart} }`;
        }
        if (o.op === 'fillet')  return `{ op: 'fillet', radius: ${emitValueExpr(o.radius)} }`;
        if (o.op === 'chamfer') return `{ op: 'chamfer', dist: ${emitValueExpr(o.dist)} }`;
        return '';
      }).filter(Boolean);
      const seg = (node as any).segments != null ? emitValueExpr((node as any).segments) : '64';
      return `sketch([${ops.join(', ')}], ${seg})`;
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

/** Compute the set of nodes whose emitted value is a bare JS array.
 *  Currently: Repeat with op === 'list'. Anything else returns a
 *  Manifold (the leaf) or another array-producer that gets unwrapped
 *  upstream. Used by stack to know when to `...spread` a child. */
function computeListProducers(graph: Graph): Set<NodeId> {
  const set = new Set<NodeId>();
  for (const n of Object.values(graph.nodes)) {
    if (n.type === 'repeat' && (n as any).op === 'list') set.add(n.id);
    // (Future: bare list nodes that aren't the root list, group containers, etc.)
  }
  return set;
}

function computeConsumedSet(graph: Graph): Set<NodeId> {
  const consumed = new Set<NodeId>();
  for (const n of Object.values(graph.nodes)) {
    if (n.type === 'method') {
      if (n.obj) consumed.add(n.obj);
      if (n.arg) consumed.add(n.arg);
    } else if (n.type === 'mv' || n.type === 'rot' || n.type === 'repeat') {
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
    } else if (n.type === 'call') {
      // Call args carrying a `__POLY__<sourceId>` sentinel expr consume
      // the source node (the polygon, today). Without this, the polygon
      // and the revolve BOTH show up as Output children — the user sees
      // two outputs when there's really only one (the revolve's solid).
      for (const v of Object.values(n.args)) {
        if (v.kind !== 'expr') continue;
        const matches = v.expr.match(/__POLY__(n_[a-z0-9]+)/gi);
        if (!matches) continue;
        for (const m of matches) consumed.add(m.slice('__POLY__'.length));
      }
    }
  }
  return consumed;
}

/** Same logic as `computeConsumedSet` but exported for the editor — used
 *  to grey-out the × delete button on cards that are consumed by another
 *  node (their value flows into something else; deleting them would
 *  break the consumer). */
export function consumedByCall(graph: Graph): Set<NodeId> {
  return computeConsumedSet(graph);
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
        node.type === 'list'    ? 'list' :
        node.type === 'stack'   ? 'stack' :
        node.type === 'group'   ? 'group' :
        node.type === 'method'  ? `${node.op}_obj` :
        node.type === 'mv'      ? 'mv_obj' :
        node.type === 'polygon' ? 'poly' :
        node.type === 'sketch'  ? 'sketch' :
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
 *  avoid serialise/parse mismatches. `layout` IS preserved so the user's
 *  hand-positioned node placements survive save → reload (a fresh hydrate
 *  falls back to defaultCallPosition for any node missing a layout entry,
 *  so older files without layout still open cleanly). */
function serialiseGraph(graph: Graph): Record<string, unknown> {
  return {
    nodes: graph.nodes,
    root: graph.root,
    params: graph.params,
    imports: graph.imports,
    layout: graph.layout,
    // Viewport ALWAYS round-trips so canvas pan + zoom restore on reload.
    // Default fallback (0, 0, zoom=1) lives in hydrateGraph for legacy files.
    ...(graph.viewport ? { viewport: graph.viewport } : {}),
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
