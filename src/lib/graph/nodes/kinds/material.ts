/**
 * MaterialKind — the view-only material node (G-MAT-CARD). Emits nothing (it is
 * a wired appearance override, not part of the geometry render tree) — the node
 * that was "silently skipped by every switch" becomes explicit + discoverable.
 *   emit  ← never in the render tree (returns null)   ·  validate ← no arm today (→ [])
 *   size  ← geom.ts:358  (label-fit pill: max(128, 88 + label.length*7.5) × 30)
 */
import type { MaterialNode } from '$lib/graph/composition/composition-graph-types';
import { type NodeKind } from '../node-kind';

export const MaterialKind: NodeKind<MaterialNode> = {
  type: 'material',
  emitExpr: () => null,   // never in the render tree
  validate: () => [],
  inputRefs: () => [],
  size: (n) => ({ w: Math.max(128, 88 + String(n.name ?? 'material').length * 7.5), h: 30 }),
  sockets: () => ({ inputs: [], output: 'material' }),
};
