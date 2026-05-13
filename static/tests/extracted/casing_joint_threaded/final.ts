import { cyl, tube, mv } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'casing_joint_threaded',
  name: 'Casing Joint (Threaded)',
  description: 'Threaded casing joint — hollow pipe body with a coupled box end at top and an external-threaded pin end at bottom. API 5CT geometry (OD, wall, drift, joint length, connection OD/length, TPI).',
  tags: ['casing', 'API 5CT', 'joint', 'threaded', 'coupling', 'pin', 'box', 'LTC', 'STC', 'BTC'],
  params: {
    od: { group: 'Body', label: 'OD', min: 2.375, max: 20, step: 0.0625, unit: 'in', default: 5.5 },
    wall: { group: 'Body', label: 'Wall Thickness', min: 0.15, max: 1.25, step: 0.005, unit: 'in', default: 0.275 },
    driftClearance: { group: 'Body', label: 'Drift Clearance', min: 0, max: 0.2, step: 0.005, unit: 'in', default: 0.125 },
    length: { group: 'Body', label: 'Joint Length', min: 6, max: 48, step: 0.25, unit: 'in', default: 18.0 },
    couplingOD: { group: 'Coupling (Box)', label: 'Coupling OD', min: 2.5, max: 22, step: 0.0625, unit: 'in', default: 6.05 },
    couplingLength: { group: 'Coupling (Box)', label: 'Coupling Length', min: 1, max: 8, step: 0.125, unit: 'in', default: 3.5 },
    boxThreadCount: { group: 'Coupling (Box)', label: 'Box Threads', min: 4, max: 30, step: 1, unit: '', default: 12 },
    boxThreadDepth: { group: 'Coupling (Box)', label: 'Box Thread Depth', min: 0.02, max: 0.12, step: 0.005, unit: 'in', default: 0.05 },
    pinLength: { group: 'Pin', label: 'Pin Length', min: 1, max: 6, step: 0.125, unit: 'in', default: 2.5 },
    pinThreadCount: { group: 'Pin', label: 'Pin Threads', min: 4, max: 30, step: 1, unit: '', default: 10 },
    pinThreadDepth: { group: 'Pin', label: 'Pin Thread Depth', min: 0.02, max: 0.12, step: 0.005, unit: 'in', default: 0.05 },
    pinTaper: { group: 'Pin', label: 'Pin Taper (in/in)', min: 0, max: 0.15, step: 0.005, unit: 'in/in', default: 0.0625 },
  },
  derived: {
    id: { label: 'Inner Diameter', unit: 'in', from: (p: Record<string, number>) => p.od - 2 * p.wall },
    drift: { label: 'Drift Diameter', unit: 'in', from: (p: Record<string, number>) => p.od - 2 * p.wall - p.driftClearance },
    totalLength: { label: 'Total Length', unit: 'in', from: (p: Record<string, number>) => p.length + p.pinLength },
    tpi: { label: 'Threads-per-Inch (pin)', unit: 'tpi', from: (p: Record<string, number>) => p.pinThreadCount / p.pinLength },
  },
  validate: (p: Record<string, number>): string[] => {
    const errs: string[] = [];
    if (p.wall * 2 >= p.od) errs.push('wall too thick — bore would collapse (wall*2 must be < od)');
    if (p.couplingOD <= p.od) errs.push('couplingOD must be greater than body OD');
    if (p.couplingLength >= p.length) errs.push('couplingLength must be shorter than the joint length');
    if (p.driftClearance >= 2 * p.wall) errs.push('driftClearance must be less than 2*wall');
    return errs;
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const bodyR = p.od / 2;
  const idR = (p.od - 2 * p.wall) / 2;
  const couplingR = p.couplingOD / 2;

  // Main pipe body — top at z=0, extending down to z=length.
  let body = tube(bodyR, idR, p.length);

  // Box-end coupling: thicker collar around the upper portion of the body.
  // Sits flush with the top (z=0) and extends downhole couplingLength.
  // Internal threads cut into the body wall under the coupling.
  const couplingShell = tube(couplingR, bodyR, p.couplingLength);
  body = body.add(couplingShell);

  for (let i = 0; i < p.boxThreadCount; i++) {
    const t = (i + 0.5) / p.boxThreadCount;
    const tz = p.couplingLength * t;
    body = body.subtract(
      mv(tube(idR + p.boxThreadDepth, idR - 0.01, 0.04), [0, 0, tz - 0.02]),
    );
  }

  // Pin end: external threads on a tapered male spigot below the body.
  const pinTopR = bodyR;
  const pinBotR = bodyR - p.pinTaper * p.pinLength;
  let pin = cyl(p.pinLength, pinTopR, pinBotR);
  pin = pin.subtract(mv(cyl(p.pinLength + 0.02, idR, idR), [0, 0, -0.01]));

  for (let i = 0; i < p.pinThreadCount; i++) {
    const t = (i + 0.5) / p.pinThreadCount;
    const tz = p.pinLength * t;
    const localR = pinTopR - p.pinTaper * p.pinLength * t;
    pin = pin.subtract(
      mv(tube(localR + 0.01, localR - p.pinThreadDepth, 0.04), [0, 0, tz - 0.02]),
    );
  }

  return body.add(mv(pin, [0, 0, p.length]));
});