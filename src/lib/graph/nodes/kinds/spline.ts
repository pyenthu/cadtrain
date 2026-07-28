/**
 * SplineKind — a control-point spline producer (consumed by sweeps/warps via its
 * prelude const; emits nothing in the node render tree, no broken-ref surface).
 *   emit  ← composition-emit.ts (returns null)   ·  validate ← (no arm → [])
 *   size  ← geom.ts:90 { w, h: 40 }
 */
import type { SplineNode } from '$lib/graph/composition/composition-graph-types';
import { type NodeKind } from '../node-kind';

export const SplineKind: NodeKind<SplineNode> = {
  type: 'spline',
  emitExpr: () => null,
  validate: () => [],
  inputRefs: () => [],
  size: (_n, ctx) => ({ w: ctx.width, h: 34 }),
  sockets: () => ({ inputs: [], output: true }),
};
