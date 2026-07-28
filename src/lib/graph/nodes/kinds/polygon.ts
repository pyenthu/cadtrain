/**
 * PolygonKind — the 2D profile producer. Emits its points array directly so a
 * consuming Call (r_revolve / r_weld_extrude …) can `__POLY__<id>` it. Entries
 * are literal `[r,z]` vertices, inline `repeat` blocks, `repeat-ref`s chasing a
 * PolyRepeatNode, or `expr-list-ref`s splicing an ExprNode's list<point> output.
 *   emit  ← composition-emit.ts:703 (verbatim)
 *   validate ← none today (polygon has NO switch arm → []); kept explicit here
 *   size  ← geom.ts:387 (persisted h override → cumulative per-entry-kind walk)
 *
 * `exprBlockVar` is the ctx binding (graph-exprs.ts, passed in to avoid a cycle).
 */
import type { PolygonNode } from '$lib/graph/composition/composition-graph-types';
import { type NodeKind } from '../node-kind';

export const PolygonKind: NodeKind<PolygonNode> = {
  type: 'polygon',
  emitExpr: (node, c) => {
    const exprBlockVar = c.exprBlockVar!;
    const nodes = c.nodes;
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
        const count = c.emitValue(src.count);
        const loopVar = /^[A-Za-z_$][\w$]*$/.test(String(src.loopVar || ''))
          ? String(src.loopVar) : 'i';
        const rExpr = c.emitValue(src.r);
        const zExpr = c.emitValue(src.z);
        const bindings: Array<{ name: string; value: any }> = Array.isArray(src.bindings) ? src.bindings : [];
        const valid = bindings.filter((b) =>
          b && typeof b.name === 'string' && /^[A-Za-z_$][\w$]*$/.test(b.name)
        );
        const bindLines = valid.map((b) => `const ${b.name} = ${c.emitValue(b.value)};`).join(' ');
        const preamble = bindLines ? `const NPts = ${count}; ${bindLines}` : `const NPts = ${count};`;
        return `...Array.from({ length: ${count} }, (_, ${loopVar}) => { ${preamble} return [${rExpr}, ${zExpr}]; })`;
      }
      if (entry?.kind === 'repeat') {
        const count = c.emitValue(entry.count);
        const loopVar = /^[A-Za-z_$][\w$]*$/.test(String(entry.loopVar || ''))
          ? String(entry.loopVar) : 'i';
        return `...Array.from({ length: ${count} }, (_, ${loopVar}) => [${c.emitValue(entry.r)}, ${c.emitValue(entry.z)}])`;
      }
      return `[${c.emitValue(entry.r)}, ${c.emitValue(entry.z)}]`;
    }).filter(Boolean);
    return `[${rows.join(', ')}]`;
  },
  // Polygon had NO validate switch arm — entries are validated when the
  // consuming Call re-scans its args, not here. Keep it explicit + empty.
  validate: () => [],
  inputRefs: () => [],
  size: (node, ctx) => {
    const c = ctx.consts!;
    const MAX_VISIBLE = 8;
    const entryH = (pt: any): number =>
      (pt?.kind === 'repeat-ref' || pt?.kind === 'expr-list-ref') ? c.POLY_RREF_PITCH
      : pt?.kind === 'repeat' ? 74
      : c.POLY_VTX_PITCH;
    const pts: any[] = (node as any).points ?? [];
    const rows = pts.slice(0, MAX_VISIBLE);
    const savedH = ctx.layout?.h;
    const rowsH = rows.length ? rows.reduce((a, pt) => a + entryH(pt), 0) : c.POLY_VTX_PITCH;
    const autoH = 36 + rowsH + 30;
    const h = typeof savedH === 'number' ? Math.max(120, savedH) : autoH;
    return { w: ctx.width, h };
  },
  sockets: () => ({ inputs: [], output: true }),
};
