/**
 * r_cyl — a shaft cylinder the REVOLVE way. `cylinderMesh(radius, height,
 * segments)` is effectively a lathe of a rectangle profile → a CAPPED SOLID
 * cylinder (closed, manifold, χ=2). The TF analogue of Manifold's r_revolve.
 * Centred on the origin (z ∈ [−h/2, +h/2]).
 */
import { ensureTf, tfResult, type TfDemoResult } from '../trueform-client';
import type { TfExample } from './index';

export const r_cyl: TfExample = {
  name: 'r_cyl',
  label: 'r_cyl (revolve — capped solid)',
  cuttable: true,
  async build(opts: { cutaway?: boolean } = {}): Promise<TfDemoResult> {
    const tf = await ensureTf();
    const t = tf as any;
    const solid = t.cylinderMesh(3, 16, 48);
    return tfResult(tf, t, solid, { cutaway: opts?.cutaway, cuttable: true });
  },
};
