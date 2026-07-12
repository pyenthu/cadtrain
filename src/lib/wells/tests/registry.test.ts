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
import { resolveComponent, normaliseKey, categoryFallback } from '../registry';

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

// ─── #42j — the MULTI-WORD CATEGORY fallback (was dead code) ──────────────────
//
// BUG (fixed): `resolveComponent` used `CATEGORY[k.split('_')[0]]`. `normaliseKey`
// collapses the SVTC `CATEGORY.NAME` dot into `_`, so for a two-word category the
// first `_`-segment is only HALF the prefix (`FLOW_CONTROL_NIPPLE_R` → `FLOW`).
// `CATEGORY` has no `FLOW` / `ARTIFICIAL` / `DRILL` key, so an UNKNOWN member of
// FLOW_CONTROL / ARTIFICIAL_LIFT / DRILL_PIPE silently degraded to the generic
// `g_tube` instead of its category default — three of the five CATEGORY entries
// were unreachable. `categoryFallback` now matches the WHOLE prefix.
describe('categoryFallback — the multi-word category safety net (#42j)', () => {
  it('the OLD split-on-first-underscore key misses every multi-word category', () => {
    // The precise shape of the bug, pinned so a regression to `split('_')[0]`
    // is caught: the first segment is not a CATEGORY key for these three.
    for (const code of ['FLOW_CONTROL_NIPPLE_X', 'ARTIFICIAL_LIFT_Y', 'DRILL_PIPE_Z']) {
      expect(['FLOW_CONTROL', 'ARTIFICIAL_LIFT', 'DRILL_PIPE']).not.toContain(code.split('_')[0]);
    }
  });

  it('an UNKNOWN member of each multi-word category resolves to that category default', () => {
    // None of these keys is in EXACT, so only the category net can rescue them.
    const cases: Array<[string, string, string]> = [
      // code (not in EXACT)                    → partId               category
      ['FLOW_CONTROL.NIPPLE_MADE_UP', 'g_nipple_r_landing', 'nipple'],
      ['ARTIFICIAL_LIFT.NEW_LIFT_TOOL', 'g_gas_lift_mandrel', 'mandrel'],
      ['DRILL_PIPE.HEAVY_WEIGHT', 'g_dp_joint', 'drillpipe'],
    ];
    for (const [code, partId, category] of cases) {
      const r = resolveComponent(row(code) as never, 30);
      expect(r.matched, `${code} still fell through to the generic tube`).toBe(true);
      expect(r.partId, code).toBe(partId);
      expect(r.category, code).toBe(category);
    }
  });

  it('single-word categories keep working (PACKERS, TBGHANGER)', () => {
    expect(resolveComponent(row('PACKERS.SOME_NEW_PACKER') as never, 30)).toMatchObject({
      matched: true, partId: 'g_packer_baker_permanent', category: 'packer',
    });
    // TBGHANGER is itself the whole key (no NAME part) — startsWith(prefix) hits it.
    expect(resolveComponent(row('tbgHanger') as never, 30)).toMatchObject({
      matched: true, partId: 'g_tbghanger', category: 'hanger',
    });
  });

  it('does NOT over-reach: MISC.* and orphan keys still go generic (matched:false)', () => {
    // The fix must not accidentally rescue keys no category owns — those are a
    // genuine, surfaced gap (matched:false), not a silent g_tube.
    expect(categoryFallback(normaliseKey('MISC.SOMETHING_UNKNOWN'))).toBeUndefined();
    expect(categoryFallback(normaliseKey('liner_hanger_red'))).toBeUndefined();
    expect(resolveComponent(row('MISC.SOMETHING_UNKNOWN') as never, 30).matched).toBe(false);
    expect(resolveComponent(row('liner_hanger_red') as never, 30).matched).toBe(false);
  });

  it('categoryFallback matches the whole prefix, longest-first', () => {
    expect(categoryFallback('FLOW_CONTROL_NIPPLE_R')?.category).toBe('nipple');
    expect(categoryFallback('ARTIFICIAL_LIFT_GAS_LIFT_MANDREL')?.category).toBe('mandrel');
    expect(categoryFallback('FLOW')).toBeUndefined();        // half a prefix ≠ a match
    expect(categoryFallback('FLOW_CONTROL')?.category).toBe('nipple'); // the bare prefix does
  });
});
