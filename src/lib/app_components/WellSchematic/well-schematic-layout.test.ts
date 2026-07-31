import { describe, it, expect } from 'vitest';
import {
  num,
  toStringRow,
  computeRange,
  makePlot,
  yScale,
  xForRadius,
  stringRect,
  enclosingRadius,
  depthTicks,
  buildSchematic,
  type SchematicInput,
} from './well-schematic-layout';

// A representative slice mirroring welldefault.json (Wildcat #1): concentric casing strings,
// open-hole sections, a centred tubing string, and perforations.
const SAMPLE: SchematicInput = {
  width: 380,
  height: 520,
  casings: [
    { od: 13.375, grade: 'L-80', top: 0, bot: 200 },
    { od: 9.625, grade: 'L-80', top: 0, bot: 1200 },
    { od: 7, grade: 'L-80', top: 0, bot: 2200 },
    { od: 4.5, grade: 'L-80', top: 2100, bot: 2990 },
  ],
  holes: [
    { bitSize: 17.5, top: 0, bot: 200 },
    { bitSize: 8.5, top: 1200, bot: 2200 },
    { bitSize: 6, top: 2200, bot: 3000 },
  ],
  tubing: [{ od: 2.875, top: 0, bot: 2100, label: 'Tubing 2-7/8 EUE' }],
  perforations: [
    { top: 2800, bot: 2810, color: '#FF0000', perfSpec: 'Deep penetration' },
    { top: 1850, bot: 1870, color: '#F0FF0F' },
  ],
  cement: [{ od: 9.625, top: 500, bot: 1499 }],
};

describe('num', () => {
  it('coerces + falls back on non-finite', () => {
    expect(num('4.5')).toBe(4.5);
    expect(num(undefined, 7)).toBe(7);
    expect(num('nope', 3)).toBe(3);
    expect(num(NaN, 1)).toBe(1);
  });
});

describe('toStringRow', () => {
  it('coerces od (od or bitSize) and orders top/bot', () => {
    expect(toStringRow({ od: '7', top: 100, bot: 50 })).toMatchObject({ od: 7, top: 50, bot: 100 });
    expect(toStringRow({ bitSize: 8.5, top: 0, bot: 200 }).od).toBe(8.5);
  });
});

describe('computeRange', () => {
  it('derives depth + diameter extents across all inputs', () => {
    const r = computeRange(SAMPLE);
    expect(r.minDepth).toBe(0);
    expect(r.maxDepth).toBe(3000); // deepest open-hole bot
    expect(r.maxDia).toBe(17.5); // widest bit
  });
  it('honours explicit overrides', () => {
    const r = computeRange({ ...SAMPLE, maxDepth: 4000, maxDia: 20 });
    expect(r.maxDepth).toBe(4000);
    expect(r.maxDia).toBe(20);
  });
  it('never collapses to a zero span', () => {
    const r = computeRange({});
    expect(r.maxDepth).toBeGreaterThan(r.minDepth);
    expect(r.maxDia).toBeGreaterThan(0);
  });
});

describe('scales', () => {
  const range = computeRange(SAMPLE);
  const plot = makePlot(380, 520);
  it('yScale maps top→margin.top and maxDepth→bottom', () => {
    expect(yScale(0, range, plot)).toBeCloseTo(plot.margin.top);
    expect(yScale(range.maxDepth, range, plot)).toBeCloseTo(plot.margin.top + plot.plotH);
  });
  it('yScale is monotonic downward (deeper = larger y — Z-down)', () => {
    expect(yScale(1000, range, plot)).toBeGreaterThan(yScale(500, range, plot));
  });
  it('xForRadius centres at 0 and is symmetric', () => {
    expect(xForRadius(0, range, plot)).toBeCloseTo(plot.cx);
    const rPos = xForRadius(5, range, plot);
    const rNeg = xForRadius(-5, range, plot);
    expect(rPos - plot.cx).toBeCloseTo(plot.cx - rNeg);
  });
  it('xForRadius hits the plot edge at max radius', () => {
    expect(xForRadius(range.maxDia / 2, range, plot)).toBeCloseTo(plot.cx + plot.plotW / 2);
  });
});

describe('stringRect', () => {
  const range = computeRange(SAMPLE);
  const plot = makePlot(380, 520);
  it('is centred and width scales with od', () => {
    const wide = stringRect(toStringRow({ od: 13.375, top: 0, bot: 200 }), range, plot, {
      fill: '#fff',
      stroke: '#000',
    });
    const narrow = stringRect(toStringRow({ od: 4.5, top: 0, bot: 200 }), range, plot, {
      fill: '#fff',
      stroke: '#000',
    });
    expect(wide.cx).toBeCloseTo(plot.cx);
    expect(wide.x + wide.w / 2).toBeCloseTo(plot.cx); // symmetric about the axis
    expect(wide.w).toBeGreaterThan(narrow.w);
    expect(wide.h).toBeGreaterThan(0);
  });
});

describe('enclosingRadius', () => {
  const range = computeRange(SAMPLE);
  const plot = makePlot(380, 520);
  const casings = SAMPLE.casings!.map(toStringRow);
  it('hangs a perf off the innermost casing spanning the depth', () => {
    // At 2810 only the 4.5" liner (2100-2990) spans → its wall radius.
    const rLiner = enclosingRadius(2810, casings, range, plot);
    const expected = Math.abs(xForRadius(4.5 / 2, range, plot) - plot.cx);
    expect(rLiner).toBeCloseTo(expected);
  });
  it('falls back to the outer edge when no casing encloses the depth', () => {
    const r = enclosingRadius(9999, casings, range, plot);
    expect(r).toBeCloseTo(Math.abs(xForRadius(range.maxDia / 2, range, plot) - plot.cx));
  });
});

describe('depthTicks', () => {
  it('returns count ticks spanning the range inclusively', () => {
    const range = computeRange(SAMPLE);
    const plot = makePlot(380, 520);
    const ticks = depthTicks(range, plot, 7);
    expect(ticks).toHaveLength(7);
    expect(ticks[0].depth).toBe(0);
    expect(ticks[6].depth).toBe(3000);
    // y increases with depth
    expect(ticks[6].y).toBeGreaterThan(ticks[0].y);
  });
});

describe('buildSchematic', () => {
  const view = buildSchematic(SAMPLE);
  it('produces every layer with finite coordinates', () => {
    expect(view.casings.length).toBe(4);
    expect(view.holes.length).toBe(3);
    expect(view.tubing.length).toBe(1);
    expect(view.perfs.length).toBe(2);
    const allRects = [...view.casings, ...view.holes, ...view.tubing, ...view.cement];
    for (const r of allRects) {
      for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isFinite(v)).toBe(true);
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
    }
    for (const p of view.perfs) {
      for (const v of [p.yTop, p.yBot, p.xLeft, p.xRight]) expect(Number.isFinite(v)).toBe(true);
    }
  });
  it('paints casings widest-first (so inner strings overlay)', () => {
    const ods = view.casings.map((c) => c.od);
    expect(ods).toEqual([...ods].sort((a, b) => b - a));
    expect(ods[0]).toBe(13.375);
  });
  it('carries perf colour + label through', () => {
    expect(view.perfs[0].color).toBe('#FF0000');
    expect(view.perfs[0].label).toBe('Deep penetration');
  });
  it('drops degenerate rows (od<=0 or bot<=top)', () => {
    const v = buildSchematic({
      casings: [
        { od: 7, top: 0, bot: 100 },
        { od: 0, top: 0, bot: 100 }, // bad od
        { od: 5, top: 100, bot: 100 }, // zero height
      ],
    });
    expect(v.casings.length).toBe(1);
  });
  it('is resilient to an empty input', () => {
    const v = buildSchematic({});
    expect(v.casings).toEqual([]);
    expect(v.depthTicks.length).toBeGreaterThan(0);
    expect(Number.isFinite(v.plot.cx)).toBe(true);
  });
  it('grows contentWidth past the plot width to fit a long right-side perf label', () => {
    const narrow = { width: 260, height: 400 };
    const noLbl = buildSchematic({ ...narrow, casings: [{ od: 7, top: 0, bot: 300 }] });
    const withLbl = buildSchematic({
      ...narrow,
      casings: [{ od: 7, top: 0, bot: 300 }],
      perforations: [{ top: 100, bot: 120, label: 'A very long perforation description that would clip' }],
    });
    expect(withLbl.contentWidth).toBeGreaterThan(noLbl.contentWidth);
    expect(withLbl.contentWidth).toBeGreaterThan(narrow.width);
  });
});
