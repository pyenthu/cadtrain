import { tube, mv, rot, cyl } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'slotted_tube',
  name: 'Slotted Tube',
  description: 'Hollow tube with one or more rows of longitudinal slots cut through the wall.',
  tags: ['slotted', 'tube', 'sub', 'screen', 'liner'],
  params: {
    od: { label: 'OD', min: 0.5, max: 6, step: 0.1, unit: 'in', default: 2.875 },
    wall: { label: 'Wall', min: 0.05, max: 1, step: 0.05, unit: 'in', default: 0.375 },
    length: { label: 'Length', min: 0.5, max: 15, step: 0.1, unit: 'in', default: 7 },
    slot_count: { label: 'Slots per Row', min: 0, max: 12, step: 1, unit: '', default: 7 },
    slot_width: { label: 'Slot Width', min: 0.05, max: 1, step: 0.01, unit: 'in', default: 0.1 },
    slot_height: { label: 'Slot Height', min: 0.1, max: 14, step: 0.1, unit: 'in', default: 0.75 },
    first_offset: {
      label: 'First Row Z Offset',
      min: 0,
      max: 14,
      step: 0.1,
      unit: 'in',
      default: 0.5,
    },
    row_offset: { label: 'Row Z Offset', min: 0.1, max: 14, step: 0.1, unit: 'in', default: 1.5 },
    slot_phase: { label: 'Slot Phase', min: 0, max: 180, step: 1, unit: 'deg', default: 60 },
    slot_rows: { label: 'Slot Rows', min: 1, max: 10, step: 1, unit: '', default: 4 },
    row_phase_offset: {
      label: 'Row Phase Offset',
      min: 0,
      max: 180,
      step: 1,
      unit: 'deg',
      default: 60,
    },
  },
  validate: (p: Record<string, number>): string[] => {
    const errs: string[] = [];
    if (p.wall * 2 >= p.od) errs.push('wall too thick — bore would collapse (wall*2 must be < od)');
    if (p.length <= 0) errs.push('length must be > 0');
    if (p.slot_count > 0 && p.slot_rows > 0) {
      if (p.slot_width >= p.od) errs.push('slot_width must be less than OD');
      if (p.slot_height <= 0) errs.push('slot_height must be > 0');
      const totalReach = p.first_offset + (p.slot_rows - 1) * p.row_offset + p.slot_height;
      if (totalReach > p.length)
        errs.push(`slot pattern overflows tube (${totalReach.toFixed(2)} > length ${p.length})`);
      if (p.slot_rows > 1 && p.row_offset < p.slot_height)
        errs.push('row_offset < slot_height — consecutive rows overlap');
    }
    return errs;
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const id = p.od - 2 * p.wall;
  let body = tube(p.od / 2, id / 2, p.length);

  const count = Math.round(p.slot_count);
  const rows = Math.round(p.slot_rows);
  if (count < 1 || rows < 1) return body;

  // Each slot cutter = a full-diameter disc minus two side-blockers,
  // leaving only a strip `slot_width` wide. Blockers MUCH larger than
  // the disc so their inner boundary reads as a near-straight line —
  // see the math derivation in the prior commit.
  const outerR = p.od / 2 + 0.01;
  const blockerR = outerR * 50;
  const hw = p.slot_width / 2;

  for (let r = 0; r < rows; r++) {
    const zOffset = p.first_offset + r * p.row_offset;
    const rowPhase = r * p.row_phase_offset;
    for (let i = 0; i < count; i++) {
      const angleDeg = (360 / count) * i + p.slot_phase + rowPhase;
      const fullDisk = cyl(p.slot_height, outerR);
      const leftBlock = mv(cyl(p.slot_height, blockerR), [0, hw + blockerR, 0]);
      const rightBlock = mv(cyl(p.slot_height, blockerR), [0, -hw - blockerR, 0]);
      const slotLocal = fullDisk.subtract(leftBlock).subtract(rightBlock);
      const slotMoved = mv(slotLocal, [0, 0, zOffset]);
      const slotFinal = rot(slotMoved, [0, 0, angleDeg]);
      body = body.subtract(slotFinal);
    }
  }

  return body;
});
