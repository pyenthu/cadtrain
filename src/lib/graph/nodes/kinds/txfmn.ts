/**
 * TxfmnKind — the unified transform node (rot INNER, mv OUTER; identity-elided).
 *   emit  ← composition-emit.ts:609   ·  validate ← :141   ·  inputRefs ← consumed-set
 *   size  ← geom.ts:364  (width from ctx; FIXED height 226 — rot 3 rows + mv 3 rows)
 *
 * ⚠ As of 2026-07-01 hydrateGraph UNFOLDS saved `txfmn` back into live `mv`/`rot`
 * nodes, so a hydrated graph rarely carries a `txfmn` at runtime — this arm is
 * exercised pre-hydrate + by unit tests. Phase 1 adds the trivial MvKind/RotKind
 * (the ones the runtime actually hits). The transcription here is still correct.
 */
import type { TxfmnNode } from '$lib/graph/composition/composition-graph-types';
import { type NodeKind, has, err, checkArgs, isLiteralZero } from '../node-kind';

export const TxfmnKind: NodeKind<TxfmnNode> = {
  type: 'txfmn',
  emitExpr: (n, c) => {
    let e = c.ref(n.child ?? '', 'child');
    if (!n.rot.every(isLiteralZero)) e = `rot(${e}, [${n.rot.map(c.emitValue).join(', ')}])`;      // INNER — applied first
    if (!n.offset.every(isLiteralZero)) e = `mv(${e}, [${n.offset.map(c.emitValue).join(', ')}])`;  // OUTER — applied second
    return e;
  },
  validate: (n, g) => [
    ...(n.child != null && has(g, n.child) ? [] : [err(n.id, 'child', String(n.child ?? ''), 'missing-node')]),
    ...checkArgs(n.id, 'rot', n.rot, g),
    ...checkArgs(n.id, 'offset', n.offset, g),
  ],
  inputRefs: (n) => (n.child ? [n.child] : []),
  size: (_n, ctx) => ({ w: ctx.width, h: 226 }),
  sockets: () => ({ inputs: ['child'], output: true }),
};
