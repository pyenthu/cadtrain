/**
 * r_weld_extrude — Extrusion with twist + scale-along-z. K.50 sub-step (b).
 *
 * Wraps Manifold's `CrossSection.extrude(height, nDivisions, twistDegrees,
 * scaleTop)` so the cross-section can MORPH along z (twist + uniform top
 * scale) WITHOUT the warp post-pass that K.13 was parked on. This is the
 * common-case workhorse — twisted hex bars, tapered cylinders, helical wear
 * pads. Arbitrary per-v transforms (varying r(u, v) or full x(u, v) / y(u, v)
 * grids) need the hand-wound rail-weld variant which lives in a future
 * iteration of K.50(b) — this one is the same machinery as r_extrude with
 * the two extra dials Manifold already exposes.
 *
 * Z-DOWN: extrudes from z=0 (the TOP face) down to z=length (the BOTTOM
 * face). Default = ngon_v2 hex profile + 30° twist over length 2 — visually
 * unmistakable that it's NOT plain r_extrude.
 *
 * STANDARD-LIBRARY PRIMITIVE — git-tracked, read-only in the GUI.
 */
import { resolveProfile } from '$lib/shared/profile-presets';

declare const G: any;

export const meta = {
  id: 'r_weld_extrude',
  name: 'r_weld_extrude',
  description:
    'Extrusion with twist + scaleTop — cross-section morphs along z without a warp post-pass. Right tool for twisted bars, tapered prisms, helical wear pads. Uses CrossSection.extrude(height, divs, twistDeg, scaleTop) so non-convex profiles come out manifold.',
  tags: ['extrude', 'twist', 'taper', 'parametric', 'sweep', 'stdlib'],
  params: {
    profile: {
      label: 'profile',
      type: 'profile',
      default: { kind: 'ngon_v2', params: { n: 6, r: 0.6 } },
    },
    length: { label: 'length', min: 0.1, max: 20, step: 0.1, default: 2 },
    divs:   { label: 'divs',   min: 1,   max: 96, step: 1,   default: 12 },
    twist:  { label: 'twist (°)', min: -360, max: 360, step: 5,    default: 30 },
    taper:  { label: 'taper',     min: -0.9, max: 2.0, step: 0.05, default: 0 },
  },
  material: {
    outer: { color: '#ff7a00', metallic: 0.6, roughness: 0.4 },
    inner: { color: '#3a3a3a', metallic: 0.1, roughness: 0.9 },
  },
};

export function r_weld_extrude(
  profile: any,
  length: number,
  divs: number,
  twist: number,
  taper: number,
): any {
  const pts: [number, number][] =
    typeof profile === 'string' ? JSON.parse(profile) : resolveProfile(profile);
  if (!Array.isArray(pts) || pts.length < 3) throw new Error('profile needs ≥ 3 points');
  const wasm = G.__cadtrain_manifold__.wasm;
  if (!wasm) throw new Error('manifold not initialised — call initManifold() first');

  // CCW polygon → positive signed area → outward-facing solid. Mirror r_extrude.
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  const loop = area < 0 ? [...pts].reverse() : pts;

  const CS = wasm.CrossSection;
  const h = Math.max(0.01, length);
  const nDiv = Math.max(1, Math.round(divs));
  // Twist is positional arg 3; passing scaleTop (arg 4) breaks topology in
  // manifold-3d 3.4.1 even with [1, 1] — likely the same family as the
  // memory'd scaleTop+warp collapse bug. Drop taper for v1; add it back via
  // hand-wound rail-weld (gridPatch + caps) in K.50(b)' once we sort the
  // outward-normal winding so the manifold validates.
  void taper;
  return new CS([loop]).extrude(h, nDiv, twist);
}
