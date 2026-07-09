/**
 * ContainerKind — a list / group composition node (the NON-stack containers).
 * `list` + `group` share one descriptor (identical emit + validate + size);
 * `stack` is its own kind (StackKind) because its emit differs (see stack.ts),
 * but reuses `containerSize` — all three size identically.
 *   emit  ← composition-emit.ts:555 (`case 'list': case 'group':`)
 *   validate ← :130 (`case 'list': case 'stack': case 'group':` — children walk)
 *   size  ← geom.ts:377 (root ▶ Output special-case + per-child 22px slot)
 *
 * The ROOT list never routes here for EMIT: emitGraph handles `id === root &&
 * type === 'list'` before calling emitNodeExpr (derives the `return` from the
 * unconsumed children), so ContainerKind.emitExpr only ever runs on a NESTED
 * container. The root branch of `size` DOES run (nodeSize sizes the ▶ Output
 * card), hence the `ctx.root` compare below.
 */
import type { ContainerNode } from '../../composition-graph-types';
import { type NodeKind, type SizeCtx, has, err } from '../node-kind';

/** Shared container footprint (list / stack / group). The root container is the
 *  compact ▶ Output node (narrow socket box + fixed arrow head); every other
 *  container grows one 22px slot per child + a trailing drop slot. The output
 *  constants come from ctx.consts (owned by geom.ts, injected). */
export function containerSize(node: ContainerNode, ctx: SizeCtx): { w: number; h: number } {
  const c = ctx.consts!;
  const slots = (node.children?.length ?? 0) + 1;
  if (node.id === ctx.root) {
    // #31 collapsed Output: ONE socket on the green arrow accepts ALL output wires,
    // so the card height is FIXED (no per-output growth). Remove an output by
    // clicking its wire → Delete.
    return { w: c.OUTPUT_BOX_MIN_W + c.OUTPUT_ARROW_W, h: c.OUTPUT_MIN_H };
  }
  return { w: ctx.width, h: Math.max(60, 40 + slots * 22) };
}

export const ContainerKind: NodeKind<ContainerNode> = {
  type: 'list',
  emitExpr: (n, c) => `[${n.children.map((ch, i) => c.ref(ch, `children[${i}]`)).join(', ')}]`,
  validate: (n, g) => n.children.flatMap((ch, i) =>
    has(g, ch) ? [] : [err(n.id, `children[${i}]`, ch, 'missing-node')]),
  inputRefs: (n) => [...(n.children ?? [])],
  size: containerSize,
  sockets: (n) => ({ inputs: (n.children ?? []).map((_, i) => `children[${i}]`), output: true }),
};
