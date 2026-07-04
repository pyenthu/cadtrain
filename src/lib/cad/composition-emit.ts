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
  type ExprNode,
  type ExprDef,
  type SplineNode,
  asLiteral,
  topoOrder,
  STACK_REF_PARAM,
} from './composition-graph';
import {
  emitExprConsts, rewriteExprRefs,
  exprBlockVar, exprBlockMember, rewriteExprLocalRefs, orderExprDef, declaredNames,
  compileListFormula,
} from './graph-exprs';
import { isImperative, compileImperative } from './expr-imperative';
import { inferStructure } from './struct-type';

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
      case 'txfmn':
        // Both triples are checked so a wired-then-deleted param surfaces as
        // `missing-param`; child resolves like mv/rot (null/unwired = missing).
        if (node.child == null || !has(node.child)) {
          errs.push({ nodeId: id, slot: 'child', badRef: String(node.child ?? ''), kind: 'missing-node' });
        }
        node.rot.forEach((v, i) => checkArg(id, `rot[${i}]`, v));
        node.offset.forEach((v, i) => checkArg(id, `offset[${i}]`, v));
        break;
      case 'repeat': {
        // A bodyExpr (code mode) supplies the body without wired parts, so an
        // empty PARTS list is only an error when there is no code override.
        const hasBody = typeof (node as any).bodyExpr === 'string' && (node as any).bodyExpr.trim().length > 0;
        const kids = node.children ?? [];
        if (kids.length === 0 && !hasBody) {
          errs.push({ nodeId: id, slot: 'child', badRef: '', kind: 'missing-node' });
        }
        kids.forEach((c, i) => {
          if (!has(c)) errs.push({ nodeId: id, slot: `children[${i}]`, badRef: c, kind: 'missing-node' });
        });
        checkArg(id, 'count', node.count);
      }
        // Patterned-repeat modifier/binding ArgValues (#7) — same as poly_repeat.
        ((node as any).modifiers as any[] ?? []).forEach((m, k) =>
          (m?.vec ?? []).forEach((v: any, ax: number) => checkArg(id, `modifiers[${k}].vec[${ax}]`, v)));
        ((node as any).bindings as any[] ?? []).forEach((b, k) =>
          checkArg(id, `bindings[${k}].value`, b?.value));
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
      case 'expr':
        // An input binding wired to a since-deleted param surfaces as
        // missing-param (same treatment as every other ArgValue slot).
        for (const [inName, v] of Object.entries((node as any).bindings ?? {})) {
          checkArg(id, `bindings.${inName}`, v as ArgValue);
        }
        break;
      case 'warp':
        // The bent solid (child) must be wired; the path + refine ArgValues are
        // checked so a wired-then-deleted param surfaces as missing-param.
        if (node.child == null || !has(node.child)) {
          errs.push({ nodeId: id, slot: 'child', badRef: String(node.child ?? ''), kind: 'missing-node' });
        }
        checkArg(id, 'path', node.path);
        if (node.refine != null) checkArg(id, 'refine', node.refine);
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
      if (n?.type === 'mv' || n?.type === 'rot' || n?.type === 'txfmn') {
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
    // Part-level appearance — sparse top-level mirror of the values that also
    // live inside the serialised graph block. External consumers (the viewer
    // tint, loaders) can read these without parsing meta.graph.
    ...(graph.colorOuter ? { colorOuter: graph.colorOuter } : {}),
    ...(graph.colorInner ? { colorInner: graph.colorInner } : {}),
    ...(graph.material ? { material: graph.material } : {}),
    // Render OPACITY (0–1) — sparse top-level mirror. Emitted only when <1 so an
    // opaque part stays byte-identical. External readers (well schematic) can
    // read the transparency without parsing meta.graph.
    ...(typeof graph.opacity === 'number' && graph.opacity < 1 ? { opacity: graph.opacity } : {}),
    // Named material TEXTURE (G-MAT2) — sparse top-level mirror. Emitted only
    // when a non-empty name is set so an un-textured part stays byte-identical.
    // External readers can pick up the material without parsing meta.graph.
    ...(typeof graph.texture === 'string' && graph.texture.trim() ? { texture: graph.texture.trim() } : {}),
    // Editor VIEW scale (VIEW-ONLY) — sparse top-level mirror of the values in
    // the serialised graph block. Present only when a MANUAL scale was saved.
    ...(graph.viewZScale != null ? { viewZScale: graph.viewZScale } : {}),
    ...(graph.viewXScale != null ? { viewXScale: graph.viewXScale } : {}),
    ...(graph.partAppearance && Object.keys(graph.partAppearance).length ? { partAppearance: graph.partAppearance } : {}),
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

  // ── Calculated-expression block (B.6 / id 914) ─────────────────────────
  // When the graph declares `exprs`, prepend the topo-ordered
  // `const e_<name> = <src>;` declarations ahead of the consuming body, then
  // rewrite every `e.<name>` reference (in the const block AND any consuming
  // ArgValue) to the flat `e_<name>` identifier those consts bind. `p.<param>`
  // is untouched (`p` is the live params object). ABSENT/EMPTY exprs ⇒ this
  // whole block is skipped ⇒ the emitted source is byte-identical to today.
  const exprs = graph.exprs;
  if (exprs && exprs.length > 0) {
    const res = emitExprConsts(exprs);
    const block = res.ok
      ? res.lines.map((l) => `  ${l}`).join('\n')
      // A cyclic / unparseable expr set emits a loud throw (same philosophy as
      // missingRef) instead of silently dropping refs that would crash WASM.
      : `  throw new Error(${JSON.stringify('expression error — ' + res.error)});`;
    bodyText = `${block}\n${bodyText}`;
    bodyText = rewriteExprRefs(bodyText);
  }

  // ── Spline path blocks (TODO #15) ──────────────────────────────────────
  // Each spline node emits ONE prelude const: the centripetal Catmull-Rom curve
  // through its control points, resampled to N equally-spaced [x,y,z] points via
  // the pure-JS `resampleSpline` (injected into the sandbox; NO three.js at bake).
  // A consumer Call arg wired to the spline's output references this same const
  // (`_x_<id>_path`, exprBlockMember(id,'path')). ABSENT ⇒ no spline nodes ⇒ no
  // prelude ⇒ byte-identical to today.
  //
  // ORDER: prepend BEFORE the expr blocks so the expr-block prelude lands ABOVE
  // it — a spline with a WIRED points source (TODO #26) references an expr
  // instance's `_x_<id>_<out>` const, which must be declared first (JS `const`
  // TDZ). A manual-points spline references nothing, so the order is immaterial
  // for it (still byte-identical).
  const splineBlockLines = emitSplineBlocks(graph);
  if (splineBlockLines.length > 0) {
    const block = splineBlockLines.map((l) => `  ${l}`).join('\n');
    bodyText = `${block}\n${bodyText}`;
  }

  // ── Expr blocks (B.7 / id 914 v2) ──────────────────────────────────────
  // Each floating Expr node emits a numeric PRELUDE: one `const <blockvar>_<in>`
  // per derived input (from its wired binding, or a safe 0) then one
  // `const <blockvar>_<out>` per output in LOCAL topo order. A consumer arg
  // wired to an output socket carries `{kind:'expr', expr:'<blockvar>_<out>'}`,
  // so the prelude must sit ahead of the whole body. ABSENT/EMPTY ⇒ no expr
  // nodes ⇒ no prelude ⇒ byte-identical to today. Kept OUT of the
  // rewriteExprRefs pass above: expr-block consts use their own `<blockvar>_`
  // namespace, never the `e.*` one. Prepended AFTER the spline block so it sits
  // above (a wired spline reads an expr-output const declared here).
  const exprBlockLines = emitExprBlocks(graph);
  if (exprBlockLines.length > 0) {
    const block = exprBlockLines.map((l) => `  ${l}`).join('\n');
    bodyText = `${block}\n${bodyText}`;
  }

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

/** Render ONE sketch op (line/spline/fillet/chamfer) as an object-literal
 *  source string — shared by the parent sketch loop AND the sketch_repeat
 *  prototype spread (#805) so the two emit paths can never drift. Returns ''
 *  for a repeat-ref / unknown op (the caller handles refs separately). */
function emitSketchOpObject(o: any): string {
  if (!o) return '';
  if (o.op === 'line' || o.op === 'spline') {
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
}

function emitNodeExpr(node: GraphNode, varNames: Map<NodeId, string>, listProducers: Set<NodeId> | undefined, nodes: Record<NodeId, GraphNode>): string | null {
  const ref = (id: NodeId, slot: string) => varNames.get(id) ?? missingRef(node.id, slot, id);
  switch (node.type) {
    case 'call':
      return emitCallExpr(node.src, node.args, nodes);
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
      // PER-CHILD STACK REFERENCE OVERRIDE (#stack_ref level 2). A child listed
      // in this stack's `childRefs` has its part-level `_stackRef` overridden
      // FOR THIS STACK by re-stamping the value via withStackRef(). Wrapped at
      // the child EXPRESSION (not a parallel array) so spread Repeats stay
      // index-safe; a list-producing child applies the override to each item
      // it spreads. Children without an override emit bare and keep the value
      // their own emitted geom stamped.
      // PER-CHILD COUNT (×N). A child listed in this stack's `childCounts` is
      // placed N times, mated end-to-end — the common "Repeat → Stack" pattern
      // collapsed into the Stack itself. The child is ALREADY built once into
      // a const (`nm`, every stack child is consumed → emitted as a var), so
      // we spread N references to that same var; stack() mv's each (new
      // translated manifolds, never mutating the source) so N identical refs
      // is correct. `Math.max(1, Math.floor(count) | 0)` guards a bad / 0 / NaN
      // count → a single copy. A stack-ref override composes by mapping
      // withStackRef over each copy. List/spread children (a Repeat op='list')
      // keep their existing flatten behaviour — count does not apply to them.
      const childRefs = (node as { childRefs?: Record<NodeId, number> }).childRefs ?? {};
      const childCounts = (node as { childCounts?: Record<NodeId, ArgValue> }).childCounts ?? {};
      const args = node.children.map((c, i) => {
        const slot = `children[${i}]`;
        const nm = ref(c, slot);
        const raw = childRefs[c];
        const hasOverride = Object.prototype.hasOwnProperty.call(childRefs, c) && Number.isFinite(Number(raw));
        const v = Number(raw);
        const isList = listProducers?.has(c);
        const countVal = childCounts[c];
        // A literal ≤ 1 means "single copy" — treat as no count. Param/expr
        // values always opt in (resolved + guarded at runtime).
        const wantsCount = !isList && countVal != null &&
          !(countVal.kind === 'literal' && Number(countVal.value) <= 1);
        if (wantsCount) {
          const countExpr = `Math.max(1, Math.floor(${emitValueExpr(countVal)}) | 0)`;
          return hasOverride
            ? `...Array(${countExpr}).fill(0).map(() => withStackRef(${nm}, ${v}))`
            : `...Array(${countExpr}).fill(${nm})`;
        }
        if (isList) {
          return hasOverride ? `...${nm}.map((__m) => withStackRef(__m, ${v}))` : `...${nm}`;
        }
        return hasOverride ? `withStackRef(${nm}, ${v})` : nm;
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
    case 'txfmn': {
      // Re-expand the single node into the SAME nested helper calls the legacy
      // two-node mv(rot(...)) form produced, in rotate-then-translate order
      // (rot INNER, mv OUTER) so existing baked geometry is byte-identical.
      // Identity elision: a pure-mv txfmn emits exactly `mv(child, [...])`, a
      // pure-rot exactly `rot(child, [...])`, and an all-zero txfmn emits the
      // bare child — the regression guard for existing mv/rot parts.
      const child = ref(node.child ?? '', 'child');
      const rotIsId = node.rot.every(isLiteralZero);
      const mvIsId = node.offset.every(isLiteralZero);
      let e = child;
      if (!rotIsId) e = `rot(${e}, [${node.rot.map(emitValueExpr).join(', ')}])`;     // INNER — applied first
      if (!mvIsId)  e = `mv(${e}, [${node.offset.map(emitValueExpr).join(', ')}])`;   // OUTER — applied second
      return e;
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
      // Fold an mv/rot modifier stack around an expression, innermost-first
      // (modifiers[0] closest to the part). Axis values may reference i/N/binds.
      const foldMods = (expr: string, ms: any[]): string => {
        let e = expr;
        for (const m of (ms ?? [])) {
          const fn = m?.kind === 'rot' ? 'rot' : 'mv';
          const v = (m?.vec ?? []) as any[];
          e = `${fn}(${e}, [${emitValueExpr(v[0])}, ${emitValueExpr(v[1])}, ${emitValueExpr(v[2])}])`;
        }
        return e;
      };
      // The repeated UNIT: each part is wrapped in its OWN partModifiers stack,
      // then the parts combine per-iteration via place([...]) (compose — each
      // keeps its own position); a single part with no per-part mods emits bare
      // so legacy parts stay byte-identical. A raw `bodyExpr` (code mode)
      // overrides the children-derived body verbatim.
      const partMods: Record<string, any[]> = ((node as any).partModifiers ?? {}) as any;
      const anyPartMods = Object.values(partMods).some((m) => Array.isArray(m) && m.length > 0);
      const parts = (node.children ?? []).map((c, i) => foldMods(ref(c, `children[${i}]`), partMods[c]));
      const rawBody = typeof (node as any).bodyExpr === 'string' ? (node as any).bodyExpr.trim() : '';
      const child = rawBody
        ? rawBody
        : parts.length === 1 ? parts[0] : `place([${parts.join(', ')}])`;
      // Patterned repeat (#7): GLOBAL per-copy transforms keyed to the loop var.
      const mods: any[] = Array.isArray((node as any).modifiers) ? (node as any).modifiers : [];
      const rawBinds: any[] = Array.isArray((node as any).bindings) ? (node as any).bindings : [];
      const binds = rawBinds.filter((b) => b && typeof b.name === 'string' && /^[A-Za-z_$][\w$]*$/.test(b.name));
      const hasLoopVar = typeof (node as any).loopVar === 'string' && (node as any).loopVar.length > 0;
      let array: string;
      if (mods.length === 0 && binds.length === 0 && !hasLoopVar && !rawBody && !anyPartMods) {
        // Backward-compat: identity clone, byte-identical to the historical form.
        array = `Array.from({ length: ${count} }, () => ${child})`;
      } else {
        const loopVar = /^[A-Za-z_$][\w$]*$/.test(String((node as any).loopVar || ''))
          ? String((node as any).loopVar) : 'i';
        const bindLines = binds.map((b) => `const ${b.name} = ${emitValueExpr(b.value)};`).join(' ');
        // Inject the loop count under BOTH `N` (historical) and `NPts` (the name
        // poly_repeat/sketch_repeat use), so a binding expr like `i*turns*tau/NPts`
        // works identically across all three repeat flavors.
        const preamble = bindLines
          ? `const N = ${count}; const NPts = ${count}; ${bindLines}`
          : `const N = ${count}; const NPts = ${count};`;
        // Global modifiers wrap the whole place([…]) unit (per-part mods are
        // already folded inside each part). Innermost-first.
        const body = foldMods(child, mods);
        array = `Array.from({ length: ${count} }, (_, ${loopVar}) => { ${preamble} return ${body}; })`;
      }
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
        if (entry?.kind === 'expr-list-ref') {
          // #11 — splice an expression instance's list<point> OUTPUT (a JS
          // array of [r,z], emitted into the prelude as `V_<output>` by
          // emitExprBlocks) straight into the polygon's points. Mirrors the
          // poly_repeat repeat-ref below, but the source is an ExprNode.
          const src = nodes[entry.sourceId] as any;
          if (!src || src.type !== 'expr' || !entry.output) return '';
          return `...${exprBlockVar(entry.sourceId)}_${entry.output}`;
        }
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
        // A repeat-ref (#805) chases its sourceId to the SketchRepeatNode and
        // emits an `...Array.from(...).flat()` spread of the tiled prototype.
        // Each iteration returns an ARRAY of op objects (the optional leading
        // `(dr,dz)` advance + the prototype ops); `.flat()` splices them in.
        // i / NPts / bindings are in scope — mirrors the polygon repeat-ref.
        // This MUST stay byte-equivalent to expandSketchOps (sketch-repeat.ts).
        if (o?.op === 'expr-list-ref') {
          // #11 — splice an expression instance's list<point> OUTPUT (a JS array
          // of [r,z], emitted into the prelude as `V_<output>` by emitExprBlocks)
          // as a run of `line` ops. Recomputed at bake (parametric), NOT statically
          // expanded — mirrors the polygon expr-list-ref splice (~line 625).
          const src = nodes[o.sourceId] as any;
          if (!src || src.type !== 'expr' || !o.output) return '';
          return `...(${exprBlockVar(o.sourceId)}_${o.output}).map((__p) => ({ op: 'line', r: __p[0], z: __p[1] }))`;
        }
        if (o?.op === 'repeat-ref') {
          const src = nodes[o.sourceId] as any;
          if (!src || src.type !== 'sketch_repeat') return '';
          const count = emitValueExpr(src.count);
          const loopVar = /^[A-Za-z_$][\w$]*$/.test(String(src.loopVar || '')) ? String(src.loopVar) : 'i';
          const bindings: Array<{ name: string; value: any }> = Array.isArray(src.bindings) ? src.bindings : [];
          const valid = bindings.filter((b) => b && typeof b.name === 'string' && /^[A-Za-z_$][\w$]*$/.test(b.name));
          const bindLines = valid.map((b) => `const ${b.name} = ${emitValueExpr(b.value)};`).join(' ');
          const preamble = bindLines ? `const NPts = ${count}; ${bindLines}` : `const NPts = ${count};`;
          const hasAdvance = src.dr != null || src.dz != null;
          const drE = src.dr != null ? emitValueExpr(src.dr) : '0';
          const dzE = src.dz != null ? emitValueExpr(src.dz) : '0';
          const protoObjs = (Array.isArray(src.ops) ? src.ops : [])
            .map((po: any) => emitSketchOpObject(po)).filter(Boolean);
          const items = hasAdvance
            ? [`{ op: 'line', mode: 'rel', r: ${drE}, z: ${dzE} }`, ...protoObjs]
            : protoObjs;
          return `...Array.from({ length: ${count} }, (_, ${loopVar}) => { ${preamble} return [${items.join(', ')}]; }).flat()`;
        }
        // `mode:'rel'` → compileSketch accumulates (r,z) as a Δ from the
        // previous vertex; emitted verbatim so the bake matches the editor.
        return emitSketchOpObject(o);
      }).filter(Boolean);
      const seg = (node as any).segments != null ? emitValueExpr((node as any).segments) : '64';
      // Whole-sketch scale → trailing positional args of the `sketch(...)` call
      // (compileSketch(ops, segments, scaleX, scaleY)). Omitted entirely when
      // both are absent / literal 1 so pre-scale parts round-trip byte-identically.
      const sx = (node as any).scaleX;
      const sy = (node as any).scaleY;
      const isOne = (v: any) => v == null || (v.kind === 'literal' && v.value === 1);
      if (!isOne(sx) || !isOne(sy)) {
        const sxE = sx != null ? emitValueExpr(sx) : '1';
        const syE = sy != null ? emitValueExpr(sy) : '1';
        return `sketch([${ops.join(', ')}], ${seg}, ${sxE}, ${syE})`;
      }
      return `sketch([${ops.join(', ')}], ${seg})`;
    }
    case 'expr':
      // Expr blocks are NON-geometry calculation nodes — their named outputs
      // emit as prelude `const` bindings (see emitExprBlocks), referenced by
      // whatever arg sockets they're wired into. They are never a geometry
      // value, so they contribute nothing to this node-expression pass.
      return null;
    case 'spline':
      // Spline path producers emit a prelude const (see emitSplineBlocks), not a
      // geometry value — nothing in this node-expression pass.
      return null;
    case 'warp': {
      // Bend the built child solid along the spline path (#36):
      //   warpSpline(<child>, <path>, { refine, stretch, validate })
      // `warpSpline` = the sandbox-injected `warpManifoldAlongSpline`
      // (primitive-sandbox.ts). The path is normally an `expr` referencing a
      // wired SplineNode's prelude const (`_x_<id>_path`), so it resolves to the
      // resampled control-point array warpManifoldAlongSpline re-splines. The
      // opts object is emitted only when a non-default lever is set, so the
      // common case stays the terse `warpSpline(child, path)`.
      const child = ref(node.child ?? '', 'child');
      const pathExpr = emitValueExpr(node.path);
      const optParts: string[] = [];
      if (node.refine != null) optParts.push(`refine: ${emitValueExpr(node.refine)}`);
      if (node.stretch) optParts.push(`stretch: true`);
      if (node.validate) optParts.push(`validate: true`);
      const opts = optParts.length ? `, { ${optParts.join(', ')} }` : '';
      return `warpSpline(${child}, ${pathExpr}${opts})`;
    }
  }
}

// ─── Expr-instance prelude (B.7 / id 914 v3) ────────────────────────────────
//
// Each Expr INSTANCE node (`{type:'expr', defId, bindings}`) emits a numeric
// PRELUDE from its DEFINITION (`graph.exprDefs`), namespaced per-instance by
// `V = exprBlockVar(node.id)` (a PURE fn of the node id so emit + wiring agree).
// Eval order per def (orderExprDef): params → consts → vars(topo) → outputs(topo):
//   const V_<param> = <binding emit | default | 0>;   // PARAMS  (wired per instance)
//   const V_<const> = <value>;                         // CONSTS
//   const V_<var>   = <formula, locals → V_*>;          // VARIABLES (topo)
//   const V_<out>   = <formula, locals → V_*>;          // OUTPUTS   (topo)
// A consumer wiring an output socket into an arg references `V_<out>`. Two
// instances of one def → two independent V-namespaced groups. ABSENT/EMPTY
// exprDefs OR no instances ⇒ no prelude ⇒ byte-identical to today.

/** The PRELUDE `const` lines for every Expr INSTANCE in the graph (empty when
 *  there are none — the byte-identical guarantee). */
export function emitExprBlocks(graph: Graph): string[] {
  const defs = new Map((graph.exprDefs ?? []).map((d) => [d.id, d]));
  const lines: string[] = [];
  for (const node of Object.values(graph.nodes)) {
    if (!node || node.type !== 'expr') continue;
    const inst = node as ExprNode;
    const def: ExprDef | undefined = defs.get(inst.defId);
    if (!def) continue; // dangling instance — nothing to emit (PR-4 surfaces it)
    const V = exprBlockVar(inst.id);
    const locals = declaredNames(def);
    const bindings = inst.bindings ?? {};
    for (const item of orderExprDef(def).order) {
      if (item.section === 'param') {
        const p = item.param;
        const bound = bindings[p.name];
        const rhs = bound != null ? emitValueExpr(bound)
          : p.default != null ? String(p.default)
          : '0';
        lines.push(`const ${V}_${p.name} = ${rhs};`);
      } else if (item.section === 'const') {
        lines.push(`const ${V}_${item.konst.name} = ${item.konst.value};`);
      } else if (item.section === 'var') {
        lines.push(`const ${V}_${item.vardef.name} = ${rewriteExprLocalRefs(item.vardef.formula, V, locals)};`);
      } else {
        const out = item.output;
        // An `'auto'` output (Phase A) is compiled as a LIST when its formula
        // structurally produces one (an array literal / map / concat, or the
        // imperative accumulator form); otherwise it falls through to the scalar
        // path. Explicit `'list'` always takes the list path; everything else
        // (scalar / undefined) is byte-identical to before — emit is unchanged
        // for existing parts (none carry `'auto'`).
        const autoList = out.shape === 'auto'
          && (isImperative(out.formula) || inferStructure(out.formula).type?.kind === 'list');
        if (out.shape === 'list' || autoList) {
          // A list output (#11) is compiled from the constrained mathjs grammar
          // to a JS array expression, THEN its def-local symbols are namespaced
          // to V_* (same rewrite as a scalar output; loop params + math globals
          // survive untouched). A bad formula emits a loud throw IIFE rather
          // than a silent placeholder that would crash WASM downstream.
          // Two styles: the imperative accumulator (poly=[]; for…; poly.append(…))
          // compiles to a JS loop; otherwise the functional map/concat form. Both
          // return { ok, js }; loop-locals (poly/point/i) stay bare, def params → V_*.
          const compiled = isImperative(out.formula)
            ? compileImperative(out.formula)
            : compileListFormula(out.formula);
          const rhs = compiled.ok
            ? rewriteExprLocalRefs(compiled.js, V, locals)
            : `(() => { throw new Error(${JSON.stringify('list output "' + out.name + '" error — ' + compiled.error)}); })()`;
          lines.push(`const ${V}_${out.name} = ${rhs};`);
        } else {
          lines.push(`const ${V}_${out.name} = ${rewriteExprLocalRefs(out.formula, V, locals)};`);
        }
      }
    }
  }
  return lines;
}

// ─── Spline path-producer prelude (TODO #15) ────────────────────────────────
//
// Each `spline` node lowers to ONE prelude const binding the resampled curve:
//   const _x_<id>_path = resampleSpline([[x,y,z], …], <N>);
// `_x_<id>_path` is exprBlockMember(id, 'path') — the SAME identifier the wire
// handler computes (wire.startExprOutWire(ev, id, 'path') → endWireOnCallArg →
// exprBlockMember(id, 'path')), so a Call's `path` arg wired to the spline's
// output references this const. `resampleSpline` is injected into the sandbox by
// name (primitive-sandbox.ts), so the bake stays three.js-free.

/** The PRELUDE `const` lines for every spline node (empty when there are none —
 *  the byte-identical guarantee). */
export function emitSplineBlocks(graph: Graph): string[] {
  const lines: string[] = [];
  for (const node of Object.values(graph.nodes)) {
    if (!node || node.type !== 'spline') continue;
    // WIRED control-points source (TODO #26) OVERRIDES the manual literal: emit
    // the wired producer's output var (an expr instance's `_x_<id>_<out>` const,
    // or a `p.<param>`) in place of the `[[x,y,z],…]` array. `resampleSpline`
    // still smooths + arc-length-resamples the runtime array. Absent ⇒ the
    // manual literal (byte-identical to before).
    const pxpr = (node as any).pointsExpr as ArgValue | undefined;
    let ptsLit: string;
    if (pxpr && (pxpr.kind === 'expr' || pxpr.kind === 'param')) {
      ptsLit = emitValueExpr(pxpr);
    } else {
      const pts = Array.isArray((node as any).points) ? (node as any).points : [];
      ptsLit = `[${pts
        .map((p: any[]) => `[${Number(p?.[0]) || 0}, ${Number(p?.[1]) || 0}, ${Number(p?.[2]) || 0}]`)
        .join(', ')}]`;
    }
    const samples = (node as any).samples != null ? emitValueExpr((node as any).samples) : '32';
    // The spline OWNS loop-ness: a closed spline resamples around the full ring
    // (no reflected endpoints). Consumers wired to this path auto-follow the flag
    // (see the `call` arg emit → closedPath / caps). Absent ⇒ false ⇒ open.
    const closed = (node as any).closed === true;
    lines.push(`const ${exprBlockMember(node.id, 'path')} = resampleSpline(${ptsLit}, ${samples}, ${closed});`);
  }
  return lines;
}

/** The `spline` node whose OUTPUT the given `path` ArgValue references, or null.
 *  A wired path arg is `{kind:'expr', expr:'_x_<splineId>_path'}` (exactly
 *  `exprBlockMember(splineId,'path')`); we match that against every spline node.
 *  Only a genuine spline source qualifies — hand-authored / expr-IIFE paths
 *  (any other expr string) return null, so their explicit closedPath is kept. */
function splineSourceOfPath(pathArg: ArgValue | undefined, nodes: Record<NodeId, GraphNode>): SplineNode | null {
  if (!pathArg || pathArg.kind !== 'expr') return null;
  for (const n of Object.values(nodes)) {
    if (n && n.type === 'spline' && exprBlockMember(n.id, 'path') === pathArg.expr) return n as SplineNode;
  }
  return null;
}

function emitCallExpr(src: string, args: Record<string, ArgValue>, nodes?: Record<NodeId, GraphNode>): string {
  // AUTO-FOLLOW (spline owns loop-ness): when a call's `path` arg is wired to a
  // spline node's output, the spline decides whether the sweep is a loop —
  // OVERRIDE closedPath + caps from its `closed` flag (closed ⇒ closedPath:true,
  // caps:false ; open ⇒ closedPath:false, caps:true). A path from any other
  // source (hand-authored expr IIFE, literal) is left untouched, so those keep
  // whatever closedPath/caps the graph stored. Only spreads keys when a spline
  // source is found ⇒ byte-identical emit for every non-spline call.
  let effArgs = args;
  const sp = nodes ? splineSourceOfPath(args.path, nodes) : null;
  if (sp) {
    const closed = sp.closed === true;
    effArgs = { ...args, closedPath: asLiteral(closed), caps: asLiteral(!closed) };
  }
  const keys = Object.keys(effArgs);
  if (keys.length === 0) return `${src}({})`;
  const lines = keys.map((k) => `${k}: ${emitValueExpr(effArgs[k]!)}`);
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

/** True for a literal `0` ArgValue — used by the txfmn emit to elide an
 *  identity rotation / translation so a pure-mv or pure-rot TXFMN emits the
 *  same bare `mv(...)` / `rot(...)` the legacy two-node form did. */
function isLiteralZero(v: ArgValue): boolean {
  return v.kind === 'literal' && Number(v.value) === 0;
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
    } else if (n.type === 'mv' || n.type === 'rot' || n.type === 'txfmn') {
      if (n.child) consumed.add(n.child);
    } else if (n.type === 'warp') {
      // The warp's bent solid is an INPUT — consumed so it doesn't double-emit
      // as an Output + its × delete button greys (mirrors mv/rot child).
      if (n.child) consumed.add(n.child);
    } else if (n.type === 'repeat') {
      // Every wired PART is an input to the repeat — consumed so it doesn't
      // double-emit as an Output and its delete button greys.
      for (const c of n.children ?? []) consumed.add(c);
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
    } else if (n.type === 'sketch') {
      // A sketch's repeat-ref entries consume their SketchRepeatNode source
      // (#805) so it never double-emits as an Output + its × greys out —
      // exactly the polygon repeat-ref / __POLY__ precedent.
      for (const o of (n.ops as any[]) ?? []) {
        if (o?.op === 'repeat-ref' && o.sourceId) consumed.add(o.sourceId);
      }
    } else if (n.type === 'call') {
      // Call args carrying a `__POLY__<sourceId>` sentinel expr consume
      // the source node (the polygon, today). Without this, the polygon
      // and the revolve BOTH show up as Output children — the user sees
      // two outputs when there's really only one (the revolve's solid).
      for (const v of Object.values(n.args)) {
        if (v.kind !== 'expr') continue;
        const matches = v.expr.match(/__POLY__(n_[a-z0-9_]+)/gi);
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
        node.type === 'txfmn'   ? 'txfmn_obj' :
        node.type === 'polygon' ? 'poly' :
        node.type === 'sketch'  ? 'sketch' :
        node.type === 'warp'    ? 'warp_obj' :
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
    // Part-level appearance — sparse so legacy files stay clean. hydrateGraph
    // reads these back into graph.colorOuter / graph.colorInner / graph.material.
    ...(graph.colorOuter ? { colorOuter: graph.colorOuter } : {}),
    ...(graph.colorInner ? { colorInner: graph.colorInner } : {}),
    ...(graph.material ? { material: graph.material } : {}),
    // Render OPACITY (0–1) — sparse so legacy/opaque files stay byte-identical.
    // hydrateGraph reads this back into graph.opacity.
    ...(typeof graph.opacity === 'number' && graph.opacity < 1 ? { opacity: graph.opacity } : {}),
    // Named material TEXTURE (G-MAT2) — sparse so un-textured files stay byte-
    // identical. hydrateGraph reads this back into graph.texture.
    ...(typeof graph.texture === 'string' && graph.texture.trim() ? { texture: graph.texture.trim() } : {}),
    // Editor VIEW scale (VIEW-ONLY) — sparse so legacy files stay byte-identical.
    // hydrateGraph reads these back into graph.viewZScale / graph.viewXScale.
    ...(graph.viewZScale != null ? { viewZScale: graph.viewZScale } : {}),
    ...(graph.viewXScale != null ? { viewXScale: graph.viewXScale } : {}),
    ...(graph.partAppearance && Object.keys(graph.partAppearance).length ? { partAppearance: graph.partAppearance } : {}),
    // Calculated expressions (B.6 / id 914) — sparse so legacy files stay
    // byte-identical. hydrateGraph reads these back into graph.exprs.
    ...(graph.exprs && graph.exprs.length ? { exprs: graph.exprs } : {}),
    // Expression DEFINITIONS (B.7 / id 914 v3) — sparse so legacy files stay
    // byte-identical. hydrateGraph reads these back into graph.exprDefs.
    ...(graph.exprDefs && graph.exprDefs.length ? { exprDefs: graph.exprDefs } : {}),
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
