/**
 * cone — a solid right cone, built by revolving a right-triangle half-section with
 * the reusable {@link tfRevolveProfile} lathe.
 *
 * Half-section (r, z), a CLOSED loop that TOUCHES the axis at two points:
 *   (0, 0) → (R, 0) → (0, h) → close      (R = 3, h = 8)
 * The (0,0) base-centre and (0,h) apex collapse to single shared axis vertices, so
 * the revolve is a watertight genus-0 solid (χ=2): a fanned base disk + the cone
 * wall. The (0,h)→(0,0) closing edge lies ON the axis → contributes no surface.
 */
import { ensureTf, tfResult, type TfDemoResult } from '../trueform-client';
import { tfRevolveProfile, type ProfilePoint } from './revolve';
import type { TfExample } from './index';

/** Right-triangle half-section (r, z) — base radius R = 3, height h = 8. */
const PROFILE: ProfilePoint[] = [
  [0, 0],
  [3, 0],
  [0, 8],
];

export const cone: TfExample = {
  name: 'cone',
  label: 'cone (revolved solid)',
  cuttable: true,
  async build(opts: { cutaway?: boolean } = {}): Promise<TfDemoResult> {
    const tf = await ensureTf();
    const t = tf as any;
    const solid = tfRevolveProfile(t, PROFILE, 64);
    return tfResult(tf, t, solid, { cutaway: opts?.cutaway, cuttable: true });
  },
};
