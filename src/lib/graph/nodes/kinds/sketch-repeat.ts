/**
 * SketchRepeatKind — a sketch-repeat PRODUCER node (#805). Like PolyRepeat it
 * never emits on its own: its expanded prototype is spliced into a parent sketch
 * via a `repeat-ref` op (see SketchKind), which reads this node directly.
 *   emit  ← composition-emit.ts (no switch arm → undefined; here → null, both skip)
 *   validate ← none today → []
 *   size  ← geom.ts:413 (fixed 252 wide; height = heads + bindings + one row per op)
 */
import type { SketchRepeatNode } from '../../composition-graph-types';
import { type NodeKind } from '../node-kind';

export const SketchRepeatKind: NodeKind<SketchRepeatNode> = {
  type: 'sketch_repeat',
  emitExpr: () => null,
  validate: () => [],
  inputRefs: () => [],
  size: (node) => {
    // header + Params head + 2 param rows + bindings (head + rows) +
    // Prototype-ops head + one row per op + footer + pad (#805).
    const bindings = (node as any).bindings ?? [];
    const ops = (node as any).ops ?? [];
    const h = 28 + 18 + 56 + (24 + bindings.length * 22) + 18 + ops.length * 24 + 30 + 14;
    return { w: 252, h };
  },
  sockets: () => ({ inputs: [], output: true }),
};
