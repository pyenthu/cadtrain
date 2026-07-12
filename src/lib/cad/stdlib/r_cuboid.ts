/**
 * r_cuboid — axis-aligned box, centered at the origin.
 *
 * STANDARD-LIBRARY PRIMITIVE. Lives in `src/lib/cad/stdlib/` — git-tracked,
 * canonical, read-only in the GUI. Served BEFORE the volume by the resolver,
 * write endpoints reject the id.
 *
 * Three independent positional params (w, h, d) → an axis-aligned cuboid
 * centered at the origin. The simplest primitive in the library: numeric
 * args only, no profile, no welded mesh, no engine plumbing. Useful as the
 * cutter in a subtract op (rotate + translate + subtract from a tube) and
 * as a generic building block for primitives that don't need anything
 * fancier.
 *
 * Z-DOWN: same convention as the rest of cadtrain — z=0 is the top of the
 * part, z=h is the bottom. The cube is CENTERED so the box extends from
 * -h/2 to +h/2 along z. Translate via `mv(box, [0, 0, +offset])` to place
 * the top face at a chosen depth.
 *
 * NOTE: imports below give this module real type-checking at build. At
 * RUNTIME the sandbox strips imports and injects the helpers by name; the
 * primitive executes identically to a volume part.
 */
import { M } from '$lib/engines/manifold/manifold-helpers';

export const meta = {
  id: 'r_cuboid',
  name: 'r_cuboid',
  description:
    'Axis-aligned cuboid centered at the origin. Three numeric params (w, h, d). The simplest stdlib primitive — a building block for subtract cutters, slabs, slot bodies, etc.',
  tags: ['box', 'cuboid', 'primitive', 'stdlib'],
  params: {
    w: { label: 'w', min: 0.05, max: 50, step: 0.05, default: 1, unit: 'in' },
    h: { label: 'h', min: 0.05, max: 50, step: 0.05, default: 1, unit: 'in' },
    d: { label: 'd', min: 0.05, max: 50, step: 0.05, default: 1, unit: 'in' },
  },
  material: {
    outer: { color: '#6b7280', metallic: 0.5, roughness: 0.5 },
    inner: { color: '#3a3a3a', metallic: 0.1, roughness: 0.9 },
  },
};

export function r_cuboid(w: number, h: number, d: number): any {
  // M.cube takes [w, h, d] and a `center` flag. Centered so transforms
  // (rot around the origin, mv to a target depth) behave intuitively.
  return M.cube([Math.max(0.01, w), Math.max(0.01, h), Math.max(0.01, d)], true);
}
