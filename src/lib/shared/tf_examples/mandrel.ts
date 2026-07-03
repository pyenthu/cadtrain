/**
 * mandrel — g_mandrel's shouldered downhole mandrel, built by revolving its exact
 * half-section around the Z axis with the reusable {@link tfRevolveProfile} lathe.
 *
 * g_mandrel (on the volume) is a pure `r_revolve` of a 10-point half-section — no
 * bore, no booleans — so this is a straight lathe (same family as `cone`/`dp_pin`).
 *
 * Half-section (r, z), a CLOSED loop that TOUCHES the axis at BOTH ends (r=0 at the
 * bottom z=0 and the top z=14), so the solid is genus-0 (χ=2), NOT hollow:
 *   (0, 0) → (0.5, 0) → (0.6, 0.15) → (0.6, 0.8) → (0.55, 1) → (0.55, 10)
 *          → (0.4, 10.4) → (0.4, 13.4) → (0.25, 13.7) → (0, 14) → close
 * Reading down the Z axis: a flat bottom face (axis→0.5), a short shoulder up to the
 * max radius 0.6, the shouldered head (0.6 over z 0.15→0.8), a step-in to the body
 * radius 0.55, the long body (z 1→10), a taper-down to 0.4, a mid section (z
 * 10.4→13.4), a final taper to 0.25, then the nose collapses to the axis apex at
 * z=14. The (0,14)→(0,0) closing edge lies ON the axis → contributes no surface; the
 * two axis endpoints collapse to single shared vertices so the fan closes cleanly.
 *
 * NOTE — corners are SHARP steps here (the lathe revolves the literal polyline). The
 * source g_mandrel has no fillets in its graph either, so this is faithful; any
 * physical fillet at the shoulder/tapers would insert 2–3 short profile segments,
 * skipped to keep the demo a clean readable profile — the topology is unchanged.
 *
 * SEGMENTS — 64 here (matching the sibling `cone`/`dp_pin` demos) for a smooth wall;
 * g_mandrel's graph used 32. Purely a tessellation choice — same watertight solid.
 */
import { ensureTf, tfResult, type TfDemoResult } from '../trueform-client';
import { tfRevolveProfile, type ProfilePoint } from './revolve';
import type { TfExample } from './index';

/** g_mandrel's exact half-section (r, z) — closed loop, touches the axis at both
 *  ends (r=0) → a SOLID genus-0 mandrel (no bore). */
const PROFILE: ProfilePoint[] = [
  [0, 0],
  [0.5, 0],
  [0.6, 0.15],
  [0.6, 0.8],
  [0.55, 1],
  [0.55, 10],
  [0.4, 10.4],
  [0.4, 13.4],
  [0.25, 13.7],
  [0, 14],
];

export const mandrel: TfExample = {
  name: 'mandrel',
  label: 'g_mandrel (revolved solid mandrel)',
  cuttable: true,
  async build(opts: { cutaway?: boolean } = {}): Promise<TfDemoResult> {
    const tf = await ensureTf();
    const t = tf as any;
    const solid = tfRevolveProfile(t, PROFILE, 64);
    return tfResult(tf, t, solid, { cutaway: opts?.cutaway, cuttable: true });
  },
};
