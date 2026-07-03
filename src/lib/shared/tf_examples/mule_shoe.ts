/**
 * mule_shoe — a downhole MULE SHOE guide: a hollow tube whose mouth is cut off at
 * an ANGLE (the classic diagonal / beveled end that helps a tool re-enter/stab
 * into a restriction). Mirrors the volume part `g_mule_shoe`, which is a revolved
 * hollow body MINUS a 45°-tilted cube — a `boolean_modify` (body − tilted slab).
 *
 * Built here as: a hollow tube (`cylinderMesh` OD − a taller `cylinderMesh` ID
 * that punches through both ends → a clean genus-1 bore) MINUS a large tilted
 * `boxMesh` cutter that slices the +z end at 45°, leaving the diagonal mouth.
 *
 * Geometry (from g_mule_shoe's params — the collar step is dropped for a clean,
 * single-OD demo; the topology, a hollow angled-mouth tube, is unchanged):
 *   od_body 2.875 → OUTER_R 1.4375 · wall 0.6 → INNER_R 0.8375 (bore) ·
 *   length 14 (len_collar 2 + len_body 12) · mouth cut 45° (g_mule_shoe rotates
 *   its cutter −45° about X). The angled mouth runs from z≈2.56 up to z≈5.44.
 *
 * TILTED-CUT ROBUSTNESS: the cutter is a big box positioned so ONLY its slicing
 * face passes through the tube (its other faces are far outside), and it is
 * OFFSET so no cutter face is coincident with a tube wall — this sidesteps the
 * known TrueForm tilted-coincident-cap weakness (coplanar boolean → slivers /
 * open loops). Verified: the result comes back closed + manifold, genus-1 (χ=0),
 * with zero open boundary loops (see mule_shoe.test.ts).
 *
 * The single 4×4 cutter transform is composed with NDArray `matMul` (tf has no
 * transform-stack): T(cut) · R(45°,x) · T(0,0,+L/2) — the shift puts the box's
 * bottom face through the origin, the rotation tilts it 45°, the last translate
 * drops that tilted plane onto the axis at z = CUT_Z. tf matrices are row-major
 * column-vector (makeTranslation(1,2,3) → translation in the last column), so the
 * left-to-right matMul applies the shift first, exactly the wanted order.
 */
import { ensureTf, tfResult, type TfDemoResult } from '../trueform-client';
import type { TfExample } from './index';

/** g_mule_shoe dimensions (single-OD simplification — collar step dropped). */
const OUTER_R = 1.4375; // od_body 2.875 / 2
const INNER_R = 0.8375; // OUTER_R − wall(0.6) → the bore
const LENGTH = 14;      // len_collar(2) + len_body(12)
const MOUTH_ANGLE = 45; // g_mule_shoe cuts its mouth at 45° (cutter rot −45° x)
/** Where the 45° mouth plane crosses the axis (near the +z end of z∈[−7,7]). */
const CUT_Z = 4;
/** Cutter box edge — big enough to act as a half-space over the tube. */
const CUT_BOX = 60;

export const mule_shoe: TfExample = {
  name: 'mule_shoe',
  label: 'g_mule_shoe (angled cut)',
  cuttable: true,
  async build(opts: { cutaway?: boolean } = {}): Promise<TfDemoResult> {
    const tf = await ensureTf();
    const t = tf as any;

    // Hollow tube: outer solid − a TALLER inner cylinder so the bore punches all
    // the way through both caps (no coincident coplanar faces → clean genus-1).
    const outer = t.cylinderMesh(OUTER_R, LENGTH, 64);
    const inner = t.cylinderMesh(INNER_R, LENGTH + 2, 64);
    const tube = t.positivelyOriented(t.booleanDifference(outer, inner).mesh);

    // Angled mouth: a big box, its bottom face shifted onto the origin, tilted
    // 45° about X, then dropped onto the axis at z = CUT_Z. Offset + oversize so
    // only the tilted face intersects the tube (avoids the coincident-cap sliver).
    const cutter = t.boxMesh(CUT_BOX, CUT_BOX, CUT_BOX);
    cutter.transformation = t
      .makeTranslation(0, 0, CUT_Z)
      .matMul(t.makeRotation(MOUTH_ANGLE, 'x'))
      .matMul(t.makeTranslation(0, 0, CUT_BOX / 2));
    const solid = t.positivelyOriented(t.booleanDifference(tube, cutter).mesh);

    return tfResult(tf, t, solid, { cutaway: opts?.cutaway, cuttable: true });
  },
};
