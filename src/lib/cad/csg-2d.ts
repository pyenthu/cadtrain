/**
 * csg-2d — 2D Constructive Solid Geometry on CrossSection polygons + extrude.
 *
 * The "compose 2D, then sweep" pattern (K.50 sub-step a). For shapes that have
 * a CONSTANT cross-section along z (a plate with through-holes, a hex nut with
 * a bored centre, an L-bracket with a bolt-hole pattern) it's both cleaner +
 * cheaper than 3D-CSG: do the booleans on 2D polygons once, extrude the result
 * once, no per-vertex pairing along the third axis.
 *
 * Two surfaces:
 *   cs(points)                              → wraps a polygon as a CrossSection
 *                                             (chainable: .add/.subtract/.
 *                                             intersect/.extrude/.revolve).
 *   extrude_csg([{profile, op}, …], height) → declarative form for the GUI to
 *                                             introspect/edit later (K.50 phase
 *                                             c). `op` ∈ {base, add, subtract,
 *                                             intersect}. The first entry's op
 *                                             is implicitly 'base'.
 *
 * Both go through Manifold's CrossSection — same machinery r_extrude uses
 * internally — so no new WASM surface, just thinner authoring sugar.
 */
type Pt = [number, number];
type CsgOp = 'base' | 'add' | 'subtract' | 'intersect';
interface CsgEntry { profile: Pt[]; op?: CsgOp }

function wasm() {
  const w = (globalThis as any).__cadtrain_manifold__?.wasm;
  if (!w) throw new Error('CrossSection accessed before initManifold()');
  return w;
}

/** Wrap a polygon (Pt[]) as a CrossSection. Pass-through for already-CrossSection
 *  inputs so chained calls like cs(profA).subtract(cs(profB)) read naturally. */
export function cs(input: Pt[] | any): any {
  const w = wasm();
  if (input && typeof input.extrude === 'function') return input; // already a CrossSection
  if (!Array.isArray(input) || input.length < 3) {
    throw new Error('cs() needs a polygon (≥ 3 [x, y] points)');
  }
  return new w.CrossSection([input as Pt[]]);
}

/** Declarative 2D-CSG + extrude. Each entry's op is applied in order; the very
 *  first one's op is treated as 'base' regardless. Returns a Manifold solid.
 *
 *  Example:
 *    extrude_csg([
 *      { profile: resolveProfile({kind:'rect',    params:{w:2, h:1}}) },
 *      { profile: resolveProfile({kind:'ellipse', params:{rMajor:0.2, rMinor:0.2, segments:32}}), op:'subtract' },
 *    ], 0.5)
 */
export function extrude_csg(spec: CsgEntry[], height: number): any {
  if (!Array.isArray(spec) || spec.length === 0) {
    throw new Error('extrude_csg needs ≥ 1 entry');
  }
  let acc = cs(spec[0].profile);
  for (let i = 1; i < spec.length; i++) {
    const op = spec[i].op ?? 'add';
    const next = cs(spec[i].profile);
    if (op === 'add') acc = acc.add(next);
    else if (op === 'subtract') acc = acc.subtract(next);
    else if (op === 'intersect') acc = acc.intersect(next);
    else if (op === 'base') acc = next; // explicit replacement; rarely useful past index 0
    else throw new Error(`extrude_csg: unknown op "${op}"`);
  }
  return acc.extrude(Math.max(0.001, +height || 0));
}
