import { tube, mv } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'thread_if',
  name: 'IF (Internal Flush)',
  description: 'Internal flush — smooth bore through connection, no ID restriction.',
  tags: ['IF', 'internal flush', 'flush joint', 'drill pipe'],
  params: {
    bodyOD: { label: 'Body OD', min: 1, max: 6, step: 0.1, unit: 'in', default: 3.2 },
    pinOD: { label: 'Pin OD', min: 0.8, max: 5, step: 0.1, unit: 'in', default: 3.0 },
    wall: { label: 'Wall', min: 0.1, max: 1, step: 0.05, unit: 'in', default: 0.3 },
    bodyLength: { label: 'Body Length', min: 1, max: 8, step: 0.1, unit: 'in', default: 3.5 },
    pinLength: { label: 'Pin Length', min: 0.5, max: 4, step: 0.1, unit: 'in', default: 2.5 },
    threadCount: { label: 'Threads', min: 4, max: 20, step: 1, unit: '', default: 14 },
    threadDepth: { label: 'Thread Depth', min: 0.02, max: 0.10, step: 0.01, unit: 'in', default: 0.05 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const id = p.bodyOD - 2 * p.wall;
  const body = tube(p.bodyOD / 2, id / 2, p.bodyLength);
  let pin = tube(p.pinOD / 2, id / 2, p.pinLength);
  pin = mv(pin, [0, 0, p.bodyLength]);
  for (let i = 0; i < p.threadCount; i++) {
    const tz = p.bodyLength + p.pinLength * (i + 0.5) / p.threadCount;
    pin = pin.subtract(mv(tube(p.pinOD / 2 + 0.01, p.pinOD / 2 - p.threadDepth, 0.03), [0, 0, tz]));
  }
  return body.add(pin);
});
