/**
 * nipple_f — a downhole landing NIPPLE (female), built by revolving its exact
 * half-section around the Z axis with the reusable {@link tfRevolveProfile} lathe.
 *
 * A landing nipple is axisymmetric: a stepped tube with a PROFILED BORE that
 * carries a landing seat + a no-go shoulder so a matching lock mandrel seats and
 * cannot pass. The demo lathes g_nipple_f's exact `meta.graph` polygon (an
 * r_revolve of a CLOSED `[r,z]` half-section on the volume — see
 * `/api/primitives/source?name=g_nipple_f`).
 *
 * Half-section (r, z), a CLOSED loop, min r = 0.72 (so the through-bore gives a
 * genus-1 hollow nipple, χ=0):
 *   OUTER wall (z 0→12): (1.15,0)→(1.15,1.4)→(1.05,1.7)→(1.05,11.6)→(1.15,11.7)
 *     →(1.15,12)      — OD ≈ 2.3, a shallow relief band r=1.05 over most of the body.
 *   TOP face steps in:  (1.15,12)→(0.9,12)
 *   BORE back down (z 12→0), the landing/no-go profile:
 *     (0.9,12)→(0.9,10.8)→(0.75,10.5)  — bore necks in to the seat bore r=0.75
 *     →(0.75,5.8)→(0.8,5.6)→(0.8,5.2)→(0.75,5)  — a raised no-go land (r=0.8 band)
 *     →(0.75,3.2)→(0.72,3)→(0.72,2.4)→(0.9,2.1)  — the no-go shoulder (bore opens
 *       from 0.72 out to 0.9)
 *     →(0.9,0)        — straight bore to the bottom
 *   The bottom annulus (0.9,0)→(1.15,0) closes the loop.
 *
 * NOTE — the real g_nipple_f corners are sharp steps in `meta.graph` too, so this
 * is a faithful lathe of the literal polyline. Any manufacturing fillets/rounds
 * (seat lead-in chamfers, corner breaks) are APPROXIMATED as sharp corners here —
 * adding them would insert 2–3 short profile segments per corner; skipped so the
 * demo stays a clean readable profile. The topology (a bored, seated tube) is
 * unchanged: min r = 0.72 > 0 → every profile point is off-axis → a genus-1 solid.
 */
import { ensureTf, tfResult, type TfDemoResult } from '../trueform-client';
import { tfRevolveProfile, type ProfilePoint } from './revolve';
import type { TfExample } from './index';

/** g_nipple_f's exact half-section (r, z) — closed loop, min r = 0.72 (bored).
 *  Exported so the unit test can lathe + topology-check the REAL profile (drift-proof). */
export const NIPPLE_F_PROFILE: ProfilePoint[] = [
  [1.15, 0],
  [1.15, 1.4],
  [1.05, 1.7],
  [1.05, 11.6],
  [1.15, 11.7],
  [1.15, 12],
  [0.9, 12],
  [0.9, 10.8],
  [0.75, 10.5],
  [0.75, 5.8],
  [0.8, 5.6],
  [0.8, 5.2],
  [0.75, 5],
  [0.75, 3.2],
  [0.72, 3],
  [0.72, 2.4],
  [0.9, 2.1],
  [0.9, 0],
];

export const nipple_f: TfExample = {
  name: 'nipple_f',
  label: 'g_nipple_f (landing nipple)',
  cuttable: true,
  async build(opts: { cutaway?: boolean } = {}): Promise<TfDemoResult> {
    const tf = await ensureTf();
    const t = tf as any;
    const solid = tfRevolveProfile(t, NIPPLE_F_PROFILE, 64);
    return tfResult(tf, t, solid, { cutaway: opts?.cutaway, cuttable: true });
  },
};
