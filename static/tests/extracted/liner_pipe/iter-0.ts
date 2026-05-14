import { tube } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'liner_pipe',
  name: 'Liner Pipe (LP)',
  description: 'Large-OD thin-wall hollow cylinder used as conductor or surface liner. Parametrized identically to casing (OD, wall, drift clearance) but with shorter typical joint length per API 5CT liner conventions.',
  tags: ['liner', 'LP', 'conductor', 'surface liner', 'API 5CT', 'thin wall', 'large OD', 'casing'],
  params: {
    od: { label: 'OD', min: 4.5, max: 30, step: 0.0625, unit: 'in', default: 13.375 },
    wall: { label: 'Wall Thickness', min: 0.2, max: 1.0, step: 0.005, unit: 'in', default: 0.380 },
    driftClearance: { label: 'Drift Clearance', min: 0, max: 0.2, step: 0.005, unit: 'in', default: 0.125 },
    length: { label: 'Joint Length', min: 6, max: 36, step: 0.25, unit: 'in', default: 14.0 },
  },
  derived: {
    id: { label: 'Inner Diameter', unit: 'in', from: (p: Record<string, number>) => p.od - 2 * p.wall },
    drift: { label: 'Drift Diameter', unit: 'in', from: (p: Record<string, number>) => p.od - 2 * p.wall - p.driftClearance },
    wallRatio: { label: 'OD / Wall', unit: '', from: (p: Record<string, number>) => p.od / p.wall },
  },
  validate: (p: Record<string, number>): string[] => {
    const errs: string[] = [];
    if (p.wall * 2 >= p.od) errs.push('wall too thick — bore would collapse (wall*2 must be < od)');
    if (p.driftClearance >= 2 * p.wall) errs.push('driftClearance must be less than 2*wall');
    if (p.length <= 0) errs.push('length must be > 0');
    return errs;
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const bodyR = p.od / 2;
  const idR = (p.od - 2 * p.wall) / 2;
  return tube(bodyR, idR, p.length);
});