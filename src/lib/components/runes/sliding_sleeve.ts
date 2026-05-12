import { tube, mv, rot, M } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'sliding_sleeve',
  name: 'Sliding-Sleeve Valve Mandrel',
  description: 'Hollow mandrel with axial ports + polished seal bores at each end. Generic body for interval control valves (HS-ICV, MCC-ICV, circulating valves).',
  tags: ['ICV', 'interval control valve', 'sliding sleeve', 'seal bore', 'valve mandrel', 'completion'],
  params: {
    od: { label: 'OD', min: 2, max: 8, step: 0.1, unit: 'in', default: 3.5 },
    wall: { label: 'Wall', min: 0.2, max: 1, step: 0.05, unit: 'in', default: 0.4 },
    length: { label: 'Length', min: 3, max: 10, step: 0.1, unit: 'in', default: 5.0 },
    numPorts: { label: 'Ports', min: 1, max: 8, step: 1, unit: '', default: 4 },
    portWidth: { label: 'Port Width', min: 0.1, max: 1, step: 0.05, unit: 'in', default: 0.4 },
    portHeight: { label: 'Port Height', min: 0.3, max: 2, step: 0.05, unit: 'in', default: 0.8 },
    sealBoreDepth: { label: 'Seal-Bore Depth', min: 0.02, max: 0.15, step: 0.01, unit: 'in', default: 0.06 },
    sealBoreHeight: { label: 'Seal-Bore Height', min: 0.2, max: 1, step: 0.05, unit: 'in', default: 0.5 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const id = p.od - 2 * p.wall;
  let body = tube(p.od / 2, id / 2, p.length);
  const portZ = p.length / 2;
  for (let i = 0; i < p.numPorts; i++) {
    const angle = (i * 360) / p.numPorts;
    const port = rot(M.cube([p.od * 1.2, p.portWidth, p.portHeight], true), [0, 0, angle]);
    body = body.subtract(mv(port, [0, 0, portZ]));
  }
  const sbH = p.sealBoreHeight;
  body = body.subtract(mv(tube(id / 2 + p.sealBoreDepth, id / 2 - 0.01, sbH), [0, 0, sbH / 2]));
  body = body.subtract(mv(tube(id / 2 + p.sealBoreDepth, id / 2 - 0.01, sbH), [0, 0, p.length - sbH * 1.5]));
  return body;
});
