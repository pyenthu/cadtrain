/**
 * r_surface — THE CONVERGED parametric-surface engine (sweep/thread end goal).
 *
 * One welded `gridPatch(Nu, Nv, fn)` over a parametric surface
 * `fn(u, v) → [x, y, z]` (u, v ∈ [0,1]), plus optional caps. This is the single
 * formulation every prior engine collapses into — revolve, extrude, helix,
 * thread, flute and lobe are all just a different `fn`:
 *
 *   • revolve:  fn(u,v) = [R(v)·cos(u·2π), R(v)·sin(u·2π), Z(v)]
 *   • extrude:  fn(u,v) = [Px(u), Py(u), v·L]
 *   • helix /   fn(u,v) = r(θ=u·2π, z=v·L) with r = baseR + tooth(frac(z·tpi − u))
 *     thread        → r_helical_surface is EXACTLY r_surface with the thread fn.
 *
 * WHY this is manifold by construction (see docs/plans/sweep-thread-engine.md
 * "⭐ THE CONVERGENCE"): the sweep axis is the surface's OWN parameters (u, v) —
 * NOT the helix / path. The mesh traversal never follows the coil, so "the
 * previous turn" is just earlier rows of the SAME grid — already welded. No
 * path frame, no torsion, no inter-turn weld, no CSG. Only the two v-ends need
 * caps. Single limitation (inherent to a single-valued surface): no undercut /
 * overhanging flanks — that stays Option 4 (swept band + CSG).
 *
 * Parameters:
 *   • fn(u, v) → [x, y, z]   the surface, u (around / along) and v (the open
 *                            axis) both in [0,1]. Supplied by the volume part —
 *                            an inline arrow or an expression-built closure.
 *   • Nu, Nv                 grid resolution. Nu = samples around the u-seam,
 *                            Nv = samples along the open v-axis. Segmentation
 *                            belongs at BUILD time (Rule 25): denser = more
 *                            triangles HERE, never a post-bake rewrite.
 *   • wrapU                  the u-direction CLOSES (a body of revolution / a
 *                            tube): fn is 2π-periodic in u so row 0 ≡ row Nu and
 *                            weldAndBuild merges the seam → it closes EXACTLY.
 *                            false → an open strip in u (no wrap weld).
 *   • capLo / capHi          triangle-fan the open v=0 / v=1 rings shut to that
 *                            ring's centroid. The ring verts re-use the SAME
 *                            fn samples as the wall edge → coincident → weld
 *                            merges them (watertight join).
 *
 * `weldAndBuild` at the end concatenates + position-welds every patch and
 * auto-corrects the GLOBAL volume sign (negative ⇒ inside-out ⇒ CSG subtract
 * would ADD), so the caller never has to wind triangles perfectly.
 *
 * Z-DOWN: pass v→z with z=0 the TOP and larger z DEEPER (down-hole), like every
 * other engine.
 *
 * NO meta.params (an empty block) ON PURPOSE: this engine's first argument is a
 * FUNCTION, which is not a GUI dial. An empty params block makes the loader's
 * signature canonicalisation a NO-OP (paramKeysOf → []), so the closure passes
 * straight through as positional arg 0 instead of being reordered/dropped by a
 * meta-keyed rewrite. Volume parts call it from their body with `meta.uses:
 * ['r_surface']`; the GUI-facing dials live on those parts (surf_revolve,
 * surf_thread, …), not here.
 *
 * STANDARD-LIBRARY PRIMITIVE — git-tracked, read-only in the GUI. Imports are
 * for type-checking only; at RUNTIME the sandbox strips them and injects
 * gridPatch / weldAndBuild by name (primitive-sandbox.ts).
 */
import { gridPatch, weldAndBuild } from '$lib/engines/manifold/manifold-mesh';
import type { Patch } from '$lib/engines/manifold/manifold-mesh';

export const meta = {
  id: 'r_surface',
  name: 'r_surface',
  description:
    'THE converged parametric-surface engine: one welded gridPatch over fn(u,v)→[x,y,z] (u,v∈[0,1]) + optional caps. Manifold by construction — revolve/extrude/helix/thread are all just a different fn (the sweep axis is the surface\'s own (u,v), the helix lives in the fn). wrapU closes the u-seam; capLo/capHi fan the open v-ends shut. No path frame, no torsion, no CSG. The first arg is a FUNCTION, so this engine is called from a part body, not GUI-dialed.',
  tags: ['welded', 'surface', 'sweep', 'revolve', 'thread', 'helix', 'parametric', 'stdlib'],
  // Empty ON PURPOSE — see the file header. The fn arg is not a dial.
  params: {},
  material: {
    outer: { color: '#7a8a3f', metallic: 0.5, roughness: 0.4 },
    inner: { color: '#3a3a3a', metallic: 0.1, roughness: 0.9 },
  },
};

export function r_surface(
  fn: (u: number, v: number) => [number, number, number],
  Nu: number,
  Nv: number,
  wrapU: boolean,
  capLo: boolean,
  capHi: boolean,
): any {
  const nU = Math.max(3, Math.floor(Nu));
  const nV = Math.max(1, Math.floor(Nv));
  const wrap = wrapU !== false;

  // ── the surface: ONE displacement/parametric gridPatch ──────────────────
  // gridPatch samples u = r/nU for r∈[0,nU] and v = c/nV for c∈[0,nV] (both
  // endpoints INCLUSIVE). When wrapU and fn is 2π-periodic in u, row 0 ≡ row
  // nU (coincident) and weldAndBuild merges them → the seam closes exactly,
  // with no special handling. When !wrapU, fn(u=0) ≠ fn(u=1) so the strip is
  // genuinely open in u (gridPatch never bridges row nU back to row 0).
  const wall = gridPatch(nU, nV, (u, v): [number, number, number] => fn(u, v));

  // ── EXACT seam closure (wrap) ───────────────────────────────────────────
  // The wrap weld assumes row nU (u=1) is byte-identical to row 0 (u=0) so the
  // two seam columns merge. But fn(1,v) and fn(0,v) are only MATHEMATICALLY
  // equal — floating-point makes them differ by ~1e-16 (e.g. sin(2π) ≠ 0, and
  // `frac(z·tpi − 1)` ≠ `frac(z·tpi − 0)` bit-for-bit). For a CONTINUOUS fn that
  // sub-ε wobble welds away, but a fn with a step DISCONTINUITY landing on the
  // seam (a Square thread tooth: tooth flips 0↔depth across `d == halfFrac`) can
  // straddle that step between u=0 and u=1 → a FULL thread-depth radial mismatch
  // at the seam → unmerged verts → boundary edges → "Not manifold", which (when
  // the degenerate mesh is fed to the core repeatedly) corrupts the WASM
  // singleton (Rule 25). Fix: overwrite the last u-row with the first u-row so
  // the seam is closed BY CONSTRUCTION, independent of fn's float behaviour. The
  // two rows are SUPPOSED to be identical, so this is geometrically a no-op for a
  // well-behaved fn (it only snaps a ≤ε difference) and is byte-identical to the
  // pre-fix weld at default resolution; it merely makes the already-intended
  // coincidence exact. capRing never samples u=1 (i < nU), so caps are unaffected.
  if (wrap && nU >= 1) {
    const stride = (nV + 1) * 3;
    const last = nU * stride;
    for (let c = 0; c < stride; c++) wall.verts[last + c] = wall.verts[c];
  }

  // ── end caps: fan the open v-ring to its centroid ───────────────────────
  // Sample the ring at the v-edge over u. For a wrapped (closed-in-u) surface
  // the ring is nU DISTINCT points (u = i/nU for i∈[0,nU); u=1 duplicates u=0);
  // the fan wraps i→(i+1)%nU. For an open surface the ring is nU+1 points and
  // the fan does NOT wrap. Either way the ring verts equal the wall's v-edge
  // verts → coincident → weld merges them; only the centroid apex is new.
  function capRing(vEdge: number, reverse: boolean): Patch {
    const distinct = wrap ? nU : nU + 1;
    const ring: Array<[number, number, number]> = new Array(distinct);
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < distinct; i++) {
      const p = fn(i / nU, vEdge);
      ring[i] = p;
      cx += p[0]; cy += p[1]; cz += p[2];
    }
    cx /= distinct; cy /= distinct; cz /= distinct;
    const verts = new Float32Array((distinct + 1) * 3);
    verts[0] = cx; verts[1] = cy; verts[2] = cz;            // centroid apex (index 0)
    for (let i = 0; i < distinct; i++) {
      verts[(i + 1) * 3]     = ring[i][0];
      verts[(i + 1) * 3 + 1] = ring[i][1];
      verts[(i + 1) * 3 + 2] = ring[i][2];
    }
    const triCount = wrap ? distinct : distinct - 1;
    const tris = new Uint32Array(triCount * 3);
    let k = 0;
    for (let i = 0; i < triCount; i++) {
      const a = 1 + i;
      const b = 1 + ((i + 1) % distinct);
      if (reverse) { tris[k++] = 0; tris[k++] = b; tris[k++] = a; }
      else         { tris[k++] = 0; tris[k++] = a; tris[k++] = b; }
    }
    return { verts, tris };
  }

  const patches: Patch[] = [wall];
  // Wound OPPOSITE handedness so the two ends face opposite directions (both
  // consistent with the wall); weldAndBuild's volume-sign net auto-corrects the
  // global orientation regardless. Mirrors r_helical_surface's top/bot caps.
  if (capLo) patches.push(capRing(0, false));
  if (capHi) patches.push(capRing(1, true));

  return weldAndBuild(patches);
}
