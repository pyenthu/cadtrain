/**
 * Component family classification.
 *
 * Each single-file component under `src/lib/cad/components/<id>.ts` is
 * tagged with one of these families. The /components sidebar uses the
 * mapping to:
 *
 *   1. Restrict the **Basic** tab to family='basic' (pure geometric
 *      building blocks).
 *   2. Group the **Components** tab by family with a subheading per
 *      family, and let the user toggle families on/off via a filter
 *      popup whose state lives in localStorage.
 *
 * Why a central map (not a `family` field per component file): we can
 * re-classify by editing this single file instead of 25, and any new
 * component is auto-visible (default 'basic') until classified — no
 * silent disappearance from the UI.
 */

export type Family =
  | 'basic'
  | 'casing_tubing'
  | 'drillstring'
  | 'wellhead_xt'
  | 'packers_plugs'
  | 'fishing_intervention'
  | 'artificial_lift'
  | 'flow_control';

export interface FamilyInfo {
  id: Family;
  name: string;
  description: string;
  /** Sort order for the popup + Components-tab group headers. */
  order: number;
}

export const FAMILIES: FamilyInfo[] = [
  { id: 'basic',                name: 'Basic',                       order: 0, description: 'Pure geometric building blocks — tube, taper, shoulder, cone, slotted, grooved, seal bore.' },
  { id: 'casing_tubing',        name: 'Casing & Tubing',             order: 1, description: 'Production-string members and their threaded connections (EUE, LTC, threaded box/pin).' },
  { id: 'drillstring',          name: 'Drillstring',                 order: 2, description: 'Drill pipe, tool joints, drill-collar connections (IF/FH/NC), kickoff tools.' },
  { id: 'wellhead_xt',          name: 'Wellhead & XMAS Trees',       order: 3, description: 'Casing-head spools, tubing hangers, master + wing valves, choke trees.' },
  { id: 'packers_plugs',        name: 'Packers & Bridge Plugs',      order: 4, description: 'Annular seals + zonal isolation hardware (elements, slips, locks).' },
  { id: 'fishing_intervention', name: 'Fishing & Intervention',      order: 5, description: 'Workover tools, fishing necks, GS pulling tools, jars.' },
  { id: 'artificial_lift',      name: 'Artificial Lift',             order: 6, description: 'Gas-lift mandrels, ESP, sucker-rod pumps, jet pumps.' },
  { id: 'flow_control',         name: 'Flow Control',                order: 7, description: 'ICV, ICD, sliding sleeves, chokes, downhole regulators.' },
];

export const FAMILY_BY_ID: Record<string, Family> = {
  // Basic — pure shapes + generic mechanism primitives that show up
  // in many domains (packer element / slips / J-latch are reusable
  // building blocks, not Packers-only — the user re-classified
  // 2026-05-13).
  hollow_cylinder: 'basic', taper: 'basic', shoulder: 'basic', tapered_cone: 'basic',
  slotted_cylinder: 'basic', slotted_tube: 'basic', grooved_cylinder: 'basic', seal_bore: 'basic',
  packer_element: 'basic', slips: 'basic', j_latch: 'basic',
  thread_helix: 'basic',
  profile_extrude_demo: 'basic',
  // Casing & Tubing
  thread_eue: 'casing_tubing', thread_ltc: 'casing_tubing',
  threaded_box: 'casing_tubing', threaded_pin: 'casing_tubing',
  threaded_pin_collared: 'casing_tubing', window_cutout: 'casing_tubing',
  // Drillstring
  thread_if: 'drillstring', thread_fh: 'drillstring', thread_nc: 'drillstring',
  drill_pipe_tool_joint: 'drillstring', conn_box: 'drillstring',
  enhanced_box: 'drillstring', whipstock: 'drillstring',
  // Wellheads & Christmas Trees
  tubing_hanger_spool: 'wellhead_xt', tubing_hanger_coupling: 'wellhead_xt',
  // Flow Control
  sliding_sleeve: 'flow_control',
};

/** Family for a component id. Unknown ids default to 'basic' so new
 *  files are visible in the Basic tab until they're explicitly
 *  classified here. */
export function familyOf(componentId: string): Family {
  return FAMILY_BY_ID[componentId] ?? 'basic';
}

/** Default set for the filter popup: every non-basic family enabled. */
export function defaultEnabledFamilies(): Set<Family> {
  return new Set(FAMILIES.filter((f) => f.id !== 'basic').map((f) => f.id));
}

const STORAGE_KEY = 'cad:enabledFamilies';

/** Read the persisted enabled-families set from localStorage. Falls
 *  back to defaults on any read/parse error (privacy mode, corrupt
 *  JSON, missing key). */
export function loadEnabledFamilies(): Set<Family> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultEnabledFamilies();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr.filter((s): s is Family => FAMILIES.some((f) => f.id === s)));
  } catch {
    return defaultEnabledFamilies();
  }
}

/** Persist the enabled-families set to localStorage. Silently ignores
 *  failures (the in-memory state remains authoritative for the session). */
export function saveEnabledFamilies(enabled: Set<Family>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...enabled]));
  } catch { /* private mode etc. */ }
}

// ─── Basic-tab complexity levels ──────────────────────────────────────────
//
// Inside the Basic tab (family='basic') we further classify primitives by
// complexity LEVEL so the user can transition from atomic shapes up to
// composite features. The filter UX mirrors the Family filter on the
// Parts tab — same funnel button, same FloatingPanel popup, same
// localStorage persistence — just operates on a different axis.
//
// Levels are scoped to family='basic' only. Components in other
// families don't have a level and aren't displayed in the Basic tab.

export type Level = 1 | 2;

export interface LevelInfo {
  id: Level;
  name: string;
  description: string;
  /** Sort order in the popup + Basic-tab group headers. */
  order: number;
}

export const LEVELS: LevelInfo[] = [
  { id: 1, name: 'Level 1 — Atomic shapes', order: 0, description: 'Pure geometry: tube. No transitions or internal features.' },
  { id: 2, name: 'Level 2 — With features', order: 1, description: 'Atomic shape + a feature: taper, shoulder, tapered cone (transitions); slots, grooves, J-slots, elastomer rings.' },
];

/** Per-component complexity level within the Basic family. Components
 *  not in this map (or not family='basic') default to level 1. Edit
 *  this map to reclassify; no per-file annotation needed. */
export const LEVEL_BY_ID: Record<string, Level> = {
  // Level 1 — pure geometric primitive (tube)
  hollow_cylinder: 1,
  // Level 2 — shape with a feature: transitions (taper/shoulder/cone)
  // or feature patterns (slots, grooves, elastomers, latches)
  taper: 2, shoulder: 2, tapered_cone: 2,
  slotted_cylinder: 2, slotted_tube: 2, grooved_cylinder: 2, seal_bore: 2,
  packer_element: 2, slips: 2, j_latch: 2,
  thread_helix: 2,
  profile_extrude_demo: 2,
};

/** Level for a component id. Unknown ids default to 1. */
export function levelOf(componentId: string): Level {
  return LEVEL_BY_ID[componentId] ?? 1;
}

/** Default set for the level filter: every level enabled. */
export function defaultEnabledLevels(): Set<Level> {
  return new Set(LEVELS.map((l) => l.id));
}

const LEVEL_STORAGE_KEY = 'cad:enabledBasicLevels';

/** Read the persisted enabled-levels set from localStorage. Falls
 *  back to defaults on any read/parse error. */
export function loadEnabledLevels(): Set<Level> {
  try {
    const raw = localStorage.getItem(LEVEL_STORAGE_KEY);
    if (!raw) return defaultEnabledLevels();
    const arr = JSON.parse(raw) as number[];
    return new Set(arr.filter((n): n is Level => LEVELS.some((l) => l.id === n)));
  } catch {
    return defaultEnabledLevels();
  }
}

/** Persist the enabled-levels set to localStorage. Silently ignores
 *  failures (the in-memory state remains authoritative for the session). */
export function saveEnabledLevels(enabled: Set<Level>): void {
  try {
    localStorage.setItem(LEVEL_STORAGE_KEY, JSON.stringify([...enabled]));
  } catch { /* private mode etc. */ }
}
