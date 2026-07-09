/**
 * test-profiles — closed 2D sections used to exercise the pure grid builders
 * (`tf-weld`, `sweep-section`). Test-only: the `weld_extrude` demo that used to
 * export `roundedRect` was removed with the demo-selector path (`ae0f6b1`), but
 * the builder guards still need a deliberately NON-circular section to prove
 * they handle arbitrary profiles and not just `tubeMesh`'s fixed circle.
 *
 * Not matched by vitest's `*.{test,spec}.ts` include glob, so it stays a plain
 * helper module rather than an empty suite.
 */

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
