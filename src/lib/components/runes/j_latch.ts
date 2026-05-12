import { tube, M } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'j_latch',
  name: 'J-Latch Profile',
  description: 'J-slot mechanism for lock / unlock rotation.',
  tags: ['j-slot', 'ratch-latch', 'lock mandrel', 'locator', 'running tool'],
  params: {
    od: { label: 'OD', min: 0.5, max: 4, step: 0.1, unit: 'in', default: 2.2 },
    wall: { label: 'Wall', min: 0.1, max: 0.8, step: 0.05, unit: 'in', default: 0.3 },
    length: { label: 'Length', min: 0.5, max: 3, step: 0.1, unit: 'in', default: 1.5 },
    slotWidth: { label: 'Slot Width', min: 0.05, max: 0.3, step: 0.05, unit: 'in', default: 0.15 },
    slotDepth: { label: 'Slot Depth', min: 0.1, max: 0.5, step: 0.05, unit: 'in', default: 0.25 },
    numSlots: { label: 'J-Slots', min: 1, max: 4, step: 1, unit: '', default: 2 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const id = p.od - 2 * p.wall;
  let body = tube(p.od / 2, id / 2, p.length);
  for (let i = 0; i < p.numSlots; i++) {
    const angle = i * (360 / p.numSlots);
    let vSlot = M.cube([p.slotWidth, p.slotDepth, p.length * 0.6], true);
    vSlot = vSlot.translate([0, p.od / 2 - p.slotDepth / 2, p.length * 0.4]);
    vSlot = vSlot.rotate([0, 0, angle]);
    body = body.subtract(vSlot);
    let hSlot = M.cube([p.slotWidth * 2, p.slotDepth, p.slotWidth], true);
    hSlot = hSlot.translate([p.slotWidth * 0.5, p.od / 2 - p.slotDepth / 2, p.length * 0.1]);
    hSlot = hSlot.rotate([0, 0, angle]);
    body = body.subtract(hSlot);
  }
  return body;
});
