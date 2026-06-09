/**
 * composition-emit-profile.ts — profile graph → `build(p)` body.
 *
 * Sister of composition-emit.ts (which emits 3D part `.asm.ts` source).
 * Walks a profile graph — Output ← chain of pen_* Call nodes + repeat
 * containers — and emits a JavaScript function body that returns an
 * array of `[r, z]` (revolve) or `[x, y]` (cartesian) points.
 *
 * Pen vocabulary (`src` strings):
 *
 *   pen_mv    args { r, z }     move pen to absolute (places first vertex
 *                                or starts a new sub-path; we treat it as
 *                                "place a vertex at the given point")
 *   pen_line  args { r, z }     line to absolute point
 *   pen_lineR args { dr, dz }   line to relative offset from previous pen
 *   pen_lineZ args { dz }       vertical line (same r, dz down/up)
 *
 * Repeat × N (container kind 'repeat') wraps a sub-sequence with a JS
 * `for (let i = 0; i < N; i++) { … }` loop. Inside the loop, `i` is
 * available so the user can express `p.r * i / N` etc. via the ƒ-popup
 * on any arg.
 *
 * The emitted body is sandbox-evaluated server-side by
 * /api/primitives/profiles/resolve (the same endpoint that runs hand-
 * authored profile build() bodies today).
 *
 * Body shape:
 *
 *   export function build(p) {
 *     const pts = [];
 *     let _pen = [0, 0];
 *     // pen_mv → _pen = [<r>, <z>]; pts.push([..._pen]);
 *     // pen_line → _pen = [<r>, <z>]; pts.push([..._pen]);
 *     // pen_lineR → _pen = [_pen[0] + <dr>, _pen[1] + <dz>]; pts.push([..._pen]);
 *     // pen_lineZ → _pen = [_pen[0], _pen[1] + <dz>]; pts.push([..._pen]);
 *     // for (let i = 0; i < <count>; i++) { … }
 *     return pts;
 *   }
 *
 * `_pen` tracks the last placed vertex so relative ops can chain without
 * the emitter needing to peek at the previous static value (which would
 * break inside a repeat loop — the previous vertex inside iteration
 * isn't a compile-time constant).
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
 *  order (no topological sort needed because there's no method/CSG
 *  here — every node is a Call or a Container). */
export function emitProfileGraph(graph: Graph, _opts: EmitProfileOptions = {}): EmitProfileResult {
  const used = new Set<string>();
  const lines: string[] = [];
  lines.push('  const pts = [];');
  lines.push('  let _pen = [0, 0];');

  const rootNode = graph.nodes[graph.root];
  if (rootNode && (rootNode as any).type === 'list') {
    walkList((rootNode as any).children as NodeId[], graph, lines, used, '  ');
  }

  lines.push('  return pts;');
  const body = lines.join('\n');
  const source = `export function build(p) {\n${body}\n}\n`;
  return { source, body, usedOps: Array.from(used) };
}

/** Walk a list of child ids in declared order, emitting each child's
 *  contribution into `lines`. Children of unknown type are skipped
 *  silently (validation lives elsewhere). */
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
