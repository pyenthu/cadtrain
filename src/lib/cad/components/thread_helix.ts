import { helix_band } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'thread_helix',
  name: 'Helical Thread',
  description: 'Parametric helical thread band — designed to be composed into a body via subtract to cut external threads. Standalone render shows the positive helix so the tooth shape is visible while authoring.',
  tags: ['thread', 'helix', 'tpi', 'pitch', 'screw'],
  params: {
    od:     { label: 'OD',          min: 0.5, max: 12,  step: 0.125, default: 4.5,  unit: 'in' },
    length: { label: 'Length',      min: 0.25, max: 10, step: 0.25,  default: 2,    unit: 'in' },
    tpi:    { label: 'Threads/in',  min: 2,   max: 16,  step: 1,     default: 4 },
    depth:  { label: 'Depth',       min: 0.02, max: 0.25, step: 0.01, default: 0.06, unit: 'in' },
    profile: { label: 'Profile',    min: 0,   max: 2,   step: 1,     default: 0, choices: { Square: 0, V60: 1, ACME: 2 } },
    taper:  { label: 'Taper',       min: 0,   max: 5,   step: 0.1,   default: 0,    unit: 'deg/side' },
  },
} as const;

export const geom = defineGeom(meta, (p) => helix_band(p.od, p.length, p.tpi, p.depth, p.profile, p.taper));
