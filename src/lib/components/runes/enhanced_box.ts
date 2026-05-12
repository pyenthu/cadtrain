import { geom as taperedConeGeom } from './tapered_cone';
import { tube, mv } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'enhanced_box',
  name: 'box_en',
  description: '',
  tags: [],
  params: {
    od: { label: 'OD', min: 0.5, max: 6, step: 0.1, unit: 'in', default: 2.0 },
    wall: { unit: 'in', label: 'Wall', step: 0.05, max: 2, min: 0.1, default: 0.28 },
    stub_len: { unit: 'in', label: 'Length', step: 0.1, max: 15, min: 0.5, default: 1 },
    odTop: { label: 'OD Top', min: 0.5, max: 6, step: 0.1, unit: 'in', default: 1.5 },
    coneLength: { label: 'Cone Length', min: 0.5, max: 10, step: 0.1, unit: 'in', default: 0.5 },
    collar_mult: { label: 'Collar OD/Body OD', step: 0.1, max: 10, min: 1, default: 1.2 },
    collar_len: { unit: 'in', label: 'Collar Length', step: 0.1, max: 10, min: 0.1, default: 1 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const collarOd = p.od * p.collar_mult;

  const bore = tube(p.od / 2, p.od / 2 - p.wall, p.stub_len);

  const tc1 = taperedConeGeom({
    od: p.od,
    odTop: collarOd,
    wall: p.wall,
    length: p.coneLength,
  }).translate(0, 0, -p.coneLength);

  // Collar tube at the large end of the tapered cone (top, lower z)
  const collarTube = mv(tube(collarOd / 2, collarOd / 2 - p.wall, p.collar_len), [
    0,
    0,
    -p.coneLength - p.collar_len,
  ]);

  return bore.add(tc1).add(collarTube);
});
