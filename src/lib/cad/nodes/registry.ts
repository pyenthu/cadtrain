/**
 * registry.ts — the node-kind lookup. `kindOf(node)` returns the descriptor for
 * a registered type, or `undefined` for a not-yet-migrated type so every
 * call-site keeps its legacy switch arm.
 *
 * Phase 0 registers only the 3 leaf kinds; validate + nodeSize route through
 * `kindOf`, everything else falls through. Phase 1+ fills in the rest and the
 * `undefined` return goes away.
 */
import type { GraphNode } from '../composition-graph-types';
import type { NodeKind } from './node-kind';
import { CallKind, MethodKind, TxfmnKind, MaterialKind, MvKind, RotKind, SplineKind, WarpKind, ContainerKind, StackKind, RepeatKind } from './kinds';

const KINDS: Partial<Record<GraphNode['type'], NodeKind>> = {
  call: CallKind as NodeKind,
  method: MethodKind as NodeKind,
  txfmn: TxfmnKind as NodeKind,
  material: MaterialKind as NodeKind,
  mv: MvKind as NodeKind,
  rot: RotKind as NodeKind,
  spline: SplineKind as NodeKind,
  warp: WarpKind as NodeKind,
  // ContainerKind covers the two NON-stack containers; StackKind is separate
  // (its emit differs) but shares containerSize.
  list: ContainerKind as NodeKind,
  group: ContainerKind as NodeKind,
  stack: StackKind as NodeKind,
  repeat: RepeatKind as NodeKind,
};

/** undefined for not-yet-migrated kinds → the call-site keeps its legacy arm. */
export const kindOf = (n: GraphNode): NodeKind | undefined => KINDS[n.type];
