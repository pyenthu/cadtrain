import { tube } from '../manifold-helpers';
import { defineGeom } from '.';
export const meta = { id: 'hollow_cylinder', name: 'Tube', description: 'Hollow cylinder (tube)', tags: ['tube','pipe'], params: { length: { label: 'length', min: 0.5, max: 12, step: 0.1, default: 4, unit: 'in' }, od: { label: 'OD', min: 0.5, max: 12, step: 0.1, default: 2.875, unit: 'in' }, wall: { label: 'wall', min: 0.05, max: 1, step: 0.01, default: 0.3, unit: 'in' } } } as const;
export const geom = defineGeom(meta, (p) => tube(p.od / 2, (p.od - 2 * p.wall) / 2, p.length));
