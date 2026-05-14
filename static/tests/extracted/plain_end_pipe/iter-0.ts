import { tube } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'plain_end_pipe',
  name: 'Plain-End Pipe',
  description: 'Hollow cylinder with square-cut, unthreaded ends ready for field welding. Parametrized by OD, ID, and length — the bare pipe body before any thread / upset / coupling features are applied.',
  tags: ['plain end', 'PE', 'pipe', 'unthreaded', 'field weld', 'casing', 'tubing', 'API 5CT', 'API 5L', 'bare pipe'],
  params: {
    od: { label: 'OD', min: 1.05, max: 20, step: 0.0625, unit: 'in', default: 5.5 },
    id: { label: 'ID', min: 0.5, max: 19.5, step: 0.0625, unit: 'in', default: 4.95 },
    length: { label: 'Length', min: 6, max: 480, step: 0.5, unit: 'in', default: 30.0 },
  },
  derived: {
    wall: {
      label: 'Wall Thickness',
      unit: 'in',
      from: (p: Record<string, number>) => (p.od - p.id) / 2,
    },
    drift: {
      label: 'Drift Diameter',
      unit: 'in',
      from: (p: Record<string, number>) => Math.max(0, p.id - 0.125),
    },
  },
  validate: (p: Record<string, number>): string[] => {
    const errs: string[] = [];
    if (p.id >= p.od) errs.push('ID must be less than OD');
    if ((p.od - p.id) / 2 < 0.05) errs.push('wall too thin — (od - id)/2 must be ≥ 0.05 in');
    if (p.length <= 0) errs.push('length must be > 0');
    return errs;
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  // Square-cut hollow cylinder — no upsets, no threads, no chamfers.
  // Top face at z=0, bottom face at z=length (Z-down convention).
  return tube(p.od / 2, p.id / 2, p.length);
});