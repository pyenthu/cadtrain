/**
 * CutawayKind — subtract an authored angular cross-section wedge from a solid.
 *   emit  ← 1 child:  sectionCut(child, { az, offset })  (byte-identical)
 *          ≥2 children: [sectionCut(a,{az,offset}), sectionCut(b,{az,offset})] — a LIST
 *          producer so the parent Stack / root SPREADS the sectioned parts as SEPARATE
 *          bodies (a part inside a transparent open-hole stays independent; multi-input
 *          section, mirrors WarpKind #36b).
 *   validate ← each child + checkArg(az) + checkArg(offset)   ·   size ← geom.ts { w, h: 112 }
 */
import type { CutawayNode } from '$lib/graph/composition/composition-graph-types';
import { type NodeKind, has, err, checkArg } from '../node-kind';

/** The cutaway's input solids — `children[]` when present (multi), else the legacy
 *  single `child` (byte-identical). Shared by emit / validate / sockets / the
 *  NodeCard + wire-state so the single↔multi rule lives in ONE place (mirrors
 *  warpChildren). */
export function cutawayChildren(n: CutawayNode): string[] {
  if (Array.isArray(n.children) && n.children.length) return n.children.filter(Boolean) as string[];
  return n.child ? [n.child] : [];
}

/** True when this cutaway emits a JS ARRAY (≥2 wired solids) → a list producer. */
export function cutawayIsMulti(n: CutawayNode): boolean {
  return cutawayChildren(n).length > 1;
}

export const CutawayKind: NodeKind<CutawayNode> = {
  type: 'cutaway',
  emitExpr: (n, c) => {
    const kids = cutawayChildren(n);
    const az = c.emitValue(n.az);
    const offset = c.emitValue(n.offset);
    const one = (childId: string, slot: string) =>
      `sectionCut(${c.ref(childId, slot)}, { az: ${az}, offset: ${offset} })`;
    // 1 solid → the historical single expr (byte-identical). ≥2 → a bare array of
    // per-part sections; computeListProducers flags it so the parent spreads it.
    if (kids.length <= 1) return one(kids[0] ?? (n.child ?? ''), 'child');
    return `[${kids.map((k, i) => one(k, `children[${i}]`)).join(', ')}]`;
  },
  validate: (n, g) => {
    const kids = cutawayChildren(n);
    const multi = kids.length > 1;
    const childErrs = kids.length
      ? kids.flatMap((k, i) => has(g, k) ? [] : [err(n.id, multi ? `children[${i}]` : 'child', String(k ?? ''), 'missing-node')])
      : [err(n.id, 'child', String(n.child ?? ''), 'missing-node')];
    return [
      ...childErrs,
      ...checkArg(n.id, 'az', n.az, g),
      ...checkArg(n.id, 'offset', n.offset, g),
    ];
  },
  inputRefs: (n) => cutawayChildren(n),
  size: (_n, ctx) => ({ w: ctx.width, h: 112 }),
  sockets: (n) => {
    const kids = cutawayChildren(n);
    const inputs = kids.length > 1 ? kids.map((_, i) => `children[${i}]`) : ['child'];
    return { inputs, output: true };
  },
};
