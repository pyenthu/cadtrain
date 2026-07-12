/**
 * sketchColLayout — the pure column-layout seam for the sketch card
 * (docs/plans/sketch-multicolumn.md, PR-1 step 1). Pins:
 *  (a) cols=1 reproduces the LEGACY single-column walk byte-for-byte
 *      (yTop = 36 + Σ sketchEntryH(prior ops)) — so the on-graph card and all
 *      snapshots are stable when the feature is off.
 *  (b) cols=2/3 partition the ops into CONTIGUOUS ranges, never split an op,
 *      keep tallestH ≤ the single-column total, and report innerW correctly.
 */
import { describe, it, expect } from 'vitest';
import {
  sketchColLayout,
  sketchEntryH,
  SKETCH_COL_W,
  SKETCH_COL_GAP,
} from '../sketch-layout';

/** A mixed op list — lines (45) + a fillet (24) + a spline (45) + a chamfer (24). */
const mixed = () => [
  { op: 'line', r: 0, z: 0 },
  { op: 'line', r: 2, z: 0 },
  { op: 'fillet', radius: 0.5 },
  { op: 'line', r: 2, z: 2 },
  { op: 'spline', r: 1, z: 3 },
  { op: 'chamfer', dist: 0.3 },
  { op: 'line', r: 0, z: 2 },
];

/** The legacy formula, copied verbatim from the pre-PR-1 sketchRowTop walk. */
const legacyRowTop = (ops: any[], idx: number) => {
  let y = 36; // header + divider
  for (let i = 0; i < Math.min(idx, ops.length); i++) y += sketchEntryH(ops[i]);
  return y;
};

describe('sketchColLayout — cols=1 byte-identity', () => {
  it('yTop matches the legacy 36 + Σ sketchEntryH(prior) for every op', () => {
    const ops = mixed();
    const cl = sketchColLayout(ops, 1);
    expect(cl.columns).toHaveLength(1);
    expect(cl.columns[0]).toHaveLength(ops.length);
    for (let i = 0; i < ops.length; i++) {
      expect(cl.byIdx[i].yTop).toBe(legacyRowTop(ops, i));
      expect(cl.byIdx[i].x).toBe(0); // every cell hangs at the left edge
      expect(cl.byIdx[i].col).toBe(0);
      expect(cl.byIdx[i].idx).toBe(i);
    }
  });

  it('cols=1 innerW = SKETCH_COL_W and tallestH = total op height', () => {
    const ops = mixed();
    const total = ops.reduce((a, o) => a + sketchEntryH(o), 0);
    const cl = sketchColLayout(ops, 1);
    expect(cl.innerW).toBe(SKETCH_COL_W);
    expect(cl.tallestH).toBe(total);
    expect(cl.colWidth).toBe(SKETCH_COL_W);
    expect(cl.gap).toBe(SKETCH_COL_GAP);
  });

  it('empty op list → a single empty column, yTop fallback 36, tallestH 0', () => {
    const cl = sketchColLayout([], 1);
    expect(cl.columns).toEqual([[]]);
    expect(cl.tallestH).toBe(0);
    expect(cl.innerW).toBe(SKETCH_COL_W);
  });
});

describe('sketchColLayout — cols=2/3 partition', () => {
  const total = mixed().reduce((a, o) => a + sketchEntryH(o), 0);

  for (const cols of [2, 3] as const) {
    it(`cols=${cols}: contiguous ranges, no split, every op placed once`, () => {
      const ops = mixed();
      const cl = sketchColLayout(ops, cols);
      expect(cl.columns).toHaveLength(cols);

      // Concatenating the columns in column order reproduces the original op
      // order — proving each column is a contiguous, non-overlapping range and
      // no op was dropped or duplicated.
      const flat = cl.columns.flatMap((c) => c.map((cell) => cell.idx));
      expect(flat).toEqual(ops.map((_, i) => i));

      // Each column's idxs are strictly increasing & contiguous (no split).
      for (const c of cl.columns) {
        for (let j = 1; j < c.length; j++) {
          expect(c[j].idx).toBe(c[j - 1].idx + 1);
        }
      }

      // byIdx agrees with the partition for every op.
      for (let i = 0; i < ops.length; i++) {
        const cell = cl.byIdx[i];
        expect(cell.col * (SKETCH_COL_W + SKETCH_COL_GAP)).toBe(cell.x);
        expect(cl.columns[cell.col]).toContain(cell);
      }
    });

    it(`cols=${cols}: tallestH ≤ single-column total and innerW correct`, () => {
      const cl = sketchColLayout(mixed(), cols);
      expect(cl.tallestH).toBeLessThanOrEqual(total);
      expect(cl.tallestH).toBeGreaterThan(0);
      expect(cl.innerW).toBe(cols * SKETCH_COL_W + (cols - 1) * SKETCH_COL_GAP);
    });
  }

  it('cols=2: each column yTop restarts at 36 (header offset per column)', () => {
    const cl = sketchColLayout(mixed(), 2);
    for (const c of cl.columns) {
      if (c.length) expect(c[0].yTop).toBe(36);
      // within a column, yTop walks by sketchEntryH of prior ops in THAT column
      for (let j = 1; j < c.length; j++) {
        expect(c[j].yTop).toBe(c[j - 1].yTop + sketchEntryH(c[j - 1].op));
      }
    }
  });
});
