import { cyl, mv } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'tapered_cone',
  name: 'Tapered Cone',
  description:
    'Hollow cone — wider at the bottom, narrower at the top, with constant wall thickness.',
  tags: ['cone', 'taper', 'crossover', 'transition'],
  params: {
    od: { label: 'OD (bottom)', min: 0.5, max: 14, step: 0.05, unit: 'in', default: 2.875 },
    odTop: { label: 'OD (top)', min: 0.5, max: 14, step: 0.05, unit: 'in', default: 2.0 },
    wall: { label: 'Wall', min: 0.05, max: 1, step: 0.05, unit: 'in', default: 0.217 },
    length: { unit: 'in', label: 'Length', step: 0.1, max: 20, min: 0.5, default: 1 },
  },
  validate: (p: Record<string, number>): string[] => {
    const errs: string[] = [];
    if (p.wall * 2 >= p.od) errs.push('wall too thick at the bottom — wall*2 must be < od');
    if (p.wall * 2 >= p.odTop) errs.push('wall too thick at the top — wall*2 must be < odTop');
    if (p.length <= 0) errs.push('length must be > 0');
    return errs;
  },
} as const;

export const geom = defineGeom(meta, ({ od, odTop, wall, length }) => {
  const id = od - 2 * wall;
  const idTop = odTop - 2 * wall;
  const outer = cyl(length, odTop / 2, od / 2);
  const OS = 0.4;
  const slope = (id - idTop) / 2 / length;
  const innerH = length + 2 * OS;
  const innerR1 = idTop / 2 - slope * OS;
  const innerR2 = id / 2 + slope * OS;
  const inner = mv(cyl(innerH, innerR1, innerR2), [0, 0, length / 2]);
  return mv(outer, [0, 0, length / 2])
    .subtract(inner)
    .rotate(180, 0, 0);
});
