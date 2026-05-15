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
}

/** @part Z-up cylinder/cone — height h, bottom radius r1, top radius r2 (defaults to r1). */
export function cyl(h: number, r1: number, r2?: number) {
  return M.cylinder(h, r1, r2 ?? r1, currentSegments);
}
/** @part Hollow Z-up tube — outerR, innerR, height. */
export function tube(outerR: number, innerR: number, h: number) {
  return cyl(h, outerR).subtract(cyl(h + 0.02, innerR));
}
/** Translate a Manifold by a vec3. NOT a physical object — transform op,
 *  so it's intentionally NOT @part-tagged and stays out of the Parts
 *  catalog. The user writes `mv(...)` calls themselves in the geom body. */
export function mv(m: any, v: [number, number, number]) { return m.translate(v); }
/** Rotate a Manifold by a vec3 of degrees (xyz). NOT a physical object —
 *  transform op, not @part-tagged. */
export function rot(m: any, v: [number, number, number]) { return m.rotate(v); }

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
