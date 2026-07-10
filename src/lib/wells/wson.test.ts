import { describe, it, expect } from 'vitest';
import { lintWson, parseWson, isDeviated, completionExtents, recomputeAutoTops, type Wson, type Completion } from './wson';

const vertical: Wson = {
  meta: { wellName: 'T-1', td: 1070, pbtd: 1062 },
  oh: [{ bitSize: 12.25, top: 300, bot: 1070 }],
  ch: [
    { od: 13.375, id: 12.4, top: 0, bot: 300, type: 'surface' },
    { od: 9.625, id: 8.681, top: 0, bot: 1070, type: 'production' },
  ],
  perforations: [{ top: 1040, bot: 1060, label: 'Main' }],
  completions: [{ tool_comp: 'PACKERS.BAKER', od: 8.681, top: 1028, bot: 1028.5 }],
  cementing: [{ od: 9.625, top: 700, bot: 1070 }],
};

describe('WSON model (W0)', () => {
  it('lints a clean vertical well with no errors', () => {
    expect(lintWson(vertical).filter((i) => i.level === 'error')).toHaveLength(0);
  });

  it('flags missing well name + bad ordering + nesting', () => {
    const bad: Wson = {
      meta: { wellName: '' },
      ch: [{ od: 9.625, top: 0, bot: 300 }, { od: 13.375, top: 0, bot: 1000 }], // deeper = larger OD
      completions: [{ tool_comp: '', top: 5, bot: 1 }], // no key + top>bot... actually bot<top
    };
    const issues = lintWson(bad);
    expect(issues.some((i) => i.path === 'meta.wellName' && i.level === 'error')).toBe(true);
    expect(issues.some((i) => i.path.startsWith('ch[1].od') && i.message.includes('nesting'))).toBe(true);
    expect(issues.some((i) => i.path === 'completions[0].tool_comp')).toBe(true);
  });

  it('isDeviated: vertical=false, profile with dev>0=true', () => {
    expect(isDeviated(vertical)).toBe(false);
    expect(isDeviated({ ...vertical, profile: [{ md: 0, dev: 0, az: 0 }, { md: 2000, dev: 30, az: 90 }] })).toBe(true);
  });

  it('completionExtents resolves absolute + cumulative-length stacks', () => {
    const ext = completionExtents([
      { tool_comp: 'A', top: 100, bot: 110 },
      { tool_comp: 'B', length: 5 },   // 110 → 115
      { tool_comp: 'C', length: 20 },  // 115 → 135
    ]);
    expect(ext).toEqual([{ top: 100, bot: 110 }, { top: 110, bot: 115 }, { top: 115, bot: 135 }]);
  });

  it('recomputeAutoTops: an auto item follows its predecessor bot, preserving length', () => {
    // Two default (auto) items; item 1 is stale (top 999) and must be re-pinned to
    // item 0's bot (10), keeping its OWN length (5) → 10..15.
    const out = recomputeAutoTops([
      { tool_comp: 'A', top: 0, bot: 10 },
      { tool_comp: 'B', top: 999, bot: 1004 }, // len 5, stale top
    ]);
    expect(out.map((c) => [c.top, c.bot])).toEqual([[0, 10], [10, 15]]);
  });

  it('recomputeAutoTops: a manual item (autoTop=false) holds its MD and the chain resumes after it', () => {
    // Item 1 is a fixed-depth nipple at MD 500..503 (manual); item 0 (auto, first,
    // held) ends at 10, but the manual item does NOT snap to it. Item 2 (auto)
    // resumes from the manual item's bot (503), not from 10.
    const out = recomputeAutoTops([
      { tool_comp: 'TUBING', top: 0, bot: 10 },
      { tool_comp: 'SSSV', top: 500, bot: 503, autoTop: false },
      { tool_comp: 'TUBING', top: 0, bot: 2 }, // len 2, auto → 503..505
    ]);
    expect(out.map((c) => [c.top, c.bot])).toEqual([[0, 10], [500, 503], [503, 505]]);
  });

  it('recomputeAutoTops: editing a length drives bot = top + len down the whole chain', () => {
    // Grow item 0 from length 10 to length 40; every downstream auto item shifts
    // by the same 30, staying contiguous.
    const before: Completion[] = [
      { tool_comp: 'A', top: 0, bot: 10 },
      { tool_comp: 'B', top: 10, bot: 13 },  // len 3
      { tool_comp: 'C', top: 13, bot: 18 },  // len 5
    ];
    const grown = before.map((c, i) => (i === 0 ? { ...c, bot: 40 } : c));
    const out = recomputeAutoTops(grown);
    expect(out.map((c) => [c.top, c.bot])).toEqual([[0, 40], [40, 43], [43, 48]]);
  });

  it('recomputeAutoTops: is pure — it never mutates its input rows', () => {
    const input: Completion[] = [
      { tool_comp: 'A', top: 0, bot: 10 },
      { tool_comp: 'B', top: 999, bot: 1004 },
    ];
    const snapshot = JSON.parse(JSON.stringify(input));
    recomputeAutoTops(input);
    expect(input).toEqual(snapshot);
  });

  it('recomputeAutoTops: resolves the real 7-item sample-01 string to its contiguous depths', () => {
    // The SVTC vertical-land-producer completion string — already contiguous, so
    // re-pinning is a no-op and reproduces 0→0.5→1025→1025.3→1028→1028.5→1029.8→1030.
    const comps: Completion[] = [
      { tool_comp: 'tbgHanger', top: 0, bot: 0.5 },
      { tool_comp: 'MISC.TUBING', top: 0.5, bot: 1025 },
      { tool_comp: 'FLOW_CONTROL.NIPPLE_R_LANDING', top: 1025, bot: 1025.3 },
      { tool_comp: 'MISC.TUBING_PUP', top: 1025.3, bot: 1028 },
      { tool_comp: 'PACKERS.PACKER_BAKER_PERMANENT', top: 1028, bot: 1028.5 },
      { tool_comp: 'MISC.TUBING_PUP', top: 1028.5, bot: 1029.8 },
      { tool_comp: 'MISC.MULE_SHOE', top: 1029.8, bot: 1030 },
    ];
    const out = recomputeAutoTops(comps);
    expect(out.map((c) => c.top)).toEqual([0, 0.5, 1025, 1025.3, 1028, 1028.5, 1029.8]);
    expect(out.map((c) => c.bot)).toEqual([0.5, 1025, 1025.3, 1028, 1028.5, 1029.8, 1030]);
  });

  it('parseWson throws on invalid JSON + on fatal lint, returns warnings', () => {
    expect(() => parseWson('{ not json')).toThrow(/parse failed/);
    expect(() => parseWson(JSON.stringify({ meta: { wellName: '' } }))).toThrow(/invalid/);
    const { issues } = parseWson(JSON.stringify({ ...vertical, ch: [{ od: 99, top: 0, bot: 100 }] }));
    expect(issues.some((i) => i.level === 'warn' && i.path.includes('od'))).toBe(true);
  });
});
