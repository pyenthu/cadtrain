/**
 * CutawayKind — subtract an authored angular cross-section wedge from a solid.
 *   emit  ← composition-emit.ts: sectionCut(child, { az, offset })
 *   validate ← child + checkArg(az) + checkArg(offset)   ·   size ← geom.ts { w, h: 112 }
 */
import type { CutawayNode } from '../../composition-graph-types';
import { type NodeKind, has, err, checkArg } from '../node-kind';

export const CutawayKind: NodeKind<CutawayNode> = {
  type: 'cutaway',
  emitExpr: (n, c) => {
    const child = c.ref(n.child ?? '', 'child');
    const az = c.emitValue(n.az);
    const offset = c.emitValue(n.offset);
    return `sectionCut(${child}, { az: ${az}, offset: ${offset} })`;
  },
  validate: (n, g) => [
    ...(n.child != null && has(g, n.child) ? [] : [err(n.id, 'child', String(n.child ?? ''), 'missing-node')]),
    ...checkArg(n.id, 'az', n.az, g),
    ...checkArg(n.id, 'offset', n.offset, g),
  ],
  inputRefs: (n) => (n.child ? [n.child] : []),
  size: (_n, ctx) => ({ w: ctx.width, h: 112 }),
  sockets: () => ({ inputs: ['child'], output: true }),
};
