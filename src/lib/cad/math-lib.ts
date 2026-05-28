/**
 * math-lib — the math primitives that the primitive + profile sandboxes inject
 * as BARE names. So inside a part / profile body the author can write
 *
 *     cos(i * 2 * PI / n)
 *
 * instead of
 *
 *     Math.cos(i * 2 * Math.PI / n)
 *
 * Math is still in scope unchanged (Math.cos still works), so older bodies +
 * existing curated profiles continue to build. The recognizer (parseBody)
 * strips `Math.` from extracted expressions so reloaded profiles display the
 * shorter form too.
 *
 * Wiring: primitive-sandbox.ts spreads `Object.keys(mathLib)` into
 * SANDBOX_ARG_NAMES and `Object.values(mathLib)` into sandboxArgValues();
 * profile-fn.ts adds the same names + values to its `new Function(...)`
 * constructor. ONE source of truth.
 *
 * Why a module instead of hand-rolling the bindings inside each sandbox file:
 * we get type checking on the names + values lining up, and adding a new
 * helper (e.g. lerp, clamp, deg, rad) only edits THIS file.
 */
const {
  // Functions
  abs, acos, asin, atan, atan2, ceil, cos, cosh, exp, floor, hypot,
  log, log2, log10, max, min, pow, round, sign, sin, sinh, sqrt, tan, tanh, trunc,
  // Constants
  PI, E, LN2, LN10, LOG2E, LOG10E, SQRT2, SQRT1_2,
} = Math;

// Sugar helpers — common shaping operations that aren't in Math but are useful
// in profile/part expressions. `tau` saves one keystroke vs `2 * PI`; `deg(x)`
// reads as "x in degrees" inline.
const tau = 2 * Math.PI;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const deg = (x: number) => (x * Math.PI) / 180;
const rad = (x: number) => (x * 180) / Math.PI;

export {
  abs, acos, asin, atan, atan2, ceil, cos, cosh, exp, floor, hypot,
  log, log2, log10, max, min, pow, round, sign, sin, sinh, sqrt, tan, tanh, trunc,
  PI, E, LN2, LN10, LOG2E, LOG10E, SQRT2, SQRT1_2,
  tau, lerp, clamp, deg, rad,
};
