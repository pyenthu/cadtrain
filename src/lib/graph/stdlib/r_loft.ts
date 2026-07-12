/**
 * r_loft — extrude a 2D cross-section along z while SCALING it by a smooth
 * profile-along-length (s-curve / barrel / waist / flare) plus twist.
 *
 * This is the shape class `r_weld_extrude` CANNOT make: its Manifold
 * `CrossSection.extrude(h, divs, twist, scaleTop)` only does a LINEAR top↔bottom
 * scale (the "taper"). A vase bulge, a barrel, a necked-down sub, swaged
 * tubing — anything whose radius varies *smoothly* along the length — needs a
 * per-slice scale baked into the vertex positions. That's what this does.
 *
 * APPROACH (per the 2026-05-28 bench guidance, memory `bench_extrude_findings`):
 * bake the per-slice transform into vertex positions at CONSTRUCTION time via
 * the welded-mesh toolkit (`gridPatch` side wall + origin-fan caps +
 * `weldAndBuild`), NOT as a `Manifold.warp` post-pass (refineToLength + warp is
 * 4× slower and balloons the downstream cutaway CSG).
 *
 * The cross-section at normalized height t ∈ [0,1] (t=0 → top face z=0,
 * t=1 → bottom face z=length, Z-down) is:
 *     scale θ → s(t) · Rot(twist·t) · profile
 * so each side vertex is `[ s·(x·cosθ − y·sinθ), s·(x·sinθ + y·cosθ), t·length ]`.
 *
 * `shape` selects the s(t) curve (amplitude = `bulge`):
 *   barrel  s = 1 + bulge·sin(π t)     fat middle  (vase / barrel)   [default]
 *   waist   s = 1 − bulge·sin(π t)     thin middle (hourglass)
 *   flare   s = 1 + bulge·t            linear, wide bottom
 *   ogive   s = 1 − bulge·t²           curved taper to a nose
 *   scurve  s = 1 + bulge·(½−½cos(π·smoothstep(t)))·sign — smooth S between ends
 * s is floored at 0.02 so a big bulge can't collapse a slice.
 *
 * Z-DOWN: extrudes from z=0 (TOP) to z=length (BOTTOM), same as r_weld_extrude.
 *
 * STANDARD-LIBRARY PRIMITIVE — git-tracked, read-only in the GUI. The imports
 * below give real type-checking; at runtime the sandbox strips them and injects
 * `gridPatch` / `weldAndBuild` / `resample` / `resolveProfile` by name.
 */
import { resolveProfile } from '$lib/shared/profiles/profile-presets';
import { resample } from '$lib/graph/csg-2d';
import { gridPatch, weldAndBuild, type Patch } from '$lib/engines/manifold/manifold-mesh';

export const meta = {
  id: 'r_loft',
  name: 'r_loft',
  description:
    'Loft extrusion — sweep a 2D cross-section down z while scaling it by a smooth profile-along-length (barrel / waist / flare / ogive / s-curve) plus twist. The tool for vase bulges, barrels, necked subs, swaged tubing — radius varying smoothly along the length, which r_weld_extrude (linear taper only) cannot do.',
  tags: ['loft', 'extrude', 'bulge', 'barrel', 'vase', 'sweep', 'twist', 'stdlib'],
  params: {
    profile: {
      label: 'profile',
      type: 'profile',
      default: { kind: 'ngon', params: { n: 24, r: 0.8 } },
    },
    length:  { label: 'length', min: 0.1, max: 40, step: 0.1, default: 6 },
    divs:    { label: 'divs',   min: 2,   max: 128, step: 1,  default: 48 },
    twist:   { label: 'twist (°)', min: -360, max: 360, step: 5, default: 0 },
    bulge:   { label: 'bulge', min: -0.9, max: 2.0, step: 0.05, default: 0.4 },
    shape:   {
      label: 'shape', type: 'enum',
      options: ['barrel', 'waist', 'flare', 'ogive', 'scurve'],
      default: 'barrel',
    },
    segments: { label: 'segments', min: 4, max: 256, step: 1, default: 48 },
  },
  material: {
    outer: { color: '#c08a3e', metallic: 0.5, roughness: 0.45 },
    inner: { color: '#3a3a3a', metallic: 0.1, roughness: 0.9 },
  },
};

export function r_loft(
  profile: any,
  length: number,
  divs: number,
  twist: number,
  bulge: number,
  shape?: string,
  segments?: number,
): any {
  const raw: [number, number][] =
    typeof profile === 'string' ? JSON.parse(profile) : resolveProfile(profile);
  if (!Array.isArray(raw) || raw.length < 3) throw new Error('profile needs ≥ 3 points');
  // Densify the perimeter (a circle given as 8 points should loft round).
  const pts = resample(raw, Number(segments ?? 0));

  // Normalize to CCW (positive signed area) so the side-wall winding below is
  // OUTWARD-facing (positive Manifold volume). Mirror r_weld_extrude's check.
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  const prof = area < 0 ? [...pts].reverse() : pts;

  const P = prof.length;
  const h = Math.max(0.01, length);
  const nDiv = Math.max(2, Math.min(128, Math.round(divs)));
  const tw = (Number(twist) || 0) * Math.PI / 180;
  const amp = Number(bulge) || 0;

  const smoothstep = (x: number) => x * x * (3 - 2 * x);
  const scaleAt = (t: number): number => {
    let s: number;
    switch (shape) {
      case 'waist':  s = 1 - amp * Math.sin(Math.PI * t); break;
      case 'flare':  s = 1 + amp * t; break;
      case 'ogive':  s = 1 - amp * t * t; break;
      case 'scurve': s = 1 + amp * (smoothstep(t) - 0.5); break;
      case 'barrel':
      default:       s = 1 + amp * Math.sin(Math.PI * t); break;
    }
    return Math.max(0.02, s);
  };

  // Place a cross-section vertex k at normalized height t.
  const place = (k: number, t: number): [number, number, number] => {
    const [x, y] = prof[k]!;
    const s = scaleAt(t);
    const th = tw * t;
    const ct = Math.cos(th), st = Math.sin(th);
    return [s * (x * ct - y * st), s * (x * st + y * ct), t * h];
  };

  // SIDE WALL: u walks z (0→length), v walks the closed perimeter. vN = P so
  // gridPatch's column P wraps back onto column 0 (welded away).
  const side: Patch = gridPatch(nDiv, P, (u, v) => {
    const k = Math.round(v * P) % P;
    return place(k, u);
  });

  // CAPS: origin-fan triangulation (robust for the origin-star-convex r(θ)
  // profiles we author — a plain vertex-0 fan breaks on non-convex stars).
  // A center vertex at the axis + one triangle per perimeter edge. Top and
  // bottom are wound opposite so both face outward.
  const capPatch = (t: number, reverse: boolean): Patch => {
    const verts = new Float32Array((P + 1) * 3);
    verts[0] = 0; verts[1] = 0; verts[2] = t * h; // axis center
    for (let k = 0; k < P; k++) {
      const p = place(k, t);
      verts[(k + 1) * 3] = p[0]; verts[(k + 1) * 3 + 1] = p[1]; verts[(k + 1) * 3 + 2] = p[2];
    }
    const tris = new Uint32Array(P * 3);
    let i = 0;
    for (let k = 0; k < P; k++) {
      const a = 1 + k, b = 1 + ((k + 1) % P);
      if (reverse) { tris[i++] = 0; tris[i++] = b; tris[i++] = a; }
      else         { tris[i++] = 0; tris[i++] = a; tris[i++] = b; }
    }
    return { verts, tris };
  };

  // Cap winding must OPPOSE the side wall along the shared perimeter edge or
  // the edge is traversed the same way twice → "Not manifold". The side wall's
  // top row walks each perimeter edge k→k+1, so the top cap must walk k+1→k
  // (reverse=true); the bottom row walks k+1→k, so the bottom cap walks k→k+1
  // (reverse=false). This also yields POSITIVE volume (outward) for a CCW prof.
  const top = capPatch(0, true);
  const bot = capPatch(1, false);

  return weldAndBuild([side, top, bot]);
}
