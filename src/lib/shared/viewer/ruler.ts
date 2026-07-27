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

type V3 = [number, number, number];
/** A frame at arc-length `s` along the (warped) spline: the trajectory point `pos`
 *  and a right-handed perpendicular basis (`N`, `B`). Supplied by
 *  `warp-spline.splineFrameSampler` so the ruler follows the SAME curve as the geometry. */
export type RulerFrameAt = (s: number) => { pos: V3; N: V3; B: V3 };

/** One WARPED ruler tick: its TRUE depth (label) + its 3D world position on the
 *  offset ruler line beside the deviated trajectory. */
export interface RulerTickWarped { depth: number; pos: V3; }

/**
 * Warped ruler ticks — for a DEVIATED part, each tick sits on the trajectory at
 * arc-length `s = tick.z` (the DTX display-depth), pushed PERPENDICULAR to the path by
 * `distance` in the `azimuth` direction of the spline's local frame:
 *   pos = P(s) + distance·(cos az·N(s) + sin az·B(s))
 * `azimuth` mirrors `rulerXY` (0° = +B/front → cos·B? no): to match the straight-ruler
 * convention where 0° = +Y and 90° = +X, we map cos·(frame's "up"/B-ish) — here N is the
 * side axis and B the up axis, so azimuth 0 = +B (up/front), 90° = +N (side). The label
 * always shows the TRUE depth. So the ruler bends with the well + stays registered.
 */
export function rulerTicksWarped(
  ticks: RulerTick[],
  frameAt: RulerFrameAt,
  distance: number,
  azimuthDeg: number,
): RulerTickWarped[] {
  const a = ((azimuthDeg || 0) * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  return ticks.map((t) => {
    const { pos, N, B } = frameAt(t.z);
    // Offset in the N/B plane: azimuth 0 → +B (matches straight ruler's +Y front),
    // 90° → +N (side). d·(sa·N + ca·B).
    return {
      depth: t.depth,
      pos: [
        pos[0] + distance * (sa * N[0] + ca * B[0]),
        pos[1] + distance * (sa * N[1] + ca * B[1]),
        pos[2] + distance * (sa * N[2] + ca * B[2]),
      ] as V3,
    };
  });
}
