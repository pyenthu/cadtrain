import { cyl, tube, mv } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'thread_fh',
  name: 'FH (Full Hole)',
  description: 'Full hole — larger bore, moderate upset, balanced strength.',
  tags: ['FH', 'full hole', 'drill collar connection'],
  params: {
    bodyOD: { label: 'Body OD', min: 1, max: 6, step: 0.1, unit: 'in', default: 3.8 },
    pinOD: { label: 'Pin OD', min: 0.8, max: 5, step: 0.1, unit: 'in', default: 3.0 },
    wall: { label: 'Wall', min: 0.15, max: 1, step: 0.05, unit: 'in', default: 0.4 },
    bodyLength: { label: 'Body Length', min: 1, max: 8, step: 0.1, unit: 'in', default: 3.0 },
    pinLength: { label: 'Pin Length', min: 0.5, max: 3, step: 0.1, unit: 'in', default: 1.8 },
    threadCount: { label: 'Threads', min: 4, max: 16, step: 1, unit: '', default: 10 },
    threadDepth: { label: 'Thread Depth', min: 0.02, max: 0.10, step: 0.01, unit: 'in', default: 0.06 },
    shoulderWidth: { label: 'Shoulder Width', min: 0.1, max: 0.6, step: 0.05, unit: 'in', default: 0.3 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const id = p.bodyOD - 2 * p.wall;
  let body = tube(p.bodyOD / 2, id / 2, p.bodyLength);
  body = body.add(mv(cyl(p.shoulderWidth, p.bodyOD / 2), [0, 0, p.bodyLength]));
  body = body.subtract(cyl(p.bodyLength + p.shoulderWidth + 0.1, id / 2));
  let pin = tube(p.pinOD / 2, id / 2, p.pinLength);
  pin = mv(pin, [0, 0, p.bodyLength + p.shoulderWidth]);
  for (let i = 0; i < p.threadCount; i++) {
    const tz = p.bodyLength + p.shoulderWidth + p.pinLength * (i + 0.5) / p.threadCount;
    pin = pin.subtract(mv(tube(p.pinOD / 2 + 0.01, p.pinOD / 2 - p.threadDepth, 0.04), [0, 0, tz]));
  }
  return body.add(pin);
});
