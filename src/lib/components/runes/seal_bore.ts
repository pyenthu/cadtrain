import { tube, mv } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'seal_bore',
  name: 'Seal Bore (Polished)',
  description: 'Smooth internal bore with seal grooves.',
  tags: ['PBR', 'polished bore receptacle', 'seal assembly', 'sealbore extension'],
  params: {
    od: { label: 'OD', min: 0.5, max: 6, step: 0.1, unit: 'in', default: 2.8 },
    boreID: { label: 'Bore ID', min: 0.3, max: 4, step: 0.1, unit: 'in', default: 2.0 },
    length: { label: 'Length', min: 1, max: 10, step: 0.1, unit: 'in', default: 3.0 },
    numGrooves: { label: 'Grooves', min: 0, max: 8, step: 1, unit: '', default: 3 },
    grooveDepth: { label: 'Groove Depth', min: 0.02, max: 0.1, step: 0.01, unit: 'in', default: 0.05 },
    grooveWidth: { label: 'Groove Width', min: 0.05, max: 0.3, step: 0.05, unit: 'in', default: 0.1 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  let body = tube(p.od / 2, p.boreID / 2, p.length);
  for (let i = 0; i < p.numGrooves; i++) {
    const gz = p.length * (i + 1) / (p.numGrooves + 1);
    body = body.subtract(mv(tube(p.boreID / 2 + p.grooveDepth, p.boreID / 2 - 0.01, p.grooveWidth), [0, 0, gz - p.grooveWidth / 2]));
  }
  return body;
});
