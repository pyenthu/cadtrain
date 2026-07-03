/**
 * dp_stand — a downhole drill-pipe STAND (the volume `g_dp_stand` assembly, but in
 * TrueForm). A "stand" is the unit a rig racks back: N drill-pipe JOINTS made up
 * end-to-end (typically 2–3), each joint being a female BOX + hollow PIPE + male
 * PIN. `g_dp_stand` on the volume is literally a `stack` of `n = 3` `g_dp_joint`s;
 * this demo mirrors that — it builds N copies of the SAME joint the {@link dp_joint}
 * demo builds (reusing its exact three half-sections via the exported {@link
 * JOINT_PARTS}), shifts each copy one joint-length down-hole, and `booleanUnion`-s
 * them all into ONE watertight solid whose bores line up into a single continuous
 * through-bore.
 *
 * ── Why this stays a DEMO, not the real string ──────────────────────────────────
 * The real `g_dp_stand` is a HEAVY stack (full 30 ft pipe bodies × 3 joints — ~27 s
 * to bake on Manifold). We do NOT reproduce that. Two things keep this tf demo light:
 *   1. It reuses {@link dp_joint}'s DEMO joint, whose pipe body is shortened to
 *      PIPE_LEN = 8 (so one joint is ~20 units tall, not ~30 ft).
 *   2. {@link N_JOINTS} is capped at a representative 3, at a modest {@link SEGMENTS}
 *      revolve resolution — so the tri-count + union time stay reasonable.
 * It is therefore a REPRESENTATIVE stand (topology + make-up pattern), not the full
 * drill string.
 *
 * ── The Z-stack (Z-DOWN: top = LOWER z, down-hole = +z) ──────────────────────────
 * One joint's baked profiles (from {@link JOINT_PARTS}) span z ∈ [0, JOINT_LEN]
 * (box face at 0, pin nose at JOINT_LEN). Copy i is shifted down-hole by
 *   i × (JOINT_LEN − OVERLAP)
 * so copy i's PIN region interpenetrates copy (i+1)'s BOX region by a small {@link
 * OVERLAP} (the same trick {@link dp_joint} uses at each box↔tube↔pin junction): the
 * solids overlap rather than kiss at a coplanar face, so the mesh boolean welds them
 * into a clean watertight manifold instead of leaving a coincident-face seam. All
 * copies are coaxial and every joint's bore is ~1.7–1.75, so the interior voids merge
 * into ONE continuous through-bore ⇒ the whole stand is a single genus-1 tube (χ=0).
 */
import { ensureTf, tfResult, type TfDemoResult } from '../trueform-client';
import { tfRevolveProfile, type ProfilePoint } from './revolve';
import { JOINT_PARTS } from './dp_joint';
import type { TfExample } from './index';

/** Joints made up into this demo stand. Real stands are 2–3 joints; capped at 3
 *  (matching `g_dp_stand`'s default `n = 3`) so the tri-count + union time stay
 *  demo-sized — this is a representative stand, not the full drill string. */
export const N_JOINTS = 3;

/** Revolve resolution per joint half-section — modest (vs dp_joint's 64) so N
 *  stacked joints don't blow up the tri-count. */
export const SEGMENTS = 48;

/** Junction interpenetration between adjacent joints so the boolean union welds
 *  cleanly (not a coplanar kiss) — same value dp_joint uses inside each joint. */
export const OVERLAP = 0.1;

/** Full Z-span of ONE joint (box face → pin nose), read from dp_joint's baked
 *  world-space profiles so it tracks any change to the joint geometry. */
export const JOINT_LEN =
  Math.max(...JOINT_PARTS.flatMap((p) => p.profile.map(([, z]) => z))) -
  Math.min(...JOINT_PARTS.flatMap((p) => p.profile.map(([, z]) => z)));

/** Down-hole shift between successive joints — a full joint length minus the
 *  weld overlap (so joint i's pin tucks into joint i+1's box). */
export const JOINT_DELTA = JOINT_LEN - OVERLAP;

/** Shift every profile point down-hole by `dz` (bake the stack offset into z). */
function offsetZ(profile: readonly ProfilePoint[], dz: number): ProfilePoint[] {
  return profile.map(([r, z]) => [r, z + dz] as ProfilePoint);
}

/**
 * Every world-space half-section in the stand — N_JOINTS copies of dp_joint's
 * three parts (box/tube/pin), each copy shifted down-hole by i × JOINT_DELTA.
 * Exported for the pure unit test (each revolves to a watertight genus-1 tube;
 * adjacent joints overlap so their unions weld with bores aligned).
 */
export const STAND_PARTS: { name: string; profile: ProfilePoint[] }[] = Array.from(
  { length: N_JOINTS },
  (_, i) =>
    JOINT_PARTS.map((p) => ({
      name: `${p.name}${i}`,
      profile: offsetZ(p.profile, i * JOINT_DELTA),
    })),
).flat();

export const dp_stand: TfExample = {
  name: 'dp_stand',
  label: `g_dp_stand (${N_JOINTS} joints)`,
  cuttable: true,
  async build(opts: { cutaway?: boolean } = {}): Promise<TfDemoResult> {
    const tf = await ensureTf();
    const t = tf as any;
    // Lathe every joint half-section → a watertight bored tube (positivelyOriented
    // inside tfRevolveProfile). N_JOINTS × 3 solids, coaxial, overlapping in Z.
    const solids = STAND_PARTS.map((p) => tfRevolveProfile(t, p.profile, SEGMENTS));
    // Weld them all into ONE solid; the OVERLAP at every junction makes each a clean
    // manifold merge (box↔tube↔pin within a joint AND pin↔box between joints).
    let stand = solids[0];
    for (let k = 1; k < solids.length; k++) {
      stand = t.booleanUnion(stand, solids[k]).mesh;
    }
    // Enforce one consistent outward orientation on the merged solid (harmless if
    // already positive) — same guard the revolve/joint helpers use.
    try { stand = t.positivelyOriented(stand); } catch { /* keep the union as-is */ }
    return tfResult(tf, t, stand, { cutaway: opts?.cutaway, cuttable: true });
  },
};
