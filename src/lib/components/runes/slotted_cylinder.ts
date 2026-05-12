import { tube, M } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'slotted_cylinder',
  name: 'Slotted Cylinder',
  description: 'Tube with longitudinal slots cut from the OD inward (simpler single-row form — see slotted_tube for rows + phase).',
  tags: ['collet', 'drag spring', 'port sub', 'flow port', 'vent sub'],
  params: {
    od: { label: 'OD', min: 0.5, max: 6, step: 0.1, unit: 'in', default: 2.5 },
    wall: { label: 'Wall', min: 0.05, max: 1, step: 0.05, unit: 'in', default: 0.3 },
    length: { label: 'Length', min: 1, max: 10, step: 0.1, unit: 'in', default: 4.0 },
    numSlots: { label: 'Slots', min: 1, max: 12, step: 1, unit: '', default: 4 },
    slotWidth: { label: 'Slot Width', min: 0.05, max: 0.5, step: 0.05, unit: 'in', default: 0.15 },
    slotDepth: { label: 'Slot Depth', min: 0.05, max: 0.5, step: 0.05, unit: 'in', default: 0.2 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const id = p.od - 2 * p.wall;
  let body = tube(p.od / 2, id / 2, p.length);
  for (let i = 0; i < p.numSlots; i++) {
    const angle = i * (360 / p.numSlots);
    let slot = M.cube([p.slotWidth, p.slotDepth, p.length * 0.8], true);
    slot = slot.translate([0, p.od / 2 - p.slotDepth / 2, p.length / 2]);
    slot = slot.rotate([0, 0, angle]);
    body = body.subtract(slot);
  }
  return body;
});
