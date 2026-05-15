import { cyl, mv } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'taper',
  name: 'Taper (Cone)',
  description:
    'Smooth diameter transition between two sections. Doubles as setting / release cones in packer assemblies.',
  tags: ['cone', 'swage', 'reducer', 'transition', 'wedge'],
  params: {
    odTop: { label: 'OD Top', min: 0.5, max: 6, step: 0.1, unit: 'in', default: 2.0 },
    odBottom: { label: 'OD Bottom', min: 0.5, max: 6, step: 0.1, unit: 'in', default: 3.0 },
    wall: { label: 'Wall', min: 0.05, max: 1, step: 0.05, unit: 'in', default: 0.3 },
    length: { label: 'Length', min: 0.2, max: 4, step: 0.1, unit: 'in', default: 0.8 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const idTop = p.odTop - 2 * p.wall;
  const idBottom = p.odBottom - 2 * p.wall;
  const outer = cyl(p.length, p.odTop / 2, p.odBottom / 2);

  const inner = cyl(p.length + 0.02, idTop / 2, idBottom / 2);
  return outer.subtract(mv(inner, [0, 0, -0.01]));
});
