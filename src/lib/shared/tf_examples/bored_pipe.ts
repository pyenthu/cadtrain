/**
 * bored_pipe — exercises the CSG kernel + the memory's caveat that TrueForm's
 * boolean is not automatically watertight. An outer solid cylinder MINUS a taller,
 * narrower inner cylinder that punches all the way through → a hollow tube capped
 * by two annular faces. A correct boolean returns `closed`, `manifold`, genus-1
 * (χ=0); `tfAnalyze` (via tfResult) reports whether tf actually delivered that.
 * (Formerly the `boolean` demo.)
 */
import { ensureTf, tfResult, type TfDemoResult } from '../trueform-client';
import type { TfExample } from './index';

export const bored_pipe: TfExample = {
  name: 'bored_pipe',
  label: 'bored_pipe (CSG hollow tube)',
  cuttable: true,
  async build(opts: { cutaway?: boolean } = {}): Promise<TfDemoResult> {
    const tf = await ensureTf();
    const t = tf as any;
    const outer = t.cylinderMesh(6, 16, 64);
    // Slightly taller so the bore fully punches through both caps (no coplanar
    // coincident faces → cleaner boolean).
    const inner = t.cylinderMesh(3.5, 16 + 4, 64);
    const solid = t.booleanDifference(outer, inner).mesh;
    return tfResult(tf, t, solid, { cutaway: opts?.cutaway, cuttable: true });
  },
};
