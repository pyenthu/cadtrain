import { cyl, mv, rot, M } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'whipstock',
  name: 'Whipstock',
  description: 'Angled deflector wedge — kicks the milling / drilling bit off-center toward a lateral exit at a multilateral junction.',
  tags: ['whipstock', 'deflector', 'ramp', 'multilateral junction', 'kick-off'],
  params: {
    od: { label: 'OD', min: 2, max: 10, step: 0.1, unit: 'in', default: 5.0 },
    length: { label: 'Length', min: 2, max: 8, step: 0.1, unit: 'in', default: 4.0 },
    rampHeight: { label: 'Ramp Height', min: 0.5, max: 4, step: 0.1, unit: 'in', default: 2.0 },
    rampOffset: { label: 'Ramp Offset', min: 0, max: 2, step: 0.1, unit: 'in', default: 0 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  let body = cyl(p.length, p.od / 2);
  const rampAngle = (Math.atan2(p.rampHeight, p.length) * 180) / Math.PI;
  const ramp = M.cube([p.od * 1.5, p.od * 1.5, p.length * 1.5], true);
  let tilted = rot(ramp, [0, -rampAngle, 0]);
  tilted = mv(tilted, [p.od * 0.6, 0, p.length / 2 + p.rampOffset]);
  body = body.subtract(tilted);
  return body;
});
