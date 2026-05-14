import { tube, mv } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'casing_joint',
  name: 'Casing Joint',
  description: 'Long thick-walled hollow casing pipe with external API cut threads at both ends. R-3 range length (34–48 ft real-world, scaled inches in viewer). Defaults per API 5CT 7" 26 lb/ft. Coupling is a separate primitive; this joint is the bare pin × pin pipe.',
  tags: ['casing', 'API 5CT', 'joint', 'R-3', 'pipe', 'STC', 'LTC', 'BTC', 'threaded', 'pin x pin'],
  params: {
    od: { group: 'Body', label: 'OD', min: 4.5, max: 20, step: 0.0625, unit: 'in', default: 7.0 },
    wall: { group: 'Body', label: 'Wall Thickness', min: 0.2, max: 1.25, step: 0.005, unit: 'in', default: 0.408 },
    jointLength: { group: 'Body', label: 'Joint Length (R-3)', min: 24, max: 60, step: 0.5, unit: 'in', default: 42.0 },
    threadLength: { group: 'Threads', label: 'Thread Length per End', min: 1, max: 8, step: 0.125, unit: 'in', default: 3.5 },
    threadCount: { group: 'Threads', label: 'Threads per End', min: 4, max: 30, step: 1, unit: '', default: 14 },
    threadDepth: { group: 'Threads', label: 'Thread Depth', min: 0.02, max: 0.12, step: 0.005, unit: 'in', default: 0.05 },
    connectionType: {
      group: 'Threads',
      label: 'Connection Type',
      min: 0,
      max: 2,
      step: 1,
      unit: '',
      default: 1,
      choices: { STC: 0, LTC: 1, BTC: 2 },
    },
  },
  derived: {
    id: { label: 'Inner Diameter', unit: 'in', from: (p: Record<string, number>) => p.od - 2 * p.wall },
    drift: { label: 'Drift Diameter', unit: 'in', from: (p: Record<string, number>) => Math.max(0, p.od - 2 * p.wall - 0.125) },
    tpi: { label: 'Threads-per-Inch', unit: 'tpi', from: (p: Record<string, number>) => p.threadCount / p.threadLength },
    bodyLength: { label: 'Plain Body Length', unit: 'in', from: (p: Record<string, number>) => Math.max(0, p.jointLength - 2 * p.threadLength) },
  },
  validate: (p: Record<string, number>): string[] => {
    const errs: string[] = [];
    if (p.wall * 2 >= p.od) errs.push('wall too thick — bore would collapse (wall*2 must be < od)');
    if (p.jointLength <= 2 * p.threadLength + 1) errs.push('jointLength must exceed 2 × threadLength + 1 in (need a plain body run between the threaded ends)');
    if (p.threadDepth >= p.wall) errs.push('threadDepth must be less than wall (would cut into the bore)');
    return errs;
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const odR = p.od / 2;
  const idR = (p.od - 2 * p.wall) / 2;

  // Z-down: top = LOWER z, bottom = HIGHER z. The joint runs z = 0 .. jointLength.
  let body = tube(odR, idR, p.jointLength);

  // Top pin threads (external) cut into the OD over z = 0 .. threadLength.
  for (let i = 0; i < p.threadCount; i++) {
    const tz = (p.threadLength * (i + 0.5)) / p.threadCount;
    body = body.subtract(
      mv(tube(odR + 0.01, odR - p.threadDepth, 0.04), [0, 0, tz - 0.02]),
    );
  }

  // Bottom pin threads (external) cut into the OD over the lower threadLength band.
  const botStart = p.jointLength - p.threadLength;
  for (let i = 0; i < p.threadCount; i++) {
    const tz = botStart + (p.threadLength * (i + 0.5)) / p.threadCount;
    body = body.subtract(
      mv(tube(odR + 0.01, odR - p.threadDepth, 0.04), [0, 0, tz - 0.02]),
    );
  }

  return body;
});