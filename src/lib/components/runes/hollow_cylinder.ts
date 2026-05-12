/**
 * Hollow Cylinder — single-file primitive.
 *
 *   `meta` — metadata (params + ranges + units + validate). The Inspector
 *            reads from here for the Params slider grid + MD docs tab.
 *   `geom` — pure (p) => Manifold function. Takes the live slider values
 *            and produces the geometry. The renderer (buildPrimitiveManifold)
 *            consults the runes registry first and calls this directly.
 *
 * Z-down convention: top = lower z, bottom = higher z. tube() is centered
 * at the origin by default; the renderer doesn't translate it further for
 * single-piece primitives.
 */

import { tube } from '../manifold-helpers';

export const meta = {
  id: 'hollow_cylinder',
  name: 'Tube',
  description: 'Plain hollow tube — the fundamental building block.',
  tags: ['mandrel', 'sleeve', 'body', 'tube', 'pup joint', 'sub', 'coupling'],
  params: {
    od:     { label: 'OD',     min: 0.5,  max: 6,  step: 0.1,  unit: 'in', default: 2.875 },
    wall:   { label: 'Wall',   min: 0.05, max: 1,  step: 0.05, unit: 'in', default: 0.375 },
    length: { label: 'Length', min: 0.5,  max: 15, step: 0.1,  unit: 'in', default: 4.0 },
  },
  validate: (p: Record<string, number>): string[] => {
    const errs: string[] = [];
    if (p.wall * 2 >= p.od) errs.push('wall too thick — bore would collapse (wall*2 must be < od)');
    if (p.length <= 0)      errs.push('length must be > 0');
    return errs;
  },
} as const;

export const geom = (p: Record<string, number>) => {
  const id = p.od - 2 * p.wall;
  const body = tube(p.od / 2, id / 2, p.length);
  return body;
};