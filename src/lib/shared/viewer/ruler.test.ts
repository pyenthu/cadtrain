import { describe, it, expect } from 'vitest';
import { rulerTicks, rulerXY, niceRulerStep } from './ruler';
import { autoNodes, lerpDTX } from '$lib/wells/dtx';

describe('niceRulerStep', () => {
  it('picks a 1/2/5×10ⁿ step giving a sane tick count', () => {
    expect(niceRulerStep(1000)).toBe(100); // ~10 ticks
    expect(niceRulerStep(3000)).toBe(500); // ~6 ticks
    expect(niceRulerStep(15)).toBe(2); // 15/1=15>12 → step 2 (~7 ticks)
    expect(niceRulerStep(10)).toBe(1);
  });
  it('falls back to 1 for a non-positive span', () => {
    expect(niceRulerStep(0)).toBe(1);
    expect(niceRulerStep(-5)).toBe(1);
  });
});

describe('rulerTicks — no DTX (linear)', () => {
  it('places ticks at multiples of step with z == depth', () => {
    const ticks = rulerTicks(0, 500, 100);
    expect(ticks.map((t) => t.depth)).toEqual([0, 100, 200, 300, 400, 500]);
    for (const t of ticks) expect(t.z).toBe(t.depth); // z == true depth
  });
  it('snaps the first tick UP to a multiple of step', () => {
    const ticks = rulerTicks(50, 320, 100);
    expect(ticks.map((t) => t.depth)).toEqual([100, 200, 300]);
  });
  it('returns [] for a degenerate range or step', () => {
    expect(rulerTicks(100, 100, 10)).toEqual([]);
    expect(rulerTicks(0, 100, 0)).toEqual([]);
    expect(rulerTicks(0, 100, -5)).toEqual([]);
    expect(rulerTicks(0, 100, NaN)).toEqual([]);
  });
});

describe('rulerTicks — with DTX (magnified interval spreads out)', () => {
  // A 20 m emphasis node inside a 1000 m well → autoNodes magnifies [100,120].
  const dtx = autoNodes([{ start: 100, end: 120 }], 1000);

  it('z is lerpDTX-remapped; depth stays the TRUE depth (for the label)', () => {
    const ticks = rulerTicks(0, 1000, 20, dtx);
    for (const t of ticks) {
      expect(t.z).toBeCloseTo(lerpDTX(dtx, t.depth), 9);
    }
    // The label value (depth) is the TRUE depth, NOT the remapped z.
    const t120 = ticks.find((t) => t.depth === 120)!;
    expect(t120.depth).toBe(120);
    expect(t120.z).not.toBeCloseTo(120, 3); // display z is stretched away from 120
  });

  it("a magnified interval's ticks are farther apart in z than an unmagnified one", () => {
    const ticks = rulerTicks(0, 1000, 20, dtx);
    const zAt = (d: number) => ticks.find((t) => t.depth === d)!.z;
    // Inside the magnified node [100,120]:
    const dzInside = zAt(120) - zAt(100);
    // Well outside it (same 20 m of TRUE depth):
    const dzOutside = zAt(320) - zAt(300);
    expect(dzInside).toBeGreaterThan(dzOutside * 3); // clearly spread apart
  });

  it('preserves endpoints (DTX total length invariant) and monotonic z', () => {
    const ticks = rulerTicks(0, 1000, 100, dtx);
    expect(ticks[0].z).toBeCloseTo(0, 6);
    expect(ticks[ticks.length - 1].z).toBeCloseTo(1000, 6);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].z).toBeGreaterThanOrEqual(ticks[i - 1].z);
    }
  });
});

describe('rulerXY — (distance, azimuth) → (x, y) around the Z axis', () => {
  it('azimuth 0° = +Y (front, toward camera)', () => {
    const { x, y } = rulerXY(30, 0);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(30, 9);
  });
  it('azimuth 90° = +X', () => {
    const { x, y } = rulerXY(30, 90);
    expect(x).toBeCloseTo(30, 9);
    expect(y).toBeCloseTo(0, 9);
  });
  it('azimuth 180° = −Y (behind)', () => {
    const { x, y } = rulerXY(30, 180);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(-30, 9);
  });
  it('radius is preserved for any azimuth', () => {
    for (const az of [17, 45, 123, 250, 359]) {
      const { x, y } = rulerXY(42, az);
      expect(Math.hypot(x, y)).toBeCloseTo(42, 9);
    }
  });
});
