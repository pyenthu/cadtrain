/**
 * ExprKind — an expression-block INSTANCE. It is a non-geometry calculation
 * node: its named outputs emit as prelude `const` bindings (via emitExprBlocks,
 * a separate pass), referenced by whatever arg sockets they're wired into — so
 * it contributes NOTHING to the node-expression pass (emit → null).
 *   emit  ← composition-emit.ts:803 (returns null)
 *   validate ← :200 (each input binding ArgValue checked → missing-param)
 *   size  ← geom.ts:421 (rows = taller of {def.params, def.outputs}, via ctx.exprDefs)
 *
 * The def lives on `graph.exprDefs` (not `graph.nodes`), so `size` reads it from
 * the injected `ctx.exprDefs` — the reason expr was deferred until the SizeCtx
 * carried it.
 */
import type { ExprNode, ArgValue } from '$lib/graph/composition/composition-graph-types';
import { type NodeKind, checkArg } from '../node-kind';

export const ExprKind: NodeKind<ExprNode> = {
  type: 'expr',
  emitExpr: () => null,
  validate: (node, g) =>
    // An input binding wired to a since-deleted param surfaces as
    // missing-param (same treatment as every other ArgValue slot).
    Object.entries((node as any).bindings ?? {}).flatMap(([inName, v]) =>
      checkArg(node.id, `bindings.${inName}`, v as ArgValue, g)),
  inputRefs: () => [],
  size: (node, ctx) => {
    const c = ctx.consts!;
    // Height = the taller of {input sockets = def.params, output rows =
    // def.outputs} so neither column clips, + trailing pad. Reads THROUGH the
    // instance's def (v3); a dangling defId falls back to a 1-row card.
    const def = (ctx.exprDefs ?? []).find((d: any) => d.id === (node as any).defId);
    const ins = def?.params ?? [];
    const outs = def?.outputs ?? [];
    const rows = Math.max(1, outs.length, ins.length);
    return { w: ctx.width, h: c.EXPR_BODY_TOP + rows * c.EXPR_ROW_H + 30 };
  },
  sockets: () => ({ inputs: [], output: true }),
};
