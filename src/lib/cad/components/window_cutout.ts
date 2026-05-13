import { tube, mv, M } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'window_cutout',
  name: 'Pre-Milled Window',
  description: 'Casing joint with a rectangular pre-milled window — multilateral lateral-exit base.',
  tags: ['multilateral', 'window', 'pre-milled', 'lateral', 'TAML'],
  params: {
    od: { label: 'OD', min: 4, max: 14, step: 0.1, unit: 'in', default: 7.0 },
    wall: { label: 'Wall', min: 0.2, max: 1, step: 0.05, unit: 'in', default: 0.4 },
    length: { label: 'Length', min: 3, max: 8, step: 0.1, unit: 'in', default: 5.0 },
    windowWidth: { label: 'Window Width', min: 0.5, max: 4, step: 0.1, unit: 'in', default: 2.0 },
    windowHeight: { label: 'Window Height', min: 1, max: 5, step: 0.1, unit: 'in', default: 3.0 },
    windowOffset: { label: 'Window Offset', min: 0.5, max: 5, step: 0.1, unit: 'in', default: 1.0 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const id = p.od - 2 * p.wall;
  let body = tube(p.od / 2, id / 2, p.length);
  const cut = M.cube([p.windowWidth, p.od * 1.2, p.windowHeight], true);
  body = body.subtract(mv(cut, [0, 0, p.windowOffset + p.windowHeight / 2]));
  return body;
});
