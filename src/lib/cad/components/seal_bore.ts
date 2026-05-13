import { geom as threaded_pinGeom } from './threaded_pin';
import { tube, mv, rot, cyl } from '../manifold-helpers';

export const meta = {
  id: 'seal_bore',
  name: 'Seal Bore (Polished)',
  description: 'Smooth internal bore with seal grooves.',
  tags: ['PBR', 'polished bore receptacle', 'seal assembly', 'sealbore extension'],
  params: {
    od: { label: 'OD', min: 0.5, max: 6, step: 0.1, unit: 'in', default: 2.8 },
    boreID: { label: 'Bore ID', min: 0.3, max: 4, step: 0.1, unit: 'in', default: 2.0 },
    length: { label: 'Length', min: 1, max: 10, step: 0.1, unit: 'in', default: 3.0 },
    numGrooves: { label: 'Grooves', min: 0, max: 8, step: 1, unit: '', default: 3 },
    grooveDepth: {
      label: 'Groove Depth',
      min: 0.02,
      max: 0.1,
      step: 0.01,
      unit: 'in',
      default: 0.05,
    },
    grooveWidth: {
      label: 'Groove Width',
      min: 0.05,
      max: 0.3,
      step: 0.05,
      unit: 'in',
      default: 0.1,
    },
    crossHoleD: {
      label: 'Cross-Hole Diameter',
      min: 0.1,
      max: 2,
      step: 0.05,
      unit: 'in',
      default: 0.5,
    },
    numCrossSections: {
      label: 'Cross-Hole Sections',
      min: 1,
      max: 8,
      step: 1,
      unit: '',
      default: 4,
    },
    crossPhaseAngle: {
      label: 'Cross-Hole Phase Angle',
      min: 0,
      max: 180,
      step: 1,
      unit: 'deg',
      default: 60,
    },
    holeD: {
      unit: 'in',
      label: 'Hole Diameter',
      step: 0.05,
      max: 3,
      min: 0.1,
      default: 0.5,
    },
    crossHoleZ: {
      label: 'Cross-Hole Depth',
      min: 0,
      max: 1,
      step: 0.01,
      unit: 'in',
      default: 0.5,
    },
    coneLength: {
      label: 'Top Cone Length',
      min: 0.1,
      max: 6,
      step: 0.1,
      unit: 'in',
      default: 1.0,
    },
    coneTopOD: {
      label: 'Cone Top OD',
      min: 0.3,
      max: 6,
      step: 0.1,
      unit: 'in',
      default: 1.5,
    },
    pinOD: { label: 'Pin OD', min: 0.5, max: 6, step: 0.1, unit: 'in', default: 2.4 },
    pinLength: { label: 'Pin Length', min: 0.5, max: 6, step: 0.1, unit: 'in', default: 2.0 },
    pinWall: { label: 'Pin Wall', min: 0.1, max: 2, step: 0.05, unit: 'in', default: 0.4 },
    pinThreadCount: { label: 'Pin Thread Count', min: 1, max: 20, step: 1, unit: '', default: 8 },
    pinThreadDepth: {
      label: 'Pin Thread Depth',
      min: 0.01,
      max: 0.2,
      step: 0.01,
      unit: 'in',
      default: 0.05,
    },
    pinTaper: {
      label: 'Pin Taper',
      min: 0,
      max: 0.2,
      step: 0.005,
      unit: 'in/in',
      default: 0.0625,
    },
  },
  derived: {
    crossHoleZAbs: {
      label: 'Cross-Hole Z (abs)',
      unit: 'in',
      from: (p: Record<string, number>) => p.crossHoleZ * p.length,
    },
  },
} as const;

export const geom = (p: Record<string, number>) => {
  // Tapered cone at the top (z=0 is top, z=coneLength is bottom of cone).
  const coneSolid = cyl(p.coneLength, p.coneTopOD / 2, p.od / 2);
  const coneBore = cyl(p.coneLength + 0.01, p.boreID / 2);
  const cone = coneSolid.subtract(mv(coneBore, [0, 0, -0.005]));

  // Main tube body placed directly below the cone
  let body = mv(tube(p.od / 2, p.boreID / 2, p.length), [0, 0, p.coneLength]);

  // Seal grooves on inner bore
  for (let i = 0; i < p.numGrooves; i++) {
    const gz = p.coneLength + (p.length * (i + 1)) / (p.numGrooves + 1);
    body = body.subtract(
      mv(tube(p.boreID / 2 + p.grooveDepth, p.boreID / 2 - 0.01, p.grooveWidth), [
        0,
        0,
        gz - p.grooveWidth / 2,
      ]),
    );
  }

  // Cross-holes: cylindrical cutters lying along X axis, phased circumferentially.
  const crossR = p.crossHoleD / 2;
  const cutLen = p.od + 0.1;
  const cz = p.coneLength + p.crossHoleZAbs;

  for (let i = 0; i < p.numCrossSections; i++) {
    const azimuthDeg = i * p.crossPhaseAngle;
    const baseCyl = cyl(cutLen, crossR);
    const xAligned = mv(rot(baseCyl, [0, 90, 0]), [-cutLen / 2, 0, 0]);
    const phasedCutter = rot(mv(xAligned, [0, 0, cz]), [0, 0, azimuthDeg]);
    body = body.subtract(phasedCutter);
  }

  // Axial hole drilled through the body (not cone — bore already cut there)
  const holeR = p.holeD / 2;
  const holeCutter = cyl(p.length + 0.1, holeR);
  body = body.subtract(mv(holeCutter, [0, 0, p.coneLength - 0.05]));

  // Threaded male pin connection placed below the seal bore body
  const pin = threaded_pinGeom({
    od: p.pinOD,
    wall: p.pinWall,
    length: p.pinLength,
    threadCount: p.pinThreadCount,
    threadDepth: p.pinThreadDepth,
    taper: p.pinTaper,
  });

  const pinPositioned = mv(pin, [0, 0, p.coneLength + p.length]);

  return cone.add(body).add(pinPositioned);
};
