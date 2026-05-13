import { cyl, tube, mv } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'tubing_hanger_coupling',
  name: 'Tubing Hanger Coupling',
  description: 'Union-nut coupling that lands on a tubing-hanger thread. Lets the back-pressure valve be screwed in without rotating the Christmas tree. Hex-style union nut at top, API EUE box thread profile below.',
  tags: ['wellhead', 'tubing hanger', 'THC', 'coupling', 'union nut', 'BPV', 'API EUE'],
  params: {
    couplingOD: { label: 'Coupling OD', min: 3, max: 10, step: 0.0625, unit: 'in', default: 4.5 },
    tubingOD: { label: 'Tubing OD', min: 2, max: 6, step: 0.0625, unit: 'in', default: 2.375 },
    nutHeight: { label: 'Nut Height', min: 0.5, max: 4, step: 0.125, unit: 'in', default: 1.5 },
    bodyHeight: { label: 'Body Height', min: 1, max: 6, step: 0.125, unit: 'in', default: 3.0 },
    wall: { label: 'Wall', min: 0.15, max: 1, step: 0.05, unit: 'in', default: 0.35 },
    threadCount: { label: 'Threads', min: 2, max: 20, step: 1, unit: '', default: 8 },
    threadDepth: { label: 'Thread Depth', min: 0.02, max: 0.15, step: 0.01, unit: 'in', default: 0.06 },
    bpvBore: { label: 'BPV Bore', min: 0.5, max: 4, step: 0.0625, unit: 'in', default: 1.5 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const totalLen = p.nutHeight + p.bodyHeight;
  const bodyOD = p.tubingOD + 2 * p.wall;
  let body = cyl(p.nutHeight, p.couplingOD / 2);
  body = body.add(mv(cyl(p.bodyHeight, bodyOD / 2), [0, 0, p.nutHeight]));
  body = body.subtract(mv(cyl(p.nutHeight + 0.02, p.bpvBore / 2), [0, 0, -0.01]));
  const tubingBoreR = p.tubingOD / 2;
  body = body.subtract(mv(cyl(p.bodyHeight + 0.02, tubingBoreR), [0, 0, p.nutHeight - 0.01]));
  for (let i = 0; i < p.threadCount; i++) {
    const t = (i + 0.5) / p.threadCount;
    const tz = p.nutHeight + p.bodyHeight * t;
    body = body.subtract(mv(tube(tubingBoreR + p.threadDepth, tubingBoreR - 0.01, 0.05), [0, 0, tz]));
  }
  return body;
});
