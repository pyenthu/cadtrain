import { tube } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'hollow_cylinder',
  name: 'Tube',
  description: 'Plain hollow tube — the fundamental building block.',
  tags: ['mandrel', 'sleeve', 'body', 'tube', 'pup joint', 'sub', 'coupling'],
  params: {
    od: { label: 'OD', min: 0.5, max: 6, step: 0.1, unit: 'in', default: 2.875 },
    wall: { label: 'Wall', min: 0.05, max: 1, step: 0.05, unit: 'in', default: 0.375 },
    length: { label: 'Length', min: 0.5, max: 15, step: 0.1, unit: 'in', default: 4.0 },
  },
  validate: (p: Record<string, number>): string[] => {
    const errs: string[] = [];
    if (p.wall * 2 >= p.od) errs.push('wall too thick — bore would collapse (wall*2 must be < od)');
    if (p.length <= 0) errs.push('length must be > 0');
    return errs;
  },
} as const;

export const geom = defineGeom(meta, ({ od, wall, length }) => {
  const id = od - 2 * wall;
  return tube(od / 2, id / 2, length).translate(0, 0, length / 2);
});
