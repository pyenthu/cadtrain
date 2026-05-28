/**
 * r_weld_extrude — RAIL-WELDED extrusion. K.50 sub-step (b).
 *
 * Replaces `Manifold.extrude` with the gridPatch + cap-fan + weldAndBuild
 * machinery used by `r_revolve`. The point isn't speed — it's that the cross-
 * section can MORPH along z (twist + taper baked in here; arbitrary per-v
 * transforms once the GUI exposes them) WITHOUT needing the warp post-pass
 * that K.13 was parked on.
 *
 * Side surface: gridPatch with u = around-section, v = along-z. fn(u, v)
 * looks up profile[u·N], rotates it by (twist · v), scales by (1 + taper · v),
 * and places it at z = v · length. weldAndBuild merges the wrap-around seam.
 *
 * End caps: triangle fans from the transformed profile centroid at z=0 and
 * z=length. Convex profiles only for the cap fan (a concave outline would
 * leak); use `r_extrude` (Manifold.extrude + CrossSection tessellator) for
 * non-convex cross-sections.
 *
 * Z-DOWN: extrudes from z=0 (TOP face) down to z=length (BOTTOM). Default is
 * a hex with a 30° twist over length 2 — visually obvious that this is NOT
 * Manifold.extrude.
 *
 * STANDARD-LIBRARY PRIMITIVE — git-tracked, read-only in the GUI. The
 * imports below are stripped at sandbox eval; the sandbox injects
 * resolveProfile / gridPatch / weldAndBuild / G by name.
 */
import { resolveProfile } from '$lib/shared/profile-presets';
import { gridPatch, weldAndBuild, type Patch } from '../manifold-mesh';

declare const G: any;

export const meta = {
  id: 'r_weld_extrude',
  name: 'r_weld_extrude',
  description:
    'Rail-welded extrusion — cross-section morphs along z (twist + taper) without a warp post-pass. Right tool for twisted bars, tapered prisms, helical wear pads. Convex profiles only (the cap fan needs convex).',
  tags: ['extrude', 'weld', 'twist', 'taper', 'parametric', 'sweep', 'stdlib'],
  params: {
    profile: {
      label: 'profile',
      type: 'profile',
      default: { kind: 'ngon_v2', params: { n: 6, r: 0.6 } },
    },
    length: { label: 'length', min: 0.1, max: 20, step: 0.1, default: 2 },
    zSteps: { label: 'z steps',  min: 2,   max: 96, step: 1,   default: 12 },
    twist:  { label: 'twist (°)', min: -360, max: 360, step: 5,   default: 30 },
    taper:  { label: 'taper',     min: -0.5, max: 0.5, step: 0.05, default: 0 },
  },
  material: {
    outer: { color: '#ff7a00', metallic: 0.6, roughness: 0.4 },
    inner: { color: '#3a3a3a', metallic: 0.1, roughness: 0.9 },
  },
};

export function r_weld_extrude(
  profile: any,
  length: number,
  zSteps: number,
  twist: number,
  taper: number,
): any {
  const pts: [number, number][] =
    typeof profile === 'string' ? JSON.parse(profile) : resolveProfile(profile);
  if (!Array.isArray(pts) || pts.length < 3) throw new Error('profile needs ≥ 3 points');
  const wasm = G.__cadtrain_manifold__.wasm;
  if (!wasm) throw new Error('manifold not initialised — call initManifold() first');

  // CCW polygon → outward-facing solid (positive volume). Match r_extrude.
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  const loop: [number, number][] = area < 0 ? [...pts].reverse() : pts;
  const N = loop.length;
  const V = Math.max(2, Math.round(zSteps));
  const twistRad = (twist * Math.PI) / 180;
  const L = Math.max(0.01, length);

  // Per-(u,v) transform — twist, taper, and z placement in ONE place so the
  // side surface and the two end caps stay in lockstep.
  function pointAt(idx: number, vNorm: number): [number, number, number] {
    const [px, py] = loop[idx]!;
    const ang = twistRad * vNorm;
    const scale = 1 + taper * vNorm;
    const c = Math.cos(ang), s = Math.sin(ang);
    return [(px * c - py * s) * scale, (px * s + py * c) * scale, vNorm * L];
  }

  // Side: gridPatch sampling on (uN+1) × (vN+1) verts. u walks AROUND the
  // section (N samples + wrap; the wrap vertex coincides with u=0 and welds
  // away in weldAndBuild). v walks ALONG z.
  const side: Patch = gridPatch(N, V - 1, (u, v) => {
    const idx = Math.round(u * N) % N;
    return pointAt(idx, v);
  });

  // End cap — triangle fan from the transformed centroid.
  function makeCap(vNorm: number, faceUp: boolean): Patch {
    let cx = 0, cy = 0, cz = 0;
    const ring: [number, number, number][] = [];
    for (let i = 0; i < N; i++) {
      const pt = pointAt(i, vNorm);
      ring.push(pt);
      cx += pt[0]; cy += pt[1]; cz += pt[2];
    }
    cx /= N; cy /= N; cz /= N;
    const verts = new Float32Array((N + 1) * 3);
    verts[0] = cx; verts[1] = cy; verts[2] = cz;
    for (let i = 0; i < N; i++) {
      verts[(i + 1) * 3 + 0] = ring[i]![0];
      verts[(i + 1) * 3 + 1] = ring[i]![1];
      verts[(i + 1) * 3 + 2] = ring[i]![2];
    }
    const tris = new Uint32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = i + 1;
      const b = (i + 1) % N + 1;
      // faceUp = top (z=L, normal +z, CCW from above)
      // !faceUp = bottom (z=0, normal -z, CCW from below means CW from above)
      if (faceUp) { tris[i * 3 + 0] = 0; tris[i * 3 + 1] = a; tris[i * 3 + 2] = b; }
      else        { tris[i * 3 + 0] = 0; tris[i * 3 + 1] = b; tris[i * 3 + 2] = a; }
    }
    return { verts, tris };
  }

  const bottomCap = makeCap(0, false);
  const topCap = makeCap(1, true);
  return weldAndBuild([side, bottomCap, topCap]);
}
