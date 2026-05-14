import { tube, mv } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'pipe_coupling',
  name: 'Threaded Coupling (Collar)',
  description: 'Short thick-walled sleeve with internal threads on both ends — joins two pipe pin ends. API 5CT collar geometry (coupling OD, length, thread engagement per end, thread form).',
  tags: ['coupling', 'collar', 'API 5CT', 'box × box', 'STC', 'LTC', 'BTC', 'casing', 'tubing'],
  params: {
    couplingOD: { group: 'Body', label: 'Coupling OD', min: 1.5, max: 22, step: 0.0625, unit: 'in', default: 6.05 },
    pipeOD: { group: 'Body', label: 'Pipe OD (mating)', min: 1.0, max: 20, step: 0.0625, unit: 'in', default: 5.5 },
    boreID: { group: 'Body', label: 'Through Bore ID', min: 0.5, max: 19, step: 0.0625, unit: 'in', default: 4.95 },
    length: { group: 'Body', label: 'Coupling Length', min: 2, max: 14, step: 0.125, unit: 'in', default: 9.0 },
    threadLength: { group: 'Threads', label: 'Thread Engagement / End', min: 0.5, max: 6, step: 0.125, unit: 'in', default: 3.5 },
    threadCount: { group: 'Threads', label: 'Threads / End', min: 4, max: 40, step: 1, unit: '', default: 28 },
    threadDepth: { group: 'Threads', label: 'Thread Depth', min: 0.02, max: 0.15, step: 0.005, unit: 'in', default: 0.062 },
    threadTaper: { group: 'Threads', label: 'Thread Taper (in/in)', min: 0, max: 0.15, step: 0.005, unit: 'in/in', default: 0.0625 },
    reliefID: { group: 'Threads', label: 'Center Relief ID', min: 0, max: 20, step: 0.0625, unit: 'in', default: 5.6 },
  },
  derived: {
    wall: { label: 'Wall (collar)', unit: 'in', from: (p: Record<string, number>) => (p.couplingOD - p.boreID) / 2 },
    tpi: { label: 'Threads-per-Inch', unit: 'tpi', from: (p: Record<string, number>) => p.threadCount / p.threadLength },
    centerLength: { label: 'Center (no-thread) Length', unit: 'in', from: (p: Record<string, number>) => Math.max(0, p.length - 2 * p.threadLength) },
  },
  validate: (p: Record<string, number>): string[] => {
    const errs: string[] = [];
    if (p.couplingOD <= p.pipeOD) errs.push('couplingOD must be greater than pipeOD');
    if (p.boreID >= p.couplingOD) errs.push('boreID must be less than couplingOD');
    if (p.boreID < p.pipeOD - 0.5) errs.push('boreID too small — pin end would not enter coupling');
    if (p.threadLength * 2 > p.length) errs.push('threadLength × 2 exceeds coupling length — threads would overlap at center');
    if (p.reliefID > 0 && p.reliefID < p.boreID) errs.push('reliefID must be ≥ boreID (or 0 to disable)');
    if (p.reliefID >= p.couplingOD) errs.push('reliefID must be less than couplingOD');
    return errs;
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const outerR = p.couplingOD / 2;
  const boreR = p.boreID / 2;

  // Thick-walled sleeve with a straight through bore.
  let body = tube(outerR, boreR, p.length);

  // Optional center relief — slightly enlarged bore between the two thread runs
  // so the mating pin noses don't bind on the un-threaded mid-section.
  const centerLen = p.length - 2 * p.threadLength;
  if (p.reliefID > p.boreID && centerLen > 0.02) {
    body = body.subtract(
      mv(tube(p.reliefID / 2, boreR - 0.01, centerLen), [0, 0, p.threadLength]),
    );
  }

  // Top box threads: taper opens outward toward the top (z = 0).
  // Local radius at fraction t (t=0 at top face, t=1 at thread root) shrinks
  // by threadTaper × threadLength × t — same convention as casing_joint_threaded.
  const topRStart = boreR + p.threadTaper * p.threadLength;
  for (let i = 0; i < p.threadCount; i++) {
    const t = (i + 0.5) / p.threadCount;
    const tz = p.threadLength * t;
    const localR = topRStart - p.threadTaper * p.threadLength * t;
    body = body.subtract(
      mv(tube(localR + p.threadDepth, localR - 0.01, 0.05), [0, 0, tz - 0.025]),
    );
  }

  // Bottom box threads: mirror of the top — taper opens outward toward
  // the bottom face (z = length). Local radius grows toward the bottom face.
  const botStartZ = p.length - p.threadLength;
  for (let i = 0; i < p.threadCount; i++) {
    const t = (i + 0.5) / p.threadCount;
    const tz = botStartZ + p.threadLength * t;
    const localR = boreR + p.threadTaper * p.threadLength * t;
    body = body.subtract(
      mv(tube(localR + p.threadDepth, localR - 0.01, 0.05), [0, 0, tz - 0.025]),
    );
  }

  return body;
});