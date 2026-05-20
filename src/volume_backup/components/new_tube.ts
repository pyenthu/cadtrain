import { cyl } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: 'new_tube',
  name: 'Tube',
  description: '',
  tags: [],
  params: {},
} as const;

export const geom = defineGeom(meta, (p) => {
  // Empty primitive — open the AI tab and describe what this should be.
  return cyl(0.1, 0.05, 0.05);
});
