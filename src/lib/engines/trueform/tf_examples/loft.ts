/**
 * tf_examples/loft — a native TrueForm LOFT builder, the analogue of Manifold's
 * `r_loft` (`src/lib/graph/stdlib/r_loft.ts`) and BREP's `r_loft`
 * (`src/lib/engines/brep/brep-occt.ts`).
 *
 * `r_weld_extrude` morphs a 2D section with a LINEAR twist + uniform TOP-SCALE
 * (taper) only. A LOFT scales the section by a smooth SHAPE-ALONG-LENGTH curve —
 * a fat MIDDLE (barrel / vase), a necked WAIST (hourglass), a wide bottom
 * (flare), a nose (ogive), an S between the ends (scurve) — which a monotonic
 * top-scale CANNOT make (a barrel's mid is fatter than BOTH ends). TrueForm has
 * no native loft (trueform-api-notes.md § ⛔ — only `tubeMesh`, a fixed circular
 * section), so this builds the SAME per-t scaled+rotated section stack the MF
 * `gridPatch` build + the BREP ThruSections loft use, welded into a watertight
 * solid via the ported welded-mesh toolkit ({@link buildWeldGrid}).
 *
 * SOURCE OF TRUTH: r_loft.ts's `scaleAt(t)` (reproduced IDENTICALLY in
 * {@link loftScaleAt}) + its per-slice `place` (scale in section space, then
 * rotate about Z, planted at z = t·length). Z-DOWN (drilling convention): the
 * section at u=0 sits at z=0 (the TOP face, unscaled + untwisted); the section at
 * u=1 sits at z=length (the BOTTOM face). `divs` intermediate rings sample the
 * smooth curve so the loft reads round, not chorded.
 *
 * SPLIT (same as `extrude.ts` / `tf-weld.ts`): the PURE grid step
 * ({@link buildLoftGrid}) + the PURE mesh step ({@link buildLoftMesh}) have NO
 * WASM, so their winding / watertightness / the fat-middle property are
 * unit-testable without the 31 MB kernel; {@link tfLoftProfile} is the thin
 * wrapper that hands the flat buffers to `tf.mesh(...)` + `positivelyOriented`
 * (freshly welded TF walls can come back inward — the absolute in/out sign is
 * fixed at build time, exactly like `tfExtrudeProfile` / `tfRevolveProfile`).
 */
import type { FlatMesh } from '../trueform-client';
import { buildWeldGrid, type V3 } from './tf-weld';

/** A 2D section point `[x, y]` (the loft cross-section, in the XY plane). */
export type Pt2 = readonly [number, number];

export interface LoftOpts {
  /** Total loft length along +Z (Z-DOWN: z=0 top → z=length bottom). */
  length: number;
  /** Number of axial segments (→ `divs+1` rings) sampling the smooth shape
   *  curve. Clamped to [2, 128] (matches r_loft's `nDiv`). Default 48. */
  divs?: number;
  /** Twist in DEGREES applied linearly over the length. Default 0. */
  twist?: number;
  /** Shape amplitude (r_loft's `bulge`): how much the section swells / necks.
   *  Default 0 (a straight prism, if twist is also 0). */
  bulge?: number;
  /** The shape-along-length curve selecting `scaleAt(t)`:
   *  barrel (fat middle) · waist (thin middle) · flare (wide bottom) ·
   *  ogive (curved taper to a nose) · scurve (smooth S). Default 'barrel'. */
  shape?: string;
  /** Perimeter resample target — densify the section to N points before lofting
   *  (matches r_loft's `segments`, so an 8-pt circle lofts round). Default: the
   *  section's own point count (no resample). */
  segments?: number;
}

/** Uniform arc-length resample of a CLOSED 2D polygon to `target` points (mirrors
 *  `csg-2d.resample` — inlined, like `extrude.ts`'s copy, to keep this module
 *  WASM-free + self-contained). A no-op when `target ≤ points.length` or the
 *  polygon has < 3 points. */
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
 * The r_loft shape curve s(t), t ∈ [0,1] — IDENTICAL to r_loft.ts's `scaleAt`
 * (the source of truth) and brep-occt.ts's r_loft. `amp` is the `bulge`. Floored
 * at 0.02 so a large bulge can't collapse a slice.
 *
 *   barrel  1 + amp·sin(π t)      fat middle (default)
 *   waist   1 − amp·sin(π t)      thin middle (hourglass)
 *   flare   1 + amp·t             linear, wide bottom
 *   ogive   1 − amp·t²            curved taper to a nose
 *   scurve  1 + amp·(smoothstep(t) − ½)   smooth S between the ends
 */
export function loftScaleAt(shape: string | undefined, amp: number, t: number): number {
  const smoothstep = (x: number) => x * x * (3 - 2 * x);
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
}

/**
 * PURE grid builder (no WASM) — turn a 2D section polygon into an ordered
 * (rings × section) 3D vertex grid, applying the smooth SHAPE scale
 * ({@link loftScaleAt}) + linear TWIST at each ring. `grid[u][v]` = section
 * point `v` at ring `u`; `u=0` is the top face (z=0, unscaled/untwisted), the
 * last ring is the bottom face (z=length). Mirrors r_loft.ts's `place`: scale in
 * section space, then rotate about Z. Feed this to {@link buildWeldGrid} (with
 * `closedV:true, caps:true`) → a welded solid.
 */
export function buildLoftGrid(section: readonly Pt2[], opts: LoftOpts): V3[][] {
  const L = Math.max(0.01, Number(opts.length) || 0);
  const twistRad = (Number(opts.twist) || 0) * Math.PI / 180;
  const amp = Number(opts.bulge) || 0;
  const shape = opts.shape;
  // divs → nSeg segments (nSeg+1 rings). Clamp matches r_loft's nDiv.
  const nSeg = Math.max(2, Math.min(128, Math.round(Number(opts.divs ?? 48))));
  const pts = resamplePerimeter(section, Number(opts.segments ?? 0));

  const grid: V3[][] = [];
  for (let r = 0; r <= nSeg; r++) {
    const t = r / nSeg;                          // 0 (top) → 1 (bottom)
    const s = loftScaleAt(shape, amp, t);        // smooth shape scale
    const ang = twistRad * t;                    // linear twist
    const c = Math.cos(ang), sn = Math.sin(ang);
    const z = t * L;
    grid.push(
      pts.map(([x, y]): V3 => {
        // scale (uniform scalar) then rotate about Z — same as r_loft.place.
        const sx = s * x, sy = s * y;
        return [sx * c - sy * sn, sx * sn + sy * c, z];
      }),
    );
  }
  return grid;
}

/**
 * PURE loft mesh (no WASM) — {@link buildLoftGrid} welded into a watertight
 * `{points, faces}` solid via {@link buildWeldGrid} (closed section loop + capped
 * ends). The section-close seam wraps by modulo (no duplicate seam verts); the
 * top + bottom faces close by centroid fans; a final position-weld collapses
 * coincident verts + drops the degenerate tris. Watertight by construction.
 */
export function buildLoftMesh(section: readonly Pt2[], opts: LoftOpts): FlatMesh {
  return buildWeldGrid(buildLoftGrid(section, opts), { closedV: true, caps: true });
}

/**
 * Build a welded, capped TrueForm `Mesh` for a smooth loft — the WASM wrapper
 * around {@link buildLoftMesh}. Emits the flat buffers, hands them to
 * `tf.mesh(faces, points)`, then runs `positivelyOriented` so the walls + caps
 * share ONE outward orientation (positive signed volume). `t` is the initialised
 * tf module (`ensureTf()`'d by the caller). Returns the tf `Mesh`.
 */
export function tfLoftProfile(t: any, section: readonly Pt2[], opts: LoftOpts): any {
  const { points, faces } = buildLoftMesh(section, opts);
  let m = t.mesh(faces, points);
  try { m = t.positivelyOriented(m); } catch { /* keep the plain welded loft */ }
  return m;
}
