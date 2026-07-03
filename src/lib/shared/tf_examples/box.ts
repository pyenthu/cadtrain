/**
 * box — the original from-scratch TrueForm primitive. `boxMesh(w,h,d)` is a
 * centred, closed, manifold AABB (χ=2). Proves the kernel loads + generates a
 * watertight solid on the main thread; the simplest thing that cross-sections.
 */
import { ensureTf, tfResult, type TfDemoResult } from '../trueform-client';
import type { TfExample } from './index';

export const box: TfExample = {
  name: 'box',
  label: 'box',
  cuttable: true,
  async build(opts: { cutaway?: boolean } = {}): Promise<TfDemoResult> {
    const tf = await ensureTf();
    const t = tf as any;
    const solid = t.boxMesh(4, 4, 4);
    return tfResult(tf, t, solid, { cutaway: opts?.cutaway, cuttable: true });
  },
};
