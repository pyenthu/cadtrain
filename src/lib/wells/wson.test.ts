import { describe, it, expect } from 'vitest';
import { lintWson, parseWson, isDeviated, completionExtents, type Wson } from './wson';

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

  it('parseWson throws on invalid JSON + on fatal lint, returns warnings', () => {
    expect(() => parseWson('{ not json')).toThrow(/parse failed/);
    expect(() => parseWson(JSON.stringify({ meta: { wellName: '' } }))).toThrow(/invalid/);
    const { issues } = parseWson(JSON.stringify({ ...vertical, ch: [{ od: 99, top: 0, bot: 100 }] }));
    expect(issues.some((i) => i.level === 'warn' && i.path.includes('od'))).toBe(true);
  });
});
