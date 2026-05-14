import { cyl, tube, mv } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'tubing_joint',
  name: 'Tubing Joint',
  description: 'Production tubing joint — slim hollow pipe sized for flow up the wellbore. Selectable connection style at the ends (flush / NUE plain pin / EUE external upset). R-2 range length (≈25–34 ft scaled).',
  tags: ['tubing', 'tubing joint', 'production string', 'API 5CT', 'R-2', 'EUE', 'NUE', 'flush', 'premium'],
  params: {
    od: { group: 'Body', label: 'OD', min: 1.05, max: 4.5, step: 0.0625, unit: 'in', default: 2.875 },
    wall: { group: 'Body', label: 'Wall Thickness', min: 0.113, max: 0.5, step: 0.005, unit: 'in', default: 0.217 },
    jointLength: { group: 'Body', label: 'Joint Length (R-2)', min: 12, max: 60, step: 0.5, unit: 'in', default: 31.0 },
    connType: {
      group: 'Connection',
      label: 'Connection Type',
      min: 0,
      max: 2,
      step: 1,
      unit: '',
      default: 1,
      choices: { flush: 0, NUE: 1, EUE: 2 },
    },
    endLength: { group: 'Connection', label: 'End Length', min: 0.5, max: 4, step: 0.05, unit: 'in', default: 1.5 },
    upsetOD: { group: 'Connection', label: 'Upset OD (EUE only)', min: 1.05, max: 5.5, step: 0.0625, unit: 'in', default: 3.5 },
    taperH: { group: 'Connection', label: 'Upset Taper', min: 0.05, max: 0.6, step: 0.05, unit: 'in', default: 0.25 },
    threadCount: { group: 'Connection', label: 'Threads per End', min: 4, max: 16, step: 1, unit: '', default: 10 },
    threadDepth: { group: 'Connection', label: 'Thread Depth', min: 0.02, max: 0.10, step: 0.01, unit: 'in', default: 0.04 },
  },
  derived: {
    id: { label: 'Inner Diameter', unit: 'in', from: (p: Record<string, number>) => p.od - 2 * p.wall },
    drift: { label: 'Drift Diameter', unit: 'in', from: (p: Record<string, number>) => Math.max(0, p.od - 2 * p.wall - 0.094) },
    bodyLength: {
      label: 'Body (run) Length',
      unit: 'in',
      from: (p: Record<string, number>) => {
        const endsTaken = p.connType >= 2 ? 2 * (p.endLength + p.taperH) : 2 * p.endLength;
        return Math.max(0, p.jointLength - endsTaken);
      },
    },
  },
  validate: (p: Record<string, number>): string[] => {
    const errs: string[] = [];
    if (p.wall * 2 >= p.od) errs.push('wall too thick — bore would collapse (wall*2 must be < od)');
    if (p.connType >= 2 && p.upsetOD < p.od) errs.push('EUE upsetOD must be ≥ body OD');
    const endsTaken = p.connType >= 2 ? 2 * (p.endLength + p.taperH) : 2 * p.endLength;
    if (p.jointLength - endsTaken <= 0.5) errs.push('jointLength too short for the requested end sections');
    return errs;
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const bodyR = p.od / 2;
  const idR = (p.od - 2 * p.wall) / 2;
  const isEUE = p.connType >= 2;
  const isNUE = Math.round(p.connType) === 1;
  const endLen = p.endLength;
  const taperH = isEUE ? p.taperH : 0;
  const endOuterR = isEUE ? p.upsetOD / 2 : bodyR;
  const bodyLen = Math.max(0.01, p.jointLength - 2 * (endLen + taperH));

  // ---- Top end (z = 0 .. endLen): pin, threads cut into the OD ----
  let result = tube(endOuterR, idR, endLen);
  if (isEUE || isNUE) {
    for (let i = 0; i < p.threadCount; i++) {
      const tz = (endLen * (i + 0.5)) / p.threadCount;
      result = result.subtract(
        mv(tube(endOuterR + 0.01, endOuterR - p.threadDepth, 0.04), [0, 0, tz]),
      );
    }
  }

  // ---- Top taper (EUE only): upsetOD narrows down to bodyOD ----
  let z = endLen;
  if (isEUE) {
    const topTaper = cyl(taperH, endOuterR, bodyR).subtract(
      mv(cyl(taperH + 0.02, idR, idR), [0, 0, -0.01]),
    );
    result = result.add(mv(topTaper, [0, 0, z]));
    z += taperH;
  }

  // ---- Pipe body (the long slim run) ----
  result = result.add(mv(tube(bodyR, idR, bodyLen), [0, 0, z]));
  z += bodyLen;

  // ---- Bottom taper (EUE only): bodyOD widens back to upsetOD ----
  if (isEUE) {
    const botTaper = cyl(taperH, bodyR, endOuterR).subtract(
      mv(cyl(taperH + 0.02, idR, idR), [0, 0, -0.01]),
    );
    result = result.add(mv(botTaper, [0, 0, z]));
    z += taperH;
  }

  // ---- Bottom end pin ----
  let botEnd = tube(endOuterR, idR, endLen);
  if (isEUE || isNUE) {
    for (let i = 0; i < p.threadCount; i++) {
      const tz = (endLen * (i + 0.5)) / p.threadCount;
      botEnd = botEnd.subtract(
        mv(tube(endOuterR + 0.01, endOuterR - p.threadDepth, 0.04), [0, 0, tz]),
      );
    }
  }
  result = result.add(mv(botEnd, [0, 0, z]));

  return result;
});