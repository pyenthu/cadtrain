/**
 * CallKind — a call to a volume primitive / stdlib engine (the most common node).
 *   emit  ← composition-emit.ts:542  (emitCallExpr, via ctx.emitCall)
 *   validate ← :119  (missing-param on each arg)   ·   size ← geom.ts:345
 *
 * inputRefs is a Phase-2 concern: a call consumes producers via `__POLY__<id>`
 * refs embedded in its expr args (string-scanned by computeConsumedSet), not via
 * node-id slots — so [] here until Phase 2 wires computeConsumedSet through the
 * registry and reconciles that scan.
 */
import type { CallNode } from '../../composition-graph-types';
import { type NodeKind, checkArg } from '../node-kind';

export const CallKind: NodeKind<CallNode> = {
  type: 'call',
  emitExpr: (n, c) => c.emitCall(n.src, n.args),
  validate: (n, g) => Object.entries(n.args).flatMap(([k, v]) => checkArg(n.id, `args.${k}`, v, g)),
  inputRefs: () => [],
  size: (n, ctx) => ({ w: ctx.width, h: Math.max(80, 50 + Object.keys(n.args ?? {}).length * 22) }),
  sockets: (n) => ({ inputs: Object.keys(n.args ?? {}), output: true }),
};
