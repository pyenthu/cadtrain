import { describe, it, expect } from 'vitest';
import { rulerTicks, rulerXY, niceRulerStep, rulerTicksWarped, type RulerFrameAt } from './ruler';
import { splineFrameSampler } from '$lib/engines/manifold/warp-spline';
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

describe('rulerTicksWarped — ticks ride the (bent) trajectory, offset ⊥ the path', () => {
  // A STRAIGHT vertical frame: pos = (0,0,s); N = +X (side), B = +Y (up/front).
  const straight: RulerFrameAt = (s) => ({ pos: [0, 0, s], N: [1, 0, 0], B: [0, 1, 0] });

  it('azimuth 0° pushes along +B (matches the straight ruler +Y front)', () => {
    const [t] = rulerTicksWarped([{ depth: 100, z: 40 }], straight, 30, 0);
    expect(t.depth).toBe(100);
    expect(t.pos[0]).toBeCloseTo(0, 9);   // no N
    expect(t.pos[1]).toBeCloseTo(30, 9);  // +B · distance
    expect(t.pos[2]).toBeCloseTo(40, 9);  // on-path z = station
  });

  it('azimuth 90° pushes along +N (side)', () => {
    const [t] = rulerTicksWarped([{ depth: 0, z: 10 }], straight, 30, 90);
    expect(t.pos[0]).toBeCloseTo(30, 9);  // +N · distance
    expect(t.pos[1]).toBeCloseTo(0, 9);
    expect(t.pos[2]).toBeCloseTo(10, 9);
  });

  it('the offset is always ⊥ the tangent (distance preserved off the path)', () => {
    // A bent frame: at s the tangent tilts, but N/B stay a unit basis ⊥ it.
    const bent: RulerFrameAt = (s) => {
      const a = s * 0.01;
      return { pos: [Math.sin(a) * 50, 0, s], N: [Math.cos(a), 0, -Math.sin(a)], B: [0, 1, 0] };
    };
    for (const s of [0, 25, 60]) {
      const [t] = rulerTicksWarped([{ depth: s, z: s }], bent, 12, 45);
      const p = bent(s).pos;
      const d = Math.hypot(t.pos[0] - p[0], t.pos[1] - p[1], t.pos[2] - p[2]);
      expect(d).toBeCloseTo(12, 6); // exactly `distance` from the on-path point
    }
  });
});

describe('splineFrameSampler — feeds rulerTicksWarped for a real spline', () => {
  it('a straight vertical spline reproduces a straight ruler line (x==0)', () => {
    // cp as [x, y, z] triples (what resampleSpline emits), purely vertical (y const).
    const { total, frameAt } = splineFrameSampler([[0, 0, 0], [0, 0, 100]]);
    expect(total).toBeCloseTo(100, 3);
    const ticks = rulerTicksWarped([{ depth: 0, z: 0 }, { depth: 50, z: 50 }, { depth: 100, z: 100 }], frameAt, 20, 90);
    // Offset azimuth 90 = +N; for a vertical planar spline N = ±X, so y stays ~0 and
    // z tracks the station.
    for (const t of ticks) expect(Math.abs(t.pos[1])).toBeLessThan(1e-6);
    expect(ticks[2].pos[2]).toBeGreaterThan(ticks[0].pos[2]); // deeper tick is farther down-hole
  });

  it('a bent spline makes the ruler bend: tick x tracks the trajectory offset', () => {
    // An L-ish spline (x,z plane, y const) that kicks out in +x as it descends.
    const { frameAt } = splineFrameSampler([[0, 0, 0], [0, 0, 40], [40, 0, 80], [80, 0, 80]]);
    const ticks = rulerTicksWarped([{ depth: 0, z: 0 }, { depth: 80, z: 80 }], frameAt, 5, 0);
    // The deep tick has moved out in +x relative to the shallow one (the well bent).
    expect(ticks[1].pos[0]).toBeGreaterThan(ticks[0].pos[0] + 10);
  });
});
