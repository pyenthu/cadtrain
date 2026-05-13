import { cyl, tube, mv, rot, M } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'slips',
  name: 'Slip Assembly',
  description: 'Segmented gripping ring with sawtooth profile.',
  tags: ['slip', 'grip', 'anchor', 'hold-down', 'drag block'],
  params: {
    slipOD: { label: 'Slip OD', min: 1, max: 6, step: 0.1, unit: 'in', default: 2.8 },
    bodyOD: { label: 'Body OD (inner)', min: 0.5, max: 4, step: 0.1, unit: 'in', default: 2.0 },
    height: { label: 'Height', min: 0.5, max: 4, step: 0.1, unit: 'in', default: 2.0 },
    numSectors: { label: 'Sectors', min: 2, max: 8, step: 1, unit: '', default: 6 },
    numGrooves: { label: 'Grooves', min: 4, max: 20, step: 1, unit: '', default: 10 },
    grooveDepth: {
      label: 'Groove Depth',
      min: 0.02,
      max: 0.15,
      step: 0.01,
      unit: 'in',
      default: 0.08,
    },
    grooveLengthPct: {
      label: 'Groove Length %',
      min: 0.1,
      max: 1.0,
      step: 0.05,
      unit: '',
      default: 0.85,
    },
    grooveBandLength: {
      label: 'Groove Band Length',
      min: 0.1,
      max: 4,
      step: 0.05,
      unit: 'in',
      default: 1.2,
    },
    splitWidth: {
      label: 'Split Width',
      min: 0.05,
      max: 0.3,
      step: 0.05,
      unit: 'in',
      default: 0.05,
    },
    splitLengthPct: {
      label: 'Split Length %',
      min: 0.05,
      max: 1.0,
      step: 0.05,
      unit: '',
      default: 0.75,
    },
    splitStart: {
      label: 'Split Start',
      min: 0,
      max: 1,
      step: 1,
      unit: '',
      default: 1,
      choices: { bottom: 0, top: 1 },
    },
    smoothBand: { label: 'Smooth Band %', min: 0, max: 0.3, step: 0.05, unit: '', default: 0.1 },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  const slipR = p.slipOD / 2;
  const bodyR = p.bodyOD / 2;
  let ring = tube(slipR, bodyR, p.height);

  const bandH = p.height * p.smoothBand;
  if (bandH > 0.01) {
    const bandR = slipR - p.grooveDepth * 1.5;
    ring = ring.subtract(tube(slipR + 0.01, bandR, bandH + 0.01));
  }

  const splitH = p.height * p.splitLengthPct;
  const splitZ = p.splitStart >= 0.5 ? splitH / 2 : p.height - splitH / 2;
  for (let i = 0; i < p.numSectors; i++) {
    const split = mv(
      rot(M.cube([p.slipOD + 1, p.splitWidth, splitH], true), [0, 0, i * (360 / p.numSectors)]),
      [0, 0, splitZ],
    );
    ring = ring.subtract(split);
  }

  const grooveBandLen = Math.min(p.grooveBandLength, p.height - bandH);
  const grooveH = grooveBandLen / p.numGrooves;
  const cutH = grooveH * p.grooveLengthPct;
  const offset = (grooveH - cutH) / 2;

  for (let i = 0; i < p.numGrooves; i++) {
    const gz = bandH + grooveH * i;
    const cutOuter = cyl(cutH, slipR + 0.5, slipR + 0.5);
    const keep = cyl(cutH + 0.01, slipR, slipR - p.grooveDepth);
    ring = ring.subtract(mv(cutOuter.subtract(keep), [0, 0, gz + offset]));
  }
  return ring;
});
