/**
 * Depth-ruler tick math (PURE) — the tick positions + placement for the 3D
 * viewer's depth-ruler overlay (SceneControls "Ruler" section →
 * PrimitiveDualScene). Extracted here so the tick/placement arithmetic is
 * unit-testable without a browser / Threlte.
 *
 * The ruler draws a vertical tick line beside the rendered part at a radial
 * `distance` from the drilling (Z) axis and an `azimuth` around it, with ticks
 * at regular TRUE-depth intervals. When Auto-depth (DTX) is on, each tick's
 * display-space Z runs through the SAME `lerpDTX` transform as the geometry, so
 * a magnified sub-interval's ticks spread apart to match the geometry (depths
 * stay registered). The label always shows the TRUE depth.
 *
 * NB: this UI helper imports `$lib/wells/dtx` — the same stated exception
 * PrimitiveDualCanvas relies on (a viewer file may import wells/; the engine
 * layer may not).
 */
import { lerpDTX, type Dtx } from '$lib/wells/dtx';

/** One ruler tick. `depth` = the TRUE depth (for the label); `z` = the
 *  DISPLAY-space depth (DTX-remapped when a `dtx` is given, else == `depth`) —
 *  the value the scene multiplies by the view Z-scale to place the tick. */
export interface RulerTick {
  depth: number;
  z: number;
}

/**
 * A "nice" tick step (1 / 2 / 5 × 10ⁿ) so a depth `span` yields roughly
 * `maxTicks` ticks or fewer. Mirrors the 2D schematic ruler
 * (`src/lib/wells/wson-2d.ts`). `span <= 0` → a safe fallback of 1.
 */
export function niceRulerStep(span: number, maxTicks = 12): number {
  if (!(span > 0)) return 1;
  const raw = span / 8;
  const exp = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  return [1, 2, 5, 10].map((m) => m * exp).find((m) => span / m <= maxTicks) ?? raw;
}

/**
 * Ticks at every `step` of TRUE depth from `depthMin` to `depthMax` (inclusive
 * of the end within an epsilon). The first tick is snapped UP to a multiple of
 * `step` so labels read 0, 100, 200… rather than starting on a ragged min.
 *
 * `z` is the DISPLAY-space depth: `lerpDTX(dtx, depth)` when a DTX is supplied
 * (so a magnified interval's ticks are farther apart), else `z === depth`.
 * `depth` is always the TRUE depth (what the label shows).
 *
 * Returns `[]` for a non-positive range or step.
 */
export function rulerTicks(depthMin: number, depthMax: number, step: number, dtx?: Dtx): RulerTick[] {
  const out: RulerTick[] = [];
  if (!(depthMax > depthMin) || !(step > 0) || !Number.isFinite(step)) return out;
  // Snap the first tick up to a multiple of `step`.
  const first = Math.ceil(depthMin / step - 1e-9) * step;
  // Guard against a pathological (tiny step / huge span) blow-up.
  const maxTicks = 100000;
  let n = 0;
  for (let d = first; d <= depthMax + 1e-6 && n < maxTicks; d += step, n++) {
    const depth = Math.abs(d) < 1e-9 ? 0 : d; // normalise -0 → 0
    out.push({ depth, z: dtx ? lerpDTX(dtx, depth) : depth });
  }
  return out;
}

/**
 * (distance, azimuth°) → the local (x, y) offset of the ruler around the Z
 * (drilling) axis. Mirrors the scene's `zDirAngle` bearing convention:
 * 0° = +Y (front, toward the camera), 90° = +X, 180° = −Y (behind).
 */
export function rulerXY(distance: number, azimuthDeg: number): { x: number; y: number } {
  const a = ((azimuthDeg || 0) * Math.PI) / 180;
  return { x: distance * Math.sin(a), y: distance * Math.cos(a) };
}
