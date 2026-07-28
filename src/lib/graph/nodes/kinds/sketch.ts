/**
 * SketchKind — the richer profile producer (M.1): an ordered list of CAD
 * operators (line · spline · fillet · chamfer) compiled at bake by the
 * sandbox-injected `sketch(...)`. Ops may also be `repeat-ref`s (chase a
 * SketchRepeatNode) or `expr-list-ref`s (splice an ExprNode's list<point>).
 *   emit  ← composition-emit.ts:746 (verbatim; sketch(ops, segments[, sx, sy]))
 *   validate ← :177 (per-op ArgValue component checks)
 *   size  ← geom.ts:399 (column layout via sketchColLayout + persisted h)
 *
 * `emitSketchOp` (composition-emit's local emitSketchOpObject) + `exprBlockVar`
 * are ctx bindings (passed in to avoid a cycle). `sketchColLayout` is a cad-layer
 * import (allowed), reproducing the sketchCols column-count from the layout slot.
 */
import type { SketchNode, NodeId } from '$lib/graph/composition/composition-graph-types';
import { type NodeKind, type ValidationError, checkArg } from '../node-kind';
import { sketchColLayout } from '$lib/graph/sketch/sketch-layout';

export const SketchKind: NodeKind<SketchNode> = {
  type: 'sketch',
  emitExpr: (node, c) => {
    const exprBlockVar = c.exprBlockVar!;
    const emitSketchOpObject = c.emitSketchOp!;
    const nodes = c.nodes;
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
        const count = c.emitValue(src.count);
        const loopVar = /^[A-Za-z_$][\w$]*$/.test(String(src.loopVar || '')) ? String(src.loopVar) : 'i';
        const bindings: Array<{ name: string; value: any }> = Array.isArray(src.bindings) ? src.bindings : [];
        const valid = bindings.filter((b) => b && typeof b.name === 'string' && /^[A-Za-z_$][\w$]*$/.test(b.name));
        const bindLines = valid.map((b) => `const ${b.name} = ${c.emitValue(b.value)};`).join(' ');
        const preamble = bindLines ? `const NPts = ${count}; ${bindLines}` : `const NPts = ${count};`;
        const hasAdvance = src.dr != null || src.dz != null;
        const drE = src.dr != null ? c.emitValue(src.dr) : '0';
        const dzE = src.dz != null ? c.emitValue(src.dz) : '0';
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
    const seg = (node as any).segments != null ? c.emitValue((node as any).segments) : '64';
    // Whole-sketch scale → trailing positional args of the `sketch(...)` call
    // (compileSketch(ops, segments, scaleX, scaleY)). Omitted entirely when
    // both are absent / literal 1 so pre-scale parts round-trip byte-identically.
    const sx = (node as any).scaleX;
    const sy = (node as any).scaleY;
    const isOne = (v: any) => v == null || (v.kind === 'literal' && v.value === 1);
    if (!isOne(sx) || !isOne(sy)) {
      const sxE = sx != null ? c.emitValue(sx) : '1';
      const syE = sy != null ? c.emitValue(sy) : '1';
      return `sketch([${ops.join(', ')}], ${seg}, ${sxE}, ${syE})`;
    }
    return `sketch([${ops.join(', ')}], ${seg})`;
  },
  validate: (node, g) => {
    const errs: ValidationError[] = [];
    // Mirror the polygon path: every per-op ArgValue component is checked
    // so a wired-then-deleted param surfaces as `missing-param`.
    ((node as any).ops as any[]).forEach((o, i) => {
      if (o.op === 'line' || o.op === 'spline') {
        errs.push(...checkArg(node.id, `ops[${i}].r`, o.r, g));
        errs.push(...checkArg(node.id, `ops[${i}].z`, o.z, g));
      }
      if (o.op === 'spline') {
        (o.pts ?? []).forEach((pt: any, k: number) => {
          if (pt?.[0]) errs.push(...checkArg(node.id, `ops[${i}].pts[${k}].u`, pt[0], g));
          if (pt?.[1]) errs.push(...checkArg(node.id, `ops[${i}].pts[${k}].v`, pt[1], g));
        });
        if (o.h0?.[0]) errs.push(...checkArg(node.id, `ops[${i}].h0.u`, o.h0[0], g));
        if (o.h0?.[1]) errs.push(...checkArg(node.id, `ops[${i}].h0.v`, o.h0[1], g));
        if (o.h1?.[0]) errs.push(...checkArg(node.id, `ops[${i}].h1.u`, o.h1[0], g));
        if (o.h1?.[1]) errs.push(...checkArg(node.id, `ops[${i}].h1.v`, o.h1[1], g));
      }
      if (o.op === 'fillet')  errs.push(...checkArg(node.id, `ops[${i}].radius`, o.radius, g));
      if (o.op === 'chamfer') errs.push(...checkArg(node.id, `ops[${i}].dist`, o.dist, g));
    });
    if ((node as any).segments) errs.push(...checkArg(node.id, 'segments', (node as any).segments, g));
    return errs;
  },
  // ← computeConsumedSet's `sketch` arm: a repeat-ref op consumes its
  // SketchRepeatNode source so it never double-emits as an Output + its × greys.
  inputRefs: (node) =>
    (((node as any).ops as any[]) ?? [])
      .filter((o) => o?.op === 'repeat-ref' && o.sourceId)
      .map((o) => o.sourceId as NodeId),
  size: (node, ctx) => {
    const cols = (ctx.layout?.cols === 2 || ctx.layout?.cols === 3) ? ctx.layout.cols : 1;
    const cl = sketchColLayout((node as any).ops ?? [], cols as 1 | 2 | 3);
    const savedH = ctx.layout?.h;
    const autoH = 36 + Math.max(44, cl.tallestH) + 62;
    const h = typeof savedH === 'number' ? Math.max(140, savedH) : autoH;
    const autoW = 12 + cl.innerW; // 12 = foreignObject 6px insets
    return { w: Math.max(ctx.width, 210, autoW, cols * 80), h };
  },
  sockets: () => ({ inputs: [], output: true }),
};
