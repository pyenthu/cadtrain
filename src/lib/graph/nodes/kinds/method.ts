/**
 * MethodKind — the CSG operator node (subtract/add/intersect).
 *   emit  ← composition-emit.ts:594   ·  validate ← :129   ·  inputRefs ← consumed-set
 *   size  ← geom.ts:351  (FIXED 40×40 CSG-operator circle — NOT auto-fit)
 * Byte-for-byte transcription of the existing switch/if arms.
 */
import type { MethodNode } from '../../composition-graph-types';
import { type NodeKind, has, err } from '../node-kind';

export const MethodKind: NodeKind<MethodNode> = {
  type: 'method',
  emitExpr: (n, c) => `${c.ref(n.obj, 'obj')}.${n.op}(${c.ref(n.arg, 'arg')})`,
  validate: (n, g) => [
    ...(has(g, n.obj) ? [] : [err(n.id, 'obj', n.obj, 'missing-node')]),
    ...(has(g, n.arg) ? [] : [err(n.id, 'arg', n.arg, 'missing-node')]),
  ],
  inputRefs: (n) => [n.obj, n.arg].filter(Boolean),
  size: () => ({ w: 40, h: 40 }),
  sockets: () => ({ inputs: ['obj', 'arg'], output: true }),
};
