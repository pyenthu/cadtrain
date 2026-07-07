/**
 * WarpKind — bend built solid(s) along a spline path.
 *   emit  ← 1 child:  warpSpline(child, path, { refine, stretch, validate })  (byte-identical)
 *          ≥2 children: [warpSpline(a,path,…), warpSpline(b,path,…)]  — a LIST producer so the
 *          parent Stack / root SPREADS the warped parts as SEPARATE bodies (never composed →
 *          a part inside a transparent open-hole stays independent; #36b multi-input warp).
 *   validate ← each child + checkArg(path) + checkArg(refine)   ·   size ← grows per child.
 */
import type { WarpNode } from '../../composition-graph-types';
import { type NodeKind, has, err, checkArg } from '../node-kind';

/** The warp's input solids — `children[]` when present (multi), else the legacy
 *  single `child` (byte-identical). Shared by emit / validate / sockets / the
 *  NodeCard + wire-state so the single↔multi rule lives in ONE place. */
export function warpChildren(n: WarpNode): string[] {
  if (Array.isArray(n.children) && n.children.length) return n.children.filter(Boolean) as string[];
  return n.child ? [n.child] : [];
}

/** True when this warp emits a JS ARRAY (≥2 wired solids) → a list producer. */
export function warpIsMulti(n: WarpNode): boolean {
  return warpChildren(n).length > 1;
}

export const WarpKind: NodeKind<WarpNode> = {
  type: 'warp',
  emitExpr: (n, c) => {
    const kids = warpChildren(n);
    const pathExpr = c.emitValue(n.path);
    const optParts: string[] = [];
    if (n.refine != null) optParts.push(`refine: ${c.emitValue(n.refine)}`);
    if (n.stretch) optParts.push('stretch: true');
    if (n.validate) optParts.push('validate: true');
    const opts = optParts.length ? `, { ${optParts.join(', ')} }` : '';
    const one = (childId: string, slot: string) => `warpSpline(${c.ref(childId, slot)}, ${pathExpr}${opts})`;
    // 1 solid → the historical single expr (byte-identical). ≥2 → a bare array of
    // per-part warps; computeListProducers flags it so the parent spreads it.
    if (kids.length <= 1) return one(kids[0] ?? (n.child ?? ''), 'child');
    return `[${kids.map((k, i) => one(k, `children[${i}]`)).join(', ')}]`;
  },
  validate: (n, g) => {
    const kids = warpChildren(n);
    const multi = kids.length > 1;
    const childErrs = kids.length
      ? kids.flatMap((k, i) => has(g, k) ? [] : [err(n.id, multi ? `children[${i}]` : 'child', String(k ?? ''), 'missing-node')])
      : [err(n.id, 'child', String(n.child ?? ''), 'missing-node')];
    return [
      ...childErrs,
      ...checkArg(n.id, 'path', n.path, g),
      ...(n.refine != null ? checkArg(n.id, 'refine', n.refine, g) : []),
    ];
  },
  inputRefs: (n) => warpChildren(n),
  size: (n, ctx) => {
    // Rows of solid sockets = wired solids + 1 "＋ solid" append slot (mirror
    // geom.warpSolidRows: first solid at 40, pitch 22). Path wires into the TITLE
    // row + options moved to a ⚙ popover, so the card is just title + solid rows.
    // Duplicated (not imported) — cad can't depend on the shared graph-editor layer.
    const rows = Math.max(1, warpChildren(n).length) + 1;
    return { w: ctx.width, h: 40 + rows * 22 + 12 };
  },
  sockets: (n) => {
    const kids = warpChildren(n);
    const inputs = kids.length > 1 ? kids.map((_, i) => `children[${i}]`) : ['child'];
    return { inputs: [...inputs, 'path'], output: true };
  },
};
