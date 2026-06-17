import { describe, it, expect } from 'vitest';
import { assembleWell } from './assemble';
import { resolveComponent, normaliseKey } from './registry';
import type { Wson } from './wson';

describe('component registry (W1)', () => {
  it('maps known tool_comp keys to cadtrain parts', () => {
    expect(resolveComponent({ tool_comp: 'PACKERS.PACKER_BAKER_PERMANENT', od: 8.6 }, 0.5).partId).toBe('g_packer_baker_permanent');
    expect(resolveComponent({ tool_comp: 'MISC.MULE_SHOE' }, 1).partId).toBe('g_mule_shoe');
    expect(resolveComponent({ tool_comp: 'FLOW_CONTROL.NIPPLE_R_LANDING' }, 0.3).partId).toBe('g_nipple_r_landing');
    expect(resolveComponent({ tool_comp: 'tbgHanger' }, 0.5).partId).toBe('g_tbghanger');
  });
  it('falls back by category then generic tube', () => {
    expect(resolveComponent({ tool_comp: 'PACKERS.UNKNOWN_X' }, 1).category).toBe('packer');
    const g = resolveComponent({ tool_comp: 'WHO.KNOWS' }, 1);
    expect(g.matched).toBe(false);
    expect(g.partId).toBe('g_tube');
  });
  it('derives od + length params', () => {
    const r = resolveComponent({ tool_comp: 'MISC.TUBING', od: 2.875 }, 1025);
    expect(r.params.od).toBe(2.875);
    expect(r.params.length).toBe(1025);
  });
  it('normaliseKey', () => {
    expect(normaliseKey('Flow_Control.Nipple R Landing')).toBe('FLOW_CONTROL_NIPPLE_R_LANDING');
  });
});

describe('well assembler (W1)', () => {
  const vertical: Wson = {
    meta: { wellName: 'V', td: 1070 },
    oh: [{ bitSize: 12.25, top: 300, bot: 1070 }],
    ch: [{ od: 9.625, id: 8.681, top: 0, bot: 1070, type: 'production' }],
    completions: [
      { tool_comp: 'MISC.TUBING', od: 2.875, top: 0, bot: 1028 },
      { tool_comp: 'MISC.MULE_SHOE', od: 2.875, length: 2 },  // 1028 → 1030
    ],
    perforations: [{ top: 1040, bot: 1060 }],
  };

  it('places parts z-down with true depths; tracks tvdMax + maxOd', () => {
    const a = assembleWell(vertical);
    expect(a.parts.length).toBe(5); // oh + casing + 2 completions + perf
    const casing = a.parts.find((p) => p.kind === 'casing')!;
    expect(casing.pTop[2]).toBe(0);      // top at z=0
    expect(casing.pBot[2]).toBe(1070);   // bottom deeper (z-down)
    expect(a.tvdMax).toBe(1070);
    expect(a.maxOdIn).toBeCloseTo(12.25);
    expect(a.deviated).toBe(false);
  });

  it('resolves the completion stack to parts by depth (cumulative length)', () => {
    const a = assembleWell(vertical);
    const shoe = a.parts.find((p) => p.partId === 'g_mule_shoe')!;
    expect(shoe.top).toBe(1028);
    expect(shoe.bot).toBe(1030);
    expect(shoe.pBot[2]).toBe(1030);
  });

  it('deviated survey bends the trajectory off-axis', () => {
    const dev: Wson = {
      ...vertical,
      profile: [{ md: 0, dev: 0, az: 90 }, { md: 500, dev: 0, az: 90 }, { md: 1070, dev: 90, az: 90 }],
    };
    const a = assembleWell(dev);
    expect(a.deviated).toBe(true);
    const casing = a.parts.find((p) => p.kind === 'casing')!;
    // Bottom is displaced east (az=90) and TVD < MD because of the build.
    expect(casing.pBot[0]).toBeGreaterThan(0);   // east displacement
    expect(casing.pBot[2]).toBeLessThan(1070);   // tvd shallower than MD
  });
});
