import { tube, mv } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'grooved_cylinder',
  name: 'Grooved Cylinder',
  description: 'External circumferential grooves (for seals, snap rings).',
  tags: ['snap ring groove', 'lock ring', 'seal groove', 'profile nipple', 'landing nipple'],
  params: {
    od: { label: 'OD', min: 0.5, max: 6, step: 0.1, unit: 'in', default: 2.5 },
    wall: { label: 'Wall', min: 0.1, max: 1, step: 0.05, unit: 'in', default: 0.3 },
    length: { label: 'Length', min: 1, max: 8, step: 0.1, unit: 'in', default: 3.0 },
    numGrooves: { label: 'Grooves', min: 1, max: 12, step: 1, unit: '', default: 4 },
    grooveDepth: { label: 'Groove Depth', min: 0.02, max: 0.15, step: 0.01, unit: 'in', default: 0.08 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const id = p.od - 2 * p.wall;
  let body = tube(p.od / 2, id / 2, p.length);
  for (let i = 0; i < p.numGrooves; i++) {
    const gz = p.length * (i + 1) / (p.numGrooves + 1);
    body = body.subtract(mv(tube(p.od / 2 + 0.01, p.od / 2 - p.grooveDepth, 0.06), [0, 0, gz]));
  }
  return body;
});
