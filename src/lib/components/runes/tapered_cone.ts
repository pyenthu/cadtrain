/**
 * Tapered Cone — single-file primitive.
 *
 * Hollow cylinder with a taper: outer profile is a cone from `odTop` at
 * the top to `od` at the bottom, bore is a parallel cone (constant wall
 * thickness). When odTop == od this collapses to a hollow cylinder.
 *
 * Z-down convention: top = lower z (z=0 after the mv), bottom = higher z
 * (z=length). Manifold's `cyl(h, r1, r2)` puts r1 at z=−h/2 (the lower-z
 * end = TOP) and r2 at z=+h/2 (higher-z end = BOTTOM), so the outer cone
 * is `cyl(length, odTop/2, od/2)`.
 */

import { cyl, mv } from '../manifold-helpers';

export const meta = {
  id: 'tapered_cone',
  name: 'Tapered Cone',
  description: 'Hollow cone — wider at the bottom, narrower at the top, with constant wall thickness.',
  tags: ['cone', 'taper', 'crossover', 'transition'],
  params: {
    od:     { label: 'OD (bottom)', min: 0.5,  max: 14, step: 0.05, unit: 'in', default: 2.875 },
    odTop:  { label: 'OD (top)',    min: 0.5,  max: 14, step: 0.05, unit: 'in', default: 2.0 },
    wall:   { label: 'Wall',        min: 0.05, max: 1,  step: 0.05, unit: 'in', default: 0.217 },
    length: { label: 'Length',      min: 0.5,  max: 20, step: 0.1,  unit: 'in', default: 4.0 },
  },
  validate: (p: Record<string, number>): string[] => {
    const errs: string[] = [];
    if (p.wall * 2 >= p.od)    errs.push('wall too thick at the bottom — wall*2 must be < od');
    if (p.wall * 2 >= p.odTop) errs.push('wall too thick at the top — wall*2 must be < odTop');
    if (p.length <= 0)         errs.push('length must be > 0');
    return errs;
  },
} as const;

export const geom = (p: Record<string, number>) => {
  const id    = p.od    - 2 * p.wall;
  const idTop = p.odTop - 2 * p.wall;
  const outer = cyl(p.length, p.odTop / 2, p.od / 2);
  // Generous overshoot so the bore reads as a hollow body all the way
  // through — small epsilons leave a perceptible cap on the top face
  // under Manifold's CSG tolerance.
  const OS = 0.4;
  const slope = (id - idTop) / 2 / p.length; // dr/dz, positive when bottom wider
  const innerH = p.length + 2 * OS;
  const innerR1 = idTop / 2 - slope * OS;    // at z=−OS (above the top face)
  const innerR2 = id    / 2 + slope * OS;    // at z=length+OS (below the bottom)
  const inner = mv(cyl(innerH, innerR1, innerR2), [0, 0, p.length / 2]);
  return mv(outer, [0, 0, p.length / 2]).subtract(inner);
};
