/**
 * r_extrude — function-first linear extrusion (prism).
 *
 * STANDARD-LIBRARY PRIMITIVE. Git-tracked, type-checked stdlib primitive
 * (src/lib/cad/stdlib/), NOT a volume part — canonical here and read-only in
 * the GUI. Served BEFORE the volume by the resolver; /api/primitives/save
 * refuses it (edit here + redeploy).
 *
 * The right tool for prisms whose cross-section is NOT a surface of revolution:
 * hex nuts, +/T/L brackets, stars, cams. Sweeps a flat (x,y) profile straight
 * down z. Uses Manifold's CrossSection.extrude so NON-CONVEX profiles come out
 * manifold (a welded triangle-fan cap can't triangulate a concave polygon, but
 * CrossSection's tessellator can).
 *
 * FUNCTION-BASED PARAMETRIC: pick a cartesian profile FUNCTION (rect, ngon,
 * ellipse, l, t, plus, star) with the profile selector and its params lift onto
 * the part. resolveProfile({ kind, params }) collapses the descriptor to an
 * (x,y) loop at bake/preview time; there is NO hand-edited vertex polygon.
 *
 * Z-DOWN: extrudes from z=0 (the TOP face) down to z=height (the BOTTOM face),
 * matching the drilling convention. Default is a hexagon (hex-nut blank).
 *
 * NOTE: the import below gives this module real type-checking at build. At
 * RUNTIME the sandbox strips imports and injects resolveProfile + G (the
 * Manifold wasm bridge) by name (primitive-loader.ts + primitive-sandbox.ts).
 */
import { resolveProfile } from '$lib/shared/profile-presets';

// Injected by the primitive sandbox; declared only so this module type-checks
// in src (the `declare` is stripped at transpile — the sandbox binds the real G).
declare const G: any;

export const meta = {
  id: 'r_extrude',
  name: 'r_extrude',
  description:
    'Function-first linear extrusion (prism) — sweep a cartesian (x,y) profile FUNCTION straight down z. Right for hex / + / T / L / star / ellipse cross-sections (which self-intersect under revolution). Pick a profile function with the selector; its params lift onto the part. Z-down: z=0 is the top face.',
  tags: ['extrude', 'prism', 'profile', 'function', 'non-convex', 'stdlib'],
  params: {
    profile: {
      label: 'profile',
      // FUNCTION profile — a cartesian { kind, params } descriptor resolved at
      // bake time (NOT a hand-edited vertex polygon). type:'profile' tells the
      // builder to show the selector + lifted params, never a vertex grid.
      type: 'profile',
      default: { kind: 'ngon', params: { n: 6, r: 1.5 } },
    },
    height: { label: 'height', min: 0.1, max: 20, step: 0.1, default: 3 },
  },
  material: {
    outer: { color: '#ff00dd', metallic: 0.6, roughness: 0.4 },
    inner: { color: '#3a3a3a', metallic: 0.1, roughness: 0.9 },
  },
};

export function r_extrude(profile: any, height: number): any {
  // GUI passes the resolved profile as a JSON points string; direct callers may
  // pass a cartesian { kind, params } descriptor, a { points } object, or a raw
  // [[x,y]] array — resolveProfile handles all of those.
  const pts: [number, number][] =
    typeof profile === 'string' ? JSON.parse(profile) : resolveProfile(profile);
  if (!Array.isArray(pts) || pts.length < 3) throw new Error('profile needs ≥ 3 points');
  const wasm = G.__cadtrain_manifold__.wasm;
  if (!wasm) throw new Error('manifold not initialised — call initManifold() first');
  const CS = wasm.CrossSection;
  // CrossSection's Positive fill rule keeps the region with positive winding, so
  // a CW polygon would extrude empty. Force CCW (positive signed area).
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  const loop = area < 0 ? [...pts].reverse() : pts;
  return new CS([loop]).extrude(Math.max(0.01, height));
}
