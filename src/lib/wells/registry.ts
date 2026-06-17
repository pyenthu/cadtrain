/**
 * Component registry (W1) — maps a WSON `tool_comp` catalog key to a cadtrain
 * `g_*` part + how to derive its bake params from the WSON instance. This is the
 * slot SVTC's 3D scene left empty (only bakerPacker filled); cadtrain's parts
 * fill it. The 2D icon (W2) is derived from the same part's silhouette.
 *
 * Keys are normalised UPPER, dots/spaces → '_', and matched first exactly, then
 * by a category fallback (PACKERS.* → packer), then a generic tubing default.
 * Pure data + lookup — no Manifold/DOM here.
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
  | 'hanger' | 'ssd' | 'plug' | 'crossover' | 'generic';

/** Exact `tool_comp` (normalised) → cadtrain part id + category. Extend freely;
 *  unmatched keys fall through to the category/default below. */
const EXACT: Record<string, { partId: string; category: WellCompCategory }> = {
  TBGHANGER: { partId: 'g_tbghanger', category: 'hanger' },
  MISC_TUBING: { partId: 'g_tube', category: 'tubing' },
  MISC_TUBING_PUP: { partId: 'g_tubing_pup', category: 'tubing' },
  MISC_MULE_SHOE: { partId: 'g_mule_shoe', category: 'shoe' },
  MISC_BULL_PLUG: { partId: 'g_bell_guide', category: 'plug' },
  FLOW_CONTROL_NIPPLE_R_LANDING: { partId: 'g_nipple_r_landing', category: 'nipple' },
  FLOW_CONTROL_NIPPLE_R: { partId: 'g_nipple_r', category: 'nipple' },
  FLOW_CONTROL_NIPPLE_F: { partId: 'g_nipple_f', category: 'nipple' },
  FLOW_CONTROL_SSD: { partId: 'g_ssd_1', category: 'ssd' },
  PACKERS_PACKER_BAKER_PERMANENT: { partId: 'g_packer_baker_permanent', category: 'packer' },
  PACKERS_PACKER_DIRECT: { partId: 'g_packer_direct', category: 'packer' },
  PACKERS_PACKER_RDH: { partId: 'g_packer_rdh', category: 'packer' },
  ARTIFICIAL_LIFT_GAS_LIFT_MANDREL: { partId: 'g_gas_lift_mandrel', category: 'mandrel' },
  ARTIFICIAL_LIFT_SIDE_POCKET_MANDREL: { partId: 'g_side_pocket_mandrel', category: 'mandrel' },
  MISC_CROSSOVER: { partId: 'g_crossover', category: 'crossover' },
  MISC_GAUGE_MANDREL: { partId: 'g_gauge_mandrel', category: 'mandrel' },
};

/** Category prefix fallback when the exact key is unknown. */
const CATEGORY: Record<string, { partId: string; category: WellCompCategory }> = {
  PACKERS: { partId: 'g_packer_baker_permanent', category: 'packer' },
  FLOW_CONTROL: { partId: 'g_nipple_r_landing', category: 'nipple' },
  ARTIFICIAL_LIFT: { partId: 'g_gas_lift_mandrel', category: 'mandrel' },
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
  plug: '#dc2626', crossover: '#ca8a04', generic: '#6b7280',
};
