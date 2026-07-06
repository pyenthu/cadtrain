/**
 * CallKind — a call to a volume primitive / stdlib engine (the most common node).
 *   emit  ← composition-emit.ts:542  (emitCallExpr, via ctx.emitCall)
 *   validate ← :119  (missing-param on each arg)   ·   size ← geom.ts:345
 *
 * inputRefs (← computeConsumedSet's `call` arm): a call consumes the PRODUCER
 * nodes referenced via a `__POLY__<id>` sentinel embedded in its expr args
 * (a polygon/expr-list wired into a profile arg). Scanned per-arg with the same
 * regex computeConsumedSet used, so the polygon+revolve pair shows ONE output,
 * not two.
 */
import type { CallNode, NodeId } from '../../composition-graph-types';
import { type NodeKind, checkArg } from '../node-kind';

export const CallKind: NodeKind<CallNode> = {
  type: 'call',
  emitExpr: (n, c) => c.emitCall(n.src, n.args),
  validate: (n, g) => Object.entries(n.args).flatMap(([k, v]) => checkArg(n.id, `args.${k}`, v, g)),
  inputRefs: (n) => {
    const refs: NodeId[] = [];
    for (const v of Object.values(n.args)) {
      if (v.kind !== 'expr') continue;
      const matches = v.expr.match(/__POLY__(n_[a-z0-9_]+)/gi);
      if (!matches) continue;
      for (const m of matches) refs.push(m.slice('__POLY__'.length));
    }
    return refs;
  },
  size: (n, ctx) => ({ w: ctx.width, h: Math.max(80, 50 + Object.keys(n.args ?? {}).length * 22) }),
  sockets: (n) => ({ inputs: Object.keys(n.args ?? {}), output: true }),
};
