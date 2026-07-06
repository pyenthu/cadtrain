/**
 * WarpKind — bend a built solid along a spline path.
 *   emit  ← composition-emit.ts: warpSpline(child, path, { refine, stretch, validate })
 *   validate ← child + checkArg(path) + checkArg(refine)   ·   size ← geom.ts:91 { w, h: 112 }
 */
import type { WarpNode } from '../../composition-graph-types';
import { type NodeKind, has, err, checkArg } from '../node-kind';

export const WarpKind: NodeKind<WarpNode> = {
  type: 'warp',
  emitExpr: (n, c) => {
    const child = c.ref(n.child ?? '', 'child');
    const pathExpr = c.emitValue(n.path);
    const optParts: string[] = [];
    if (n.refine != null) optParts.push(`refine: ${c.emitValue(n.refine)}`);
    if (n.stretch) optParts.push('stretch: true');
    if (n.validate) optParts.push('validate: true');
    const opts = optParts.length ? `, { ${optParts.join(', ')} }` : '';
    return `warpSpline(${child}, ${pathExpr}${opts})`;
  },
  validate: (n, g) => [
    ...(n.child != null && has(g, n.child) ? [] : [err(n.id, 'child', String(n.child ?? ''), 'missing-node')]),
    ...checkArg(n.id, 'path', n.path, g),
    ...(n.refine != null ? checkArg(n.id, 'refine', n.refine, g) : []),
  ],
  inputRefs: (n) => (n.child ? [n.child] : []),
  size: (_n, ctx) => ({ w: ctx.width, h: 112 }),
  sockets: () => ({ inputs: ['child', 'path'], output: true }),
};
