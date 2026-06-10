/**
 * composition-emit-profile.ts — profile graph → `build(p)` body.
 *
 * Sister of composition-emit.ts (which emits 3D part `.asm.ts` source).
 * Walks a profile graph — Output ← Polygon node(s) — and emits a JS
 * `export function build(p) { return [[r, z], …]; }` body.
 *
 * The profile editor's SOLE producer is the Polygon node — a compact
 * ordered list of vertices where each (r, z) coord is an ArgValue
 * (literal / expression / wired to a PARAMS slider via the ƒ-popup).
 * The earlier pen_* turtle-graphics nodes (pen_mv / pen_line / lineR /
 * lineZ) were the wrong shape for a parametric polygon — replaced by
 * this single-table model. Pen Call nodes are still tolerated as a
 * legacy back-compat path so any graph saved during the Phase 2a/2b
 * iteration still resolves.
 *
 * The emitted body is sandbox-evaluated server-side by
 * /api/primitives/profiles/resolve (the same endpoint that runs hand-
 * authored profile build() bodies today).
 *
 * Body shape (polygon path):
 *
 *   export function build(p) {
 *     return [
 *       [<r0>, <z0>],
 *       [<r1>, <z1>],
 *       …
 *     ];
 *   }
 *
 * Body shape (legacy pen path — kept until those graphs are migrated):
 *
 *   export function build(p) {
 *     const pts = [];
 *     let _pen = [0, 0];
 *     …pen_mv / pen_line / pen_lineR / pen_lineZ lines…
 *     return pts;
 *   }
 */

import type { Graph, GraphNode, ArgValue, NodeId } from './composition-graph';

/** Render an ArgValue (literal / expr / param) into a JS expression
 *  string. Mirrors the renderer in composition-emit.ts; pure transform. */
function argToCode(arg: ArgValue | undefined): string {
  if (!arg) return '0';
  if (arg.kind === 'literal') {
    const v = arg.value;
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
    if (typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return '0';
  }
  if (arg.kind === 'expr') return arg.expr || '0';
  if (arg.kind === 'param') return `p.${arg.param}`;
  return '0';
}

export interface EmitProfileOptions {
  /** Indentation prefix — internal, used when recursing into a repeat
   *  body so nested lines align. Default is two spaces (inside the
   *  build function). */
  indent?: string;
}

export interface EmitProfileResult {
  /** The complete `export function build(p) { … }` source string. */
  source: string;
  /** The body lines (no wrapper) — useful for debugging or composing
   *  into a larger document. */
  body: string;
  /** Sentinel `src` tags discovered during the walk — useful for the
   *  caller to validate every Call references a known pen op. */
  usedOps: string[];
}

/** Top-level entry point — emit a complete `export function build(p)`
 *  for a profile graph. Walks the root list's children in declared
 *  order. The body shape depends on which nodes are present:
 *
 *    * Polygon-only (the new canonical path) — single literal
 *      `return [[r0, z0], …]` collected from each PolygonNode's points.
 *    * Pen-only (legacy back-compat) — `const pts = []; let _pen = …;
 *      <pen ops>; return pts;`
 *    * Mixed — start with the polygon literal, then run any pen
 *      operations as a `pts.push` chain.
 */
export function emitProfileGraph(graph: Graph, _opts: EmitProfileOptions = {}): EmitProfileResult {
  const used = new Set<string>();

  // First pass — does the graph contain Polygon nodes? If yes we drive
  // the body from those (the new canonical path). Pen nodes get tacked
  // on as a back-compat append. A fully empty graph returns an empty
  // array (the SVG handles "no points" gracefully).
  const polyRows: string[] = [];
  const penLines: string[] = [];
  if (graph.nodes[graph.root] && (graph.nodes[graph.root] as any).type === 'list') {
    collectFromList((graph.nodes[graph.root] as any).children as NodeId[], graph, polyRows, penLines, used, '  ');
  }

  let body: string;
  if (penLines.length === 0) {
    // Pure polygon path — clean literal array return.
    body = polyRows.length > 0
      ? `  return [\n${polyRows.map((r) => `    ${r},`).join('\n')}\n  ];`
      : `  return [];`;
  } else {
    // Mixed / legacy pen path — keep the pts builder for the pen ops.
    const lines: string[] = ['  const pts = [];', '  let _pen = [0, 0];'];
    if (polyRows.length > 0) {
      for (const r of polyRows) lines.push(`  pts.push(${r});`);
    }
    for (const l of penLines) lines.push(l);
    lines.push('  return pts;');
    body = lines.join('\n');
  }
  const source = `export function build(p) {\n${body}\n}\n`;
  return { source, body, usedOps: Array.from(used) };
}

/** Walk a list of children, collecting polygon vertex rows + legacy pen
 *  op lines into separate buckets. The caller stitches the buckets into
 *  the final body shape. */
function collectFromList(
  children: NodeId[], graph: Graph, polyRows: string[], penLines: string[], used: Set<string>, indent: string,
) {
  for (const cid of children) {
    const child = graph.nodes[cid];
    if (!child) continue;
    collectFromNode(child, graph, polyRows, penLines, used, indent);
  }
}

function collectFromNode(
  node: GraphNode, graph: Graph, polyRows: string[], penLines: string[], used: Set<string>, indent: string,
) {
  if ((node as any).type === 'polygon') {
    const poly = node as any;
    for (const entry of poly.points as Array<any>) {
      // Repeat-ref (#157) — look up the PolyRepeatNode it points to and
      // emit ITS r/z expressions as an Array.from spread.
      if (entry?.kind === 'repeat-ref') {
        const src = graph.nodes[entry.sourceId] as any;
        if (!src || src.type !== 'poly_repeat') continue;
        const count = argToCode(src.count);
        const loopVar = /^[A-Za-z_$][\w$]*$/.test(String(src.loopVar || ''))
          ? String(src.loopVar) : 'i';
        const r = argToCode(src.r);
        const z = argToCode(src.z);
        // NPts is always in scope inside the loop body (#157, 2026-06-11)
        // so the user can write `i / NPts` as a 0..1 fraction or
        // `i * tau / NPts` as an angle without having to repeat the
        // count expression. Bindings (#157) emit as `const` lines AFTER
        // NPts so they can reference it.
        const bindings: Array<{ name: string; value: any }> = Array.isArray(src.bindings) ? src.bindings : [];
        const validBindings = bindings.filter((b) =>
          b && typeof b.name === 'string' && /^[A-Za-z_$][\w$]*$/.test(b.name)
        );
        const bindingLines = validBindings.map((b) => `      const ${b.name} = ${argToCode(b.value)};`).join('\n');
        const preamble = validBindings.length > 0
          ? `      const NPts = ${count};\n${bindingLines}\n`
          : `      const NPts = ${count};\n`;
        polyRows.push(
          `...Array.from({ length: ${count} }, (_, ${loopVar}) => {\n${preamble}      return [${r}, ${z}];\n    })`,
        );
        continue;
      }
      // DEPRECATED inline repeat block (#154 / pre-#157). The hydrate path
      // migrates these to repeat-refs; this branch handles raw graphs
      // that somehow bypassed hydration.
      if (entry?.kind === 'repeat') {
        const count = argToCode(entry.count);
        const loopVar = /^[A-Za-z_$][\w$]*$/.test(String(entry.loopVar || ''))
          ? String(entry.loopVar) : 'i';
        const r = argToCode(entry.r);
        const z = argToCode(entry.z);
        polyRows.push(`...Array.from({ length: ${count} }, (_, ${loopVar}) => [${r}, ${z}])`);
        continue;
      }
      // Literal vertex (legacy entries lack `kind` — default to 'point').
      const r = argToCode(entry.r);
      const z = argToCode(entry.z);
      polyRows.push(`[${r}, ${z}]`);
    }
    used.add('polygon');
    return;
  }
  // Legacy pen path — collected so existing graphs from Phase 2a/2b still resolve.
  if ((node as any).type === 'call') {
    emitNode(node, graph, penLines, used, indent);
    return;
  }
  if ((node as any).type === 'repeat') {
    emitNode(node, graph, penLines, used, indent);
    return;
  }
  if ((node as any).children && Array.isArray((node as any).children)) {
    collectFromList((node as any).children as NodeId[], graph, polyRows, penLines, used, indent);
  }
}

/** Walk a list of child ids in declared order, emitting each child's
 *  legacy-pen contribution into `lines`. Unknown types are skipped. */
function walkList(children: NodeId[], graph: Graph, lines: string[], used: Set<string>, indent: string) {
  for (const cid of children) {
    const child = graph.nodes[cid];
    if (!child) continue;
    emitNode(child, graph, lines, used, indent);
  }
}

function emitNode(node: GraphNode, graph: Graph, lines: string[], used: Set<string>, indent: string) {
  if ((node as any).type === 'call') {
    const call = node as any;
    const src: string = String(call.src ?? '');
    used.add(src);
    if (src === 'pen_mv' || src === 'pen_line') {
      const r = argToCode(call.args?.r);
      const z = argToCode(call.args?.z);
      lines.push(`${indent}_pen = [${r}, ${z}]; pts.push([_pen[0], _pen[1]]);`);
      return;
    }
    if (src === 'pen_lineR') {
      const dr = argToCode(call.args?.dr);
      const dz = argToCode(call.args?.dz);
      lines.push(`${indent}_pen = [_pen[0] + (${dr}), _pen[1] + (${dz})]; pts.push([_pen[0], _pen[1]]);`);
      return;
    }
    if (src === 'pen_lineZ') {
      const dz = argToCode(call.args?.dz);
      lines.push(`${indent}_pen = [_pen[0], _pen[1] + (${dz})]; pts.push([_pen[0], _pen[1]]);`);
      return;
    }
    // Unknown call src — pen op the emitter doesn't yet know about.
    // Emit a comment so a SRC tab reader can see what was skipped.
    lines.push(`${indent}// SKIPPED unknown pen op: ${JSON.stringify(src)}`);
    return;
  }

  // Repeat × N — JS for-loop wrapping the inner sequence. `i` is
  // available inside the loop so users can wire `p.r * i / N` etc.
  if ((node as any).type === 'repeat') {
    const rep = node as any;
    const count = argToCode(rep.count);
    const childId = rep.child as NodeId | undefined;
    const child = childId ? graph.nodes[childId] : null;
    if (!child) {
      lines.push(`${indent}// SKIPPED empty repeat (no child wired)`);
      return;
    }
    lines.push(`${indent}for (let i = 0; i < (${count}); i++) {`);
    if ((child as any).type === 'list') {
      walkList((child as any).children as NodeId[], graph, lines, used, indent + '  ');
    } else {
      emitNode(child, graph, lines, used, indent + '  ');
    }
    lines.push(`${indent}}`);
    return;
  }

  // Container (list / stack / group) — walk children. We treat all
  // containers uniformly for profiles since there's no place/stack
  // 3D semantics down here.
  if ((node as any).children && Array.isArray((node as any).children)) {
    walkList((node as any).children as NodeId[], graph, lines, used, indent);
    return;
  }

  // Anything else (method/mv/rot/etc) → silently skipped. The profile
  // picker doesn't surface these, but if a user converts a part graph
  // to a profile graph we don't want the emitter to throw.
}
