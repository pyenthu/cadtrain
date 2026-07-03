/**
 * s_cyl — the SAME shaft cylinder the SWEEP way. `tubeMesh` sweeps a circular
 * section straight up a vertical path; its open ends are CAPPED ({@link capOpenEnds})
 * → a CLOSED solid cylinder matching r_cyl (same radius/height so the two overlay
 * for compare) that cross-sections identically.
 */
import { ensureTf, tfResult, capOpenEnds, buildOpenCurve, type TfDemoResult } from '../trueform-client';
import type { TfExample } from './index';

export const s_cyl: TfExample = {
  name: 's_cyl',
  label: 's_cyl (sweep — capped solid)',
  cuttable: true,
  async build(opts: { cutaway?: boolean } = {}): Promise<TfDemoResult> {
    const tf = await ensureTf();
    const t = tf as any;
    const height = 16, radius = 3, axialSegments = 2, radialSegments = 48;
    // Straight vertical path from −h/2 to +h/2 (match cylinderMesh centring).
    const n = Math.max(2, axialSegments + 1);
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pts[i * 3] = 0; pts[i * 3 + 1] = 0;
      pts[i * 3 + 2] = -height / 2 + (i / (n - 1)) * height;
    }
    const solid = capOpenEnds(t, t.tubeMesh(buildOpenCurve(t, pts, n), radius, radialSegments));
    return tfResult(tf, t, solid, { cutaway: opts?.cutaway, cuttable: true });
  },
};
