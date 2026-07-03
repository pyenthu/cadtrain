/**
 * helix — the real sweep payoff. TrueForm has no revolve/loft/extrude, but
 * `tubeMesh` sweeps a circular section along a 3D polyline via parallel-transport
 * frames (RMF). Here the path is a HELIX (a coil/spring) — smooth curved geometry
 * `CrossSection` can't do without axial sampling. The open ends are CAPPED
 * ({@link capOpenEnds}) → a CLOSED, watertight solid coil that cross-sections.
 * (Formerly the `sweep` demo.)
 */
import { ensureTf, tfResult, capOpenEnds, buildOpenCurve, type TfDemoResult } from '../trueform-client';
import type { TfExample } from './index';

export const helix: TfExample = {
  name: 'helix',
  label: 'helix (swept coil — capped solid)',
  cuttable: true,
  async build(opts: { cutaway?: boolean } = {}): Promise<TfDemoResult> {
    const tf = await ensureTf();
    const t = tf as any;
    // Helix path (coilRadius 6, pitch 3.5, 3 turns, 64 pts/turn) swept r=1.2.
    const coilRadius = 6, pitch = 3.5, turns = 3, ptsPerTurn = 64;
    const n = Math.max(4, Math.round(turns * ptsPerTurn));
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / ptsPerTurn) * 2 * Math.PI;
      pts[i * 3] = coilRadius * Math.cos(a);
      pts[i * 3 + 1] = coilRadius * Math.sin(a);
      pts[i * 3 + 2] = (i / ptsPerTurn) * pitch;
    }
    const solid = capOpenEnds(t, t.tubeMesh(buildOpenCurve(t, pts, n), 1.2, 24));
    return tfResult(tf, t, solid, { cutaway: opts?.cutaway, cuttable: true });
  },
};
