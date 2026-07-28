/**
 * RotKind — rotate node (the LIVE rotate type; hydrateGraph unfolds txfmn into
 * mv/rot, so this is what a hydrated graph actually carries).
 *   emit  ← composition-emit.ts:604   ·  validate ← :137   ·  size ← geom.ts:355 (40×40)
 */
import type { RotNode } from '$lib/graph/composition/composition-graph-types';
import { type NodeKind, has, err, checkArgs } from '../node-kind';

export const RotKind: NodeKind<RotNode> = {
  type: 'rot',
  emitExpr: (n, c) => `rot(${c.ref(n.child, 'child')}, [${n.rot.map(c.emitValue).join(', ')}])`,
  validate: (n, g) => [
    ...(has(g, n.child) ? [] : [err(n.id, 'child', n.child, 'missing-node')]),
    ...checkArgs(n.id, 'rot', n.rot, g),
  ],
  inputRefs: (n) => (n.child ? [n.child] : []),
  size: () => ({ w: 40, h: 40 }),
  sockets: () => ({ inputs: ['child'], output: true }),
};
