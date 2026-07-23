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
  resolveEffectiveAppearance,
  STACK_REF_PARAM,
  hasKind,
} from './composition-graph';
import {
  emitExprConsts, rewriteExprRefs,
  exprBlockVar, exprBlockMember, rewriteExprLocalRefs, orderExprDef, declaredNames,
  compileListFormula,
} from './graph-exprs';
import { isImperative, compileImperative } from './expr-imperative';
import { inferStructure } from './struct-type';
import { kindOf } from './nodes/registry';
import type { EmitCtx } from './nodes/node-kind';
import { partsTableRowVar, orderedRowKeys, partsTableInstanceColors } from './nodes/kinds/parts-table';
import { partsStackRowVar, partsStackInstanceColors } from './nodes/kinds/parts-stack';

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
  // Every node type is registered — its descriptor's validate() reproduces the
  // arm that used to live in a per-type switch here (Phase 2). Output is
  // byte-identical (unit-tested) and splices straight into errs.
  for (const node of Object.values(graph.nodes)) {
    if (!node) continue;
    errs.push(...(kindOf(node)?.validate(node, graph) ?? []));
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

  // #86 — per-part appearance → meta.instanceColors, keyed by the EMITTED var
  // name (== the loader's partHashId stamp) so the color-by-source LUT
  // (analyzeParts) renders each Call in its wired-material / per-part colour,
  // OVERRIDING the part-level Default. resolveEffectiveAppearance folds a wired
  // material node ahead of the manual partAppearance override. Sparse: a graph
  // with no overrides/materials emits nothing → byte-identical to today.
  const instanceColors: Record<string, { outer?: string; inner?: string; opacity?: number; material?: string }> = {};
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node?.type !== 'call') continue;
    const vn = varNames.get(id);
    if (!vn) continue;
    const eff = resolveEffectiveAppearance(graph, id);
    const entry: { outer?: string; inner?: string; opacity?: number } = {};
    if (eff.colorOuter) entry.outer = eff.colorOuter;
    if (eff.colorInner) entry.inner = eff.colorInner;
    if (typeof eff.opacity === 'number' && eff.opacity > 0 && eff.opacity < 1) entry.opacity = eff.opacity;
    if (Object.keys(entry).length) instanceColors[vn] = entry;
  }
  // #38d — PER-ROW parts_table material overrides. A parts_table's rows are PRELUDE
  // consts (`partsTableRowVar(id, i)`), NOT Call nodes, so their per-row override is
  // stamped into the SAME meta.instanceColors LUT here, keyed by that var name (==
  // the loader's per-row instance name). part-colors.appearanceFromOverride reads
  // {outer, opacity, material} back, so each row renders in its own colour via the
  // existing color-by-source path — all rows share one `src` and would otherwise
  // paint identically. Absent rowMaterials ⇒ an empty map ⇒ byte-identical emit.
  for (const node of Object.values(graph.nodes)) {
    if (node?.type !== 'parts_table') continue;
    Object.assign(instanceColors, partsTableInstanceColors(node));
  }
  // Per-row parts_stack material overrides — same LUT, keyed by partsStackRowVar.
  // A stack's rows are already different srcs (color-by-source differentiates them);
  // this is the per-row RE-SKIN. Absent ⇒ nothing stamped (byte-identical).
  for (const node of Object.values(graph.nodes)) {
    if (node?.type !== 'parts_stack') continue;
    Object.assign(instanceColors, partsStackInstanceColors(node));
  }

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
      const exprs = visible.map((c, i) => ({
        v: varNames.get(c) ?? missingRef(id, `children[${i}]`, c),
        // A LIST-producer child (e.g. a multi-input warp) emits a bare array — SPREAD
        // it into the return so its parts reach the top-level SEPARATELY (a nested
        // array would be re-composed by the loader's autoPlace = re-fused).
        producer: listProducers.has(c),
      }));
      if (exprs.length === 0)      returnExpr = 'undefined';
      // Sole child: return it bare — a producer's array IS the return (top-level
      // autoPlace then separates it), a solid returns unchanged (byte-identical).
      else if (exprs.length === 1) returnExpr = exprs[0]!.v;
      else                         returnExpr = `[${exprs.map((e) => (e.producer ? `...${e.v}` : e.v)).join(', ')}]`;
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
  if (Object.prototype.hasOwnProperty.call(graph.params, STACK_REF_PARAM) && returnExpr !== 'undefined'
      && hasKind(graph.params[STACK_REF_PARAM]!) === 'number') {
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
    // A parts_map INSTANTIATES its `src` part per row (#38) — it's a dependency
    // exactly like a Call's src, so the loader fetches the template part.
    if (n.type === 'parts_map' && n.src) usesSet.add(n.src);
    // A parts_table (#38b) instantiates its `src` template ONCE PER ROW — same
    // dependency wiring, so the loader fetches the template part.
    if (n.type === 'parts_table' && n.src) usesSet.add(n.src);
    // A parts_stack instantiates a DIFFERENT `src` per row — every distinct row src
    // is a dependency, so add them all so the loader fetches each element part.
    if (n.type === 'parts_stack') for (const r of (Array.isArray(n.rows) ? n.rows : [])) { if (r?.src) usesSet.add(r.src); }
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
    // #86 — per-part colour LUT (keyed by emitted var name) so the color-by-
    // source render applies each part's wired-material / override colour.
    ...(Object.keys(instanceColors).length ? { instanceColors } : {}),
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

  // ── Parts-table row-instance prelude (#38b) ────────────────────────────
  // Prepend the N per-row Call consts ABOVE the aggregate const (which lives in
  // the main body). Placed FIRST (innermost) so a later prepend — calc-expr /
  // spline / expr-block — lands ABOVE it, letting a row cell reference those
  // outputs. ABSENT ⇒ [] ⇒ byte-identical to today.
  const partsTableBlockLines = emitPartsTableBlocks(graph);
  if (partsTableBlockLines.length > 0) {
    const block = partsTableBlockLines.map((l) => `  ${l}`).join('\n');
    bodyText = `${block}\n${bodyText}`;
  }

  // ── Parts-stack row-instance prelude — the N per-row Call consts (each its OWN
  // src) that PartsStackKind.emitExpr mates via `stack([...])`. Same placement +
  // TDZ reasoning as the parts_table prelude. ABSENT ⇒ [] ⇒ byte-identical.
  const partsStackBlockLines = emitPartsStackBlocks(graph);
  if (partsStackBlockLines.length > 0) {
    const block = partsStackBlockLines.map((l) => `  ${l}`).join('\n');
    bodyText = `${block}\n${bodyText}`;
  }

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
  // Every node kind emits through its descriptor (Phase 2 — the hand-written
  // switch is gone). emitValueExpr / emitCallExpr / exprBlockVar /
  // emitSketchOpObject are threaded via ctx so the cad-layer descriptors stay
  // decoupled from emit internals (importing them directly would cycle).
  const ctx: EmitCtx = { ref, emitValue: emitValueExpr, emitCall: (src, args) => emitCallExpr(src, args, nodes), varNames, listProducers: listProducers ?? new Set(), nodes, exprBlockVar, emitSketchOp: emitSketchOpObject };
  return kindOf(node)?.emitExpr(node, ctx) ?? null;
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
    // SURVEY MODE (N3b): `points` are `[md,dev,az]` stations → convert to xyz by
    // minimum curvature FIRST (`surveyToXYZ`, sandbox-injected), then resample.
    // EXPLICIT mode, never sniffed from the data. Absent / 'xyz' ⇒ the literal
    // control points, byte-identical to before.
    const ptsSrc = (node as any).mode === 'survey' ? `surveyToXYZ(${ptsLit})` : ptsLit;
    lines.push(`const ${exprBlockMember(node.id, 'path')} = resampleSpline(${ptsSrc}, ${samples}, ${closed});`);
  }
  return lines;
}

// ─── Parts-table row-instance prelude (#38b) ────────────────────────────────
//
// Each `parts_table` node lowers to N prelude consts — ONE Call PER ROW —
//   const _pt_<id>_0 = <src>({ …row0 });
//   const _pt_<id>_1 = <src>({ …row1 });
// each bound to `partsTableRowVar(id, i)` (its OWN output socket, wireable
// individually). PartsTableKind.emitExpr then emits the AGGREGATE `[_pt_<id>_0,
// …]` (marked a LIST PRODUCER) so the root returns it and the loader autoPlaces
// each row as a SEPARATE `_parts` body (no compose / no fusion). The consts are
// prepended ABOVE the aggregate const (JS const TDZ satisfied). ABSENT ⇒ no
// parts_table nodes ⇒ no prelude ⇒ byte-identical to today.

/** The PRELUDE `const` lines for every parts_table node — the N per-row Call
 *  instructions (empty when there are none — the byte-identical guarantee). Each
 *  row emits its columns in the node's declared `columns` order (deterministic);
 *  a column absent from a row is omitted so the template's own default carries. */
export function emitPartsTableBlocks(graph: Graph): string[] {
  const lines: string[] = [];
  for (const node of Object.values(graph.nodes)) {
    if (!node || node.type !== 'parts_table') continue;
    // A WIRED table (#38c) emits its rows as ONE runtime `Array.from(...)` (in
    // PartsTableKind.emitExpr) — there are NO fixed per-row consts, so the prelude
    // contributes nothing. Only the INLINE-rows path emits the `_pt_<id>_i` consts.
    if (node.dataInput) continue;
    const rows = Array.isArray(node.rows) ? node.rows : [];
    rows.forEach((row, i) => {
      const args: Record<string, ArgValue> = {};
      for (const k of orderedRowKeys(node, row ?? {})) args[k] = (row ?? {})[k]!;
      // Object-style call through the shared emitter — the SAME `src({ … })` shape
      // a Call / parts_map lambda produces (the loader's __adapt shim handles it).
      lines.push(`const ${partsTableRowVar(node.id, i)} = ${emitCallExpr(node.src, args, graph.nodes)};`);
    });
  }
  return lines;
}

/** The PRELUDE `const` lines for every parts_stack node — one per-row Call, each
 *  with its OWN `src` (heterogeneous). PartsStackKind.emitExpr then mates them via
 *  `stack([_ps_<id>_0, …])`. Empty when there are no parts_stack nodes (byte-
 *  identical). A blank row `src` is skipped here (validate greys the card). */
export function emitPartsStackBlocks(graph: Graph): string[] {
  const lines: string[] = [];
  for (const node of Object.values(graph.nodes)) {
    if (!node || node.type !== 'parts_stack') continue;
    const rows = Array.isArray(node.rows) ? node.rows : [];
    rows.forEach((row, i) => {
      const src = typeof row?.src === 'string' ? row.src : '';
      const args = (row?.args && typeof row.args === 'object') ? row.args : {};
      lines.push(`const ${partsStackRowVar(node.id, i)} = ${emitCallExpr(src, args, graph.nodes)};`);
    });
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
      // `field` (#38) — dotted access into a RECORD param (`p.spec.od`).
      // Sparse/optional: absent ⇒ the bare `p.<name>`, byte-identical to every
      // legacy param slot (golden-emit safety net).
      return `p.${v.param}${v.field ? '.' + v.field : ''}`;
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
    // A parts_map with op:'list' (its DEFAULT) emits a bare `Array.from(...)` of
    // N part instances (#38) — a parent Stack `...`-spreads it just like a Repeat.
    if (n.type === 'parts_map' && ((n as any).op ?? 'list') === 'list') set.add(n.id);
    // A parts_table (#38b) ALWAYS emits a bare array `[row0, row1, …]` of N part
    // instances that render SEPARATE — the parent Stack / root `...`-spreads it so
    // each row stays its OWN body (no compose → no fusion), exactly like above.
    if (n.type === 'parts_table') set.add(n.id);
    // A parts_stack emits a bare array `[stack([…]), mv(…), …]` ONLY when a row is
    // ANCHORED (has `top`) — separate bodies to spread. With nothing anchored it emits
    // ONE mated `stack([…])` (a single value), so it's a list producer conditionally.
    if (n.type === 'parts_stack' && Array.isArray((n as any).rows) && (n as any).rows.some((r: any) => r?.top)) set.add(n.id);
    // A multi-input warp (#36b) emits `[warpSpline(a,…), warpSpline(b,…)]` — a bare
    // array of per-part warps; the parent Stack / root `...`-spreads it so each
    // warped part stays a SEPARATE body (no compose → no fusion).
    if (n.type === 'warp' && Array.isArray((n as any).children) && (n as any).children.length > 1) set.add(n.id);
    // (Future: bare list nodes that aren't the root list, group containers, etc.)
  }
  // PROPAGATE through a SINGLE-child warp: `warpSpline(listChild, path)` maps the
  // warp over the list (see warpManifoldAlongSpline's array guard), so its runtime
  // value is ALSO a bare array. Mark it a producer so a downstream Stack / the root
  // SPREADS it (…) instead of nesting `[[…], …]` (which the loader would re-fuse).
  // Fixpoint so it's independent of node iteration order (a warp whose child is a
  // warp-of-a-list-producer, etc.). Only touches graphs with warp-of-a-list — a new
  // pattern with no existing golden, so byte-identical for every current part.
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of Object.values(graph.nodes)) {
      if (n.type !== 'warp' || set.has(n.id)) continue;
      const kid = (Array.isArray((n as any).children) && (n as any).children.length === 1)
        ? (n as any).children[0]
        : (n as any).child;
      if (kid && set.has(kid)) { set.add(n.id); changed = true; }
    }
  }
  return set;
}

function computeConsumedSet(graph: Graph): Set<NodeId> {
  const consumed = new Set<NodeId>();
  // Each node-kind descriptor's `inputRefs` enumerates the NodeIds it consumes —
  // method obj/arg, mv/rot/txfmn/warp child, container/repeat children, sketch
  // repeat-ref sources, call __POLY__ sentinels. Skipping the ROOT node is what
  // preserves the "root list's children are the OUTPUT, not consumed" rule
  // (ContainerKind.inputRefs returns children unconditionally; this skip is the
  // sole home of the root exception the old `n.id !== graph.root` guard held).
  for (const n of Object.values(graph.nodes)) {
    if (!n || n.id === graph.root) continue;
    for (const id of kindOf(n)?.inputRefs(n) ?? []) consumed.add(id);
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
        node.type === 'cutaway' ? 'cut_obj' :
        node.type === 'parts_map' ? 'parts' :
        node.type === 'parts_table' ? 'table' :
        node.type === 'parts_stack' ? 'pstack' :
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
    // MATERIAL wire bindings (callId → materialNodeId) — sparse so files with no
    // material wiring stay byte-identical. hydrateGraph reads this back.
    ...(graph.materialBindings && Object.keys(graph.materialBindings).length ? { materialBindings: graph.materialBindings } : {}),
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
