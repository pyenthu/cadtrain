import { cyl, tube, mv } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'threaded_pin',
  name: 'Threaded Pin (Male)',
  description: 'External threads — inserts into a box end.',
  tags: ['pin', 'male', 'connection', 'thread'],
  params: {
    od: { label: 'OD', min: 0.5, max: 14, step: 0.1, unit: 'in', default: 2.5 },
    wall: { label: 'Wall', min: 0.1, max: 1, step: 0.05, unit: 'in', default: 0.3 },
    length: { label: 'Length', min: 0.5, max: 6, step: 0.1, unit: 'in', default: 2.0 },
    threadCount: { label: 'Threads', min: 2, max: 40, step: 1, unit: '', default: 10 },
    threadDepth: {
      label: 'Thread Depth',
      min: 0.02,
      max: 0.15,
      step: 0.01,
      unit: 'in',
      default: 0.06,
    },
    taper: { label: 'Taper (per length)', min: 0, max: 0.2, step: 0.005, unit: '', default: 0 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const taper = p.taper ?? 0;

  const id = p.od - 2 * p.wall;
  const rStart = p.od / 2;
  const rEnd = p.od / 2 - taper * p.length;
  let body = cyl(p.length, rStart, rEnd);
  body = body.subtract(mv(cyl(p.length + 0.02, id / 2, id / 2), [0, 0, -0.01]));
  for (let i = 0; i < p.threadCount; i++) {
    const t = (i + 0.5) / p.threadCount;
    const tz = p.length * t;
    const localR = rStart - taper * p.length * t;
    body = body.subtract(mv(tube(localR + 0.01, localR - p.threadDepth, 0.04), [0, 0, tz]));
  }
  return body;
});
