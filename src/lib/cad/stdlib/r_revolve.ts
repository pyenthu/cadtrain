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
  },
  material: {
    outer: { color: '#5f7d8a', metallic: 0.6, roughness: 0.4 },
    inner: { color: '#3a3a3a', metallic: 0.1, roughness: 0.9 },
  },
};

export function r_revolve(profile: any, segments: number): any {
  // GUI passes the resolved profile as a JSON points string; direct/programmatic
  // callers may pass a { kind, params } descriptor, a { points } object, or a
  // raw [[r,z]] array — resolveProfile handles all of those (and passes raw
  // arrays straight through, so legacy r_revolve(points) callers still work).
  const pts: [number, number][] =
    typeof profile === 'string' ? JSON.parse(profile) : resolveProfile(profile);
  const seg = Math.max(3, Math.floor(segments) || 64); // 3 = triangular prism (was floored at 8 → "4 showed 8")
  return weldAndBuild([revolveProfile(pts, seg)]);
}
