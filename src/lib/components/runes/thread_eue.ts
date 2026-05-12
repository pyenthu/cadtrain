import { cyl, tube, mv } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'thread_eue',
  name: 'EUE (External Upset End)',
  description: 'Tubing connection — pin end with an external upset (thicker wall) carrying API EUE cut threads.',
  tags: ['EUE', 'external upset', 'tubing connection', 'API tubing'],
  params: {
    bodyOD: { label: 'Body OD', min: 1, max: 5, step: 0.1, unit: 'in', default: 2.375 },
    upsetOD: { label: 'Upset OD', min: 1.5, max: 6, step: 0.1, unit: 'in', default: 2.875 },
    wall: { label: 'Wall', min: 0.1, max: 0.8, step: 0.05, unit: 'in', default: 0.25 },
    bodyLength: { label: 'Body Length', min: 2, max: 10, step: 0.1, unit: 'in', default: 4.0 },
    upsetLength: { label: 'Upset Length', min: 0.5, max: 3, step: 0.1, unit: 'in', default: 1.5 },
    threadCount: { label: 'Threads', min: 4, max: 16, step: 1, unit: '', default: 10 },
    threadDepth: { label: 'Thread Depth', min: 0.02, max: 0.10, step: 0.01, unit: 'in', default: 0.05 },
    taperH: { label: 'Taper Height', min: 0.1, max: 0.5, step: 0.05, unit: 'in', default: 0.2 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const id = p.bodyOD - 2 * p.wall;
  let body = tube(p.bodyOD / 2, id / 2, p.bodyLength);
  const taper = cyl(p.taperH, p.bodyOD / 2, p.upsetOD / 2).subtract(
    cyl(p.taperH + 0.02, id / 2, id / 2));
  body = body.add(mv(taper, [0, 0, p.bodyLength]));
  let upset = tube(p.upsetOD / 2, id / 2, p.upsetLength);
  upset = mv(upset, [0, 0, p.bodyLength + p.taperH]);
  for (let i = 0; i < p.threadCount; i++) {
    const tz = p.bodyLength + p.taperH + p.upsetLength * (i + 0.5) / p.threadCount;
    upset = upset.subtract(mv(tube(p.upsetOD / 2 + 0.01, p.upsetOD / 2 - p.threadDepth, 0.04), [0, 0, tz]));
  }
  return body.add(upset);
});
