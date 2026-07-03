/**
 * s_tube_no_ext — the DEFECT-2 DEMO: a curved hollow tube built the WRONG way (NO
 * bore extension), to SEE the degenerate triangles the bore-extend prevents.
 *
 * Identical to s_tube_demo (outer solid sweep MINUS inner solid sweep → a hollow
 * pipe) EXCEPT:
 *  1. a MORE CURVED path (a ~110° circular arc, so the end caps are strongly
 *     TILTED — the worst case for the mesh boolean), and
 *  2. the inner (bore) sweep is swept along the SAME path as the outer — it is
 *     NOT extended past the ends (no `extendPathEnds`).
 *
 * Because both tubes end at the SAME tilted plane, their caps are coincident. The
 * exact mesh boolean can't cleanly resolve two coincident tilted caps → it stitches
 * a fan of degenerate / sliver triangles and phantom handles (defect-2: the result
 * is still closed + manifold, but χ is wrong — genus inflated — and the caps are a
 * visible tangle). This is the SAME failure `s_tube_demo` avoids by punching the
 * bore through the caps (`extendPathEnds`, BORE_EXT). Compare the two in the TF tab:
 * this one shows the degenerate fan; s_tube_demo (and the compiled s_tube_demo/
 * s_tub_st, since executeTfRecipe now bore-extends subtrahends) come back clean.
 */
import { ensureTf, tfResult, capOpenEnds, buildOpenCurve, type TfDemoResult } from '../trueform-client';
import type { TfExample } from './index';

const OUTER_R = 0.6;
const INNER_R = 0.5;
const SAMPLES = 40;      // path resolution
const RADIAL = 32;       // section circle segments
const ARC_R = 3;         // bend radius
const ARC_SWEEP = Math.PI * 0.6; // ~108° — clearly curved → strongly tilted end caps

/** A smooth circular-arc path in the X–Z plane (flat [n*3] the tube sweeps along).
 *  The non-axial end tangents make the swept end caps TILTED — the defect trigger. */
function arcPath(samples = SAMPLES): Float32Array {
  const out = new Float32Array(samples * 3);
  for (let i = 0; i < samples; i++) {
    const a = (i / (samples - 1)) * ARC_SWEEP;
    out[i * 3] = ARC_R * Math.sin(a);
    out[i * 3 + 1] = 0;
    out[i * 3 + 2] = ARC_R * (1 - Math.cos(a));
  }
  return out;
}

export const s_tube_no_ext: TfExample = {
  name: 's_tube_no_ext',
  label: 's_tube NO bore-extend (defect-2 demo · curved)',
  cuttable: true,
  async build(opts: { cutaway?: boolean } = {}): Promise<TfDemoResult> {
    const tf = await ensureTf();
    const t = tf as any;
    const path = arcPath();
    const n = path.length / 3;
    // BOTH sweeps on the SAME path — no bore extension → coincident tilted caps.
    const outer = capOpenEnds(t, t.tubeMesh(buildOpenCurve(t, path, n), OUTER_R, RADIAL));
    const inner = capOpenEnds(t, t.tubeMesh(buildOpenCurve(t, path, n), INNER_R, RADIAL));
    const solid = t.booleanDifference(outer, inner).mesh; // defect-2 lives here
    return tfResult(tf, t, solid, { cutaway: opts?.cutaway, cuttable: true });
  },
};
