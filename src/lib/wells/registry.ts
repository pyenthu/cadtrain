/**
 * Component registry (W1) — maps a WSON `tool_comp` catalog key to a cadtrain
 * `g_*` part + how to derive its bake params from the WSON instance. This is the
 * slot SVTC's 3D scene left empty (only bakerPacker filled); cadtrain's parts
 * fill it. The 2D icon (W2) is derived from the same part's silhouette.
 *
 * Keys are normalised UPPER, dots/spaces → '_', and matched first exactly, then
 * by a category fallback (PACKERS.* → packer), then a generic tubing default.
 * Pure data + lookup — no Manifold/DOM here.
 *
 * TWO registries live here:
 *  1. `EXACT`/`CATEGORY` (completions) — in-string `g_*` completion parts keyed
 *     by `tool_comp`; resolved via `resolveComponent`.
 *  2. `STRUCTURAL` (well body) — the parametric `bw_*` element library
 *     (casing / open-hole / cement / tubing) keyed by well-part kind; resolved
 *     via `resolveStructural`. These are the parts the assembler places for the
 *     wellbore itself, where od/id/wall/length are REAL parametric inputs.
 *
 * Every partId below is a real volume part and every param key maps to that part's
 * actual `meta.params`. VERIFIED 2026-07-10 via READ-ONLY GET
 * `/api/primitives/source?name=<id>` against the running dev server (which proxies
 * `source` to prod): all 44 `g_*` completion ids + all 4 `bw_*` structural ids
 * (48 total from `listRegisteredPartIds()`) resolved 200; 0 unresolved.
 * NB: the local `.dev-volume/cache` is NOT the source of truth — it only holds
 * parts that have been baked LOCALLY (~26 `g_*`), so a missing cache entry does
 * NOT mean the part is absent; check `/api/primitives/source` (prod).
 */
import type { Completion } from './wson';

/** A resolved component: which cadtrain part to bake + its params. */
export interface ResolvedComponent {
  partId: string;            // cadtrain g_* part id (or '' → generic tube fallback)
  /** Params to feed the part bake, derived from the WSON instance (OD, length…). */
  params: Record<string, number | string>;
  /** Display category for colour/icon grouping. */
  category: WellCompCategory;
  matched: boolean;          // false → fell back to the generic tube
}

export type WellCompCategory =
  | 'tubing' | 'packer' | 'nipple' | 'mandrel' | 'valve' | 'shoe'
  | 'hanger' | 'ssd' | 'plug' | 'crossover' | 'drillpipe' | 'generic';

/** Exact `tool_comp` (normalised) → cadtrain part id + category. Every partId is
 *  a real volume part. Keys follow the SVTC catalog `CATEGORY.NAME` convention
 *  (→ normalised `CATEGORY_NAME`); unmatched keys fall through to the category /
 *  generic default below. Extend freely as new volume parts land. */
const EXACT: Record<string, { partId: string; category: WellCompCategory }> = {
  // ── Hangers ──────────────────────────────────────────────────────────────
  TBGHANGER: { partId: 'g_tbghanger', category: 'hanger' },
  // ── Tubulars / misc ──────────────────────────────────────────────────────
  MISC_TUBING: { partId: 'g_tube', category: 'tubing' },
  MISC_TUBING_PUP: { partId: 'g_tubing_pup', category: 'tubing' },
  MISC_FLOW_PUP_LOWER: { partId: 'g_flow_pup_lower', category: 'tubing' },
  MISC_FLOW_PUP_UPPER: { partId: 'g_flow_pup_upper', category: 'tubing' },
  MISC_MULE_SHOE: { partId: 'g_mule_shoe', category: 'shoe' },
  MISC_MULE_SHOE_RECIPROCATING: { partId: 'g_mule_shoe_reciprocating', category: 'shoe' },
  MISC_MULE_SHOE_SHEARABLE: { partId: 'g_mule_shoe_shearable', category: 'shoe' },
  MISC_BULL_PLUG: { partId: 'g_bell_guide', category: 'plug' },
  MISC_BELL_GUIDE: { partId: 'g_bell_guide', category: 'plug' },
  MISC_CROSSOVER: { partId: 'g_crossover', category: 'crossover' },
  MISC_EXPANSION_JOINT: { partId: 'g_expansion_joint', category: 'crossover' },
  MISC_TRAVEL_JOINT: { partId: 'g_travel_joint', category: 'crossover' },
  MISC_UNION_ADJUSTABLE: { partId: 'g_union_adjustable', category: 'crossover' },
  MISC_GAUGE_MANDREL: { partId: 'g_gauge_mandrel', category: 'mandrel' },
  MISC_MANDREL: { partId: 'g_mandrel', category: 'mandrel' },
  // ── Flow control — nipples ───────────────────────────────────────────────
  FLOW_CONTROL_NIPPLE_R_LANDING: { partId: 'g_nipple_r_landing', category: 'nipple' },
  FLOW_CONTROL_NIPPLE_R: { partId: 'g_nipple_r', category: 'nipple' },
  FLOW_CONTROL_NIPPLE_R_PARVEEN: { partId: 'g_nipple_r_parveen', category: 'nipple' },
  FLOW_CONTROL_NIPPLE_F: { partId: 'g_nipple_f', category: 'nipple' },
  FLOW_CONTROL_NIPPLE_BX: { partId: 'g_nipple_bx', category: 'nipple' },
  FLOW_CONTROL_NIPPLE_BN: { partId: 'g_nipple_bn', category: 'nipple' },
  FLOW_CONTROL_NIPPLE_BXN: { partId: 'g_nipple_bxn', category: 'nipple' },
  FLOW_CONTROL_NIPPLE_AR_NO_GO: { partId: 'g_nipple_ar_no_go', category: 'nipple' },
  // ── Flow control — valves / SSDs ─────────────────────────────────────────
  FLOW_CONTROL_SSD: { partId: 'g_ssd_1', category: 'ssd' },
  FLOW_CONTROL_SSD_1: { partId: 'g_ssd_1', category: 'ssd' },
  FLOW_CONTROL_TRSSV_BALL: { partId: 'g_trssv_ball', category: 'valve' },
  FLOW_CONTROL_TRSSV_FLAPPER: { partId: 'g_trssv_flapper', category: 'valve' },
  FLOW_CONTROL_TRSSSV_SP: { partId: 'g_trsssv_sp', category: 'valve' },
  // ── Packers ──────────────────────────────────────────────────────────────
  PACKERS_PACKER_BAKER_PERMANENT: { partId: 'g_packer_baker_permanent', category: 'packer' },
  PACKERS_PACKER_BAKER_SIGNATURE_DF: { partId: 'g_packer_baker_signature_df', category: 'packer' },
  PACKERS_PACKER_DIRECT: { partId: 'g_packer_direct', category: 'packer' },
  PACKERS_PACKER_RDH: { partId: 'g_packer_rdh', category: 'packer' },
  PACKERS_PACKER_RH: { partId: 'g_packer_rh', category: 'packer' },
  PACKERS_PACKER_ASV: { partId: 'g_packer_asv', category: 'packer' },
  PACKERS_PACKER_AHR_AHC: { partId: 'g_packer_ahr_ahc', category: 'packer' },
  PACKERS_PACKER_MHR_RATCH: { partId: 'g_packer_mhr_ratch', category: 'packer' },
  PACKERS_PACKER_SAND_CONTROL_PIN_DOWN: { partId: 'g_packer_sand_control_pin_down', category: 'packer' },
  PACKERS_PACKER_SAND_CTROL_CTRL_BX_DN: { partId: 'g_packer_sand_ctrol_ctrl_bx_dn', category: 'packer' },
  PACKERS_AHC_PACKER: { partId: 'g_ahc_packer', category: 'packer' },
  // ── Artificial lift ──────────────────────────────────────────────────────
  ARTIFICIAL_LIFT_GAS_LIFT_MANDREL: { partId: 'g_gas_lift_mandrel', category: 'mandrel' },
  ARTIFICIAL_LIFT_SIDE_POCKET_MANDREL: { partId: 'g_side_pocket_mandrel', category: 'mandrel' },
  // ── Drill pipe ─────────────────────────────────────────────────────────────
  DRILL_PIPE_JOINT: { partId: 'g_dp_joint', category: 'drillpipe' },
  DRILL_PIPE_BOX: { partId: 'g_dp_box', category: 'drillpipe' },
  DRILL_PIPE_PIN: { partId: 'g_dp_pin', category: 'drillpipe' },
  DRILL_PIPE_STAND: { partId: 'g_dp_stand', category: 'drillpipe' },
};

/** Category prefix fallback when the exact key is unknown. */
const CATEGORY: Record<string, { partId: string; category: WellCompCategory }> = {
  PACKERS: { partId: 'g_packer_baker_permanent', category: 'packer' },
  FLOW_CONTROL: { partId: 'g_nipple_r_landing', category: 'nipple' },
  ARTIFICIAL_LIFT: { partId: 'g_gas_lift_mandrel', category: 'mandrel' },
  DRILL_PIPE: { partId: 'g_dp_joint', category: 'drillpipe' },
  TBGHANGER: { partId: 'g_tbghanger', category: 'hanger' },
};

const GENERIC = { partId: 'g_tube', category: 'tubing' as WellCompCategory };

export function normaliseKey(key: string): string {
  return String(key ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Resolve a completion to a cadtrain part + bake params. Params map OD (in) →
 *  the part's `od`/`outerOD` (W1.3 reconciles exact param names per part via
 *  /api/primitives/source); length (m→in or kept) → `length`. */
export function resolveComponent(c: Completion, lengthM: number): ResolvedComponent {
  const k = normaliseKey(c.tool_comp);
  const hit = EXACT[k] ?? CATEGORY[k.split('_')[0]];
  const base = hit ?? GENERIC;
  const params: Record<string, number | string> = { ...(c.params ?? {}) };
  if (c.od != null) params.od = c.od;
  if (lengthM > 0) params.length = lengthM;
  return { partId: base.partId, params, category: base.category, matched: !!hit };
}

/** Colour per category — used by the 3D scene + 2D icons until per-part tint. */
export const CATEGORY_COLOR: Record<WellCompCategory, string> = {
  tubing: '#9ca3af', packer: '#be185d', nipple: '#2563eb', mandrel: '#7c3aed',
  valve: '#0891b2', shoe: '#b45309', hanger: '#15803d', ssd: '#db2777',
  plug: '#dc2626', crossover: '#ca8a04', drillpipe: '#0f766e', generic: '#6b7280',
};

// ─── Structural element library (bw_* parts) ─────────────────────────────────
// The well BODY (casing / open-hole / cement / tubing) is drawn from the
// parametric `bw_*` element library — unlike the mostly-fixed `g_*` completion
// catalogue, these take real od/id/wall/length inputs. The assembler maps each
// wellbore section-kind → a `bw_*` part here so /wells can bake the body through
// the SAME graph pipeline as everything else (no bespoke geometry).

/** The wellbore section kinds that resolve to a parametric `bw_*` element. */
export type WellElementKind = 'casing' | 'openhole' | 'cement' | 'tubing';

/** A resolved structural element: which `bw_*` part to bake + its params. */
export interface ResolvedStructural {
  partId: string;
  /** Params fed to the part bake, mapped to the part's real `meta.params`
   *  (od / wall / length; od/length in the WSON's inches/metres, matching
   *  `resolveComponent`). */
  params: Record<string, number>;
  matched: boolean;   // always true — every kind has a bw_* part
}

/** Wellbore section-kind → parametric `bw_*` volume part. Every id is a real
 *  volume part with od/length (+ wall where hollow) params. */
const STRUCTURAL: Record<WellElementKind, string> = {
  casing: 'bw_casing',        // params: od, wall, length, segments, top
  openhole: 'bw_open_hole',   // params: od, length, segments
  cement: 'bw_cement',        // params: od, wall, length, segments
  tubing: 'bw_prod_tubing',   // params: od, wall, length
};

/** Dimensions pulled from a WSON section (all inches). `id` present ⇒ hollow
 *  tubular ⇒ a `wall` is derived; open-hole/cement pass od only. */
export interface StructuralDims { od: number; id?: number; wall?: number; }

/** Resolve a wellbore section-kind + its WSON dimensions to a `bw_*` part + bake
 *  params. `lengthM` is the section's depth-span (metres), forwarded as `length`
 *  the same way `resolveComponent` does — display/scene scaling stays downstream.
 *  `wall` is derived from (od-id)/2 when an id is known (casing/tubing), matching
 *  each part's real `meta.params`. */
export function resolveStructural(
  kind: WellElementKind,
  dims: StructuralDims,
  lengthM: number,
): ResolvedStructural {
  const partId = STRUCTURAL[kind];
  const params: Record<string, number> = {};
  if (dims.od != null) params.od = dims.od;
  if (lengthM > 0) params.length = lengthM;
  // Derive wall only for the hollow tubulars that expose it (casing/tubing).
  if (kind === 'casing' || kind === 'tubing') {
    const wall = dims.wall ?? (dims.od != null && dims.id != null ? (dims.od - dims.id) / 2 : undefined);
    if (wall != null && wall > 0) params.wall = wall;
  }
  return { partId, params, matched: true };
}

/** Every part id the wells engine can instantiate — the completion catalogue
 *  (EXACT + CATEGORY + generic) plus the structural `bw_*` library. Used by
 *  tests + a future inspector to verify each id resolves against the volume. */
export function listRegisteredPartIds(): string[] {
  const ids = new Set<string>();
  for (const v of Object.values(EXACT)) ids.add(v.partId);
  for (const v of Object.values(CATEGORY)) ids.add(v.partId);
  ids.add(GENERIC.partId);
  for (const v of Object.values(STRUCTURAL)) ids.add(v);
  return [...ids].sort();
}
