import { tube, mv } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'thread_ltc',
  name: 'LTC (Long Thread Coupled)',
  description: 'Casing connection — long thread for deep wells, coupling required.',
  tags: ['LTC', 'long thread', 'casing connection', 'API casing'],
  params: {
    od: { label: 'OD', min: 2, max: 10, step: 0.1, unit: 'in', default: 5.5 },
    wall: { label: 'Wall', min: 0.15, max: 1, step: 0.05, unit: 'in', default: 0.35 },
    length: { label: 'Length', min: 2, max: 8, step: 0.1, unit: 'in', default: 4.0 },
    threadCount: { label: 'Threads', min: 8, max: 24, step: 1, unit: '', default: 16 },
    threadDepth: { label: 'Thread Depth', min: 0.02, max: 0.10, step: 0.01, unit: 'in', default: 0.05 },
    couplingOD: { label: 'Coupling OD', min: 2, max: 12, step: 0.1, unit: 'in', default: 6.05 },
    couplingLength: { label: 'Coupling Length', min: 0.5, max: 3, step: 0.1, unit: 'in', default: 1.5 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const id = p.od - 2 * p.wall;
  let pipe = tube(p.od / 2, id / 2, p.length);
  for (let i = 0; i < p.threadCount; i++) {
    const tz = p.length * (i + 0.5) / p.threadCount;
    pipe = pipe.subtract(mv(tube(p.od / 2 + 0.01, p.od / 2 - p.threadDepth, 0.03), [0, 0, tz]));
  }
  const coupling = tube(p.couplingOD / 2, p.od / 2 - p.threadDepth, p.couplingLength);
  pipe = pipe.add(mv(coupling, [0, 0, p.length / 2 - p.couplingLength / 2]));
  return pipe;
});
