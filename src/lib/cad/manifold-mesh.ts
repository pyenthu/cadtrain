/**
 * manifold-mesh — the welded raw-mesh toolkit.
 *
 * Generic machinery for building a Manifold from hand-wound triangle
 * soup: tessellate a parametric swept surface (`gridPatch`), close its
 * open ends (`capFan`), then concatenate + position-weld the patches and
 * wrap them in `new Manifold(new Mesh(...))` (`weldAndBuild`).
 *
 * Extracted from the inline copies every raw-mesh primitive used to
 * carry (raw_helix_4, r_thread_full, …). These are injected into the
 * /primitives sandbox (see `primitive-sandbox.ts`) so a primitive's
 * `source.ts` only needs its UNIQUE profile + rail/bandFn — not the mesh
 * plumbing. See docs/CAD_AUTHORING.md + the raw-mesh-helix pattern.
 *
 * SVTC ordered grid: each cell emits tri (a,b,e) + (a,e,d); normals come
 * out in the −du×dv direction, so traverse a profile CLOCKWISE in 2D to
 * get OUTWARD normals on the swept band.
 */

/** One welded patch: interleaved xyz vertices + flat triangle indices. */
export type Patch = { verts: Float32Array; tris: Uint32Array };

/** A frame on a sweep rail: the centre point + the unit radial direction
 *  the profile's first (radial) coordinate is measured along. */
export type RailFrame = { cx: number; cy: number; cz: number; radial: [number, number, number] };

/**
 * Tessellate a parametric surface into a (uN+1)×(vN+1) vertex grid with
 * 2 triangles per cell. `fn(u, v)` returns the 3D point at normalized
 * (u, v) ∈ [0,1]². Used to mesh a swept band: u walks the rail, v walks
 * the profile.
 */
export function gridPatch(
  uN: number,
  vN: number,
  fn: (u: number, v: number) => [number, number, number],
): Patch {
  const verts = new Float32Array((uN + 1) * (vN + 1) * 3);
  let i = 0;
  for (let r = 0; r <= uN; r++) {
    for (let c = 0; c <= vN; c++) {
      const p = fn(r / uN, c / vN);
      verts[i++] = p[0]; verts[i++] = p[1]; verts[i++] = p[2];
    }
  }
  const tris = new Uint32Array(uN * vN * 6);
  let k = 0;
  for (let r = 0; r < uN; r++) {
    for (let c = 0; c < vN; c++) {
      const a = r * (vN + 1) + c;
      const b = a + 1;
      const d = a + (vN + 1);
      const e = d + 1;
      tris[k++] = a; tris[k++] = b; tris[k++] = e;
      tris[k++] = a; tris[k++] = e; tris[k++] = d;
    }
  }
  return { verts, tris };
}

// ── Build-time AXIAL (Z) segmentation — smooth warp without a mesh rebuild ────
// A revolve only carries rings at the PROFILE's z-points, so `Manifold.warp`
// (which only MOVES existing vertices) turns a coarse side-wall into faceted
// chords under a sine. We fix that at BUILD time, on the 2D (r,z) profile,
// BEFORE the revolve: insert COLLINEAR interior points along every long-Z edge.
// Because the inserted points lie exactly on the original straight edge the
// revolved solid is geometrically IDENTICAL (same bbox + volume), just denser
// along Z — so a later warp bends it as a smooth curve instead of chords. This
// is crash-safe: it feeds the SAME revolveProfile + weldAndBuild pipeline with
// MORE rings and never touches a built MeshGL, so it can never produce the
// non-manifold soup that OOB-crashed the prior post-bake split (reverted 3fb1fa8,
// Rule 25). Operating on the 2D profile (not the final Manifold) is the safe path.
//
// DIAL ("expose dials, don't hide constants"):
//   • axialMaxZSpan      target max length of a side edge along Z. Smaller =
//                        smoother sine, more triangles. Default 0.25 ≈ 16
//                        samples / cycle at the scene-default warp (freq 1.5 →
//                        period ≈ 4.19 z-units) and matches the proven old
//                        render-time stopgap (shared/warp.ts subdivideAlongZ,
//                        maxZSpan ≈ 0.25). null / ≤0 → OFF (byte-identical revolve).
//   • axialMaxSegPerEdge CAP on splits per edge so ONE very long single revolve
//                        can't explode the vertex count. A tall STACK is many
//                        SHORT-profile parts each revolved separately, so each
//                        part's own side edge is short and the cap rarely bites;
//                        it only guards a genuinely 100+-unit single profile edge.
// Follow-up (deferred — needs a file outside this pass's scope): drive
//   axialMaxZSpan from the warp FREQUENCY (≈8 samples/cycle → maxZSpan =
//   (2π / freq) / 8) and gate it on warpEnabled, set race-safely right before the
//   synchronous geom build (same pattern as manifold-helpers setCircularSegmentCount,
//   from /api/primitives/preview).
// DONE: default is now OFF — /api/primitives/preview drives it from the warp
//   FREQUENCY only when a warp option is present (≈16 samples/cycle), set
//   race-safely around the synchronous build and restored after. Non-warp
//   revolves stay light (an always-on 0.25 made g_dp_stand bake 26 s / 751k verts).
let _axialMaxZSpan: number | null = null;
let _axialMaxSegPerEdge = 64;
/** Read the active axial max-Z-span dial (null = subdivision off). */
export function getAxialMaxZSpan(): number | null { return _axialMaxZSpan; }
/** Set the axial max-Z-span (≤0 / null disables; smaller = smoother + denser). */
export function setAxialMaxZSpan(v: number | null): void { _axialMaxZSpan = (v != null && v > 0) ? v : null; }
/** Read the per-edge split cap. */
export function getAxialMaxSegPerEdge(): number { return _axialMaxSegPerEdge; }
/** Set the per-edge split cap (≥1). */
export function setAxialMaxSegPerEdge(n: number): void { _axialMaxSegPerEdge = Math.max(1, Math.floor(n)); }

// CIRCUMFERENTIAL segment CAP — the bake's "seg" override (preview coarsening +
// coarse-during-drag). Welded revolves use their OWN explicit segments arg and
// ignore Manifold's global circular count, so the override never reached them.
// When set, revolveProfile clamps its segN to this cap. null = no cap.
let _circSegCap: number | null = null;
/** Read the circumferential segment cap (null = uncapped). */
export function getCircSegCap(): number | null { return _circSegCap; }
/** Set the circumferential segment cap (≥3; ≤0/null clears it). */
export function setCircSegCap(v: number | null): void { _circSegCap = (v != null && v >= 3) ? Math.floor(v) : null; }

/**
 * Densify a closed (r,z) profile loop along Z: insert COLLINEAR interior points
 * on each edge so no edge spans more than `maxZSpan` in Z (capped at
 * `maxSegPerEdge` splits/edge). Takes + returns the UNIQUE loop verts (no wrap
 * copy) — a drop-in for `revolveProfile`. Interpolation is linear in BOTH r and
 * z, so the added points sit exactly on the original straight edge: the revolved
 * solid is unchanged geometrically, only denser. `maxZSpan` null/≤0 → input
 * returned unchanged. Horizontal edges (Δz≈0: caps) get no extra points; only
 * Z-spanning edges (the side walls a sine actually bends) are densified.
 */
export function subdivideProfileAxial(
  profile: [number, number][],
  maxZSpan: number | null,
  maxSegPerEdge = 64,
): [number, number][] {
  if (!Array.isArray(profile) || profile.length < 2) return profile;
  if (maxZSpan == null || !(maxZSpan > 0)) return profile;
  const cap = Math.max(1, Math.floor(maxSegPerEdge));
  const N = profile.length;
  const out: [number, number][] = [];
  for (let k = 0; k < N; k++) {
    const [r0, z0] = profile[k];
    const [r1, z1] = profile[(k + 1) % N];
    out.push([r0, z0]); // edge start — the unique loop vert
    const dz = Math.abs(z1 - z0);
    const n = Math.min(cap, Math.max(1, Math.ceil(dz / maxZSpan)));
    for (let s = 1; s < n; s++) {
      const t = s / n;
      out.push([r0 + (r1 - r0) * t, z0 + (z1 - z0) * t]);
    }
  }
  return out;
}

/**
 * Surface of revolution: spin a CLOSED 2D profile (a loop in the
 * radial–axial plane, `[r, z]` with r ≥ 0) a full 360° around the z-axis.
 *
 * Walks the profile EDGE BY EDGE (profile[k] → profile[(k+1) % N], so the
 * caller gives the unique loop verts, NOT a wrap copy) and revolves each
 * edge into a quad strip. Edges that touch the axis (r ≈ 0) emit a
 * triangle fan to the single axis point instead of degenerate quads — so
 * solids whose profile reaches the axis (a solid cylinder, a cone apex)
 * come out clean, while annular profiles (tube, tapered tube) are plain
 * quad strips. Coincident seam verts are removed later by weldAndBuild.
 *
 * Winding: this triangle order yields OUTWARD-facing solids (POSITIVE
 * Manifold volume) for a profile traversed axis→rim→up→back (e.g. the
 * cylinder rect [0,0]→[R,0]→[R,H]→[0,H]). VERIFY ORIENTATION BY VOLUME
 * SIGN, not by inspecting serialized normals: Manifold canonicalises the
 * mesh it returns, so getMesh normals always look "outward" even for an
 * inverted (negative-volume) solid. A negative `manifold.volume()` means
 * inside-out → CSG subtract will ADD instead of carve. (Burned by exactly
 * this 2026-05-20: a normal-based check passed while the solids were
 * inverted; the volume sign caught it.)
 */
export function revolveProfile(profile: [number, number][], segments: number): Patch {
  // BUILD-TIME axial densification (Rule 25): insert collinear interior points
  // along long-Z edges so a later Manifold.warp bends the side walls as a smooth
  // sine, not faceted chords. Geometrically identical (points on the straight
  // edge) → bbox/volume unchanged; just more rings. Dial: _axialMaxZSpan (null
  // disables → byte-identical to the pre-change revolve).
  const prof = subdivideProfileAxial(profile, _axialMaxZSpan, _axialMaxSegPerEdge);
  // Clamp to the bake's circumferential cap (preview seg override / coarse-drag)
  // so the pane "seg" + draft-seg actually coarsen welded revolves.
  let segN = Math.max(3, Math.floor(segments));
  if (_circSegCap != null) segN = Math.max(3, Math.min(segN, _circSegCap));
  const dT = (2 * Math.PI) / segN;
  const EPS = 1e-9;
  const verts: number[] = [];
  const tris: number[] = [];
  const push = (r: number, z: number, theta: number): number => {
    verts.push(r * Math.cos(theta), r * Math.sin(theta), z);
    return verts.length / 3 - 1;
  };
  const M = prof.length;
  for (let k = 0; k < M; k++) {
    const [r0, z0] = prof[k];
    const [r1, z1] = prof[(k + 1) % M];
    const r0z = r0 < EPS;
    const r1z = r1 < EPS;
    if (r0z && r1z) continue; // edge lies on the axis → nothing to revolve
    for (let s = 0; s < segN; s++) {
      const ta = s * dT;
      const tb = (s + 1) * dT;
      const a0 = push(r0, z0, ta), a1 = push(r0, z0, tb);
      const b0 = push(r1, z1, ta), b1 = push(r1, z1, tb);
      if (r0z) {
        // p0 on axis → fan triangle from the axis point a0.
        tris.push(a0, b1, b0);
      } else if (r1z) {
        // p1 on axis → fan triangle to the axis point b0.
        tris.push(a0, a1, b0);
      } else {
        tris.push(a0, b1, b0);
        tris.push(a0, a1, b1);
      }
    }
  }
  return { verts: new Float32Array(verts), tris: new Uint32Array(tris) };
}

/**
 * Triangle-fan triangulation of a convex profile polygon at one rail
 * frame — i.e. an end cap. `prof` is the profile's UNIQUE verts (the
 * wrap copy is NOT included). `reverse` flips the winding so the cap
 * faces the opposite way (a sweep's two ends face ±tangent, so one cap
 * must be wound backwards for both to face outward).
 */
export function capFan(
  samplePos: RailFrame,
  prof: [number, number][],
  reverse: boolean,
): Patch {
  const N = prof.length;
  const verts = new Float32Array(N * 3);
  for (let j = 0; j < N; j++) {
    const [pr, pa] = prof[j];
    verts[j * 3]     = samplePos.cx + samplePos.radial[0] * pr;
    verts[j * 3 + 1] = samplePos.cy + samplePos.radial[1] * pr;
    verts[j * 3 + 2] = samplePos.cz + pa;
  }
  const tris = new Uint32Array((N - 2) * 3);
  let k = 0;
  if (reverse) {
    for (let j = N - 1; j > 1; j--) {
      tris[k++] = 0; tris[k++] = j; tris[k++] = j - 1;
    }
  } else {
    for (let j = 1; j < N - 1; j++) {
      tris[k++] = 0; tris[k++] = j; tris[k++] = j + 1;
    }
  }
  return { verts, tris };
}

/**
 * Concatenate patches, position-weld coincident verts (the wasm Mesh
 * constructor does NOT auto-weld), and wrap the result in a Manifold.
 * Grabs the Manifold WASM from the shared singleton on globalThis — call
 * `initManifold()` first (the sandbox + every endpoint do).
 *
 * Throws synchronously on bad topology ("Not manifold", "Non-finite
 * vertex", …) — let it surface; the message is the diagnostic.
 */
export function weldAndBuild(patches: Patch[]): any {
  const wasm = (globalThis as any).__cadtrain_manifold__?.wasm;
  if (!wasm) {
    throw new Error('manifold not initialised — call initManifold() first');
  }
  const Mesh = wasm.Mesh;
  const Manifold = wasm.Manifold;

  let totalV = 0, totalT = 0;
  for (const p of patches) { totalV += p.verts.length; totalT += p.tris.length; }
  const allV = new Float32Array(totalV);
  const allT = new Uint32Array(totalT);
  let vOff = 0, tOff = 0, base = 0;
  for (const p of patches) {
    allV.set(p.verts, vOff);
    for (let n = 0; n < p.tris.length; n++) allT[tOff + n] = p.tris[n] + base;
    vOff += p.verts.length;
    tOff += p.tris.length;
    base += p.verts.length / 3;
  }
  const eps = 1e-6;
  const map = new Map<string, number>();
  const newPos: number[] = [];
  const remap = new Uint32Array(allV.length / 3);
  for (let n = 0; n < remap.length; n++) {
    const x = allV[n * 3], y = allV[n * 3 + 1], z = allV[n * 3 + 2];
    const key = `${Math.round(x / eps)},${Math.round(y / eps)},${Math.round(z / eps)}`;
    let idx = map.get(key);
    if (idx === undefined) { idx = newPos.length / 3; newPos.push(x, y, z); map.set(key, idx); }
    remap[n] = idx;
  }
  const newTris = new Uint32Array(allT.length);
  for (let n = 0; n < allT.length; n++) newTris[n] = remap[allT[n]];
  const verts3 = new Float32Array(newPos);

  let m = new Manifold(new Mesh({ numProp: 3, vertProperties: verts3, triVerts: newTris }));

  // ── Orientation self-correction (the load-bearing safety net) ──────────
  // A hand-wound mesh wound the wrong way builds a valid-but-INVERTED solid
  // (negative volume). It renders fine (DoubleSide hides it) but CSG
  // subtract then ADDS instead of carving — a silent, recurring footgun.
  // Manifold canonicalises the mesh it RETURNS, so you cannot detect this
  // from getMesh normals; the VOLUME SIGN is the only reliable signal.
  // Here we just fix it: if the solid came out inside-out, reverse every
  // triangle's winding and rebuild. Callers (revolveProfile, raw cubes,
  // any future welded primitive) get an outward, positive-volume solid no
  // matter which way they wound their triangles.
  try {
    if (m.volume() < 0) {
      const flip = new Uint32Array(newTris.length);
      for (let i = 0; i < newTris.length; i += 3) {
        flip[i] = newTris[i]; flip[i + 1] = newTris[i + 2]; flip[i + 2] = newTris[i + 1];
      }
      m = new Manifold(new Mesh({ numProp: 3, vertProperties: verts3, triVerts: flip }));
    }
  } catch { /* volume() unavailable on a degenerate result — leave as built */ }
  return m;
}
