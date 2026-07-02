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

// ── SWEEP / LOFT — repeat-as-sweep prototype ─────────────────────────────────
// Loft a continuous welded skin THROUGH an ordered list of cross-section
// "stations" (framing b) or SWEEP a fixed 2D cross-section along an ordered
// path (framing a). This is the geometry kernel behind a future repeat-node
// "sweep" mode: instead of place()-ing N discrete copies of a unit along a
// path (g_spiral_repeat → a ~26k-vert box-pile), grid ONE skin between
// consecutive frames → a single light welded solid (like g_spiral's ribbon).
//
// Same machinery as revolveProfile: a (u,v) grid → -du×dv winding → mandatory
// position-weld → weldAndBuild auto-corrects the volume sign, so the caller
// never has to get the winding perfect. u walks the PATH (stations); v walks
// the CROSS-SECTION. Build-time segmentation only (Rule 25): denser
// path/section = more triangles HERE, never a post-bake MeshGL rewrite.

type V3 = [number, number, number];
const _sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const _cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const _len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const _norm = (a: V3): V3 => { const l = _len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const _dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const _scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
/** Rotate v about the UNIT axis k by angle θ (Rodrigues' formula). */
const _rotAbout = (v: V3, k: V3, ang: number): V3 => {
  const c = Math.cos(ang), s = Math.sin(ang);
  const kv = _cross(k, v);
  const kd = _dot(k, v) * (1 - c);
  return [
    v[0] * c + kv[0] * s + k[0] * kd,
    v[1] * c + kv[1] * s + k[1] * kd,
    v[2] * c + kv[2] * s + k[2] * kd,
  ];
};

type V2 = [number, number];

/** Best-fit plane normal of a closed 3D loop via Newell's method (robust for a
 *  non-planar-ish or non-convex ring — it integrates the signed projected area
 *  over the whole loop rather than trusting any single triple). */
function newellNormal(ring: V3[]): V3 {
  let nx = 0, ny = 0, nz = 0;
  const N = ring.length;
  for (let i = 0; i < N; i++) {
    const a = ring[i], b = ring[(i + 1) % N];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

/**
 * Ear-clip triangulate a simple (possibly NON-CONVEX) 2D polygon `p`, given in
 * order. Returns triangle index triples into `p`'s ORIGINAL 0..N-1 numbering,
 * each wound in the SAME direction as the input vertex order (so the union of
 * the triangles' boundary edges reproduces the polygon's index-order perimeter
 * — exactly like the old vertex-0 fan did for a convex polygon, which keeps the
 * cap watertight against the side wall). O(n²). Returns null when no ear can be
 * found (a self-intersecting section) → caller falls back to a centroid fan.
 */
export function earClip2D(p: V2[]): number[][] | null {
  const N = p.length;
  if (N < 3) return null;
  // (b-a) × (c-a) z-component — 2× the signed area of triangle (a,b,c).
  const cross2 = (a: V2, b: V2, c: V2) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  // Polygon orientation from its signed area (index order). All ear + inside
  // tests are taken relative to this sign, so BOTH windings are handled without
  // reversing the list (which would flip the boundary the wall welds to).
  let area2 = 0;
  for (let i = 0; i < N; i++) area2 += cross2(p[0], p[i], p[(i + 1) % N]);
  const sign = area2 >= 0 ? 1 : -1;
  const EPS = 1e-12;
  // pt strictly inside triangle (a,b,c), which is wound with orientation `sign`.
  const inTri = (pt: V2, a: V2, b: V2, c: V2) =>
    sign * cross2(a, b, pt) > EPS &&
    sign * cross2(b, c, pt) > EPS &&
    sign * cross2(c, a, pt) > EPS;

  const idx: number[] = [];
  for (let i = 0; i < N; i++) idx.push(i);
  const tris: number[][] = [];
  let guard = N * N + 8;
  while (idx.length > 3) {
    if (guard-- <= 0) return null; // safety — no progress
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const n = idx.length;
      const i0 = idx[(i - 1 + n) % n], i1 = idx[i], i2 = idx[(i + 1) % n];
      const a = p[i0], b = p[i1], c = p[i2];
      if (sign * cross2(a, b, c) <= EPS) continue; // reflex / collinear tip
      let ear = true;
      for (let j = 0; j < n; j++) {
        const vj = idx[j];
        if (vj === i0 || vj === i1 || vj === i2) continue;
        if (inTri(p[vj], a, b, c)) { ear = false; break; }
      }
      if (!ear) continue;
      tris.push([i0, i1, i2]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) return null; // no ear this pass → not a simple polygon
  }
  tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

/**
 * Triangulate a closed 3D polyline (an end cap) for an ARBITRARY simple
 * (possibly non-convex) planar-ish section. Fits the ring's best-fit plane
 * (Newell normal + centroid), projects to a 2D in-plane basis, ear-clips, and
 * maps the triangles back onto the SAME ring vertices (so weld + crease-aware
 * normals + watertightness hold). A naive vertex-0 fan is only valid for a
 * CONVEX polygon — the non-convex `resampleSpline` sections used by r_sweep made
 * it emit triangles that cross OUTSIDE the loop → overlapping/degenerate sliver
 * caps. Ear-clipping never crosses the boundary.
 *
 * `reverse` flips the winding so the two ends of a sweep face opposite ways;
 * weldAndBuild fixes the overall sign, so this only needs to be SELF-consistent
 * (and the non-reverse boundary matches the old fan's index-order perimeter, so
 * a convex section still welds identically — no regression).
 *
 * Fallback: if ear-clipping fails (a self-intersecting section), fan from the
 * centroid (an extra vertex) instead of vertex 0 — still never crosses for a
 * star-convex loop and is far better than a vertex-0 fan.
 */
export function fanCap3D(ring: V3[], reverse: boolean): Patch {
  const N = ring.length;
  const ringVerts = new Float32Array(N * 3);
  for (let j = 0; j < N; j++) { ringVerts[j * 3] = ring[j][0]; ringVerts[j * 3 + 1] = ring[j][1]; ringVerts[j * 3 + 2] = ring[j][2]; }
  if (N < 3) return { verts: ringVerts, tris: new Uint32Array(0) };

  // Best-fit plane → in-plane basis → project ring to 2D → ear-clip.
  let tris2d: number[][] | null = null;
  const nrm0 = newellNormal(ring);
  const nl = _len(nrm0);
  if (nl > 1e-12) {
    const nrm: V3 = [nrm0[0] / nl, nrm0[1] / nl, nrm0[2] / nl];
    const ref: V3 = Math.abs(nrm[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = _norm(_cross(ref, nrm));
    const v = _cross(nrm, u); // unit (nrm ⟂ u, both unit)
    const p2: V2[] = ring.map((pt): V2 => [_dot(pt, u), _dot(pt, v)]);
    tris2d = earClip2D(p2);
  }

  if (tris2d) {
    const tris = new Uint32Array(tris2d.length * 3);
    let k = 0;
    for (const [a, b, c] of tris2d) {
      if (reverse) { tris[k++] = a; tris[k++] = c; tris[k++] = b; }
      else { tris[k++] = a; tris[k++] = b; tris[k++] = c; }
    }
    return { verts: ringVerts, tris };
  }

  // Fallback — centroid fan (star-convex safe). Append the centroid vertex.
  let cx = 0, cy = 0, cz = 0;
  for (const pt of ring) { cx += pt[0]; cy += pt[1]; cz += pt[2]; }
  cx /= N; cy /= N; cz /= N;
  const verts = new Float32Array((N + 1) * 3);
  verts.set(ringVerts);
  verts[N * 3] = cx; verts[N * 3 + 1] = cy; verts[N * 3 + 2] = cz;
  const ci = N;
  const tris = new Uint32Array(N * 3);
  let k = 0;
  for (let j = 0; j < N; j++) {
    const a = j, b = (j + 1) % N;
    if (reverse) { tris[k++] = ci; tris[k++] = b; tris[k++] = a; }
    else { tris[k++] = ci; tris[k++] = a; tris[k++] = b; }
  }
  return { verts, tris };
}

/**
 * Grid the SIDE WALL between consecutive cross-section stations into ONE patch
 * (no caps, no weld). Each station is an ordered list of `m` positioned 3D
 * points. The wall is a (#stations)×(m) grid with the toolkit's -du×dv winding;
 * a duplicate wrap row/col is appended where the section (closedSection) and/or
 * the path (closedPath) closes so the seam quad is generated (weldAndBuild later
 * merges the coincident seam verts). Extracted from `loftStations` so the
 * ANNULAR sweep can grid the outer + each hole loop as separate wall patches
 * and weld them together with the annular caps in ONE `weldAndBuild`.
 */
function wallPatch(stations: V3[][], closedSection: boolean, closedPath: boolean): Patch {
  const nS = stations.length;
  const m = stations[0].length;
  const rows = closedPath ? nS + 1 : nS;
  const cols = closedSection ? m + 1 : m;
  const sverts = new Float32Array(rows * cols * 3);
  for (let r = 0; r < rows; r++) {
    const st = stations[r % nS];
    for (let c = 0; c < cols; c++) {
      const p = st[c % m];
      const i = (r * cols + c) * 3;
      sverts[i] = p[0]; sverts[i + 1] = p[1]; sverts[i + 2] = p[2];
    }
  }
  const tris = new Uint32Array((rows - 1) * (cols - 1) * 6);
  let k = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      tris[k++] = a; tris[k++] = b; tris[k++] = e;
      tris[k++] = a; tris[k++] = e; tris[k++] = d;
    }
  }
  return { verts: sverts, tris };
}

/**
 * LOFT (framing b): build a welded solid by gridding the side wall between
 * consecutive cross-section "stations", each an ordered list of 3D points of
 * the SAME vertex count `m`, already positioned in space. The side wall is a
 * (#stations) × (m) grid welded with the toolkit's -du×dv winding; the two
 * path ends are fan-capped.
 *
 *   • closedSection (default true) — the cross-section is a closed loop, so the
 *     wall wraps from section vert m-1 back to 0 (a tube). false → an open
 *     ribbon strip (no wrap seam).
 *   • closedPath (default false) — the path itself loops (last station joins the
 *     first); suppresses the end caps.
 *   • caps (default true for an open path) — fan-cap the two ends so the tube is
 *     a watertight SOLID. Ignored when closedPath.
 *
 * Returns the welded Manifold (positive volume — weldAndBuild self-corrects).
 */
export function loftStations(
  stations: V3[][],
  opts: { closedSection?: boolean; closedPath?: boolean; caps?: boolean } = {},
): any {
  const nS = stations.length;
  if (nS < 2) throw new Error('loftStations needs ≥ 2 stations');
  const m = stations[0].length;
  if (m < 2) throw new Error('loftStations needs ≥ 2 points per station');
  for (const s of stations) if (s.length !== m) throw new Error('every station needs the same vertex count');
  const closedSection = opts.closedSection !== false;
  const closedPath = opts.closedPath === true;
  const caps = opts.caps !== false && !closedPath;

  const patches: Patch[] = [wallPatch(stations, closedSection, closedPath)];
  if (caps) {
    patches.push(fanCap3D(stations[0], true));        // start cap (-tangent)
    patches.push(fanCap3D(stations[nS - 1], false));  // end cap (+tangent)
  }
  return weldAndBuild(patches);
}

/** One placed sweep station: origin + the orthonormal (side, up, tangent) basis
 *  the 2D cross-section `[a, b]` maps into as `o + a·side + b·up`. */
export type SweepFrame = { o: V3; side: V3; up: V3; tangent: V3 };

/**
 * ROTATION-MINIMIZING FRAMES (parallel transport) along an ordered 3D path —
 * the twist-free framing behind `sweepAlongPath`. Uses the DOUBLE-REFLECTION
 * method (Wang, Jüttler, Zheng & Liu, ACM TOG 2008): the standard robust RMF
 * approximation. The reference normal is carried forward frame-to-frame by two
 * reflections (across the chord, then onto the next tangent) instead of being
 * recomputed from a fixed `up` each station — so the section never ROLLS, and
 * (crucially) it does NOT degenerate when the path runs ~parallel to `up`
 * (the old `side = tangent × up` cross product collapsed there, e.g. a
 * straight-along-Z path with the default `up = world-Z`).
 *
 * SEED (station 0) reproduces the OLD fixed-up convention exactly so planar
 * sweeps are unchanged at the seed and torsion-free thereafter (for a planar
 * path RMF == the old fixed-up frame):
 *   side0 = tangent0 × up ;  up0' = side0 × tangent0 ;  reference r0 = up0'
 * and at every station  side = tangent × r,  up = r,  so `[a,b]` → o + a·side + b·up.
 *
 *   • up (default [0,0,1]) — only the SEED reference; auto-falls-back when the
 *     first tangent is ~parallel to it.
 *   • closedPath — wrapped central-difference tangents; the residual seam twist
 *     (frame carried once around vs the seed) is distributed EVENLY across the
 *     stations so the tube closes without a visible seam kink.
 */
export function sweepFrames(
  path: V3[],
  opts: { up?: V3; closedPath?: boolean } = {},
): SweepFrame[] {
  const N = path.length;
  const up0: V3 = opts.up ?? [0, 0, 1];
  const closedPath = opts.closedPath === true;

  // Per-station unit tangents (central difference interior; one-sided open ends;
  // wrapped for a closed path). A degenerate (zero) tangent inherits the prior.
  const tan: V3[] = [];
  for (let i = 0; i < N; i++) {
    let t: V3;
    if (closedPath) t = _sub(path[(i + 1) % N], path[(i - 1 + N) % N]);
    else if (i === 0) t = _sub(path[1], path[0]);
    else if (i === N - 1) t = _sub(path[N - 1], path[N - 2]);
    else t = _sub(path[i + 1], path[i - 1]);
    tan.push(_len(t) < 1e-12 ? (i > 0 ? tan[i - 1] : ([0, 0, 1] as V3)) : _norm(t));
  }

  // Seed reference r0 = up0' (⟂ tangent0, in the up0 plane) — matches the old
  // fixed-up frame at station 0.
  const t0 = tan[0];
  let side0 = _cross(t0, up0);
  if (_len(side0) < 1e-6) { const alt: V3 = Math.abs(t0[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]; side0 = _cross(t0, alt); }
  side0 = _norm(side0);
  let r: V3 = _norm(_cross(side0, t0)); // r0 = up'
  const refs: V3[] = [r];

  // Double-reflection: carry r from station i to i+1.
  for (let i = 0; i < N - 1; i++) {
    const v1 = _sub(path[i + 1], path[i]);
    const c1 = _dot(v1, v1) || 1e-20;
    const rL = _sub(r, _scale(v1, (2 / c1) * _dot(v1, r)));           // reflect r across the chord
    const tL = _sub(tan[i], _scale(v1, (2 / c1) * _dot(v1, tan[i]))); // reflect tangent_i
    const v2 = _sub(tan[i + 1], tL);
    const c2 = _dot(v2, v2) || 1e-20;
    let rNext = _sub(rL, _scale(v2, (2 / c2) * _dot(v2, rL)));        // reflect onto tangent_{i+1}
    // Re-orthogonalize against the next tangent + renormalize (float-drift guard).
    rNext = _norm(_sub(rNext, _scale(tan[i + 1], _dot(rNext, tan[i + 1]))));
    refs.push(rNext);
    r = rNext;
  }

  // Closed path: propagate refs[N-1] across the seam edge (N-1 → 0), measure the
  // angle vs refs[0] about the shared tangent, and unwind it evenly per station.
  if (closedPath && N > 2) {
    const v1 = _sub(path[0], path[N - 1]);
    const c1 = _dot(v1, v1) || 1e-20;
    const rL = _sub(refs[N - 1], _scale(v1, (2 / c1) * _dot(v1, refs[N - 1])));
    const tL = _sub(tan[N - 1], _scale(v1, (2 / c1) * _dot(v1, tan[N - 1])));
    const v2 = _sub(tan[0], tL);
    const c2 = _dot(v2, v2) || 1e-20;
    let arrived = _sub(rL, _scale(v2, (2 / c2) * _dot(v2, rL)));
    arrived = _norm(_sub(arrived, _scale(tan[0], _dot(arrived, tan[0]))));
    const projB = _norm(_sub(refs[0], _scale(tan[0], _dot(refs[0], tan[0]))));
    const ang = Math.atan2(_dot(_cross(arrived, projB), tan[0]), _dot(arrived, projB));
    for (let i = 0; i < N; i++) refs[i] = _rotAbout(refs[i], tan[i], -ang * (i / N));
  }

  return refs.map((rr, i) => ({ o: path[i], up: rr, side: _norm(_cross(tan[i], rr)), tangent: tan[i] }));
}

/**
 * SWEEP (framing a): sweep a fixed 2D cross-section along an ordered 3D path
 * and weld it into ONE solid. Each path point gets a rotation-minimizing frame
 * (`sweepFrames`, double-reflection parallel transport); the cross-section's
 * local coords `[a, b]` are placed as `P + a·side + b·up`, and the placed rings
 * become `loftStations`.
 *
 * The RMF replaced the old per-station fixed-up frame (`side = tangent × up`),
 * which ROLLED the section on 3D paths and DEGENERATED when the path ran
 * ~parallel to `up` (a straight-along-Z path lost its `side` → flat/garbage).
 * The seed frame reproduces the old fixed-up basis, so the planar spiral WALL
 * case is unchanged; everything downstream is twist-free.
 *
 *   • up (default [0,0,1]) — the SEED reference only (see sweepFrames).
 *   • section: closed 2D loop `[r-side, z-up]`. Trace it consistently; sign is
 *     auto-corrected by the weld. ALSO accepts an ANNULAR section — an object
 *     `{ outer, holes }` or a Manifold `CrossSection` — which routes to
 *     `sweepAnnular` (a hollow tube as ONE welded mesh with a holes-aware cap,
 *     no 3D boolean).
 *   • closedPath / caps / closedSection — forwarded to loftStations.
 */
export function sweepAlongPath(
  path: V3[],
  section: Section2D,
  opts: { up?: V3; closedPath?: boolean; caps?: boolean; closedSection?: boolean } = {},
): any {
  const N = path.length;
  if (N < 2) throw new Error('sweepAlongPath needs ≥ 2 path points');
  // ANNULAR / region section (outer + holes, or a CrossSection) → sweepAnnular.
  const ann = asAnnular(section);
  if (ann) {
    return sweepAnnular(path, ann.outer, ann.holes, {
      up: opts.up,
      closedPath: opts.closedPath === true,
      caps: opts.caps,
    });
  }
  const loop = section as [number, number][];
  if (!Array.isArray(loop) || loop.length < 2) throw new Error('section needs ≥ 2 points');
  const closedPath = opts.closedPath === true;
  const frames = sweepFrames(path, { up: opts.up, closedPath });
  const stations: V3[][] = frames.map((f) => placeLoop(f, loop));
  return loftStations(stations, {
    closedSection: opts.closedSection ?? true,
    closedPath,
    caps: opts.caps,
  });
}

// ── ANNULAR / region cross-section sweep — ONE welded hollow solid, no 3D CSG ──
// Sweep an outer loop AND one-or-more hole loops along the path (each an
// independent wall grid), then close BOTH ends with a HOLES-AWARE triangulation
// of the 2D region (outer minus holes) planted in the start + end frames. The
// caps' boundary verts coincide (by position) with the wall verts at those
// stations, so weldAndBuild stitches everything into ONE manifold solid — the
// material BETWEEN outer and holes. This is the durable, engine-agnostic fix for
// defect 2 (a curved concentric hollow SUBTRACT gives two tilted, coincident cap
// planes whose independent triangulations don't align → Manifold's mesh boolean
// corrupts them into sliver caps). Doing the CSG in 2D on the SECTION avoids the
// 3D boolean entirely → no coincident caps → no slivers, and it's faster (no
// mesh boolean). See docs/plans/annular-csg2d-section-sweep.md + memory
// r_sweep_normals_and_twist (defect 2).

/** A 2D annular / region cross-section: an outer boundary loop + zero-or-more
 *  hole loops (Phase 1: typically one hole). */
export type AnnularSection = { outer: [number, number][]; holes?: [number, number][][] };
/** What `sweepAlongPath` accepts for `section`: a single closed loop (the
 *  original), an annular region, or a Manifold `CrossSection`. */
export type Section2D = [number, number][] | AnnularSection | any;

/** Place a 2D loop `[a,b]` into a sweep frame as `o + a·side + b·up`. */
function placeLoop(f: SweepFrame, loop: [number, number][]): V3[] {
  return loop.map(([a, b]): V3 => [
    f.o[0] + f.side[0] * a + f.up[0] * b,
    f.o[1] + f.side[1] * a + f.up[1] * b,
    f.o[2] + f.side[2] * a + f.up[2] * b,
  ]);
}

/** 2× the signed area of a 2D loop (CCW > 0). */
function signedArea2(loop: [number, number][]): number {
  let a2 = 0;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const p = loop[i], q = loop[(i + 1) % n];
    a2 += p[0] * q[1] - q[0] * p[1];
  }
  return a2;
}

/**
 * Coerce a `section` argument to `{ outer, holes }` IFF it's a region (an
 * `{ outer, … }` object or a Manifold `CrossSection`); otherwise return null so
 * the caller keeps the single-loop path (full back-compat). A plain point list
 * (`[[a,b],…]`) is an Array without an `outer` field → null.
 */
function asAnnular(section: Section2D): { outer: [number, number][]; holes: [number, number][][] } | null {
  if (!section || typeof section !== 'object') return null;
  // Manifold CrossSection → polygons; classify the largest-area loop as the
  // outer boundary, the rest as holes (Phase 1 is one hole, but N is free).
  if (typeof (section as any).toPolygons === 'function') {
    const polys: [number, number][][] = (section as any).toPolygons();
    if (!Array.isArray(polys) || polys.length === 0) return null;
    let oi = 0, best = -Infinity;
    for (let i = 0; i < polys.length; i++) {
      const a = Math.abs(signedArea2(polys[i]));
      if (a > best) { best = a; oi = i; }
    }
    const outer = polys[oi];
    const holes = polys.filter((_, i) => i !== oi);
    return { outer, holes };
  }
  if (Array.isArray((section as any).outer)) {
    const a = section as AnnularSection;
    return { outer: a.outer, holes: a.holes ?? [] };
  }
  return null;
}

/** Holes-aware triangulation of the 2D region [outer, …holes] via Manifold's
 *  `triangulate`. Returns triangle index triples into the CONCATENATED point
 *  list (outer first, then each hole in order). Computed ONCE in 2D + reused for
 *  both end caps. */
function annularCapTris(outer: [number, number][], holes: [number, number][][]): [number, number, number][] {
  const wasm = (globalThis as any).__cadtrain_manifold__?.wasm;
  if (!wasm || typeof wasm.triangulate !== 'function') {
    throw new Error('annular sweep: manifold not initialised (triangulate unavailable) — call initManifold() first');
  }
  return wasm.triangulate([outer, ...holes]) as [number, number, number][];
}

/**
 * Sweep an ANNULAR section (outer + holes) along `path` → ONE welded solid.
 * Walls: the outer loop + each hole loop each gridded via `wallPatch`. Caps: the
 * holes-aware region triangulation planted in the start + end frames (winding
 * flipped for the start so both ends face outward; weldAndBuild fixes the global
 * sign). No 3D boolean, no coincident caps → no defect-2 slivers.
 */
export function sweepAnnular(
  path: V3[],
  outerIn: [number, number][],
  holesIn: [number, number][][],
  opts: { up?: V3; closedPath?: boolean; caps?: boolean } = {},
): any {
  const N = path.length;
  if (N < 2) throw new Error('sweepAnnular needs ≥ 2 path points');
  if (!Array.isArray(outerIn) || outerIn.length < 3) throw new Error('annular section: outer needs ≥ 3 points');
  const closedPath = opts.closedPath === true;
  const caps = opts.caps !== false && !closedPath;

  // Normalise winding so the region is well-formed for `triangulate` + the walls
  // are mutually consistent: outer CCW (positive area), holes CW (negative
  // area). Copy before reversing so we never mutate the caller's arrays.
  const outer = signedArea2(outerIn) < 0 ? outerIn.slice().reverse() : outerIn.slice();
  const holes = (holesIn ?? [])
    .filter((h) => Array.isArray(h) && h.length >= 3)
    .map((h) => (signedArea2(h) > 0 ? h.slice().reverse() : h.slice()));

  const frames = sweepFrames(path, { up: opts.up, closedPath });

  const patches: Patch[] = [];
  // Outer wall + one wall per hole (each a closed-section tube skin).
  patches.push(wallPatch(frames.map((f) => placeLoop(f, outer)), true, closedPath));
  for (const h of holes) patches.push(wallPatch(frames.map((f) => placeLoop(f, h)), true, closedPath));

  if (caps) {
    const capTris = annularCapTris(outer, holes); // triangulate ONCE in 2D
    const all2d: [number, number][] = [outer, ...holes].flat() as [number, number][];
    const capPatch = (f: SweepFrame, reverse: boolean): Patch => {
      const M = all2d.length;
      const verts = new Float32Array(M * 3);
      for (let j = 0; j < M; j++) {
        const [a, b] = all2d[j];
        verts[j * 3]     = f.o[0] + f.side[0] * a + f.up[0] * b;
        verts[j * 3 + 1] = f.o[1] + f.side[1] * a + f.up[1] * b;
        verts[j * 3 + 2] = f.o[2] + f.side[2] * a + f.up[2] * b;
      }
      const tris = new Uint32Array(capTris.length * 3);
      let k = 0;
      for (const [a, b, c] of capTris) {
        if (reverse) { tris[k++] = a; tris[k++] = c; tris[k++] = b; }
        else { tris[k++] = a; tris[k++] = b; tris[k++] = c; }
      }
      return { verts, tris };
    };
    patches.push(capPatch(frames[0], true));       // start cap (-tangent)
    patches.push(capPatch(frames[N - 1], false));  // end cap (+tangent)
  }

  return weldAndBuild(patches);
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
  // Remap triangles AND drop any the position-weld collapsed: when two of a
  // triangle's corners merge to the same vertex (a≡b, b≡c or a≡c) the triangle
  // is a zero-area degenerate spike. Manifold can OOB-crash the WASM core on
  // such soup (Rule 25) — and the crash corrupts the singleton so EVERY later
  // bake fails. Dropping them here is a no-op for a clean mesh (a valid mesh has
  // none) and protects every welded primitive, not just one engine.
  const keptTris: number[] = [];
  for (let n = 0; n < allT.length; n += 3) {
    const a = remap[allT[n]], b = remap[allT[n + 1]], c = remap[allT[n + 2]];
    if (a === b || b === c || a === c) continue; // weld-collapsed → drop
    keptTris.push(a, b, c);
  }
  const newTris = Uint32Array.from(keptTris);
  const verts3 = new Float32Array(newPos);

  // NaN/Inf guard: a non-finite vertex coordinate (a divide-by-zero / bad fn at
  // a parameter boundary) reaches the WASM Mesh constructor as garbage and can
  // OOB-crash + corrupt the core. Fail with a CLEAN, catchable error instead —
  // the loader turns it into a 400, the singleton stays healthy.
  for (let n = 0; n < verts3.length; n++) {
    if (!Number.isFinite(verts3[n])) {
      throw new Error('weldAndBuild: non-finite vertex coordinate (NaN/Inf) — refusing to build (would corrupt the Manifold core)');
    }
  }

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
