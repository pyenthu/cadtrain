import { cyl, tube, mv } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'tubing_joint_threaded',
  name: 'Tubing Joint (Threaded)',
  description: 'Production tubing joint — slim pipe body with external-upset (EUE-style) pin ends carrying API cut threads. Pin × pin, R-2 range length, sized for production strings (1.9"–4.5" OD). Set upsetOD = bodyOD to read as a flush premium connection.',
  tags: ['tubing', 'tubing joint', 'EUE', 'premium', 'production string', 'threaded', 'API tubing', 'pin x pin', 'R-2'],
  params: {
    bodyOD: { label: 'Body OD', min: 1.9, max: 4.5, step: 0.0625, unit: 'in', default: 2.375 },
    wall: { label: 'Wall', min: 0.15, max: 0.5, step: 0.005, unit: 'in', default: 0.217 },
    jointLength: { label: 'Joint Length (R-2)', min: 12, max: 60, step: 0.5, unit: 'in', default: 30.0 },
    upsetOD: { label: 'Upset OD', min: 1.9, max: 5.5, step: 0.0625, unit: 'in', default: 2.875 },
    upsetLength: { label: 'Upset Length', min: 0.5, max: 3, step: 0.05, unit: 'in', default: 1.5 },
    taperH: { label: 'Taper Height', min: 0.05, max: 0.6, step: 0.05, unit: 'in', default: 0.25 },
    threadCount: { label: 'Threads per End', min: 4, max: 16, step: 1, unit: '', default: 10 },
    threadDepth: { label: 'Thread Depth', min: 0.02, max: 0.10, step: 0.01, unit: 'in', default: 0.05 },
  },
  derived: {
    id: { label: 'Inner Diameter', unit: 'in', from: (p: Record<string, number>) => p.bodyOD - 2 * p.wall },
    drift: { label: 'Drift Diameter', unit: 'in', from: (p: Record<string, number>) => Math.max(0, p.bodyOD - 2 * p.wall - 0.094) },
    bodyLength: { label: 'Body Length', unit: 'in', from: (p: Record<string, number>) => p.jointLength - 2 * (p.upsetLength + p.taperH) },
  },
  validate: (p: Record<string, number>): string[] => {
    const errs: string[] = [];
    if (p.wall * 2 >= p.bodyOD) errs.push('wall too thick — bore would collapse (wall*2 must be < bodyOD)');
    if (p.upsetOD < p.bodyOD) errs.push('upsetOD must be ≥ bodyOD');
    const bodyLen = p.jointLength - 2 * (p.upsetLength + p.taperH);
    if (bodyLen <= 0.5) errs.push('jointLength too short for the requested upset + taper sections');
    if (p.threadDepth >= (p.upsetOD - (p.bodyOD - 2 * p.wall)) / 2)
      errs.push('threadDepth deeper than upset wall — would cut into the bore');
    return errs;
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const id = p.bodyOD - 2 * p.wall;
  const upsetLen = p.upsetLength;
  const taperH = p.taperH;
  const bodyLen = p.jointLength - 2 * (upsetLen + taperH);

  // Top upset pin (z = 0 .. upsetLen). Z-down: this is the UPPER end of the joint.
  let result = tube(p.upsetOD / 2, id / 2, upsetLen);
  for (let i = 0; i < p.threadCount; i++) {
    const tz = (upsetLen * (i + 0.5)) / p.threadCount;
    result = result.subtract(
      mv(tube(p.upsetOD / 2 + 0.01, p.upsetOD / 2 - p.threadDepth, 0.04), [0, 0, tz]),
    );
  }

  // Top taper: upsetOD narrows down to bodyOD (z = upsetLen .. upsetLen + taperH).
  const topTaper = cyl(taperH, p.upsetOD / 2, p.bodyOD / 2).subtract(
    mv(cyl(taperH + 0.02, id / 2, id / 2), [0, 0, -0.01]),
  );
  result = result.add(mv(topTaper, [0, 0, upsetLen]));

  // Pipe body (the long slim run).
  const bodyZ = upsetLen + taperH;
  result = result.add(mv(tube(p.bodyOD / 2, id / 2, bodyLen), [0, 0, bodyZ]));

  // Bottom taper: bodyOD widens back to upsetOD.
  const botTaperZ = bodyZ + bodyLen;
  const botTaper = cyl(taperH, p.bodyOD / 2, p.upsetOD / 2).subtract(
    mv(cyl(taperH + 0.02, id / 2, id / 2), [0, 0, -0.01]),
  );
  result = result.add(mv(botTaper, [0, 0, botTaperZ]));

  // Bottom upset pin (z = botUpsetZ .. botUpsetZ + upsetLen). LOWER end of the joint.
  const botUpsetZ = botTaperZ + taperH;
  let botUpset = tube(p.upsetOD / 2, id / 2, upsetLen);
  for (let i = 0; i < p.threadCount; i++) {
    const tz = (upsetLen * (i + 0.5)) / p.threadCount;
    botUpset = botUpset.subtract(
      mv(tube(p.upsetOD / 2 + 0.01, p.upsetOD / 2 - p.threadDepth, 0.04), [0, 0, tz]),
    );
  }
  result = result.add(mv(botUpset, [0, 0, botUpsetZ]));

  return result;
});