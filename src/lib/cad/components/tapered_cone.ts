import { cyl } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'tapered_cone',
  name: 'Tapered Cone',
  description:
    'Hollow cone — wider at the bottom, narrower at the top, with constant wall thickness.',
  tags: ['cone', 'taper', 'crossover', 'transition'],
  params: {
    od: { label: 'OD (bottom)', min: 0.5, max: 14, step: 0.05, unit: 'in', default: 2.875 },
    odTop: { label: 'OD (top)', min: 0.5, max: 14, step: 0.05, unit: 'in', default: 3.5 },
    wall: { label: 'Wall', min: 0.05, max: 1, step: 0.05, unit: 'in', default: 0.29 },
    length: { label: 'Length', min: 0.5, max: 20, step: 0.1, unit: 'in', default: 1 },
    top: { label: 'Top', min: -100, max: 20000, step: 1, default: 0, unit: 'ft' },
  },
  validate: (p: Record<string, number>): string[] => {
    const errs: string[] = [];
    if (p.wall * 2 >= p.od) errs.push('wall too thick at the bottom — wall*2 must be < od');
    if (p.wall * 2 >= p.odTop) errs.push('wall too thick at the top — wall*2 must be < odTop');
    if (p.length <= 0) errs.push('length must be > 0');
    return errs;
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  // Z-down: top (z=0) is narrow, bottom (z=length) is wide.
  // cyl(length, r1, r2) puts r1 at z=0 and r2 at z=length (Manifold's uncentered default).
  const outer = cyl(p.length, p.odTop / 2, p.od / 2);

  // Bore — same taper inset by `wall`. Small overshoot at each end so
  // the subtract reads as fully hollow under Manifold's CSG tolerance.
  const id = p.od - 2 * p.wall;
  const idTop = p.odTop - 2 * p.wall;
  const OS = 0.4;
  const slope = (id - idTop) / 2 / p.length; // dr/dz, positive when bottom wider
  const innerR1 = idTop / 2 - slope * OS; // bore radius at z=-OS
  const innerR2 = id / 2 + slope * OS; // bore radius at z=length+OS
  const inner = cyl(p.length + 2 * OS, innerR1, innerR2).translate(0, 0, -OS);

  return outer.subtract(inner);
});
