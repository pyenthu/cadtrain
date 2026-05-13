import { tube, mv, M } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'drill_pipe_tool_joint',
  name: 'Drill-Pipe Tool Joint',
  description: 'Drill-pipe tool-joint upset with API grade-identification markings — circumferential grooves + short axial slots in the tong-area band.',
  tags: ['drill pipe', 'tool joint', 'DP', 'identification', 'tong area', 'API drill pipe'],
  params: {
    pipeOD: { label: 'Pipe OD', min: 2.5, max: 8, step: 0.05, unit: 'in', default: 5.0 },
    toolJointOD: { label: 'Tool-Joint OD', min: 3, max: 10, step: 0.05, unit: 'in', default: 6.625 },
    wall: { label: 'Wall', min: 0.2, max: 1.5, step: 0.05, unit: 'in', default: 0.5 },
    length: { label: 'Length', min: 4, max: 12, step: 0.1, unit: 'in', default: 6.0 },
    numGrooves: { label: 'Grooves', min: 0, max: 4, step: 1, unit: '', default: 1 },
    numSlots: { label: 'Slots', min: 0, max: 2, step: 1, unit: '', default: 0 },
    grooveDepth: { label: 'Groove Depth', min: 0.02, max: 0.12, step: 0.01, unit: 'in', default: 0.05 },
    grooveWidth: { label: 'Groove Width', min: 0.1, max: 0.6, step: 0.05, unit: 'in', default: 0.2 },
    grooveWide: { label: 'Wide Groove (0/1)', min: 0, max: 1, step: 1, unit: '', default: 0 },
    slotWidth: { label: 'Slot Width', min: 0.05, max: 0.4, step: 0.05, unit: 'in', default: 0.15 },
    slotLength: { label: 'Slot Length', min: 0.2, max: 1.5, step: 0.05, unit: 'in', default: 0.6 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const id = p.toolJointOD - 2 * p.wall;
  let body = tube(p.toolJointOD / 2, id / 2, p.length);
  const bandStart = p.length * 0.35;
  const bandEnd = p.length * 0.65;
  const bandSpan = bandEnd - bandStart;
  if (p.numGrooves > 0) {
    const stepZ = bandSpan / (p.numGrooves + 1);
    for (let i = 0; i < p.numGrooves; i++) {
      const gz = bandStart + stepZ * (i + 1);
      const gw = p.grooveWide ? p.grooveWidth * 2 : p.grooveWidth;
      body = body.subtract(mv(tube(p.toolJointOD / 2 + 0.01, p.toolJointOD / 2 - p.grooveDepth, gw), [0, 0, gz - gw / 2]));
    }
  }
  for (let i = 0; i < p.numSlots; i++) {
    const sz = bandStart + bandSpan * (i + 0.5) / p.numSlots;
    const slot = M.cube([p.slotWidth, p.toolJointOD * 1.2, p.slotLength], true);
    body = body.subtract(mv(slot, [0, 0, sz]));
  }
  return body;
});
