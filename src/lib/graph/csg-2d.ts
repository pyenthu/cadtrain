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

/** Resample a closed polygon (Pt[]) to `n` points equally spaced along its
 *  perimeter. For curves (ellipse) it upsamples to finer chords; for polygons
 *  (rect, ngon, L, T, +, star) it adds intermediate vertices along each edge.
 *
 *  Used by the extrude parts' `segments` dial — cranking it up replaces large
 *  non-planar twist quads with many smaller (nearly-planar) quads, smoothing
 *  the per-triangle normal artifact that flatShading would otherwise expose.
 *  No-op when n <= the natural vertex count.
 *
 *  Pass-through (no copy) when n is 0, negative, or already matches input.
 */
export function resample(points: Pt[], n: number): Pt[] {
  if (!Array.isArray(points) || points.length < 3) return points;
  const target = Math.max(3, Math.round(Number(n) || 0));
  if (target <= points.length) return points;
  // Cumulative arc length around the closed polygon.
  const N = points.length;
  const seg: number[] = new Array(N);   // length of segment i → (i+1) mod N
  let total = 0;
  for (let i = 0; i < N; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % N]!;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    seg[i] = d;
    total += d;
  }
  if (total < 1e-12) return points;
  const out: Pt[] = new Array(target);
  const step = total / target;
  let i = 0;       // current segment index
  let acc = 0;     // cumulative length up to start of segment i
  for (let k = 0; k < target; k++) {
    const s = k * step;
    // Advance to the segment containing arc length s.
    while (i < N - 1 && acc + seg[i]! < s) { acc += seg[i]!; i++; }
    const t = seg[i]! > 0 ? (s - acc) / seg[i]! : 0;
    const a = points[i]!;
    const b = points[(i + 1) % N]!;
    out[k] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  return out;
}

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
 *  Optional twist (degrees) + divs (vertical slices) mirror the same params
 *  on r_extrude. `twist=0` (the default) takes the bare `.extrude(h)` path —
 *  no behavior change for existing callers AND avoids the manifold-3d
 *  degeneracy where `extrude(h, n>0, 0)` produces coincident intermediate
 *  slices ("Not manifold").
 *
 *  Example:
 *    extrude_csg([
 *      { profile: resolveProfile({kind:'rect',    params:{w:2, h:1}}) },
 *      { profile: resolveProfile({kind:'ellipse', params:{rMajor:0.2, rMinor:0.2, segments:32}}), op:'subtract' },
 *    ], 0.5, 90, 24)   // 90° twist over 0.5 thickness, 24 slices
 */
export function extrude_csg(spec: CsgEntry[], height: number, twist?: number, divs?: number): any {
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
  return ext(acc, height, twist, divs);
}

/** Twist-aware terminal `.extrude(h)` for a CrossSection. Same conditional as
 *  r_extrude / extrude_csg — bare `extrude(h)` when twist≈0 (sidesteps the
 *  manifold-3d degeneracy where nDivisions>0 + zero-twist yields coincident
 *  slices) and `extrude(h, divs, twist)` otherwise. Lets a chain like
 *  `cs(a).subtract(cs(b))` finish with twist support without inlining a
 *  ternary in every authored part: `ext(cs(a).subtract(cs(b)), h, twist, divs)`.
 */
export function ext(crossSection: any, height: number, twist?: number, divs?: number): any {
  if (!crossSection || typeof crossSection.extrude !== 'function') {
    throw new Error('ext() needs a CrossSection (got something without .extrude)');
  }
  const h = Math.max(0.001, +height || 0);
  const tw = Number(twist ?? 0);
  if (Math.abs(tw) < 0.001) return crossSection.extrude(h);
  const nDiv = Math.max(1, Math.min(96, Math.round(Number(divs ?? 12))));
  return crossSection.extrude(h, nDiv, tw);
}
