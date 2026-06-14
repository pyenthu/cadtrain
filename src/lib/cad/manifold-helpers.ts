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

/** CrossSection class — same live-read Proxy pattern as M but resolved
 *  through `wasm.CrossSection`. Lets sandboxed volume components do
 *  `new CS([poly]).extrude(h)` without reaching for the wasm module. */
export const CS: any = new Proxy(
  function () {},
  {
    get(_t, prop) {
      const w = G.__cadtrain_manifold__.wasm;
      if (!w) return undefined;
      const c = w.CrossSection;
      const v = c[prop];
      return typeof v === 'function' ? v.bind(c) : v;
    },
    has(_t, prop) {
      const w = G.__cadtrain_manifold__.wasm;
      return !!w && prop in w.CrossSection;
    },
    construct(_t, args) {
      const w = G.__cadtrain_manifold__.wasm;
      if (!w) throw new Error('CrossSection accessed before initManifold()');
      return new w.CrossSection(...(args as any[]));
    },
  },
);

/** Mesh class — same proxy pattern. Used by raw-vertex primitives that
 *  build a manifold by handing it a triangle soup:
 *    new M(new Mesh({ numProp: 3, vertProperties, triVerts }))
 *  Triangles must be wound CCW from outside and form a closed 2-manifold,
 *  otherwise the Manifold constructor will throw. */
export const Mesh: any = new Proxy(
  function () {},
  {
    get(_t, prop) {
      const w = G.__cadtrain_manifold__.wasm;
      if (!w) return undefined;
      const c = w.Mesh;
      const v = c[prop];
      return typeof v === 'function' ? v.bind(c) : v;
    },
    construct(_t, args) {
      const w = G.__cadtrain_manifold__.wasm;
      if (!w) throw new Error('Mesh accessed before initManifold()');
      return new w.Mesh(...(args as any[]));
    },
  },
);

export function setCircularSegmentMode(mode: 'default' | 'compose'): void {
  currentSegments = mode === 'compose' ? CIRCULAR_SEGMENTS_COMPOSE : CIRCULAR_SEGMENTS_DEFAULT;
  const w = G.__cadtrain_manifold__.wasm;
  if (w) w.setCircularSegments(currentSegments);
}

/** Read the segment count currently in effect — used to capture-then-restore
 *  around a one-off coarse bake (see setCircularSegmentCount). */
export function getCircularSegmentCount(): number {
  return currentSegments;
}

/** Set a NUMERIC circular-segment count for the NEXT geom build (e.g. the SVG
 *  tab's coarse bake). Sets BOTH the module-local `currentSegments` (which
 *  `cyl`/`tube`/`revolve` pass explicitly to `M.cylinder(...)` /
 *  `cs.revolve(...)`) AND the Manifold WASM global (`setCircularSegments`,
 *  which governs any geometry that doesn't pass an explicit count) so the two
 *  stay in lock-step.
 *
 *  GLOBAL-RACE caution: like setCircularSegmentMode this mutates a process-wide
 *  setting. The /preview endpoint sets it IMMEDIATELY before the SYNCHRONOUS
 *  geom call (`primFn(...args)` — WASM is sync, no await in between) and
 *  restores it right after, so concurrent requests can't interleave a coarse
 *  count into a full bake. Callers MUST pair this with a restore (capture via
 *  getCircularSegmentCount() or call setCircularSegmentMode('default')). */
export function setCircularSegmentCount(n: number): void {
  currentSegments = n;
  const w = G.__cadtrain_manifold__.wasm;
  if (w) w.setCircularSegments(n);
}

// ── Coarse-bake segment CAP ─────────────────────────────────────────────────
// `currentSegments` (above) only reaches the RAW helpers (cyl/tube/revolve),
// which pass it explicitly to `M.cylinder(...)` / `cs.revolve(...)`. The ENGINE
// primitives (r_revolve / r_tube / r_cylinder, …) instead take their own
// explicit `segments` PARAM and feed it straight to `revolveProfile(pts, seg)`
// — they never consult `currentSegments` OR the WASM global, so the SVG coarse
// override never reached an assembly (whose circular geometry lives entirely
// inside those engine-primitive deps). This cap is the second lever: the part
// loader (primitive-loader.ts `wrapped`) clamps any `segments`-style positional
// /object param DOWN to this value for EVERY part it calls — top-level AND
// every dep — so an assembly actually bakes coarse.
//
// null = no cap (full-resolution bake; default). Set + restored by /preview in
// the SAME race-safe synchronous window as `currentSegments` (set immediately
// before the sync geom build, restored in `finally`, no `await` between), so a
// concurrent full bake can't observe the cap.
let currentSegmentCap: number | null = null;
/** Read the active coarse-bake segment cap (null = no cap). */
export function getCircularSegmentCap(): number | null {
  return currentSegmentCap;
}
/** Set (or clear, with null) the coarse-bake segment cap. Pair with a restore
 *  in a `finally` — see /api/primitives/preview. */
export function setCircularSegmentCap(n: number | null): void {
  currentSegmentCap = n;
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
/** "Additive zero" Manifold used as the seed for assembly bodies.
 *  M.cube([0,0,0]) is degenerate — Manifold's boolean library DROPS its
 *  union output entirely (empty().add(X) returned empty geometry, NOT X).
 *  A tiny 1mm cube at the origin is small enough to be visually invisible
 *  at any typical scene scale yet keeps boolean ops correct: empty().add(X)
 *  now returns X ∪ tiny_origin_cube ≈ X. */
export function empty(): any {
  return M.cube([0.001, 0.001, 0.001], true);
}

/**
 * Stamp a Manifold with a single source `hashId` (color-by-source).
 *
 * Collapses the mesh to ONE relation run carrying `hashId` in
 * `runOriginalID`, so every triangle of this part carries it through
 * subsequent `.add`/`.subtract`/`.intersect`. After the final boolean,
 * `getMesh().runOriginalID` lets the renderer map each triangle back to
 * its part and color it (see `part-id.ts`, `analyzeParts`, `builder.ts`).
 *
 * Injected into the /primitives sandbox as `__tag` and wrapped around each
 * recognized named instance by `buildPrimitiveGeom`. A no-op (returns the
 * value untouched) on anything that isn't a Manifold — e.g. a
 * `resolveProfile(...)` instance that returns a point array — so wrapping
 * is always safe.
 */
export function tagManifold(m: any, hashId: number): any {
  if (!m || typeof m.getMesh !== 'function') return m;
  const wasm = G.__cadtrain_manifold__?.wasm;
  const Manifold = wasm?.Manifold;
  const Mesh = wasm?.Mesh;
  if (!Manifold || !Mesh) return m;
  try {
    const old = m.getMesh();
    // CONSTRUCT a FRESH Mesh with our runOriginalID baked in via the
    // MeshOptions constructor — mutating .runOriginalID on the returned
    // mesh object DID NOT propagate to the underlying WASM state, so the
    // outer __tag silently inherited the input manifold's existing
    // relation. With nested asm calls (assembly imports another assembly)
    // every part ended up sharing the inner asm's tag → single colour
    // across all parts. Building a new Mesh with explicit MeshOptions
    // makes the override actually stick. Discovered 2026-06-03.
    //
    // One run spanning every triangle: runIndex = [0, triVerts.length],
    // runOriginalID = [hashId]. Manifold accepts runIndex shorter by one
    // and auto-appends, but supplying the full pair is the documented
    // canonical form.
    // COPY the typed-array data into fresh buffers — passing through the
    // old.* references can put the new Mesh in a weird state where it
    // silently produces an empty manifold (observed 2026-06-03: parts
    // disappeared from the bake instead of getting recoloured). Fresh
    // Float32Array(old.vertProperties) + Uint32Array(old.triVerts) are
    // structurally identical but owned by the new Mesh.
    const tvLen = (old.triVerts as ArrayLike<number>).length;
    const fresh = new Mesh({
      numProp: old.numProp,
      vertProperties: new Float32Array(old.vertProperties),
      triVerts: new Uint32Array(old.triVerts),
      runOriginalID: new Uint32Array([hashId >>> 0]),
      runIndex: new Uint32Array([0, tvLen]),
    });
    return new Manifold(fresh);
  } catch {
    return m;
  }
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
/** @op Translate — shift the part by [x, y, z]. Carries any connection datums
 *  (set via `ref`) along z so `tail(positionedPart)` keeps working for chaining. */
export function mv(m: any, v: [number, number, number]) {
  const r = m.translate(v);
  if (m._refHead !== undefined) r._refHead = m._refHead + v[2];
  if (m._refTail !== undefined) r._refTail = m._refTail + v[2];
  // `_stackRef` (the per-part STACK REFERENCE — how this part mates inside a
  // stack(); see stack() below) is NOT a z-coordinate, it's an advance amount
  // / sign flag, so it carries through a translate UNSHIFTED. Lets a user wrap
  // a part in mv() before dropping it into a stack without losing the ref.
  if (m._stackRef !== undefined) r._stackRef = m._stackRef;
  return r;
}
/** @op Rotate — rotate the part by degrees around [x, y, z]. */
export function rot(m: any, v: [number, number, number]) { return m.rotate(v); }

/** Re-stamp the per-part STACK REFERENCE on a manifold. Used by emitted
 *  stack() expressions to apply a PER-CHILD OVERRIDE (the Stack node's
 *  childRefs) — it overrides the value the child's own geom stamped as
 *  `_stackRef`. Mutates + returns the same manifold; no-op on non-objects so
 *  it's safe to wrap any child expression. See stack() for how `v` is read. */
export function withStackRef(m: any, v: number) {
  if (m && typeof m === 'object') m._stackRef = v;
  return m;
}

/** @op Place parts as ONE manifold WITHOUT a boolean union — a purely
 *  topological combine (Manifold.compose). Parts stay SEPARATE bodies
 *  ("connected/placed, not fused"), and each one's source originalID is
 *  preserved so color-by-source still works. MUCH cheaper than .add()/union
 *  for stacking many instances: build a part ONCE, then `place()` translated
 *  copies (e.g. an N-joint drill stand). Verified in
 *  scripts/spike_csg_originalid.ts (TEST 5: ids + cutaway survive, no merge).
 *  Skips empty/non-Manifold entries so it's safe to spread a mixed list. */
export function place(parts: any[]): any {
  const ms = (parts ?? []).filter((p) => p && typeof p.getMesh === 'function');
  if (ms.length === 0) return empty();
  if (ms.length === 1) return ms[0];
  return M.compose(ms);
}

// ── Axial extent + connection-DATUM helpers (assembling along the drilling axis) ──
// Stack pieces inside a part's mv transform: `const pipe = mv(r_tube(…), [0,0,
// tail(box)]);` drops `pipe` at `box`'s tail datum. The offset is the part's OWN
// connection plane, so flush vs overlap is decided by the PART (via `ref`), not a
// magic number. Datums default to the bbox faces → flush stacking with no setup.
// (Manifold bbox min/max are Vec3 arrays → [2] is z.)
/** Bottom (max z, Z-down) face of a part. */
export function zMax(m: any): number { return m.boundingBox().max[2]; }
/** Top (min z, Z-down) face of a part. */
export function zMin(m: any): number { return m.boundingBox().min[2]; }
/** Axial length (z-extent) of a part. */
export function zLen(m: any): number { const b = m.boundingBox(); return b.max[2] - b.min[2]; }
/** Declare a part's connection datums (z): `head` = top plane, `tail` = bottom
 *  plane. Returns the same manifold with the datums attached. A part overrides
 *  the defaults to e.g. a makeup shoulder so connections overlap correctly. */
export function ref(m: any, head: number, tail: number): any { m._refHead = head; m._refTail = tail; return m; }
/** Top connection datum (default = top face). */
export function head(m: any): number { return m._refHead !== undefined ? m._refHead : zMin(m); }
/** Bottom connection datum (default = bottom face). */
export function tail(m: any): number { return m._refTail !== undefined ? m._refTail : zMax(m); }
/** Drop `b` so its head datum meets `a`'s tail datum (+ optional gap). */
export function mate(a: any, b: any, gap = 0): any { return mv(b, [0, 0, tail(a) - head(b) + gap]); }
/** Shift `b` so its reference z `bZ` lands on the target z `aZ`. */
export function align(b: any, aZ: number, bZ: number): any { return mv(b, [0, 0, aZ - bZ]); }

/** @op Stack — auto-mate the children linearly down z. First child stays at
 *  the origin; each subsequent child gets `mv(c, [0, 0, tail(prev)])` so its
 *  head meets the previous child's tail. Returns the composed placement.
 *  Mirror of the Phase F StackNode emit — drives the canonical drilling
 *  string idiom (joints stacked under joints, no gap). */
export function stack(children: any[]): any {
  const items = (Array.isArray(children) ? children : []).filter((c) => c != null);
  if (items.length === 0) return empty();
  // Guard against an EMPTY child. An empty Manifold (0 triangles — e.g. a
  // subtract that removed everything, "blanking" a part) reports a DEGENERATE
  // bounding box (max = [null,null,null] → tail()/head() = ±Infinity). Using
  // that as a stacking offset translates the next part by ±Infinity → NaN
  // geometry → the place() union crashes Manifold with "memory access out of
  // bounds" and (pre-guard) cascaded into a client request-flood that took the
  // server down (2026-06-13). Fail with a clear, accurate message instead.
  for (let i = 0; i < items.length; i++) {
    if (!Number.isFinite(tail(items[i])) || !Number.isFinite(head(items[i]))) {
      throw new Error(`stack: item ${i + 1} of ${items.length} produced EMPTY or invalid geometry (degenerate bounding box) — a part collapsed to nothing (e.g. a subtract removing everything, or identical OD on both sides). Fix that part's parameters.`);
    }
  }
  // STACK REFERENCE / z-offset (per-part mate control). `cursor` is the z where
  // the NEXT child's local origin lands: the placed child's TAIL datum (flush /
  // end-to-end) PLUS its `_stackRef` z-offset (stamped by its emitted geom —
  // composition-emit's `stack_ref` reserved param; absent on parts that never
  // opted in). The offset is a DELTA, intuitive both ways:
  //   • absent / 0  → flush, end-to-end (historical behaviour).
  //   • positive v  → leave a GAP of v before the next child.
  //   • negative v  → OVERLAP the next child into this one by |v| (mate a
  //                    tool-joint pin into the box, overlap upset collars, …).
  // `_stackRef` is translation-invariant (a relative offset, not a coordinate)
  // so it's read from the ORIGINAL item, before placement.
  let cursor = 0;
  const out: any[] = [];
  for (let i = 0; i < items.length; i++) {
    const placed = i === 0 ? items[i] : mv(items[i], [0, 0, cursor]);
    out.push(placed);
    const refRaw = (items[i] as any)._stackRef;
    const ref = (refRaw == null || !Number.isFinite(Number(refRaw))) ? 0 : Number(refRaw);
    // z-offset is a DELTA to the flush (end-to-end) position: 0 = end-to-end,
    // positive = a GAP of that size, negative = OVERLAP the next child by |v|
    // (e.g. mate a tool-joint pin into the box). Intuitive in both directions —
    // unlike "advance by exactly v", a small positive value no longer piles long
    // parts on top of each other.
    cursor = tail(placed) + ref;
  }
  return place(out);
}

/** @op Overlay — translate `child` so its `at` datum meets `anchor`'s `at`
 *  datum. Does NOT advance any stacking cursor (it's a pure positional
 *  align). `at` defaults to 'head'; 'tail' or 'center' for other datums. */
export function overlay(anchor: any, child: any, at: 'head' | 'tail' | 'center' = 'head'): any {
  const datum = (m: any) => at === 'head' ? head(m) : at === 'tail' ? tail(m) : (head(m) + tail(m)) / 2;
  return mv(child, [0, 0, datum(anchor) - datum(child)]);
}

/** @part Profile extrude — sandbox/play primitive. Define a 2D profile (CCW polygon) and extrude it up Z, optionally with twist + taper. Edit the profile array, height, twist, scaleTop to experiment. */
export function profile_extrude(height: number, twistDegrees: number, scaleTop: number, sides: number): any {
  if (!G.__cadtrain_manifold__.wasm) {
    throw new Error('manifold not initialised — call initManifold() first');
  }
  const CS = G.__cadtrain_manifold__.wasm.CrossSection;

  // ── EDIT THIS PROFILE ────────────────────────────────────────────
  // Array of [x, y] points, CCW for outer ring. Default = N-gon of
  // radius 1; change to ANY shape (L-bracket, star, cam profile, …).
  // For a hole, add a second array wound CW.
  const N = Math.max(3, Math.floor(sides));
  const r = 1;
  const profile: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    profile.push([r * Math.cos(a), r * Math.sin(a)]);
  }

  // Try replacing with a fixed shape, e.g. L-bracket:
  //   const profile: [number, number][] = [
  //     [0, 0], [1, 0], [1, 0.3], [0.3, 0.3], [0.3, 1], [0, 1],
  //   ];

  // ── Extrude ──────────────────────────────────────────────────────
  // extrude(height, nDivisions, twistDegrees, scaleTop, center)
  const cs = new CS([profile]);
  const nDivisions = Math.max(8, Math.ceil(Math.abs(twistDegrees) / 12));
  return cs.extrude(height, nDivisions, twistDegrees, Math.max(0.05, scaleTop));
}

/** @part Revolve — sweep a 2D profile (array of [x,z] pairs forming a closed contour) 360° around the Z axis. Use radial=x distance, axial=z position. Pass via JSON-encoded contour string. */
export function revolve(contourJson: string, _unused1?: number, _unused2?: number, _unused3?: number, _unused4?: number): any {
  // The interpreter dispatches with positional numeric args only, so the
  // profile travels as a JSON-encoded string of [x, z] pairs the caller
  // packs and the primitive un-packs. Demo wrapper components feed real
  // profiles (e.g. a seal-bore cross-section, an O-ring groove, a thread
  // tooth meridional cut). circularSegments is left at the global
  // currentSegments — same quality as cyl/tube.
  if (!G.__cadtrain_manifold__.wasm) {
    throw new Error('manifold not initialised — call initManifold() first');
  }
  const CS = G.__cadtrain_manifold__.wasm.CrossSection;

  let pts: [number, number][];
  try {
    pts = JSON.parse(contourJson);
    if (!Array.isArray(pts) || pts.length < 3) throw new Error('contour must be ≥ 3 points');
  } catch (e: any) {
    throw new Error(`revolve: bad contour JSON: ${e?.message ?? e}`);
  }
  const cs = new CS([pts]);
  // CrossSection.revolve sweeps around the Y axis of the cross-section
  // (then maps Y → Z in the resulting manifold), matching the Z-down
  // convention we use everywhere else.
  return cs.revolve(currentSegments);
}

// helix_band_v2 / helix_band_v3_extrude — moved to volume primitives
// at <volume>/primitives/<id>/source.ts. The bundle keeps only v1
// (helix_band) so existing bundle component `thread_helix.ts` and
// `/api/primitives/preview`'s shipped helpers stay intact. New helix
// experiments live in the volume sandbox.

/** @part Helical thread band — od, length, tpi, depth, profile (0 = square, 1 = V60, 2 = ACME 29°), taper (degrees/side, 0 = straight). Pair with subtract to cut threads into a body. Union-of-cubes approach. */
export function helix_band(od: number, length: number, tpi: number, depth: number, profile: number, taper: number): any {
  if (!G.__cadtrain_manifold__.wasm) {
    throw new Error('manifold not initialised — call initManifold() first');
  }
  const pitch = 1 / Math.max(tpi, 0.0001);
  const numTurns = length * tpi;
  const segmentsPerTurn = 24;
  const totalSegments = Math.max(8, Math.ceil(numTurns * segmentsPerTurn));
  const axialExtent = pitch * 0.5;
  const taperTan = Math.tan(Math.max(0, taper) * Math.PI / 180);

  let band: any = null;
  for (let i = 0; i < totalSegments; i++) {
    const angleDeg = (i / segmentsPerTurn) * 360;
    const z = (i / totalSegments) * length;
    const localDepth = Math.max(0.005, depth - z * taperTan);
    const segArcLen = (2 * Math.PI * (od / 2)) / segmentsPerTurn;
    const tangentialExtent = segArcLen * 1.6;

    let tooth: any;
    if (profile === 1 || profile === 2) {
      const crestRatio = profile === 1 ? 0.4 : 0.6;
      tooth = M.cube([localDepth + 0.02, tangentialExtent * crestRatio, axialExtent], false);
      tooth = tooth
        .translate([od / 2 - localDepth, -(tangentialExtent * crestRatio) / 2, 0])
        .rotate([0, 0, angleDeg])
        .translate([0, 0, z]);
    } else {
      tooth = M.cube([localDepth + 0.02, tangentialExtent, axialExtent], false);
      tooth = tooth
        .translate([od / 2 - localDepth, -tangentialExtent / 2, 0])
        .rotate([0, 0, angleDeg])
        .translate([0, 0, z]);
    }
    band = band ? M.union(band, tooth) : tooth;
  }
  return band;
}

// Used by the cutaway view in finalizeManifold. Built fresh on each
// call: the previous module-local cache held a Manifold whose class
// identity went stale when Vite SSR-rebuilt this module between
// /api/primitives/preview requests, mixing two embind class registries
// inside scaled.subtract(cutBox) and throwing "Expected null or
// instance of Manifold, got an instance of Manifold". /components is
// unaffected because it builds client-side in one realm.
export function getCutBox(): any {
  if (!G.__cadtrain_manifold__.M) return null;
  return M.cube([20, 20, 100], false).translate([0, 0, -50]);
}
