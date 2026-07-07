/**
 * tf_examples/sweep-section — ARBITRARY 2D-SECTION swept solid for TrueForm
 * (TODO #50/#51). The general analogue of Manifold's `sweepAlongPath`
 * (`src/lib/cad/manifold-mesh.ts`), aimed at `tf.mesh(faces, points)`.
 *
 * ┌ WHY THIS EXISTS ───────────────────────────────────────────────────────────┐
 * │ TrueForm's ONLY native path generator is `tubeMesh` — a fixed CIRCULAR       │
 * │ section (trueform-api-notes.md § ⛔). A real `r_sweep` may carry a NON-       │
 * │ circular closed section (a rounded-rect, a hex, an airfoil…). This builder    │
 * │ transports that arbitrary 2D loop along the path's ROTATION-MINIMIZING        │
 * │ frames (RMF) and welds the swept band into a watertight `tf.mesh`, so a       │
 * │ non-circular TF sweep matches Manifold's `sweepAlongPath` output.            │
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 * SECTION TRANSPORT (identical to Manifold's `sweepAlongPath`): the per-station
 * frame is the double-reflection RMF `sweepFrames(path)` — the SAME torsion-free
 * parallel-transport math `spline3DFrames` (warp-spline.ts) re-uses for warp — so
 * the section never ROLLS along the curve. Each section point `[a,b]` maps into
 * station frame `f` as `o + a·side + b·up` (the exact `placeLoop` rule the
 * Manifold sweep uses). The ordered (path × section) vertex grid is then handed to
 * {@link buildWeldGrid} (`tf-weld.ts`): the SVTC ordered-grid wall (`-du×dv`
 * winding), a MODULO section-close seam (no duplicate seam vert), centroid-fan end
 * caps (watertight-by-construction; a non-convex section still closes into a
 * 2-manifold — the fan is topologically valid whenever the centroid is interior),
 * and a mandatory position-weld. `positivelyOriented` (in {@link tfSweepSection})
 * flips the finished solid OUTWARD, so the section's 2D winding sign never has to
 * be perfect — same self-correction `tfExtrudeProfile` / `weldGridToTf` rely on.
 *
 * SPLIT (same as `buildExtrudeMesh` / `buildRevolveMesh`): the PURE grid step
 * ({@link buildSweepGrid}) + the PURE mesh step ({@link buildSweepSectionMesh})
 * have NO WASM, so their winding / watertightness are unit-testable without the
 * 31 MB kernel; {@link tfSweepSection} is the thin wrapper that hands the flat
 * buffers to `tf.mesh(...)`, applies an OPTIONAL smoothing pass (#51), and runs
 * `positivelyOriented`.
 *
 * CIRCLE special case: a circular sweep stays the `tubeMesh` fast path in
 * `execute.ts` (byte-identical). Sweeping a circle THROUGH this general builder is
 * a thin wrapper — {@link circleSection} generates the loop and the same pipeline
 * runs — used for the demo / parity checks, not the hot path.
 */
import { buildWeldGrid, type V3 } from './tf-weld';
import type { FlatMesh } from '../trueform-client';
import { sweepFrames, type SweepFrame } from '$lib/cad/manifold-mesh';

/** A 2D section point `[x, y]` (the swept cross-section, in the frame's XY plane). */
export type Pt2 = readonly [number, number];

export interface SweepSectionOpts {
  /** Seed reference for the RMF (only the FIRST station's frame; auto-falls-back
   *  when the first tangent is ~parallel). Default `[0,0,1]` — matches `sweepFrames`. */
  up?: V3;
  /** The PATH is a closed loop (row `N-1` joins back to row 0 — a torus sweep).
   *  Suppresses the end caps + distributes the RMF seam twist. Default false. */
  closedPath?: boolean;
  /** The SECTION is a closed loop (col `N-1` joins back to col 0 — a tube skin).
   *  Default true (an `r_sweep` section is always a closed profile). */
  closedSection?: boolean;
  /** Cap the two open PATH ends into a closed SOLID (centroid fans). Only meaningful
   *  for an OPEN path with a closed section. Default `!closedPath`. */
  caps?: boolean;
}

/**
 * PURE section-transport grid (no WASM) — place the closed 2D `section` into the
 * RMF frame at every `path` station → an ordered (rows × cols) 3D vertex grid.
 * `grid[u][v]` = section point `v` transported into path station `u`. Row `u` walks
 * the PATH; col `v` walks the SECTION. Feed straight to {@link buildWeldGrid}.
 *
 * Frames come from `sweepFrames(path)` (double-reflection RMF, torsion-free), and
 * each `[a,b]` maps as `o + a·side + b·up` — byte-identical to Manifold's
 * `sweepAlongPath.placeLoop`, so a TF sweep matches the Manifold sweep.
 */
export function buildSweepGrid(
  section: readonly Pt2[],
  path: readonly V3[],
  opts: SweepSectionOpts = {},
): V3[][] {
  if (path.length < 2 || section.length < 2) return [];
  const frames: SweepFrame[] = sweepFrames(path as V3[], {
    up: opts.up,
    closedPath: opts.closedPath === true,
  });
  return frames.map((f) => placeLoop(f, section));
}

/** Place a 2D loop `[a,b]` into a sweep frame as `o + a·side + b·up` (the exact
 *  Manifold `sweepAlongPath.placeLoop` convention). */
function placeLoop(f: SweepFrame, loop: readonly Pt2[]): V3[] {
  return loop.map(([a, b]): V3 => [
    f.o[0] + f.side[0] * a + f.up[0] * b,
    f.o[1] + f.side[1] * a + f.up[1] * b,
    f.o[2] + f.side[2] * a + f.up[2] * b,
  ]);
}

/**
 * PURE swept-section mesh (no WASM) — {@link buildSweepGrid} welded into a
 * watertight `{points, faces}` solid via {@link buildWeldGrid}: a closed-section
 * side wall (modulo seam) + centroid-fan end caps (for an open path). A final
 * position-weld collapses any coincident verts (a repeated section-close point, a
 * collapsed pole) + drops the degenerate tris. Watertight by construction.
 */
export function buildSweepSectionMesh(
  section: readonly Pt2[],
  path: readonly V3[],
  opts: SweepSectionOpts = {},
): FlatMesh {
  const grid = buildSweepGrid(section, path, opts);
  if (grid.length < 2) return { points: new Float32Array(0), faces: new Int32Array(0) };
  const closedPath = opts.closedPath === true;
  return buildWeldGrid(grid, {
    closedU: closedPath,
    closedV: opts.closedSection !== false,
    caps: opts.caps ?? !closedPath,
  });
}

// ─── smoothing (#51 — NURBS/Taubin-style smoothing hook) ──────────────────────

/** A smoothing request for a swept mesh. `false`/omitted = OFF (the default). A
 *  bare string / `true` picks a kernel with default params; the object form tunes
 *  iterations / band-pass factors. Both `taubin` (band-pass — shrink-free) and
 *  `laplacian` (plain — shrinks) are TrueForm geometry/sync ops. */
export type SweepSmooth =
  | boolean
  | 'taubin'
  | 'laplacian'
  | { kind?: 'taubin' | 'laplacian'; iterations?: number; lambda?: number; mu?: number };

/**
 * Apply an OPTIONAL smoothing pass to a built TF mesh (#51). GUARDED: TrueForm's
 * `taubinSmoothed` / `laplacianSmoothed` signatures vary across builds, so we try
 * the common call shapes (opts-object, then positional) and, on ANY failure, return
 * the mesh UNCHANGED — smoothing is a quality nicety, never allowed to break a
 * watertight solid. Default OFF (`smooth` falsy → identity). Taubin is the default
 * kernel: a band-pass λ/μ pair that smooths WITHOUT the volumetric shrink plain
 * Laplacian causes — the NURBS-style "relax the facets" the sweep wants.
 */
export function applySweepSmoothing(t: any, mesh: any, smooth: SweepSmooth | undefined): any {
  if (!smooth) return mesh;
  const cfg = typeof smooth === 'object' ? smooth : {};
  const kind = (typeof smooth === 'string' ? smooth : cfg.kind) ?? 'taubin';
  const iterations = Math.max(1, Math.round(Number(cfg.iterations ?? 8)));
  const lambda = Number.isFinite(cfg.lambda as number) ? (cfg.lambda as number) : 0.5;
  // Taubin's negative μ (|μ| > λ) is the band-pass that cancels the shrink.
  const mu = Number.isFinite(cfg.mu as number) ? (cfg.mu as number) : -0.53;
  const fn = kind === 'laplacian' ? t.laplacianSmoothed : t.taubinSmoothed;
  if (typeof fn !== 'function') return mesh;
  const call = fn.bind(t);
  // Try the shapes different TF builds expose, most-specific first.
  const attempts: Array<() => any> =
    kind === 'laplacian'
      ? [
          () => call(mesh, { iterations, lambda }),
          () => call(mesh, iterations, lambda),
          () => call(mesh, iterations),
          () => call(mesh),
        ]
      : [
          () => call(mesh, { iterations, lambda, mu }),
          () => call(mesh, iterations, lambda, mu),
          () => call(mesh, iterations),
          () => call(mesh),
        ];
  for (const attempt of attempts) {
    try {
      const out = attempt();
      if (out) return out;
    } catch {
      /* try the next shape */
    }
  }
  return mesh; // no shape worked → leave the solid untouched
}

/**
 * Build a welded, capped TrueForm `Mesh` for an ARBITRARY-section sweep — the WASM
 * wrapper around {@link buildSweepSectionMesh}. Emits the flat buffers, hands them
 * to `tf.mesh(faces, points)`, applies an OPTIONAL smoothing pass (#51, default
 * off), then runs `positivelyOriented` so walls + caps share ONE outward
 * orientation (positive signed volume) — freshly welded TF walls can come back
 * inward, exactly like `tfExtrudeProfile` / `weldGridToTf`. `t` is the initialised
 * tf module (`ensureTf()`'d by the caller). Returns the tf `Mesh`.
 */
export function tfSweepSection(
  t: any,
  section: readonly Pt2[],
  path: readonly V3[],
  opts: SweepSectionOpts & { smooth?: SweepSmooth } = {},
): any {
  const { points, faces } = buildSweepSectionMesh(section, path, opts);
  let m = t.mesh(faces, points);
  m = applySweepSmoothing(t, m, opts.smooth);
  try { m = t.positivelyOriented(m); } catch { /* keep the plain welded sweep */ }
  return m;
}

/** A closed circular section `[x,y]` of `segments` points, CCW — so the circular
 *  sweep can run through the GENERAL builder as a thin wrapper (parity / demo; the
 *  hot path stays `tubeMesh` in execute.ts). */
export function circleSection(radius: number, segments: number): Pt2[] {
  const N = Math.max(3, Math.round(segments));
  const out: Pt2[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    out.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }
  return out;
}
