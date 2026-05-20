import { tube, cyl, mv, rot } from '../manifold-helpers';

export const meta = {
  id: 'extract_52',
  name: 'Drill Pipe with Box & Pin',
  description:
    'Drill pipe body with box (female) connection at top and pin (male) connection at bottom.',
  tags: ['drill pipe', 'connection', 'box', 'pin'],
  params: {
    od: { group: 'Body', label: 'Body OD', min: 2, max: 8, step: 0.125, unit: 'in', default: 4.5 },
    wall: {
      group: 'Body',
      label: 'Wall Thickness',
      min: 0.2,
      max: 1.5,
      step: 0.05,
      unit: 'in',
      default: 0.5,
    },
    bodyLength: {
      group: 'Body',
      label: 'Body Length',
      min: 10,
      max: 480,
      step: 1,
      unit: 'in',
      default: 120,
    },
    boxOD: {
      group: 'Box',
      label: 'Box OD',
      min: 3,
      max: 12,
      step: 0.125,
      unit: 'in',
      default: 6.25,
    },
    boxLength: {
      group: 'Box',
      label: 'Box Length',
      min: 2,
      max: 24,
      step: 0.25,
      unit: 'in',
      default: 8,
    },
    boxThreadCount: {
      group: 'Box',
      label: 'Thread Count',
      min: 2,
      max: 12,
      step: 1,
      unit: '',
      default: 5,
    },
    boxThreadDepth: {
      group: 'Box',
      label: 'Thread Depth',
      min: 0.02,
      max: 0.2,
      step: 0.005,
      unit: 'in',
      default: 0.05,
    },
    boxTaper: {
      group: 'Box',
      label: 'Box Taper',
      min: 0,
      max: 0.2,
      step: 0.005,
      unit: 'in',
      default: 0.05,
    },
    pinOD: { group: 'Pin', label: 'Pin OD', min: 2, max: 8, step: 0.125, unit: 'in', default: 5.0 },
    pinLength: {
      group: 'Pin',
      label: 'Pin Length',
      min: 2,
      max: 24,
      step: 0.25,
      unit: 'in',
      default: 8,
    },
    pinThreadCount: {
      group: 'Pin',
      label: 'Thread Count',
      min: 2,
      max: 12,
      step: 1,
      unit: '',
      default: 5,
    },
    pinThreadDepth: {
      group: 'Pin',
      label: 'Thread Depth',
      min: 0.02,
      max: 0.2,
      step: 0.005,
      unit: 'in',
      default: 0.05,
    },
    pinTaper: {
      group: 'Pin',
      label: 'Pin Taper',
      min: 0,
      max: 0.2,
      step: 0.005,
      unit: 'in',
      default: 0.05,
    },
  },
  derived: {
    id: { label: 'Body ID', unit: 'in', from: (p) => p.od - 2 * p.wall },
    totalLength: {
      label: 'Total Length',
      unit: 'in',
      from: (p) => p.boxLength + p.bodyLength + p.pinLength,
    },
  },
  validate: (p) => {
    const errors: string[] = [];
    if (p.boxOD <= p.od) errors.push('Box OD must be larger than Body OD');
    if (p.pinOD <= p.od) errors.push('Pin OD must be larger than Body OD');
    if (p.od <= 2 * p.wall) errors.push('OD must be greater than 2× wall thickness');
    return errors;
  },
} as const;

export const geom = (p: Record<string, number>) => {
  const id = p.od - 2 * p.wall;

  // ── Box connection at top (z=0) ──────────────────────────────────────────
  // Outer envelope with taper from boxOD down to body OD
  const boxOuter = cyl(p.boxLength, p.boxOD / 2, p.od / 2);
  // Bore — tapers slightly inward (taper increases bore at top for thread engagement)
  const boxBore = cyl(p.boxLength, id / 2 + p.boxTaper, id / 2);
  // Thread grooves cut into bore as thin annular rings
  const boxThreadSpacing = p.boxLength / (p.boxThreadCount + 1);
  let box = boxOuter.subtract(boxBore);
  for (let i = 1; i <= p.boxThreadCount; i++) {
    const zPos = i * boxThreadSpacing;
    const groove = mv(cyl(0.06, id / 2 + p.boxThreadDepth + 0.01), [0, 0, zPos]);
    box = box.subtract(groove);
  }

  // ── Body ─────────────────────────────────────────────────────────────────
  const body = mv(tube(p.od / 2, id / 2, p.bodyLength), [0, 0, p.boxLength]);

  // ── Pin connection at bottom ──────────────────────────────────────────────
  // Outer envelope tapers from body OD up to pinOD
  const pinOuter = cyl(p.pinLength, p.od / 2, p.pinOD / 2);
  const pinBore = cyl(p.pinLength, id / 2, id / 2 + p.pinTaper);
  const pinThreadSpacing = p.pinLength / (p.pinThreadCount + 1);
  let pin = pinOuter.subtract(pinBore);
  for (let i = 1; i <= p.pinThreadCount; i++) {
    const zPos = i * pinThreadSpacing;
    const groove = mv(cyl(0.06, p.pinOD / 2 + 0.01), [0, 0, zPos]);
    pin = pin.subtract(groove);
  }
  // Flip pin so taper widens toward bottom, then position after body
  const pinFlipped = mv(rot(pin, [180, 0, 0]), [0, 0, p.boxLength + p.bodyLength + p.pinLength]);

  return box.add(body).add(pinFlipped);
};
