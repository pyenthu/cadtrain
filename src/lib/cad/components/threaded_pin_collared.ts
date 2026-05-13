import { cyl, tube, mv, M } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'threaded_pin_collared',
  name: 'Threaded Pin (Collared)',
  description: 'Male end with explicit collar (upset OD), taper transition, and optional flush body stub.',
  tags: ['pin', 'collared', 'EUE', 'upset', 'API'],
  params: {
    od: { label: 'Body OD', min: 1, max: 14, step: 0.05, unit: 'in', default: 2.875 },
    wall: { label: 'Wall', min: 0.1, max: 1, step: 0.05, unit: 'in', default: 0.217 },
    collarOD: { label: 'Collar OD', min: 1, max: 16, step: 0.05, unit: 'in', default: 3.668 },
    taperHeight: { label: 'Taper Height', min: 0, max: 2, step: 0.05, unit: 'in', default: 0.4 },
    collarLength: { label: 'Collar Length', min: 0.3, max: 6, step: 0.05, unit: 'in', default: 0.8 },
    bodyStubLength: { label: 'Body Stub Length', min: 0, max: 2, step: 0.05, unit: 'in', default: 0 },
    threadCount: { label: 'Threads', min: 2, max: 40, step: 1, unit: '', default: 8 },
    threadDepth: { label: 'Thread Depth', min: 0.02, max: 0.15, step: 0.01, unit: 'in', default: 0.04 },
    taper: { label: 'Thread Taper (1:N)', min: 0, max: 0.2, step: 0.005, unit: '', default: 0.0625 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const od = p.od;
  const collarOD = p.collarOD;
  const stubLen = p.bodyStubLength;
  const taperLen = p.taperHeight;
  const collarLen = p.collarLength;
  const id = od - 2 * p.wall;

  let body = M.cube([0.001, 0.001, 0.001], true);
  if (stubLen > 0) {
    body = body.add(mv(cyl(stubLen, od / 2), [0, 0, stubLen / 2]));
  }
  if (taperLen > 0) {
    body = body.add(mv(cyl(taperLen, od / 2, collarOD / 2), [0, 0, stubLen + taperLen / 2]));
  }

  const taper = p.taper ?? 0;
  const collarStartZ = stubLen + taperLen;
  const odStart = collarOD / 2;
  const odEnd = collarOD / 2 - taper * collarLen;
  body = body.add(mv(cyl(collarLen, odStart, odEnd), [0, 0, collarStartZ + collarLen / 2]));

  body = body.subtract(mv(cyl(stubLen + taperLen + collarLen + 0.02, id / 2), [0, 0, (stubLen + taperLen + collarLen + 0.02) / 2 - 0.01]));

  for (let i = 0; i < p.threadCount; i++) {
    const t = (i + 0.5) / p.threadCount;
    const tz = collarStartZ + collarLen * t;
    const localR = odStart - taper * collarLen * t;
    body = body.subtract(mv(tube(localR + 0.01, localR - p.threadDepth, 0.04), [0, 0, tz]));
  }
  return body;
});
