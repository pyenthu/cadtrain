import { tube, mv, M } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'packer_element',
  name: 'Packer Element',
  description: 'Elastomer sealing element — expands to seal annulus.',
  tags: ['rubber element', 'elastomer', 'seal element', 'swab cup', 'packer rubber'],
  params: {
    odCompressed: { label: 'OD (set)', min: 1, max: 6, step: 0.1, unit: 'in', default: 2.5 },
    odExpanded: { label: 'OD (expanded)', min: 2, max: 8, step: 0.1, unit: 'in', default: 4.0 },
    mandrelOD: { label: 'Mandrel OD', min: 0.5, max: 3, step: 0.1, unit: 'in', default: 1.5 },
    length: { label: 'Length', min: 0.5, max: 4, step: 0.1, unit: 'in', default: 2.0 },
    numRings: { label: 'Rings', min: 1, max: 5, step: 1, unit: '', default: 3 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  let element = M.cube([0.001, 0.001, 0.001], true);
  const ringH = p.length / p.numRings;
  for (let i = 0; i < p.numRings; i++) {
    const t = (i + 0.5) / p.numRings;
    const midOD = p.odCompressed + (p.odExpanded - p.odCompressed) * Math.sin(t * Math.PI) * 0.3;
    const ring = tube(midOD / 2, p.mandrelOD / 2, ringH * 0.9);
    element = element.add(mv(ring, [0, 0, i * ringH]));
  }
  return element;
});
