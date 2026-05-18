/**
 * ManifoldCAD runtime + small geometry helpers.
 *
 * Lives in its own module so per-primitive component files can import the
 * helpers without depending on (or cycling through) builder.ts. Each
 * primitive's geom() ends up reading just from here:
 *     import { cyl, tube, mv } from '$lib/cad/manifold-helpers';
 *
 * The Manifold WASM is initialised once via initManifold(); after that,
 * cyl/tube/mv/rot use the live `M` reference. Callers MUST await
 * initManifold() before invoking any geom().
 */

import Module from 'manifold-3d';

// CIRCULAR_SEGMENTS_DEFAULT — used when nothing overrides.
// CIRCULAR_SEGMENTS_COMPOSE — temporarily set by compose.ts via
//   setCircularSegmentMode for multi-part assemblies (10+ cylinders × CSG
//   union → mobile WebKit OOMs at 256).
export const CIRCULAR_SEGMENTS_DEFAULT = 256;
export const CIRCULAR_SEGMENTS_COMPOSE = 96;

// Global WASM/Module singleton — Vite SSR + the bundle's
// `import.meta.glob` for `src/lib/cad/components/*.ts` produce SEPARATE
// module instances of this file at runtime. The bundled components
// close over their instance's `M` binding directly; if that instance's
// `initManifold` never runs, the binding stays null. Even worse: when
// each instance's initManifold runs independently, every instance ends
// up with its own wasm Module and its own Manifold class — Manifolds
// from instance A can't `.union()` Manifolds from instance B even
// though both classes are named "Manifold".
//
// Fix: stash wasm + M on globalThis and expose `M` here as a Proxy that
// always reads from the singleton at access time. Every duplicate
// manifold-helpers module's `M` import now refers to the same backing
// object via the Proxy, so all generated Manifolds share one Module +
// one prototype chain.
const G = globalThis as any;
G.__cadtrain_manifold__ ??= { wasm: null, M: null };

let currentSegments = CIRCULAR_SEGMENTS_DEFAULT;

/** Live-read Proxy for the Manifold class. `M.cube(...)`, `M.cylinder(...)`
 *  etc. always reach into the shared singleton — works even if THIS
 *  module instance never ran initManifold (a sibling instance did). */
export const M: any = new Proxy(
  // The target is a no-op object — all access is intercepted by the
  // `get` trap.
  Object.create(null),
  {
    get(_target, prop) {
      const m = G.__cadtrain_manifold__.M;
      if (!m) return undefined;
      const v = m[prop];
      // Bind so static methods (`M.cube`) keep their `this`.
      return typeof v === 'function' ? v.bind(m) : v;
    },
    has(_target, prop) {
      const m = G.__cadtrain_manifold__.M;
      return !!m && prop in m;
    },
  },
);

export function setCircularSegmentMode(mode: 'default' | 'compose'): void {
  currentSegments = mode === 'compose' ? CIRCULAR_SEGMENTS_COMPOSE : CIRCULAR_SEGMENTS_DEFAULT;
  const w = G.__cadtrain_manifold__.wasm;
  if (w) w.setCircularSegments(currentSegments);
}

export async function initManifold() {
  // If a sibling module instance already initialised the wasm, just
  // reapply this instance's segment count to the shared wasm and bail.
  if (G.__cadtrain_manifold__.wasm) {
    G.__cadtrain_manifold__.wasm.setCircularSegments(currentSegments);
    return;
  }
  const wasm = await Module();
  wasm.setup();
  const m = wasm.Manifold;
  wasm.setCircularSegments(currentSegments);
  // Publish — every other manifold-helpers instance's M Proxy now
  // resolves through this shared singleton.
  G.__cadtrain_manifold__.wasm = wasm;
  G.__cadtrain_manifold__.M = m;
}

/** @part Empty seed — a zero-volume Manifold suitable as the initial
 *  accumulator for the parts-tab pattern. Implementation: a degenerate
 *  cube at the origin. */
export function empty(): any {
  return M.cube([0, 0, 0], true);
}

/** Mutable Manifold accumulator passed as the 2nd arg to the new-form
 *  defineGeom body: `defineGeom(meta, (p, geom) => { geom.add(...); })`.
 *  Each .add(part) unions in place and returns `this` so calls chain.
 *  Eliminates the `let geom = empty(); ...; return geom;` boilerplate
 *  from the source — the framework owns the accumulator + final return.
 *
 *  Lazy-init: `current` starts null and the FIRST add/subtract takes the
 *  part directly. Subsequent calls union/subtract against it. Avoids the
 *  degenerate-empty-cube path which doesn't carry a `.union` method in
 *  every Manifold build. */
export class GeomAcc {
  current: any = null;
  add(part: any): this {
    // `union` is a STATIC method on Manifold (`M.union(a, b)`), not an
    // instance method — so we always go through the class, never call
    // `this.current.union(part)`. The first add just assigns (no boolean
    // op needed yet); every subsequent add unions via the class.
    if (this.current) this.current = M.union(this.current, part);
    else this.current = part;
    return this;
  }
  subtract(part: any): this {
    if (!this.current) return this;
    // `subtract` IS an instance method on Manifold (`a.subtract(b)`),
    // so use it directly.
    this.current = this.current.subtract(part);
    return this;
  }
  intersect(part: any): this {
    // No prior accumulator → intersecting against nothing yields nothing.
    // We seed with the part directly so the user can put an `intersect`
    // first (rare but well-defined). Subsequent calls intersect through
    // the Manifold instance method `a.intersect(b)`.
    if (!this.current) this.current = part;
    else this.current = this.current.intersect(part);
    return this;
  }
}

/** @part Z-up cylinder/cone — length (Z extent), bottom radius r1, top radius r2 (defaults to r1). */
export function cyl(length: number, r1: number, r2?: number) {
  return M.cylinder(length, r1, r2 ?? r1, currentSegments);
}
/** @part Hollow Z-up tube — outerR, innerR, length (Z extent). */
export function tube(outerR: number, innerR: number, length: number) {
  return cyl(length, outerR).subtract(cyl(length + 0.02, innerR));
}
/** @op Translate — shift the part by [x, y, z]. */
export function mv(m: any, v: [number, number, number]) { return m.translate(v); }
/** @op Rotate — rotate the part by degrees around [x, y, z]. */
export function rot(m: any, v: [number, number, number]) { return m.rotate(v); }

/** @part Helical thread band — od, length, tpi, depth, profile (0 = square, 1 = V60, 2 = ACME 29°), taper (degrees/side, 0 = straight). Pair with subtract to cut threads into a body. */
export function helix_band(od: number, length: number, tpi: number, depth: number, profile: number, taper: number): any {
  if (!G.__cadtrain_manifold__.wasm) {
    throw new Error('manifold not initialised — call initManifold() first');
  }

  // Many-wedges approach. CrossSection.extrude(twist) was wrong: a
  // narrow 2D cross-section gets swept around the Z axis and the
  // resulting groove at any θ is too thin axially (width = 2*halfW /
  // (twistDegrees * length) — for typical thread params, ~0.002").
  //
  // Instead we union N small tooth blocks placed along the helix.
  // Each block is the local thread cross-section, rotated to its θ
  // and translated to its z. Adjacent blocks overlap tangentially so
  // the result is a continuous helical ridge.
  const pitch = 1 / Math.max(tpi, 0.0001);
  const numTurns = length * tpi;
  const segmentsPerTurn = 24;
  const totalSegments = Math.max(8, Math.ceil(numTurns * segmentsPerTurn));

  // Tooth dimensions
  const axialExtent = pitch * 0.5; // tooth occupies ~50% of pitch axially
  const taperTan = Math.tan(Math.max(0, taper) * Math.PI / 180);

  let band: any = null;
  for (let i = 0; i < totalSegments; i++) {
    const angleDeg = (i / segmentsPerTurn) * 360;
    const z = (i / totalSegments) * length;

    // Taper — the cut depth shrinks linearly with z. Tooth tip moves
    // inward, fading the thread as it climbs. Clamp to a tiny positive
    // depth so a tapered-out tooth still produces a valid (but
    // vanishingly small) cube rather than a degenerate one.
    const localDepth = Math.max(0.005, depth - z * taperTan);

    // Local segment arc length at the OUTER cylinder surface — width
    // we extend tangentially so adjacent blocks overlap. 1.6× the bare
    // arc-length covers the gap from neighbour rotation cleanly.
    const segArcLen = (2 * Math.PI * (od / 2)) / segmentsPerTurn;
    const tangentialExtent = segArcLen * 1.6;

    // Profile shapes the tooth's axial cross-section.
    // 0 = Square: full rectangular block
    // 1 = V60: V-trapezoidal — narrower at the OD surface
    // 2 = ACME: wider at the root, narrower at the crest (similar to V
    //   but less aggressive). For v1, V60 and ACME both narrow the
    //   tangential extent over the radial depth — approximated by
    //   stacking two thinner blocks at half-depth offsets. Full
    //   triangular cross-sections need polygon-extrude per segment
    //   which is a later refinement.
    let tooth: any;
    if (profile === 1 || profile === 2) {
      // Narrower crest — use a slightly trimmed tangential extent at
      // the OD half. Visually distinguishable from Square.
      const crestRatio = profile === 1 ? 0.4 : 0.6;
      tooth = M.cube(
        [localDepth + 0.02, tangentialExtent * crestRatio, axialExtent],
        false,
      );
      // Center on Y axis, sit at the right radial position.
      tooth = tooth
        .translate([od / 2 - localDepth, -(tangentialExtent * crestRatio) / 2, 0])
        .rotate([0, 0, angleDeg])
        .translate([0, 0, z]);
    } else {
      // Square — full block.
      tooth = M.cube(
        [localDepth + 0.02, tangentialExtent, axialExtent],
        false,
      );
      tooth = tooth
        .translate([od / 2 - localDepth, -tangentialExtent / 2, 0])
        .rotate([0, 0, angleDeg])
        .translate([0, 0, z]);
    }

    band = band ? M.union(band, tooth) : tooth;
  }
  return band;
}

/** Used by the cutaway view in finalizeManifold. Cached so multi-part
 *  builds don't reconstruct the same cube on every part. */
let _cachedCutBox: any = null;
export function getCutBox(): any {
  // Check the singleton directly — `M` is a Proxy and `if (M)` would
  // always be truthy even when the underlying wasm hasn't initialised.
  if (!_cachedCutBox && G.__cadtrain_manifold__.M) {
    _cachedCutBox = M.cube([20, 20, 100], false).translate([0, 0, -50]);
  }
  return _cachedCutBox;
}
