/**
 * weld_extrude — the TrueForm analogue of Manifold's `r_weld_extrude`, built with
 * the ported welded-mesh methodology ({@link weldGridToTf}). TrueForm has no
 * native linear extrude (trueform-api-notes.md § ⛔), so we EXTRUDE a small closed
 * 2D profile along Z as an ordered (z-levels × profile) vertex grid, weld the
 * side wall + centroid-fan caps into ONE watertight solid, and hand it to the TF
 * kernel — proving TF can build arbitrary welded surfaces, not just `tubeMesh`'s
 * fixed circular section.
 *
 * Section: a 12-point ROUNDED RECTANGLE (4 corners × 3 arc samples) — deliberately
 * NON-circular, to show the arbitrary-section capability the circular `tubeMesh`
 * lacks. Extruded over 8 z-segments (9 rings) → a rounded-rect prism.
 */
import { ensureTf, tfResult, type TfDemoResult } from '../trueform-client';
import type { TfExample } from './index';
import { weldGridToTf, extrudeProfileGrid } from './tf-weld';

/**
 * A closed rounded-rectangle profile centred at the origin: overall `w × h`, corner
 * radius `r`, `stepsPerCorner` arc samples per corner → `4 * stepsPerCorner` points,
 * traversed CCW. Purely 2D `[x,y]` — the section fed to the extrude grid.
 */
export function roundedRect(
  w: number,
  h: number,
  r: number,
  stepsPerCorner: number,
): [number, number][] {
  const hw = w / 2 - r;
  const hh = h / 2 - r;
  // Corner arc centres (CCW) + the arc's start angle (each spans 90°).
  const corners: { cx: number; cy: number; a0: number }[] = [
    { cx: hw, cy: -hh, a0: -Math.PI / 2 }, // bottom-right
    { cx: hw, cy: hh, a0: 0 },             // top-right
    { cx: -hw, cy: hh, a0: Math.PI / 2 },  // top-left
    { cx: -hw, cy: -hh, a0: Math.PI },     // bottom-left
  ];
  const pts: [number, number][] = [];
  const steps = Math.max(1, Math.floor(stepsPerCorner));
  for (const { cx, cy, a0 } of corners) {
    for (let k = 0; k < steps; k++) {
      const a = a0 + (k / steps) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return pts;
}

export const weld_extrude: TfExample = {
  name: 'weld_extrude',
  label: 'weld_extrude (welded profile → solid)',
  cuttable: true,
  async build(opts: { cutaway?: boolean } = {}): Promise<TfDemoResult> {
    const tf = await ensureTf();
    const t = tf as any;
    const profile = roundedRect(4, 3, 0.8, 3); // 12-pt rounded rectangle
    const grid = extrudeProfileGrid(profile, 8, -4, 8); // 9 rings, z ∈ [-4, 4]
    const solid = weldGridToTf(t, grid, { closedV: true, caps: true });
    return tfResult(tf, t, solid, { cutaway: opts?.cutaway, cuttable: true });
  },
};
