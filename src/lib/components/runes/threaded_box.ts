import { cyl, tube, mv } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'threaded_box',
  name: 'Threaded Box (Female)',
  description: 'Internal threads — receives a pin end. Generic primitive; specific connection forms compose this with a body and per-spec thread profile.',
  tags: ['box', 'female', 'connection', 'thread'],
  params: {
    od: { label: 'OD', min: 0.5, max: 14, step: 0.1, unit: 'in', default: 3.0 },
    wall: { label: 'Wall', min: 0.1, max: 1, step: 0.05, unit: 'in', default: 0.5 },
    length: { label: 'Length', min: 0.5, max: 6, step: 0.1, unit: 'in', default: 2.5 },
    threadCount: { label: 'Threads', min: 2, max: 40, step: 1, unit: '', default: 8 },
    threadDepth: { label: 'Thread Depth', min: 0.02, max: 0.15, step: 0.01, unit: 'in', default: 0.08 },
    taper: { label: 'Taper (per length)', min: 0, max: 0.2, step: 0.005, unit: '', default: 0 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const taper = p.taper ?? 0;
  const idBase = p.od - 2 * p.wall;
  const rStart = idBase / 2;
  const rEnd = idBase / 2 + taper * p.length;
  let body = cyl(p.length, p.od / 2, p.od / 2);
  body = body.subtract(mv(cyl(p.length + 0.02, rStart, rEnd), [0, 0, -0.01]));
  for (let i = 0; i < p.threadCount; i++) {
    const t = (i + 0.5) / p.threadCount;
    const tz = p.length * t;
    const localR = rStart + (rEnd - rStart) * t;
    body = body.subtract(mv(tube(localR + p.threadDepth, localR - 0.01, 0.05), [0, 0, tz]));
  }
  return body;
});
