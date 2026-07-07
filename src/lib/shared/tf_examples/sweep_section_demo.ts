/**
 * sweep_section_demo — an ARBITRARY (non-circular) 2D section swept along a bent
 * 3D path, the TrueForm way (TODO #50). Where `s_tube_demo` shows the CIRCULAR
 * `tubeMesh` sweep, this shows the general {@link tfSweepSection}: a rounded-rect
 * section transported along the path's rotation-minimizing frames (RMF) + welded
 * into a watertight solid — the capability `tubeMesh`'s fixed circular section
 * lacks, matching Manifold's `sweepAlongPath`.
 *
 * SECTION: a 12-point ROUNDED RECTANGLE (deliberately non-circular). SMOOTHING
 * (#51): the OPTIONAL Taubin relax pass is wired through `tfSweepSection`'s
 * `smooth` option — left OFF here (the rounded-rect is already clean); flip
 * `SMOOTH` to `'taubin'` to exercise the NURBS-style relax hook.
 */
import { ensureTf, tfResult, type TfDemoResult } from '../trueform-client';
import type { TfExample } from './index';
import type { V3 } from './tf-weld';
import { tfSweepSection, type SweepSmooth } from './sweep-section';
import { roundedRect } from './weld_extrude_demo';

/** A gently S-bent path (distinct 3D stations, near-vertical with x/y wiggles). */
const PATH: V3[] = [
  [0, 0, 0],
  [0.4, 0.1, 1.2],
  [0.2, -0.2, 2.4],
  [-0.3, 0.15, 3.6],
  [0, 0, 4.8],
];

/** Flip to `'taubin'` / `'laplacian'` to exercise the #51 smoothing hook. */
const SMOOTH: SweepSmooth | undefined = undefined;

export const sweep_section_demo: TfExample = {
  name: 'sweep_section_demo',
  label: 'sweep_section_demo (arbitrary-section sweep — RMF-framed)',
  cuttable: true,
  async build(opts: { cutaway?: boolean } = {}): Promise<TfDemoResult> {
    const tf = await ensureTf();
    const t = tf as any;
    const section = roundedRect(1.4, 0.9, 0.25, 3); // 12-pt non-circular loop
    const solid = tfSweepSection(t, section, PATH, {
      closedSection: true,
      caps: true,
      smooth: SMOOTH,
    });
    return tfResult(tf, t, solid, { cutaway: opts?.cutaway, cuttable: true });
  },
};
