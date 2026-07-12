/**
 * StackKind — a sequential stack container: mate the children end-to-end via
 * the sandbox `stack([...])` helper (mixed single-part + list-producing-Repeat
 * children supported through the `...` spread). Its per-child STACK-REFERENCE
 * override (`childRefs` → `withStackRef(...)`) and per-child ×N COUNT
 * (`childCounts` → `Array(n).fill(...)`) are the emit's whole complexity.
 *   emit  ← composition-emit.ts:558 (the fat `case 'stack':` arm — verbatim)
 *   validate ← :130 (shares the container children-walk)  ·  size ← geom.ts:377
 *
 * `withStackRef` here is emitted SOURCE TEXT (a sandbox runtime call), not an
 * emit-time helper — no EmitCtx binding needed. `listProducers` (which children
 * produce a bare JS array) + `emitValue` come from the ctx.
 */
import type { ContainerNode, NodeId, ArgValue } from '../../composition-graph-types';
import { type NodeKind, has, err } from '../node-kind';
import { containerSize } from './container';

export const StackKind: NodeKind<ContainerNode> = {
  type: 'stack',
  emitExpr: (n, c) => {
    const childRefs = (n as { childRefs?: Record<NodeId, number> }).childRefs ?? {};
    const childCounts = (n as { childCounts?: Record<NodeId, ArgValue> }).childCounts ?? {};
    const args = n.children.map((ch, i) => {
      const slot = `children[${i}]`;
      const nm = c.ref(ch, slot);
      const raw = childRefs[ch];
      const hasOverride = Object.prototype.hasOwnProperty.call(childRefs, ch) && Number.isFinite(Number(raw));
      const v = Number(raw);
      const isList = c.listProducers.has(ch);
      const countVal = childCounts[ch];
      // A literal ≤ 1 means "single copy" — treat as no count. Param/expr
      // values always opt in (resolved + guarded at runtime).
      const wantsCount = !isList && countVal != null &&
        !(countVal.kind === 'literal' && Number(countVal.value) <= 1);
      if (wantsCount) {
        const countExpr = `Math.max(1, Math.floor(${c.emitValue(countVal)}) | 0)`;
        return hasOverride
          ? `...Array(${countExpr}).fill(0).map(() => withStackRef(${nm}, ${v}))`
          : `...Array(${countExpr}).fill(${nm})`;
      }
      if (isList) {
        return hasOverride ? `...${nm}.map((__m) => withStackRef(__m, ${v}))` : `...${nm}`;
      }
      return hasOverride ? `withStackRef(${nm}, ${v})` : nm;
    }).join(', ');
    return `stack([${args}])`;
  },
  validate: (n, g) => n.children.flatMap((ch, i) =>
    has(g, ch) ? [] : [err(n.id, `children[${i}]`, ch, 'missing-node')]),
  inputRefs: (n) => [...(n.children ?? [])],
  size: containerSize,
  sockets: (n) => ({ inputs: (n.children ?? []).map((_, i) => `children[${i}]`), output: true }),
};
