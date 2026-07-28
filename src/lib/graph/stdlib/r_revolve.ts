/**
 * r_revolve — function-first surface of revolution (welded method).
 *
 * STANDARD-LIBRARY PRIMITIVE. This is a git-tracked, type-checked stdlib
 * primitive (src/lib/graph/stdlib/), NOT a volume part — it is canonical here
 * and read-only in the GUI. The src/server resolver (primitive-paths /
 * /api/primitives/source) serves stdlib primitives BEFORE the volume, and
 * /api/primitives/save refuses to write them (edit here + redeploy).
 *
 * Revolves a profile FUNCTION 360° around the z-axis. The profile is supplied
 * PARAMETRICALLY — pick a profile function (cylinder, tube, cone, …) with the
 * profile selector and its params lift onto the part. resolveProfile({ kind,
 * params }) collapses the descriptor to an (r, z) point loop at bake/preview
 * time; there is NO hand-edited vertex polygon. Edges that touch the axis
 * (r ≈ 0) cap with a triangle fan, so a profile that starts + ends on the axis
 * gives a solid lathe shape. weldAndBuild auto-corrects orientation, so the
 * profile's winding direction doesn't matter.
 *
 * Z-DOWN: the profile's z is the drilling axis — z=0 is the TOP of the part,
 * larger z is DEEPER (toward the bottom). Default is a solid cylinder
 * (r = 1.2, len = 3).
 *
 * NOTE: the imports below give this module real type-checking at build. At
 * RUNTIME the primitive sandbox strips imports and injects resolveProfile /
 * revolveProfile / weldAndBuild by name (see primitive-loader.ts +
 * primitive-sandbox.ts), so the function executes identically to a volume part.
 */
import { resolveProfile } from '$lib/shared/profiles/profile-presets';
import { revolveProfile, weldAndBuild } from '$lib/engines/manifold/manifold-mesh';
// CURVATURE-ADAPTIVE profile densifier (the SHARED κ→Δz model — planAxialStations
// under the hood, the exact function TrueForm's executor uses). Type-checked here;
// at RUNTIME the sandbox strips this import and injects `densifyProfileAxial` by
// name (see primitive-sandbox.ts), same as revolveProfile / weldAndBuild above.
import { densifyProfileAxial } from '$lib/engines/manifold/warp-spline';

export const meta = {
  id: 'r_revolve',
  name: 'r_revolve',
  description:
    'Function-first surface of revolution (welded method) — revolve a profile FUNCTION 360° around the z-axis. Pick a profile function with the selector; its params lift onto the part. r = radial (≥0), z = axial (Z-down: z=0 top, larger z deeper).',
  tags: ['welded', 'revolution', 'lathe', 'profile', 'function', 'stdlib'],
  params: {
    profile: {
      label: 'profile',
      // FUNCTION profile — a { kind, params } descriptor resolved at bake time
      // (NOT a hand-edited vertex polygon). type:'profile' tells the builder to
      // show the profile selector + lifted params, never a vertex grid.
      type: 'profile',
      yDown: true,
      hLabel: 'r →',
      vLabel: 'z ↓',
      default: { kind: 'cylinder', params: { r: 1.2, len: 3 } },
    },
    segments: { label: 'segments', min: 3, max: 256, step: 1, default: 96 },
    // OPT-IN axial (Z) resolution. 0 = OFF → byte-identical coarse revolve
    // (only the profile's own z-rings — top + bottom on a straight wall). ≥1
    // subdivides the side wall into ~N axial RINGS spread across the profile's
    // full Z-span, so the tube is (a) SMOOTHER along its length and (b)
    // WARP-ABLE: a straight-wall revolve otherwise has just top+bottom rings →
    // nothing for Manifold.warp to bend → it collapses. The inserted points are
    // COLLINEAR on the original edges, so bbox + volume are UNCHANGED — only
    // denser. Existing consumers call r_revolve(profile, segments) with no third
    // arg → 0 → output is byte-identical (Rule 21: 12 consumers, back-compat).
    zSegments: { label: 'z-segments', min: 0, max: 256, step: 1, default: 0 },
    // OPT-IN DEVIATION PATH — the "deviated well tube". A control-point path
    // that bends the revolved tube's AXIS laterally so it follows a curved
    // trajectory (vertical then kick-off, etc.) while KEEPING the circular
    // cross-section (radius preserved). Points are `[x, y, z]` (offset x,y at
    // depth z) or bare `[x, y]` (spread evenly across the profile's Z-span).
    // For each axial ring at height z we translate its whole center by the
    // path's interpolated [x,y] at that z — a PLANAR per-Z shift, NOT a rotated
    // frame, so the caps stay axis-perpendicular (dodges the tilted-coincident-
    // cap "defect-2" class that curved sweep − sweep hits). A fully general
    // curved-FRAME sweep (rings rotate to stay normal to the tangent) is still
    // r_sweep's job; this is the pragmatic deviated revolve for wells. A
    // straight / absent path → NO offset → identical to the plain revolve.
    // Giving a path implies axial resolution: if zSegments is 0 we auto-pick a
    // sensible ring density (~path length / 1 unit, floor 32) so the bend is
    // smooth, not faceted. default:null keeps every existing consumer untouched.
    axisPath: { label: 'deviation path', type: 'expr', default: null },
  },
  material: {
    outer: { color: '#5f7d8a', metallic: 0.6, roughness: 0.4 },
    inner: { color: '#3a3a3a', metallic: 0.1, roughness: 0.9 },
  },
};

export function r_revolve(profile: any, segments: number, zSegments?: number, axisPath?: any): any {
  // GUI passes the resolved profile as a JSON points string; direct/programmatic
  // callers may pass a { kind, params } descriptor, a { points } object, or a
  // raw [[r,z]] array — resolveProfile handles all of those (and passes raw
  // arrays straight through, so legacy r_revolve(points) callers still work).
  const pts: [number, number][] =
    typeof profile === 'string' ? JSON.parse(profile) : resolveProfile(profile);
  const seg = Math.max(3, Math.floor(segments) || 64); // 3 = triangular prism (was floored at 8 → "4 showed 8")

  // ── DEVIATION PATH (the deviated well tube) ─────────────────────────────────
  // Parse the opt-in axisPath into a z-sorted list of [z,dx,dy] knots. `null` /
  // undefined / empty / a degenerate single point → no deviation (dev === null),
  // so back-compat callers (r_revolve(profile, segments[, zSegments])) are byte-
  // identical. A knot is either [x,y,z] (offset at depth z) or [x,y] (spread
  // evenly across the profile's Z-span). We offset each ring's CENTER by the
  // path's interpolated [dx,dy] at that ring's z — a planar shear that preserves
  // the circular cross-section (radius) and keeps caps axis-perpendicular.
  let dev: { zs: number[]; xs: number[]; ys: number[] } | null = null;
  {
    let raw: any = axisPath;
    if (typeof raw === 'string') { const t = raw.trim(); raw = t ? JSON.parse(t) : null; }
    if (Array.isArray(raw) && raw.length >= 2 && Array.isArray(pts) && pts.length >= 2) {
      let zmin = Infinity, zmax = -Infinity;
      for (const p of pts) { const z = p[1]; if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
      const zspan = zmax - zmin;
      const knots: [number, number, number][] = raw.map((c: any, i: number): [number, number, number] => {
        const arr = Array.isArray(c) ? c : [0, 0];
        const x = Number(arr[0]) || 0;
        const y = Number(arr[1]) || 0;
        // 3-tuple → z is explicit; 2-tuple → spread evenly over the profile's Z-span.
        const z = arr.length >= 3 && Number.isFinite(Number(arr[2]))
          ? Number(arr[2])
          : zmin + (zspan * i) / (raw.length - 1);
        return [z, x, y];
      });
      knots.sort((a, b) => a[0] - b[0]);
      // A path that never actually moves laterally is a no-op → skip (identical output).
      const moves = knots.some((k) => Math.abs(k[1]) > 1e-9 || Math.abs(k[2]) > 1e-9);
      if (moves) {
        dev = { zs: knots.map((k) => k[0]), xs: knots.map((k) => k[1]), ys: knots.map((k) => k[2]) };
      }
    }
  }
  // A deviation path IMPLIES axial resolution: with only top+bottom rings a bend
  // would be a single faceted chord. If the caller left zSegments at 0, auto-pick
  // a ring-count CAP from the path's own length (~1 unit/segment, floored at 32,
  // capped at 256). This bounds the curvature-adaptive station count below so a
  // very long survey can't over-refine — the stations themselves are placed by
  // curvature (dense at bends, sparse on straight), not uniformly.
  let zSegEff = zSegments;
  if (dev && (!zSegEff || zSegEff < 1)) {
    let len = 0;
    for (let i = 1; i < dev.zs.length; i++) {
      const dz = dev.zs[i] - dev.zs[i - 1];
      const dx = dev.xs[i] - dev.xs[i - 1];
      const dy = dev.ys[i] - dev.ys[i - 1];
      len += Math.hypot(dx, dy, dz);
    }
    zSegEff = Math.max(32, Math.min(256, Math.ceil(len)));
  }

  // OPT-IN axial (Z) segmentation (Rule 25 — build-time, on the 2D profile,
  // NEVER a post-bake MeshGL rewrite). Two ways in:
  //
  //  • DEVIATION PATH present → CURVATURE-ADAPTIVE. Insert rings at the SHARED
  //    κ→Δz stations (densifyProfileAxial → planAxialStations): dense where the
  //    trajectory bends, SPARSE on straight tangents — the exact model TrueForm's
  //    executor uses for a revolve-tree warp child (tf_examples/execute.ts,
  //    densifyRevolveTree). The axisPath IS the curvature spline (its [x,y,z]
  //    knots align with the profile z), so a vertical-then-kick-off well clusters
  //    its rings at the dogleg instead of wasting a uniform ~32 on the straight
  //    run. densifyProfileAxial is sandbox-injected (unlike subdivideProfileAxial),
  //    so this stdlib engine CALLS the shared model rather than re-deriving it.
  //
  //  • No path, explicit zSegments ≥ 1 → UNIFORM. Insert COLLINEAR interior points
  //    so the side wall gains ~zSegments evenly-spaced axial RINGS across the
  //    profile's full Z-span (a straight tube has no curvature to cluster on, so
  //    even spacing is right AND keeps this back-compat path byte-identical).
  //
  // Every inserted point sits exactly on the original straight edge → the revolved
  // solid is geometrically IDENTICAL (same bbox + volume), just denser along Z, so
  // a later Manifold.warp bends it smoothly instead of collapsing a top/bottom-only
  // ring pair. No path AND zSegments falsy/< 1 → `pts` passes through untouched →
  // byte-identical to the pre-change revolve (Rule 21: 12 consumers).
  let prof = pts;
  if (dev) {
    // The deviation path IS the curvature spline — its knots [x,y,z] follow the
    // same curve the per-vertex shear below applies. densifyProfileAxial measures
    // that curvature and clusters the profile's axial rings at the bends; a
    // straight (no-curvature) path just gets the shared model's minStations
    // baseline. Bounded by the auto ring count (`zSegEff`) so a very long survey
    // can't over-refine. `dense.length > pts.length` guards the straight/no-op case.
    const cp = dev.zs.map((z, i): [number, number, number] => [dev.xs[i], dev.ys[i], z]);
    const cap = Math.max(2, Math.floor(Number(zSegEff) || 32));
    const dense = densifyProfileAxial(pts, cp, { maxStations: cap });
    if (Array.isArray(dense) && dense.length > pts.length) prof = dense;
  } else {
    const zn = Math.floor(Number(zSegEff) || 0);
    if (zn >= 1 && Array.isArray(pts) && pts.length >= 2) {
      let zmin = Infinity, zmax = -Infinity;
      for (const p of pts) { const z = p[1]; if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
      const span = zmax - zmin;
      if (span > 0) {
        const maxZSpan = span / zn; // ⇒ a full-span side edge gets ~zn slices
        const cap = Math.max(zn, 1); // let one full-span edge reach zn splits
        const dense: [number, number][] = [];
        const N = pts.length;
        for (let k = 0; k < N; k++) {
          const [r0, z0] = pts[k];
          const [r1, z1] = pts[(k + 1) % N]; // walk the CLOSED loop (last→first too)
          dense.push([r0, z0]); // edge start — the unique loop vert
          const n = Math.min(cap, Math.max(1, Math.ceil(Math.abs(z1 - z0) / maxZSpan)));
          for (let s = 1; s < n; s++) {
            const t = s / n; // linear in BOTH r and z → point stays on the edge
            dense.push([r0 + (r1 - r0) * t, z0 + (z1 - z0) * t]);
          }
        }
        prof = dense;
      }
    }
  }
  const patch = revolveProfile(prof, seg);

  // ── Apply the deviation: shift every vertex's [x,y] by the path offset at its
  // own z. Because the offset is a pure function of z, all verts sharing a ring
  // (same r,θ,z) move together → the circular section is rigidly translated, not
  // scaled (radius preserved), and weld-by-position still coalesces coincident
  // ring verts. No deviation → patch is returned untouched (byte-identical). ────
  if (dev) {
    const v = patch.verts; // Float32Array, [x,y,z, x,y,z, …]
    const { zs, xs, ys } = dev;
    const last = zs.length - 1;
    for (let i = 0; i < v.length; i += 3) {
      const z = v[i + 2];
      let dx: number, dy: number;
      if (z <= zs[0]) { dx = xs[0]; dy = ys[0]; }         // clamp below the path
      else if (z >= zs[last]) { dx = xs[last]; dy = ys[last]; } // clamp above
      else {
        // linear interpolation in z between the bracketing knots
        let j = 1;
        while (j <= last && zs[j] < z) j++;
        const t = (z - zs[j - 1]) / (zs[j] - zs[j - 1] || 1);
        dx = xs[j - 1] + (xs[j] - xs[j - 1]) * t;
        dy = ys[j - 1] + (ys[j] - ys[j - 1]) * t;
      }
      v[i] += dx;
      v[i + 1] += dy;
    }
  }

  return weldAndBuild([patch]);
}
