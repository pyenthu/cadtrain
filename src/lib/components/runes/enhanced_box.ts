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
    threadCount: { label: 'Collar Threads', min: 0, max: 20, step: 1, unit: '', default: 6 },
    threadDepth: { label: 'Thread Depth', min: 0.02, max: 0.15, step: 0.01, unit: 'in', default: 0.06 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const collarOd = p.od * p.collar_mult;
  const collarInnerR = collarOd / 2 - p.wall;

  const bore = tube(p.od / 2, p.od / 2 - p.wall, p.stub_len);

  const tc1 = taperedConeGeom({
    od: p.od,
    odTop: collarOd,
    wall: p.wall,
    length: p.coneLength,
  }).translate(0, 0, -p.coneLength);

  const collarTop = -p.coneLength - p.collar_len;
  let collarTube = mv(tube(collarOd / 2, collarInnerR, p.collar_len), [0, 0, collarTop]);
  for (let i = 0; i < p.threadCount; i++) {
    const t = (i + 0.5) / p.threadCount;
    const tz = collarTop + p.collar_len * t;
    const cut = tube(collarInnerR + p.threadDepth, collarInnerR - 0.01, 0.05);
    collarTube = collarTube.subtract(mv(cut, [0, 0, tz - 0.025]));
  }

  return bore.add(tc1).add(collarTube);
});
