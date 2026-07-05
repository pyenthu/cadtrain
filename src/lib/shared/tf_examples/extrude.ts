/**
 * tf_examples/extrude — a REUSABLE linear extrude (with twist + top-scale) for
 * TrueForm, the native analogue of Manifold's `r_weld_extrude`.
 *
 * TrueForm has NO native linear extrude / loft (trueform-api-notes.md § ⛔) — its
 * only path generator is `tubeMesh` (a fixed CIRCULAR section). Manifold's
 * `r_weld_extrude` wraps `CrossSection.extrude(height, nDivisions, twistDegrees,
 * scaleTop)`: extrude a 2D section polygon along Z, morphing it with a linear
 * TWIST + uniform TOP SCALE (taper). This file builds the SAME shape from a
 * hand-wound (z-levels × section) vertex grid welded via the ported welded-mesh
 * toolkit ({@link buildWeldGrid} in `tf-weld.ts`), so a twisted hex bar / tapered
 * prism / extruded star builds natively in TF.
 *
 * SPLIT (same as `buildRevolveMesh` / `buildWeldGrid`): the PURE grid step
 * ({@link buildExtrudeGrid}) + the PURE mesh step ({@link buildExtrudeMesh}) have
 * NO WASM, so their winding / watertightness / twist-scale behaviour is
 * unit-testable without the 31 MB kernel; {@link tfExtrudeProfile} is the thin
 * wrapper that hands the flat buffers to `tf.mesh(...)` + `positivelyOriented`.
 *
 * Z-DOWN (drilling convention): the section at u=0 sits at z=0 (the TOP face,
 * unscaled + untwisted — Manifold's extrude BASE); the section at u=1 sits at
 * z=length (the BOTTOM face, multiplied by `scaleTop` and rotated by `twist`
 * degrees — Manifold's extrude TOP slice). `divs` intermediate rings are
 * interpolated between so a twisted/tapered section stays smooth. This mirrors
 * `CrossSection.extrude`'s morph exactly, so the TF solid matches the Manifold
 * one. The absolute in/out orientation is fixed at build time by tf's
 * `positivelyOriented` (freshly welded walls can come back inward), so the caller
 * gets a positive-signed-volume outward solid regardless of the section's winding.
 */
import type { FlatMesh } from '../trueform-client';
import { buildWeldGrid, type V3 } from './tf-weld';

/** A 2D section point `[x, y]` (the extrusion cross-section, in the XY plane). */
export type Pt2 = readonly [number, number];

export interface ExtrudeOpts {
  /** Total extrusion length along +Z (Z-DOWN: z=0 top → z=length bottom). */
  length: number;
  /** Intermediate ring segments when the section MORPHS (twist/scaleTop ≠ id).
   *  More rings → a smoother twisted/tapered wall. Clamped to [1, 96]; ignored
   *  (single segment) when there's no morph. Default 12. */
  divs?: number;
  /** Twist in DEGREES applied linearly over the length (top face rotated by this
   *  much vs the base). Default 0. */
  twist?: number;
  /** Uniform TOP-face scale `[sx, sy]` (taper) — the bottom face (z=length) is
   *  multiplied by this, the top (z=0) stays 1, linearly interpolated between.
   *  Default `[1, 1]` (no taper). */
  scaleTop?: readonly [number, number];
  /** Perimeter resample target — densify the section to N points before extruding
   *  (matches r_weld_extrude's `segments`). Critical for twist: more side verts →
   *  smaller non-planar quads → less per-triangle normal artifact. Default: the
   *  section's own point count (no resample). */
  segments?: number;
}

/** Uniform arc-length resample of a CLOSED 2D polygon to `target` points (mirrors
 *  `csg-2d.resample` — inlined here to keep this module WASM-free + self-contained).
 *  A no-op when `target ≤ points.length` or the polygon has < 3 points. */
function resamplePerimeter(points: readonly Pt2[], target: number): Pt2[] {
  const N = points.length;
  if (N < 3) return points.map((p) => [p[0], p[1]] as Pt2);
  const T = Math.max(3, Math.round(Number(target) || 0));
  if (T <= N) return points.map((p) => [p[0], p[1]] as Pt2);
  const seg: number[] = new Array(N);
  let total = 0;
  for (let i = 0; i < N; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % N]!;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    seg[i] = d;
    total += d;
  }
  if (total < 1e-12) return points.map((p) => [p[0], p[1]] as Pt2);
  const out: Pt2[] = new Array(T);
  const step = total / T;
  let i = 0;
  let acc = 0;
  for (let k = 0; k < T; k++) {
    const s = k * step;
    while (i < N - 1 && acc + seg[i]! < s) { acc += seg[i]!; i++; }
    const t = seg[i]! > 0 ? (s - acc) / seg[i]! : 0;
    const a = points[i]!;
    const b = points[(i + 1) % N]!;
    out[k] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  return out;
}

/**
 * PURE grid builder (no WASM) — turn a 2D section polygon into an ordered
 * (rings × section) 3D vertex grid, applying the linear TWIST + TOP-SCALE morph
 * along +Z. `grid[u][v]` = section point `v` at ring `u`; `u=0` is the top face
 * (z=0), the last ring is the bottom face (z=length). Feed this straight to
 * {@link buildWeldGrid} (with `closedV:true, caps:true`) → a welded solid.
 */
export function buildExtrudeGrid(section: readonly Pt2[], opts: ExtrudeOpts): V3[][] {
  const L = Math.max(1e-4, Number(opts.length) || 0);
  const twistDeg = Number(opts.twist) || 0;
  const st = opts.scaleTop ?? [1, 1];
  const sx = Number.isFinite(st[0]) ? st[0] : 1;
  const sy = Number.isFinite(st[1]) ? st[1] : 1;
  const twistRad = (twistDeg * Math.PI) / 180;
  // Does the section actually morph? Only then do we insert intermediate rings.
  const morph = Math.abs(twistRad) > 1e-6 || Math.abs(sx - 1) > 1e-6 || Math.abs(sy - 1) > 1e-6;
  const nSeg = morph ? Math.max(1, Math.min(96, Math.round(Number(opts.divs ?? 12)))) : 1;
  const pts = resamplePerimeter(section, Number(opts.segments ?? 0));

  const grid: V3[][] = [];
  for (let r = 0; r <= nSeg; r++) {
    const u = r / nSeg;                       // 0 (top) → 1 (bottom)
    const ang = twistRad * u;                 // linear twist
    const scx = 1 + (sx - 1) * u;             // linear top-scale interp
    const scy = 1 + (sy - 1) * u;
    const c = Math.cos(ang), s = Math.sin(ang);
    const z = u * L;
    grid.push(
      pts.map(([x, y]): V3 => {
        // scale first (in section space), then rotate about the Z axis.
        const px = x * scx, py = y * scy;
        return [px * c - py * s, px * s + py * c, z];
      }),
    );
  }
  return grid;
}

/**
 * PURE extrude mesh (no WASM) — {@link buildExtrudeGrid} welded into a watertight
 * `{points, faces}` solid via {@link buildWeldGrid} (closed section loop + capped
 * ends). The section-close seam wraps by modulo (no duplicate seam verts); the top
 * + bottom faces are closed by centroid fans (the same cap the revolve / sweep
 * builders use). A final position-weld collapses any coincident verts (a repeated
 * profile-close point) and drops the degenerate tris. Watertight by construction.
 */
export function buildExtrudeMesh(section: readonly Pt2[], opts: ExtrudeOpts): FlatMesh {
  const grid = buildExtrudeGrid(section, opts);
  return buildWeldGrid(grid, { closedV: true, caps: true });
}

/**
 * Build a welded, capped TrueForm `Mesh` for a twisted/tapered linear extrude — the
 * WASM wrapper around {@link buildExtrudeMesh}. Emits the flat buffers, hands them to
 * `tf.mesh(faces, points)`, then runs `positivelyOriented` so the walls + caps share
 * ONE outward orientation (positive signed volume) — freshly welded TF walls can come
 * back inward, exactly like `tfRevolveProfile` / `weldGridToTf`. `t` is the
 * initialised tf module (`ensureTf()`'d by the caller). Returns the tf `Mesh`.
 */
export function tfExtrudeProfile(t: any, section: readonly Pt2[], opts: ExtrudeOpts): any {
  const { points, faces } = buildExtrudeMesh(section, opts);
  let m = t.mesh(faces, points);
  try { m = t.positivelyOriented(m); } catch { /* keep the plain welded extrude */ }
  return m;
}
