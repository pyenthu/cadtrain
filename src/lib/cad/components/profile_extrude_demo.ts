import { profile_extrude } from '../manifold-helpers';
import { defineGeom } from '.';

// Thin wrapper around the profile_extrude primitive so /primitives can
// render a 3D preview of it. The actual geometry logic — the profile
// shape, the extrude operation — lives in manifold-helpers.ts's
// profile_extrude (which is what the user edits in the /primitives
// editor pane).
export const meta = {
  id: 'profile_extrude_demo',
  name: 'Profile Extrude (demo)',
  description: 'Demo wrapper around profile_extrude primitive — sandbox for testing extrude variants.',
  tags: ['demo', 'extrude', 'sandbox'],
  params: {
    height:       { label: 'Height',       min: 0.5, max: 10,  step: 0.25, default: 2,   unit: 'in' },
    twistDegrees: { label: 'Twist',        min: -720, max: 720, step: 15,  default: 0,   unit: 'deg' },
    scaleTop:     { label: 'Top Scale',    min: 0.1, max: 2,   step: 0.05, default: 1 },
    sides:        { label: 'Profile Sides', min: 3, max: 24,   step: 1,    default: 5 },
  },
} as const;

export const geom = defineGeom(meta, (p) =>
  profile_extrude(p.height, p.twistDegrees, p.scaleTop, p.sides),
);
