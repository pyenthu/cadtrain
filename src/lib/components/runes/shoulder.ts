import { cyl, tube, mv } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'shoulder',
  name: 'Shoulder (Step)',
  description: 'Abrupt diameter change — bearing surface.',
  tags: ['step', 'upset', 'landing shoulder', 'stop ring', 'bearing face'],
  params: {
    odSmall: { label: 'Small OD', min: 0.5, max: 4, step: 0.1, unit: 'in', default: 2.0 },
    odLarge: { label: 'Large OD', min: 1, max: 6, step: 0.1, unit: 'in', default: 3.0 },
    wall: { label: 'Wall', min: 0.1, max: 1, step: 0.05, unit: 'in', default: 0.3 },
    smallLength: { label: 'Small Length', min: 0.5, max: 6, step: 0.1, unit: 'in', default: 3.0 },
    largeLength: { label: 'Large Length', min: 0.5, max: 6, step: 0.1, unit: 'in', default: 2.0 },
    taperH: { label: 'Taper Height', min: 0, max: 0.5, step: 0.05, unit: 'in', default: 0.15 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const idSmall = p.odSmall - 2 * p.wall;
  const idLarge = p.odLarge - 2 * p.wall;
  let body = tube(p.odSmall / 2, idSmall / 2, p.smallLength);
  if (p.taperH > 0.01) {
    body = body.add(mv(cyl(p.taperH, p.odSmall / 2, p.odLarge / 2).subtract(
      cyl(p.taperH + 0.02, idSmall / 2, idLarge / 2)
    ), [0, 0, p.smallLength]));
    body = body.add(mv(tube(p.odLarge / 2, idLarge / 2, p.largeLength), [0, 0, p.smallLength + p.taperH]));
  } else {
    body = body.add(mv(tube(p.odLarge / 2, idLarge / 2, p.largeLength), [0, 0, p.smallLength]));
  }
  return body;
});
