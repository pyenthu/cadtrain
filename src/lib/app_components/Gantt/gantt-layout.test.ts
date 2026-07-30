import { describe, it, expect } from 'vitest';
import {
  normalizeRows,
  computeRange,
  groupByLane,
  barGeometry,
  statusColor,
  statusLegend,
  axisTicks,
  STATUS_COLORS,
} from './gantt-layout';

describe('gantt-layout — normalizeRows', () => {
  it('coerces records + fills sensible defaults', () => {
    const rows = normalizeRows([
      { id: 1, label: 'A', lane: 'X', start: 2, end: 5, status: 'open', details: 'd' },
    ]);
    expect(rows).toEqual([{ id: 1, label: 'A', lane: 'X', start: 2, end: 5, status: 'open', details: 'd' }]);
  });

  it('drops non-objects and falls back id→index, label→"Task n", lane→default, status→open', () => {
    const rows = normalizeRows([null, 3, { start: 1 }]);
    expect(rows).toHaveLength(1); // only the object survives; its original index is 2
    expect(rows[0]).toMatchObject({ id: 2, label: 'Task 3', lane: 'default', start: 1, end: 1, status: 'open' });
  });

  it('derives end from a duration field when mapped (a /plan {start,weeks} record)', () => {
    const rows = normalizeRows([{ id: 9, start: 1.3, weeks: 0.2 }], { duration: 'weeks' });
    expect(rows[0].start).toBe(1.3);
    expect(rows[0].end).toBeCloseTo(1.5, 6);
  });

  it('never produces a negative-width bar (end clamps to >= start)', () => {
    const rows = normalizeRows([{ id: 1, start: 5, end: 2 }]);
    expect(rows[0].end).toBe(5);
  });

  it('non-array input → empty', () => {
    expect(normalizeRows(undefined)).toEqual([]);
    expect(normalizeRows({} as unknown)).toEqual([]);
  });

  it('honors a custom field map', () => {
    const rows = normalizeRows([{ key: 7, name: 'Bar', track: 'L', s: 0, e: 3, st: 'done' }], {
      id: 'key',
      label: 'name',
      lane: 'track',
      start: 's',
      end: 'e',
      status: 'st',
    });
    expect(rows[0]).toMatchObject({ id: 7, label: 'Bar', lane: 'L', start: 0, end: 3, status: 'done' });
  });
});

describe('gantt-layout — computeRange', () => {
  const rows = normalizeRows([
    { id: 1, start: 1, end: 3 },
    { id: 2, start: 2, end: 6 },
  ]);

  it('auto extent covers min start .. max end', () => {
    expect(computeRange(rows)).toEqual({ min: 1, max: 6, span: 5 });
  });

  it('explicit overrides win', () => {
    expect(computeRange(rows, 0, 10)).toEqual({ min: 0, max: 10, span: 10 });
  });

  it('empty rows → 0..1', () => {
    expect(computeRange([])).toEqual({ min: 0, max: 1, span: 1 });
  });

  it('degenerate max<=min widens by 1 (never divides by zero)', () => {
    const r = computeRange([{ id: 1, label: 'x', lane: 'a', start: 4, end: 4, status: 'open' }]);
    expect(r.span).toBe(1);
    expect(r.max).toBe(5);
  });
});

describe('gantt-layout — groupByLane', () => {
  it('buckets by lane, preserving first-seen order', () => {
    const rows = normalizeRows([
      { id: 1, lane: 'B', start: 0, end: 1 },
      { id: 2, lane: 'A', start: 0, end: 1 },
      { id: 3, lane: 'B', start: 1, end: 2 },
    ]);
    const lanes = groupByLane(rows);
    expect(lanes.map((l) => l.lane)).toEqual(['B', 'A']);
    expect(lanes[0].rows.map((r) => r.id)).toEqual([1, 3]);
    expect(lanes[1].rows.map((r) => r.id)).toEqual([2]);
  });
});

describe('gantt-layout — barGeometry', () => {
  const range = { min: 0, max: 10, span: 10 };
  it('places left + width as percentages of the track', () => {
    const g = barGeometry({ id: 1, label: 'x', lane: 'a', start: 2, end: 7, status: 'open' }, range);
    expect(g.leftPct).toBeCloseTo(20, 6);
    expect(g.widthPct).toBeCloseTo(50, 6);
  });
  it('a zero-length bar has width 0 (min-width handled in CSS)', () => {
    const g = barGeometry({ id: 1, label: 'x', lane: 'a', start: 5, end: 5, status: 'open' }, range);
    expect(g.widthPct).toBe(0);
  });
});

describe('gantt-layout — status colours + legend', () => {
  it('maps known statuses; unknown falls back to open', () => {
    expect(statusColor('done')).toBe(STATUS_COLORS.done);
    expect(statusColor('active')).toBe(STATUS_COLORS.active);
    expect(statusColor('mystery')).toBe(STATUS_COLORS.open);
  });
  it('legend counts distinct statuses', () => {
    const rows = normalizeRows([
      { id: 1, status: 'open', start: 0, end: 1 },
      { id: 2, status: 'open', start: 0, end: 1 },
      { id: 3, status: 'done', start: 0, end: 1 },
    ]);
    const lg = statusLegend(rows);
    expect(lg.find((l) => l.status === 'open')?.count).toBe(2);
    expect(lg.find((l) => l.status === 'done')?.count).toBe(1);
  });
});

describe('gantt-layout — axisTicks', () => {
  it('emits count+1 ticks spanning 0..100%', () => {
    const t = axisTicks({ min: 0, max: 12, span: 12 }, 6);
    expect(t).toHaveLength(7);
    expect(t[0]).toEqual({ value: 0, leftPct: 0 });
    expect(t[6]).toEqual({ value: 12, leftPct: 100 });
    expect(t[3].value).toBeCloseTo(6, 6);
  });
});
