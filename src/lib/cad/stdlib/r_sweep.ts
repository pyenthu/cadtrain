/**
 * r_sweep — Option 3: extrude a fixed 2D cross-section along an arbitrary 3D
 * PATH, welded into ONE solid (manifold by construction, NO CSG).
 *
 * This is the GENERAL sweep engine of the sweep/thread ladder
 * (docs/plans/sweep-thread-engine.md). Where `r_surface` parameterizes the
 * surface by its OWN (u,v) and so is torsion-free, `r_sweep` follows a real
 * path: at every path point it builds a per-station orthonormal frame from the
 * local tangent + a stable `up`, plants the cross-section in that frame, and
 * lofts the placed rings into a tube. So it covers the cases a single-valued
 * surface can't — a bent pipe, an elbow, an L-bend, a clamp hook — that
 * `r_surface`/`r_revolve` don't reach.
 *
 * The whole build routes through ONE call:
 *
 *   sweepAlongPath(path, section, opts)
 *     → frames the section along the path (clean side / up' / tangent basis)
 *     → places a ring at each station
 *     → loftStations(stations)            // (#path × #section) gridPatch wall
 *     → weldAndBuild(patches)             // OUR welder — position-weld + sign-fix
 *
 * — the SAME welded-mesh toolkit `r_surface` / `r_revolve` use. No CSG, no
 * union-of-segments: the wall is a single grid, the two open ends are
 * fan-capped, and `weldAndBuild` merges the section's wrap seam + auto-corrects
 * the global volume sign (memory `welded_orientation_volume_sign`), so the
 * caller never has to wind triangles perfectly.
 *
 * Parameters (all DATA — supplied by the volume part, not GUI dials):
 *   • path       ordered 3D points `[[x,y,z], …]` (≥ 2). The spine the section
 *                rides along.
 *   • section    a 2D cross-section `[[a,b], …]` (≥ 2), interpreted in each
 *                station's (side, up') frame: `[a,b] → P + a·side + b·up'`.
 *                Trace it consistently (sign is auto-corrected by the weld).
 *   • closedPath the path itself loops (last station joins the first) — a torus
 *                / closed loop; suppresses the end caps. Default false.
 *   • caps       fan-cap the two open ends so the tube is a watertight SOLID.
 *                Default true (ignored when closedPath). `closedSection` is
 *                forced true here — the section is a closed loop (a tube wall).
 *
 * Z-DOWN: the part supplies path points in the Z-down convention (z=0 top,
 * larger z deeper); r_sweep imposes no axis of its own.
 *
 * FRAME-TORSION CAVEAT (Option 3 ceiling, docs/plans/sweep-thread-engine.md):
 * the fixed-`up` frame is torsion-free for planar-ish / gentle paths, but a
 * path with TIGHT inner turns or one that doubles back along `up` can twist or
 * self-intersect the swept tube. Keep demo paths gentle; a rotation-minimizing
 * frame (parallel transport) is the eventual upgrade for harsh 3D paths.
 *
 * meta.params DECLARES THE FOUR POSITIONAL KEYS (path, section, closedPath,
 * caps) even though they are DATA arrays/flags, not GUI dials (the `data: true`
 * marker tells the GUI not to draw them). This is REQUIRED, not cosmetic:
 * primitive-loader.ts's adaptive call boundary only spreads an object-style
 * call `r_sweep({ path, section, … })` back into positional args when
 * `paramKeysOf` returns a non-empty key list. The graph editor emits EVERY Call
 * object-style (composition-emit `emitCallExpr` → `r_sweep({ … })`), so the
 * earlier EMPTY block (paramKeysOf → []) left the whole `{path,section,…}`
 * object bound to `path`, `section` undefined → bake "section needs ≥ 2 points".
 * A hand-authored POSITIONAL call `r_sweep(path, section, false, true)` still
 * works — it isn't object-inbound, so the boundary passes the args through
 * untouched. (r_surface, if it carries an empty params block, has the SAME
 * latent bug for any graph-emitted call — fix it the same way.)
 * The GUI-facing dials live on the volume parts that CALL it (sweep_demo, …).
 *
 * STANDARD-LIBRARY PRIMITIVE — git-tracked, read-only in the GUI. The import
 * below is for type-checking only; at RUNTIME the sandbox strips it and injects
 * sweepAlongPath by name (primitive-sandbox.ts), exactly like r_surface's
 * gridPatch/weldAndBuild.
 */
import { sweepAlongPath } from '$lib/cad/manifold-mesh';

export const meta = {
  id: 'r_sweep',
  name: 'r_sweep',
  description:
    'Option 3 general sweep: extrude a fixed 2D cross-section along an arbitrary 3D path → ONE welded solid (manifold by construction, no CSG). Routes sweepAlongPath → loftStations → weldAndBuild (the welded-mesh toolkit). Per-station fixed-up frame (side = tangent×up, up\' = side×tangent); torsion-free for gentle/planar-ish paths. path + section are DATA arrays, so this engine is called from a part body, not GUI-dialed.',
  tags: ['welded', 'sweep', 'path', 'tube', 'pipe', 'parametric', 'stdlib'],
  // The four POSITIONAL args, declared in order. These are DATA (not GUI
  // dials), but the keys MUST exist: the loader's adaptive call boundary
  // (primitive-loader.ts) spreads an object-style call `r_sweep({ path, … })`
  // into positional args ONLY when meta.params is non-empty (`metaKeys`). The
  // graph editor emits EVERY Call object-style (composition-emit's emitCallExpr
  // → `r_sweep({ … })`), so with an EMPTY params block the whole
  // `{path,section,…}` object landed in `path`, `section` was undefined, and the
  // bake died "section needs ≥ 2 points". `data: true` flags them so the GUI
  // doesn't render them as numeric dials. See the file header.
  params: {
    path:       { data: true, label: '3D path points [[x,y,z],…]' },
    section:    { data: true, label: '2D cross-section [[a,b],…]' },
    closedPath: { data: true, label: 'path loops (suppress caps)' },
    caps:       { data: true, label: 'fan-cap the open ends' },
  },
  material: {
    outer: { color: '#6a7d8a', metallic: 0.55, roughness: 0.4 },
    inner: { color: '#3a3a3a', metallic: 0.1, roughness: 0.9 },
  },
};

export function r_sweep(
  path: [number, number, number][],
  section: [number, number][],
  closedPath: boolean,
  caps: boolean,
): any {
  // The section is always a closed loop (a tube wall); the two ends cap to a
  // watertight solid unless the path itself closes. weldAndBuild (inside
  // sweepAlongPath → loftStations) position-welds the section seam and
  // auto-corrects the global volume sign, so the section winding is free.
  return sweepAlongPath(path, section, {
    closedPath: closedPath === true,
    caps: caps !== false,
    closedSection: true,
  });
}
