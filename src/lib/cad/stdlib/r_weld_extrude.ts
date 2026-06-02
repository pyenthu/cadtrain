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
 * face). Default = ngon (6-sided) hex profile + 30° twist over length 2
 * — visually unmistakable that it's NOT plain r_extrude. (Earlier default
 * used `ngon_v2` — a volume-only profile — which the client `resolveProfile`
 * can't resolve synchronously; only curated kinds belong as stdlib defaults.)
 *
 * STANDARD-LIBRARY PRIMITIVE — git-tracked, read-only in the GUI.
 */
import { resolveProfile } from '$lib/shared/profile-presets';
// `resample` lives in cad/csg-2d and is also sandbox-injected for volume parts.
// Importing here gives r_weld_extrude its own perimeter-densification path so
// the smoothness/normal experiment works the same way r_extrude callers do.
import { resample } from '$lib/cad/csg-2d';

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
      default: { kind: 'ngon', params: { n: 6, r: 0.6 } },
    },
    length: { label: 'length', min: 0.1, max: 20, step: 0.1, default: 2 },
    divs:   { label: 'divs',   min: 1,   max: 96, step: 1,   default: 12 },
    twist:  { label: 'twist (°)', min: -360, max: 360, step: 5,    default: 30 },
    taper:  { label: 'taper',     min: -0.9, max: 2.0, step: 0.05, default: 0 },
    // Perimeter resampling — densifies the input profile to N points before
    // extruding. Critical for twist: more side vertices → smaller non-planar
    // quads → less per-triangle normal artifact under flatShading. Same dial
    // r_extrude + the volume extrude parts expose; added here so r_weld_extrude
    // gets the same smoothness experiment.
    segments: { label: 'segments', min: 4, max: 256, step: 1, default: 32 },
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
  segments?: number,
): any {
  const raw: [number, number][] =
    typeof profile === 'string' ? JSON.parse(profile) : resolveProfile(profile);
  if (!Array.isArray(raw) || raw.length < 3) throw new Error('profile needs ≥ 3 points');
  // Perimeter resample BEFORE the CCW check + extrude. Legacy callers (no
  // segments arg) get `undefined`, resample() passes through with no work. New
  // GUI callers supply p.segments and the profile is densified.
  const pts = resample(raw, Number(segments ?? 0));
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
  // Branch matrix on (twist, taper). Uses CrossSection.extrude's NATIVE
  // scaleTop parameter — the cross-section is multiplied by [sx, sy] at
  // the top slice and linearly interpolated to (1, 1) at the bottom. We
  // pass the Vec2 `[1 + taper, 1 + taper]` (not the scalar form — the
  // scalar+warp combo collapses the top in manifold-3d 3.4.1; memory:
  // manifold_extrude_scaletop_warp_bug). No warp post-pass, so the
  // collapse-with-warp boundary case doesn't apply.
  //
  //   tw == 0, tp == 0   → bare extrude(h). No morph at all.
  //   tw == 0, tp != 0   → extrude(h, 1, 0, [s, s]). Single slice top-to-bottom
  //                        keyed off scaleTop only; nDivisions = 1 + non-1
  //                        scaleTop means slices aren't coincident so the
  //                        twist=0 degeneracy bug doesn't trigger.
  //   tw != 0, tp == 0   → extrude(h, divs, twist). Twist morph only.
  //   both               → extrude(h, divs, twist, [s, s]). One pass.
  //
  // Sign convention: taper > 0 flares (bottom wider), taper < 0 narrows
  // (classic shaft taper). Clamp s to a small positive floor so dialing
  // taper near -1 doesn't collapse the bottom to zero.
  const tw = Math.abs(twist);
  const tp = Math.abs(taper);
  const s = Math.max(0.001, 1 + taper);
  if (tw < 0.001 && tp < 0.001) {
    void divs;
    return new CS([loop]).extrude(h);
  }
  if (tw < 0.001) {
    // Taper-only path. nDivisions = 1 keeps the morph shallow but
    // present, avoiding both the coincident-slice bug and unnecessary
    // intermediate triangles when there's no twist.
    return new CS([loop]).extrude(h, 1, 0, [s, s] as any);
  }
  const nDiv = Math.max(1, Math.min(96, Math.round(divs)));
  if (tp < 0.001) {
    return new CS([loop]).extrude(h, nDiv, twist);
  }
  return new CS([loop]).extrude(h, nDiv, twist, [s, s] as any);
}
