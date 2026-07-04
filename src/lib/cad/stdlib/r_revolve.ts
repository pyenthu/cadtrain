/**
 * r_revolve — function-first surface of revolution (welded method).
 *
 * STANDARD-LIBRARY PRIMITIVE. This is a git-tracked, type-checked stdlib
 * primitive (src/lib/cad/stdlib/), NOT a volume part — it is canonical here
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
import { resolveProfile } from '$lib/shared/profile-presets';
import { revolveProfile, weldAndBuild } from '$lib/cad/manifold-mesh';

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
  },
  material: {
    outer: { color: '#5f7d8a', metallic: 0.6, roughness: 0.4 },
    inner: { color: '#3a3a3a', metallic: 0.1, roughness: 0.9 },
  },
};

export function r_revolve(profile: any, segments: number, zSegments?: number): any {
  // GUI passes the resolved profile as a JSON points string; direct/programmatic
  // callers may pass a { kind, params } descriptor, a { points } object, or a
  // raw [[r,z]] array — resolveProfile handles all of those (and passes raw
  // arrays straight through, so legacy r_revolve(points) callers still work).
  const pts: [number, number][] =
    typeof profile === 'string' ? JSON.parse(profile) : resolveProfile(profile);
  const seg = Math.max(3, Math.floor(segments) || 64); // 3 = triangular prism (was floored at 8 → "4 showed 8")

  // OPT-IN axial (Z) segmentation (Rule 25 — build-time, on the 2D profile,
  // NEVER a post-bake MeshGL rewrite). When zSegments ≥ 1, densify the (r,z)
  // profile along Z BEFORE the revolve: insert COLLINEAR interior points so the
  // side wall gains ~zSegments axial RINGS across the profile's full Z-span.
  // Because every inserted point sits exactly on the original straight edge the
  // revolved solid is geometrically IDENTICAL (same bbox + volume) — just denser
  // along Z — so the tube looks smoother AND a later Manifold.warp bends it as a
  // smooth curve instead of collapsing a top-only/bottom-only ring pair.
  //
  // This mirrors manifold-mesh's `subdivideProfileAxial`, but INLINED: that
  // helper is a max-Z-SPAN dial (a module global set by the warp-preview path)
  // and is NOT one of the names the primitive sandbox injects, so an stdlib
  // engine can't import it at runtime — the logic lives here as a self-contained
  // closure. zSegments falsy / undefined / < 1 → `pts` passes through untouched
  // → byte-identical to the pre-change revolve (Rule 21: 12 consumers).
  let prof = pts;
  const zn = Math.floor(Number(zSegments) || 0);
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
  return weldAndBuild([revolveProfile(prof, seg)]);
}
