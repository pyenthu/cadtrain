/**
 * WarpKind — bend built solid(s) along a spline path.
 *   emit  ← 1 child:  warpSpline(child, path, { refine, stretch, validate })  (byte-identical)
 *          ≥2 children: [warpSpline(a,path,…), warpSpline(b,path,…)]  — a LIST producer so the
 *          parent Stack / root SPREADS the warped parts as SEPARATE bodies (never composed →
 *          a part inside a transparent open-hole stays independent; #36b multi-input warp).
 *   validate ← each child + checkArg(path) + checkArg(refine)   ·   size ← grows per child.
 */
import type { WarpNode } from '$lib/graph/composition/composition-graph-types';
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
    // BUILD-TIME exaggeration (N3) — emitted ONLY when set, so a warp without a
    // scale emits byte-identically (the golden gate). `yScale` is arc-length
    // depth, `xDiaScale` is radial/diameter (see WarpNode + warpManifoldAlongSpline).
    if (n.xDiaScale != null) optParts.push(`xDiaScale: ${c.emitValue(n.xDiaScale)}`);
    if (n.yScale != null) optParts.push(`yScale: ${c.emitValue(n.yScale)}`);
    // Absolute depth placement (#36c b): emitted ONLY when set, so existing single
    // warp parts (no originZ) emit byte-identically (the golden gate). MULTI-input
    // warps default to ABSOLUTE (originZ 0) so each child's own z — including its
    // mv-z — sets its distance ALONG the spline (s = z); otherwise the per-part
    // bbox re-zero cancels an mv-z and children stack at the spline start. Single
    // child keeps the part-relative default (starts at the spline origin).
    if (n.originZ != null) optParts.push(`originZ: ${c.emitValue(n.originZ)}`);
    else if (kids.length > 1) optParts.push('originZ: 0');
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
      ...(n.originZ != null ? checkArg(n.id, 'originZ', n.originZ, g) : []),
      ...(n.xDiaScale != null ? checkArg(n.id, 'xDiaScale', n.xDiaScale, g) : []),
      ...(n.yScale != null ? checkArg(n.id, 'yScale', n.yScale, g) : []),
    ];
  },
  inputRefs: (n) => warpChildren(n),
  size: (_n, ctx) => {
    // SINGLE compact CHIP ROW (like the mv/rot icon chips) — one ~40 px row:
    // the ≈ icon centred, the `path` socket on the TOP-MIDDLE, the ONE ×N
    // `solids` socket on the LEFT edge (all solids fan in — drop appends, remove
    // by clicking a wire → delete), the bent result out the RIGHT edge, and a
    // compact ⚙ (options) + × (delete) top-right. Fixed small height.
    return { w: ctx.width, h: 40 };
  },
  sockets: (n) => {
    const kids = warpChildren(n);
    const inputs = kids.length > 1 ? kids.map((_, i) => `children[${i}]`) : ['child'];
    return { inputs: [...inputs, 'path'], output: true };
  },
};
