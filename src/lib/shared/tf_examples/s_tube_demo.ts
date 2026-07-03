/**
 * s_tube_demo — the CURVED HOLLOW TUBE, the TrueForm way. Replicates the volume
 * part `s_tube_demo` (an `r_sweep` assembly: a circular section swept along a bent
 * 3D spline path, then an inner tube subtracted → a thin-walled bent pipe).
 *
 * ┌ WHY THIS DEMO MATTERS ─────────────────────────────────────────────────────┐
 * │ In Manifold this exact part is the "defect-2" case: the mesh-boolean of two  │
 * │ swept tubes with TILTED end caps comes back a genus-mess (non-manifold /      │
 * │ extra handles). TrueForm sweeps with parallel-transport frames (RMF) and does │
 * │ EXACT booleans, so the same bent hollow tube should come back CLEAN — closed, │
 * │ 2-manifold, genus-1 (χ=0). That contrast is the whole point of this example.  │
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 * PATH: the part's 5-point spline (z 0.646 → 7.531, tiny x/y wiggles — a near-
 * vertical, slightly-bent tube) resampled to 32 points with a Catmull-Rom spline
 * (matching the part's `resampleSpline(path, 32, false)`).
 *
 * SECTION: the part's section is a genuine CIRCLE (`d_circle` expr, radius `rad`),
 * so `tubeMesh`'s fixed-radius circular section is an EXACT match — no non-circular
 * approximation needed here. Outer radius 0.6, inner 0.5 → 0.1 wall.
 *
 * ANNULUS: outer solid tube MINUS inner solid tube = a hollow pipe with annular end
 * faces. The inner path is extended slightly past both ends so the bore punches
 * fully THROUGH the outer caps (no coincident coplanar cap faces → cleaner boolean,
 * same trick `bored_pipe` uses). Both tubes are capped ({@link capOpenEnds}) into
 * closed solids before the exact `booleanDifference`.
 */
import { ensureTf, tfResult, capOpenEnds, buildOpenCurve, type TfDemoResult } from '../trueform-client';
import type { TfExample } from './index';

/** The `s_tube_demo` part's spline path control points (from meta.graph n_path_spl). */
const PATH_CTRL: readonly (readonly [number, number, number])[] = [
  [-0.021, -0.186, 0.646],
  [0, 0, 1.522071596816624],
  [0, 0, 2.498],
  [0.063, -0.011, 4.456],
  [0, 0, 7.531],
];

const SECTION_SAMPLES = 32; // matches the part's resampleSpline(path, 32, false)
const RADIAL_SEGMENTS = 32; // section is a 32-sample circle
const OUTER_R = 0.6;
const INNER_R = 0.5; // 0.1 wall (the s_tube_demo variant)
const BORE_EXT = 1.0; // extend inner path past both ends so the bore punches through

/**
 * Uniform Catmull-Rom resample of the control polyline to `samples` points — a
 * PURE spline (no WASM), the TrueForm-side stand-in for the part's `resampleSpline`.
 * Passes through the first and last control points exactly. Returns a flat [samples*3]
 * Float32Array (the shared point buffer `tubeMesh` sweeps along).
 */
export function buildSweepPath(samples = SECTION_SAMPLES): Float32Array {
  const ctrl = PATH_CTRL;
  const n = ctrl.length;
  const out = new Float32Array(samples * 3);
  const P = (i: number) => ctrl[Math.max(0, Math.min(n - 1, i))];
  for (let s = 0; s < samples; s++) {
    const u = (s / (samples - 1)) * (n - 1);
    let seg = Math.floor(u);
    if (seg > n - 2) seg = n - 2;
    const t = u - seg;
    const p0 = P(seg - 1), p1 = P(seg), p2 = P(seg + 1), p3 = P(seg + 2);
    const t2 = t * t, t3 = t2 * t;
    for (let k = 0; k < 3; k++) {
      out[s * 3 + k] = 0.5 * (
        2 * p1[k] +
        (-p0[k] + p2[k]) * t +
        (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
        (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3
      );
    }
  }
  return out;
}

/**
 * Extend a path by `ext` along its END TANGENTS at both ends → one extra point
 * before the first and after the last. Used for the inner bore so it punches fully
 * through the outer end caps (avoids coincident coplanar cap faces in the boolean).
 */
export function extendPathEnds(path: Float32Array, ext = BORE_EXT): Float32Array {
  const n = path.length / 3;
  const g = (i: number, k: number) => path[i * 3 + k];
  const norm = (v: number[]) => Math.hypot(v[0], v[1], v[2]) || 1;
  const s0 = [g(0, 0) - g(1, 0), g(0, 1) - g(1, 1), g(0, 2) - g(1, 2)];
  const ls = norm(s0);
  const e0 = [g(0, 0) + (s0[0] / ls) * ext, g(0, 1) + (s0[1] / ls) * ext, g(0, 2) + (s0[2] / ls) * ext];
  const d1 = [g(n - 1, 0) - g(n - 2, 0), g(n - 1, 1) - g(n - 2, 1), g(n - 1, 2) - g(n - 2, 2)];
  const le = norm(d1);
  const e1 = [g(n - 1, 0) + (d1[0] / le) * ext, g(n - 1, 1) + (d1[1] / le) * ext, g(n - 1, 2) + (d1[2] / le) * ext];
  const out = new Float32Array((n + 2) * 3);
  out.set(e0, 0);
  out.set(path, 3);
  out.set(e1, (n + 1) * 3);
  return out;
}

export const s_tube_demo: TfExample = {
  name: 's_tube_demo',
  label: 's_tube_demo (bent hollow tube — TF-clean vs Manifold defect-2)',
  cuttable: true,
  async build(opts: { cutaway?: boolean } = {}): Promise<TfDemoResult> {
    const tf = await ensureTf();
    const t = tf as any;
    const outerPath = buildSweepPath();
    const innerPath = extendPathEnds(outerPath);
    const outer = capOpenEnds(t, t.tubeMesh(buildOpenCurve(t, outerPath, outerPath.length / 3), OUTER_R, RADIAL_SEGMENTS));
    const inner = capOpenEnds(t, t.tubeMesh(buildOpenCurve(t, innerPath, innerPath.length / 3), INNER_R, RADIAL_SEGMENTS));
    const solid = t.booleanDifference(outer, inner).mesh;
    return tfResult(tf, t, solid, { cutaway: opts?.cutaway, cuttable: true });
  },
};
