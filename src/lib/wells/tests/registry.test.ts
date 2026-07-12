/**
 * Registry coverage against the REAL WSON corpus (TODO #42j).
 *
 * The 14 keys below are every distinct `tool_comp` appearing across the 10-well
 * template corpus (canonical copy: `~/code/SVTC/.dev-volume/samples/schematics/`),
 * harvested by running each well through `resolveComponent`. They are inlined
 * rather than read from that sibling repo so this test is hermetic.
 *
 * The point of the test is the `matched` flag. An unmatched key does not fail
 * loudly — `resolveComponent` returns the GENERIC `g_tube`, so a side-pocket
 * mandrel silently renders as a plain pipe. This pins which keys are genuinely
 * unsupported (they need parts that don't exist) and guards against a key
 * regressing from matched → generic.
 */
import { describe, it, expect } from 'vitest';
import { resolveComponent, normaliseKey } from '../registry';

/** tool_comp → the `bw_*`-adjacent `g_*` part it must resolve to. */
const MATCHED: Array<[string, string]> = [
  ['MISC.TUBING', 'g_tube'],
  ['MISC.TUBING_PUP', 'g_tubing_pup'],
  ['tbgHanger', 'g_tbghanger'],
  ['FLOW_CONTROL.NIPPLE_R_LANDING', 'g_nipple_r_landing'],
  ['MISC.MULE_SHOE', 'g_mule_shoe'],
  ['PACKERS.PACKER_BAKER_PERMANENT', 'g_packer_baker_permanent'],
  ['FLOW_CONTROL.TRSSV_FLAPPER', 'g_trssv_flapper'],
  ['FLOW_CONTROL.TRSSSV_SP', 'g_trsssv_sp'],
  ['MISC.GAUGE_MANDREL', 'g_gauge_mandrel'],
  ['PACKERS.PACKER_AHR_AHC', 'g_packer_ahr_ahc'],
  ['FLOW_CONTROL.SSD_1', 'g_ssd_1'],
  // #42j — the corpus files the side-pocket mandrel under MISC., not
  // ARTIFICIAL_LIFT. 6 real instances (wells 03, 06) used to fall through.
  ['MISC.SIDE_POCKET_MANDREL', 'g_side_pocket_mandrel'],
];

/** Keys the corpus uses that we genuinely have no part for. Listed so the gap
 *  is visible; each is a real `components_missing_from_catalogue` entry. */
const KNOWN_UNMATCHED = [
  'liner_hanger_red', // wells 07, 08 — no liner-hanger part exists
  'MISC.PUP_PERF',    // wells 05, 10 — perforated pup, no part exists
];

const row = (tool_comp: string) => ({ tool_comp, od: 2.875, top: 0, bot: 30 });

describe('registry — coverage of the 10-well corpus', () => {
  it.each(MATCHED)('resolves %s → %s (matched)', (code, partId) => {
    const r = resolveComponent(row(code) as never, 30);
    expect(r.matched, `${code} fell back to the generic tube`).toBe(true);
    expect(r.partId).toBe(partId);
  });

  it.each(KNOWN_UNMATCHED)('%s is unmatched — and says so', (code) => {
    const r = resolveComponent(row(code) as never, 30);
    // Not a silent success: matched:false is the signal a caller can surface.
    expect(r.matched).toBe(false);
    expect(r.partId).toBe('g_tube');
  });

  it('the MISC. side-pocket alias resolves to the SAME part as ARTIFICIAL_LIFT.', () => {
    const misc = resolveComponent(row('MISC.SIDE_POCKET_MANDREL') as never, 30);
    const artl = resolveComponent(row('ARTIFICIAL_LIFT.SIDE_POCKET_MANDREL') as never, 30);
    expect(misc.partId).toBe(artl.partId);
    expect(misc.category).toBe(artl.category);
    expect(misc.matched && artl.matched).toBe(true);
  });

  it('the CATEGORY fallback cannot rescue a MISC. key — which is why the alias is needed', () => {
    // Regression witness for #42j: MISC has no CATEGORY entry, so any unknown
    // MISC.* key goes generic. If someone adds `MISC` to CATEGORY, this flips
    // and the aliases become dead code — that deserves a deliberate decision.
    expect(normaliseKey('MISC.SOMETHING_UNKNOWN').split('_')[0]).toBe('MISC');
    const r = resolveComponent(row('MISC.SOMETHING_UNKNOWN') as never, 30);
    expect(r.matched).toBe(false);
    expect(r.partId).toBe('g_tube');
  });
});
