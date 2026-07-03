/**
 * dp_joint — a downhole drill-pipe JOINT (the volume `g_dp_joint` assembly, but in
 * TrueForm): a female BOX end (top) + a hollow PIPE body + a male PIN end (bottom),
 * each LATHED from its closed half-section with {@link tfRevolveProfile}, stacked
 * end-to-end along Z, then `booleanUnion`-ed into ONE watertight solid whose bores
 * line up into a single continuous through-bore.
 *
 * ── The three half-sections (r, z), each a CLOSED loop revolved 360° ────────────
 * All three are BORED (min r > 0) → each alone is a genus-1 tube (χ=0); stacked
 * coaxially with their bores aligned they union into ONE genus-1 tube (χ=0).
 *
 *   BOX  (g_dp_box, sharp-corner approx of the collar→body fillet):
 *     (3,0)→(3,4)→(2.25,4)→(2.25,5.5)→(1.7,5.5)→(1.7,3)→(2.25,3)→(2.6,0.01)→close
 *     collar_od/2=3 · od_body/2=2.25 · wall=0.55 (bore 1.7) · length_collar=4 ·
 *     length_collar+length_body=5.5 · length_thd=3 · collar_upset→2.6 near-face.
 *     Z-local 0 (box FACE, the female mouth) → 5.5 (body end, welds to the pipe).
 *     NOTE the ~0.5 collar→body fillet is APPROXIMATED as a sharp step (the lathe
 *     revolves the literal polyline); topology (a bored socket) is unchanged.
 *
 *   TUBE (g_tube, od 4.5 / id 3.5 hollow cylinder):
 *     (2.25,0)→(2.25,L)→(1.75,L)→(1.75,0)→close     (L = length_pipe demo, 8)
 *     od_body/2=2.25 · bore 1.75 (wall 0.5). Z-local 0 → L.
 *
 *   PIN  (g_dp_pin — the SAME profile the dp_pin demo revolves, imported):
 *     (3,0)→(3,4)→(2.6,4)→(2.25,7)→(1.7,7)→(1.7,0)→close
 *     collar_od/2=3 (z 0→4) · upset→2.6 · taper to od_body/2=2.25 at z=7 · bore 1.7.
 *     Z-local 0 (collar, welds to the pipe) → 7 (threaded nose, the free end).
 *
 * ── Z-stack (Z-DOWN: top = LOWER z, downhole = +z; matches g_dp_joint's box↔pipe↔
 *    pin order so the bores line up) ──────────────────────────────────────────────
 * No flips — every part's Z-local axis already runs face→downhole, so each is placed
 * with a plain +Z offset (baked into the profile z, so the lathed points are already
 * in world coords — no `.transformation` needed; the alternative is `makeTranslation`).
 * A small {@link OVERLAP} is baked into each junction so adjacent solids INTERPENETRATE
 * (not merely touch at a coplanar face) → the mesh boolean welds them into a clean
 * watertight manifold instead of leaving a coincident-face seam (the tf boolean caveat).
 *
 *     BOX : z ∈ [0, 5.5]                       (face at 0)
 *     TUBE: z ∈ [5.5−OVERLAP, 5.5−OVERLAP+L]   (top tucked into the box bottom)
 *     PIN : z ∈ [pinTop, pinTop+7]             (collar tucked into the pipe bottom)
 *
 * The bores (box 1.7 / tube 1.75 / pin 1.7) all overlap in radius at every junction,
 * so the interior voids merge into ONE continuous through-bore; the pin's collar
 * (r=3) and box collar (r=3) stand proud of the pipe (r=2.25) as the tool-joint upsets.
 */
import { ensureTf, tfResult, type TfDemoResult } from '../trueform-client';
import { tfRevolveProfile, type ProfilePoint } from './revolve';
import { PIN_PROFILE } from './dp_pin';
import type { TfExample } from './index';

/** Demo pipe-body length (g_dp_joint's `length_pipe`, shortened for the demo). */
const PIPE_LEN = 8;
/** Junction interpenetration so the boolean union welds cleanly (not a coplanar kiss). */
const OVERLAP = 0.1;

/** Box (female) end half-section — sharp-corner approx of g_dp_box (see file header). */
const BOX_PROFILE: ProfilePoint[] = [
  [3, 0],
  [3, 4],
  [2.25, 4],
  [2.25, 5.5],
  [1.7, 5.5],
  [1.7, 3],
  [2.25, 3],
  [2.6, 0.01],
];

/** Hollow pipe body half-section — od_body/2=2.25, bore 1.75, length L. */
function tubeProfile(len: number): ProfilePoint[] {
  return [
    [2.25, 0],
    [2.25, len],
    [1.75, len],
    [1.75, 0],
  ];
}

/** Shift every profile point down-hole by `dz` (bake the Z-stack offset into z). */
function offsetZ(profile: readonly ProfilePoint[], dz: number): ProfilePoint[] {
  return profile.map(([r, z]) => [r, z + dz] as ProfilePoint);
}

// ── Z offsets (see header) — box at 0, pipe tucked under it, pin under the pipe. ──
const BOX_BOTTOM = 5.5;
const TUBE_DZ = BOX_BOTTOM - OVERLAP;
const PIN_DZ = TUBE_DZ + PIPE_LEN - OVERLAP;

/** The three world-space (Z-offset baked-in) half-sections — exported for the pure
 *  unit test (each revolves to a watertight genus-1 tube; ranges overlap). */
export const JOINT_PARTS: { name: string; profile: ProfilePoint[] }[] = [
  { name: 'box', profile: offsetZ(BOX_PROFILE, 0) },
  { name: 'tube', profile: offsetZ(tubeProfile(PIPE_LEN), TUBE_DZ) },
  { name: 'pin', profile: offsetZ(PIN_PROFILE, PIN_DZ) },
];

export const dp_joint: TfExample = {
  name: 'dp_joint',
  label: 'g_dp_joint (box+pipe+pin)',
  cuttable: true,
  async build(opts: { cutaway?: boolean } = {}): Promise<TfDemoResult> {
    const tf = await ensureTf();
    const t = tf as any;
    // Lathe each closed profile → a watertight bored tube (positivelyOriented inside).
    const [box, tube, pin] = JOINT_PARTS.map((p) => tfRevolveProfile(t, p.profile, 64));
    // Weld the three into ONE solid (2 unions); overlap makes each a clean manifold merge.
    let joint = t.booleanUnion(box, tube).mesh;
    joint = t.booleanUnion(joint, pin).mesh;
    // Enforce one consistent outward orientation on the merged solid (harmless if
    // already positive) — same guard the revolve/cap helpers use.
    try { joint = t.positivelyOriented(joint); } catch { /* keep the union as-is */ }
    return tfResult(tf, t, joint, { cutaway: opts?.cutaway, cuttable: true });
  },
};
