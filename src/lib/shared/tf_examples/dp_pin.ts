/**
 * dp_pin — a downhole drill-pipe PIN (box-end pin), built by revolving its exact
 * half-section around the Z axis with the reusable {@link tfRevolveProfile} lathe.
 *
 * Half-section (r, z), a CLOSED loop with min r = 1.7 (so the bore gives a genus-1
 * hollow pin, χ=0):
 *   (3, 0) → (3, 4) → (2.6, 4) → (2.25, 7) → (1.7, 7) → (1.7, 0) → close
 * i.e. collar_od/2 = 3 up length_collar = 4, in upset_collar 0.4 → 2.6, taper to
 * od_body/2 = 2.25 at z = length_thd + length_collar = 7, in wall = 0.55 → 1.7
 * bore, straight down the bore to z = 0, then the bottom annulus closes the loop.
 *
 * NOTE — the ~0.45 top corner fillet on the real g_dp_pin is APPROXIMATED as a
 * sharp step here (the lathe revolves the literal polyline). A rounded corner would
 * insert 2–3 short profile segments between (3,4) and (2.6,4)/(2.25,7); skipped so
 * the demo stays a clean readable profile — the topology (hollow pin) is unchanged.
 */
import { ensureTf, tfResult, type TfDemoResult } from '../trueform-client';
import { tfRevolveProfile, type ProfilePoint } from './revolve';
import type { TfExample } from './index';

/** g_dp_pin's exact half-section (r, z) — closed loop, min r = 1.7 (bored). */
const PROFILE: ProfilePoint[] = [
  [3, 0],
  [3, 4],
  [2.6, 4],
  [2.25, 7],
  [1.7, 7],
  [1.7, 0],
];

export const dp_pin: TfExample = {
  name: 'dp_pin',
  label: 'dp_pin (revolved hollow pin)',
  cuttable: true,
  async build(opts: { cutaway?: boolean } = {}): Promise<TfDemoResult> {
    const tf = await ensureTf();
    const t = tf as any;
    const solid = tfRevolveProfile(t, PROFILE, 64);
    return tfResult(tf, t, solid, { cutaway: opts?.cutaway, cuttable: true });
  },
};
