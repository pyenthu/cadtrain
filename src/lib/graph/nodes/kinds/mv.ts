/**
 * MvKind — translate node (the LIVE translate type; hydrateGraph unfolds txfmn
 * into mv/rot, so this is what a hydrated graph actually carries).
 *   emit  ← composition-emit.ts:599   ·  validate ← :133   ·  size ← geom.ts:355 (40×40)
 */
import type { MvNode } from '$lib/graph/composition/composition-graph-types';
import { type NodeKind, has, err, checkArgs } from '../node-kind';

export const MvKind: NodeKind<MvNode> = {
  type: 'mv',
  emitExpr: (n, c) => `mv(${c.ref(n.child, 'child')}, [${n.offset.map(c.emitValue).join(', ')}])`,
  validate: (n, g) => [
    ...(has(g, n.child) ? [] : [err(n.id, 'child', n.child, 'missing-node')]),
    ...checkArgs(n.id, 'offset', n.offset, g),
  ],
  inputRefs: (n) => (n.child ? [n.child] : []),
  size: () => ({ w: 40, h: 40 }),
  sockets: () => ({ inputs: ['child'], output: true }),
};
