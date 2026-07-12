import { describe, it, expect } from 'vitest';
import { assembleWell } from '../assemble';
import {
  resolveComponent, resolveStructural, listRegisteredPartIds, normaliseKey,
} from '../registry';
import type { Wson } from '../wson';

describe('component registry (W1)', () => {
  it('maps known tool_comp keys to cadtrain parts', () => {
    expect(resolveComponent({ tool_comp: 'PACKERS.PACKER_BAKER_PERMANENT', od: 8.6 }, 0.5).partId).toBe('g_packer_baker_permanent');
    expect(resolveComponent({ tool_comp: 'MISC.MULE_SHOE' }, 1).partId).toBe('g_mule_shoe');
    expect(resolveComponent({ tool_comp: 'FLOW_CONTROL.NIPPLE_R_LANDING' }, 0.3).partId).toBe('g_nipple_r_landing');
    expect(resolveComponent({ tool_comp: 'tbgHanger' }, 0.5).partId).toBe('g_tbghanger');
  });
  it('resolves the newly-registered catalogue keys (were falling back before)', () => {
    // These appear in the sample WSON but only had a category fallback before.
    expect(resolveComponent({ tool_comp: 'PACKERS.PACKER_AHR_AHC' }, 1)).toMatchObject({ partId: 'g_packer_ahr_ahc', category: 'packer', matched: true });
    expect(resolveComponent({ tool_comp: 'FLOW_CONTROL.TRSSSV_SP' }, 1)).toMatchObject({ partId: 'g_trsssv_sp', category: 'valve', matched: true });
    // A representative from each expanded family.
    expect(resolveComponent({ tool_comp: 'FLOW_CONTROL.NIPPLE_BX' }, 1).partId).toBe('g_nipple_bx');
    expect(resolveComponent({ tool_comp: 'PACKERS.PACKER_RH' }, 1).partId).toBe('g_packer_rh');
    expect(resolveComponent({ tool_comp: 'MISC.MULE_SHOE_SHEARABLE' }, 1).partId).toBe('g_mule_shoe_shearable');
    expect(resolveComponent({ tool_comp: 'DRILL_PIPE.JOINT' }, 1)).toMatchObject({ partId: 'g_dp_joint', category: 'drillpipe' });
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

describe('structural bw_* registry (W1)', () => {
  it('maps each wellbore section-kind to its parametric bw_* part', () => {
    expect(resolveStructural('openhole', { od: 12.25 }, 770).partId).toBe('bw_open_hole');
    expect(resolveStructural('cement', { od: 9.625 }, 500).partId).toBe('bw_cement');
    expect(resolveStructural('casing', { od: 9.625, id: 8.681 }, 1070).partId).toBe('bw_casing');
    expect(resolveStructural('tubing', { od: 2.875, id: 2.441 }, 1028).partId).toBe('bw_prod_tubing');
  });
  it('forwards od + length and derives wall from (od-id)/2 for hollow tubulars', () => {
    const casing = resolveStructural('casing', { od: 9.625, id: 8.681 }, 1070);
    expect(casing.params.od).toBe(9.625);
    expect(casing.params.length).toBe(1070);
    expect(casing.params.wall).toBeCloseTo((9.625 - 8.681) / 2, 6);
    // open-hole has no id ⇒ od + length only (part's wall stays default).
    const oh = resolveStructural('openhole', { od: 12.25 }, 770);
    expect(oh.params.od).toBe(12.25);
    expect(oh.params.wall).toBeUndefined();
  });
});

describe('registered part ids (W1 — every id is a real volume part)', () => {
  it('enumerates the completion catalogue + structural library', () => {
    const ids = listRegisteredPartIds();
    // structural library
    for (const id of ['bw_casing', 'bw_open_hole', 'bw_cement', 'bw_prod_tubing']) {
      expect(ids).toContain(id);
    }
    // a spread of completion parts across families
    for (const id of ['g_packer_ahr_ahc', 'g_trsssv_sp', 'g_nipple_bx', 'g_dp_joint', 'g_mule_shoe_shearable']) {
      expect(ids).toContain(id);
    }
    // every id is a g_* or bw_* volume part id (no typos / bad prefixes)
    for (const id of ids) expect(id).toMatch(/^(g|bw)_[a-z0-9_]+$/);
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

  it('wires the structural bw_* part id onto wellbore sections', () => {
    const a = assembleWell(vertical);
    expect(a.parts.find((p) => p.kind === 'openhole')!.partId).toBe('bw_open_hole');
    expect(a.parts.find((p) => p.kind === 'casing')!.partId).toBe('bw_casing');
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
