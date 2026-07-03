/**
 * s_tub_st — the THICKER-WALLED sibling of {@link s_tube_demo}, the TrueForm way.
 * Replicates the volume part `s_tub_st` (an `r_sweep` assembly: a circular section
 * swept along the SAME bent 3D spline path, inner tube subtracted).
 *
 * ⚠ NOTE on the id: despite the `_st` suffix (which reads like "straight"), the
 * volume part `s_tub_st` uses the IDENTICAL `sweep_tube_demo` path as `s_tube_demo`
 * — it is NOT a straight variant. The only difference between the two parts is the
 * INNER (bore) radius: `s_tube_demo` subtracts r=0.5 (0.1 wall), `s_tub_st`
 * subtracts r=0.4 (0.2 wall). Both are the same bent hollow tube. This file mirrors
 * that faithfully — same path, thicker wall.
 *
 * Like `s_tube_demo`, this is Manifold's "defect-2" case (tilted swept caps →
 * genus-mess in the mesh boolean); TrueForm's RMF sweep + exact boolean should
 * return it CLEAN (closed, 2-manifold, genus-1 / χ=0).
 *
 * SECTION: a genuine circle (radius `rad`) — `tubeMesh`'s fixed circular section is
 * an EXACT match, no approximation. Outer 0.6, inner 0.4 → 0.2 wall.
 */
import { ensureTf, tfResult, capOpenEnds, buildOpenCurve, type TfDemoResult } from '../trueform-client';
import type { TfExample } from './index';

/** The `s_tub_st` part's spline path control points (from meta.graph n_path_spl —
 *  identical to s_tube_demo's). */
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
const INNER_R = 0.4; // 0.2 wall (the s_tub_st variant — thicker than s_tube_demo)
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

export const s_tub_st: TfExample = {
  name: 's_tub_st',
  label: 's_tub_st (bent hollow tube, 0.2 wall — TF-clean vs Manifold defect-2)',
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
