/**
 * PolyRepeatKind — a polygon-repeat PRODUCER node. It never emits a geometry
 * value on its own: its output is spliced into a polygon via a `repeat-ref`
 * entry (see PolygonKind), which reads THIS node's count/loopVar/r/z directly.
 *   emit  ← composition-emit.ts (no switch arm → undefined; here → null, both skip)
 *   validate ← none today → []
 *   size  ← geom.ts:408 (fixed 240 wide; height grows with the bindings rows)
 */
import type { PolyRepeatNode } from '../../composition-graph-types';
import { type NodeKind } from '../node-kind';

export const PolyRepeatKind: NodeKind<PolyRepeatNode> = {
  type: 'poly_repeat',
  emitExpr: () => null,
  validate: () => [],
  inputRefs: () => [],
  size: (node) => {
    const bindings = (node as any).bindings ?? [];
    const bindingsH = 28 + bindings.length * 22 + 24; // hdr + rows + add btn
    return { w: 240, h: 154 + bindingsH - 24 };
  },
  sockets: () => ({ inputs: [], output: true }),
};
