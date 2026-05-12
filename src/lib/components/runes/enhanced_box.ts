import { geom as taperedConeGeom } from './tapered_cone';
import { tube } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'enhanced_box',
  name: 'box_en',
  description: '',
  tags: [],
  params: {
    od: { label: 'OD', min: 0.5, max: 6, step: 0.1, unit: 'in', default: 2.0 },
    wall: { unit: 'in', label: 'Wall', step: 0.05, max: 2, min: 0.1, default: 0.28 },
    length: { label: 'Length', min: 0.5, max: 15, step: 0.1, unit: 'in', default: 1.5 },
    odTop: { label: 'OD Top', min: 0.5, max: 6, step: 0.1, unit: 'in', default: 1.5 },
    coneLength: { label: 'Cone Length', min: 0.5, max: 10, step: 0.1, unit: 'in', default: 0.5 },
  },
} as const;

export const geom = defineGeom(meta, ({ od, wall, length, odTop, coneLength }) => {
  const coneTop = -length / 2 - coneLength / 2;
  const bore = tube(od / 2, od / 2 - wall, length);

  const tc1 = taperedConeGeom({ od: 2.875, odTop: 2, wall: wall, length: coneLength }); // + part: Tapered Cone
  return bore.add(tc1);
});
