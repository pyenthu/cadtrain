/**
 * WSON — Well Schematic Object Notation (W0 of docs/plans/well-schematic.md).
 *
 * The SHARED data model for cadtrain's 3D-FIRST well schematic: the canonical
 * 3D well (parts placed along the survey by depth) AND its derived 2D schematic
 * both read this. Ported/adapted from SVTC's WSON (the 10 sample `.wson` files
 * in `~/code/SVTC/.dev-volume/samples/schematics/`).
 *
 * UNITS (SVTC convention): depths in METRES, diameters in INCHES, angles in
 * DEGREES. `tool_comp` is a catalog key `CATEGORY.NAME` that maps to a cadtrain
 * `g_*` part in the component registry (W1).
 *
 * Pure types + a Zod-free linter (mirrors SVTC's informal `validate.js`). No
 * Svelte/DOM/Three here — this is the model layer (FEM-style encapsulation).
 */

/** Catalog key — `CATEGORY.NAME`, e.g. `PACKERS.PACKER_BAKER_PERMANENT`. The
 *  registry (W1) resolves this to a cadtrain `g_*` part + a 2D icon. */
export type ToolComp = string;

export interface WellLocation {
  x?: number; y?: number; crs?: string; lon?: number; lat?: number;
}

export interface WsonMeta {
  wellName: string;
  rkbToGl?: number;      // RKB → ground-level offset (m)
  td?: number;           // total depth (m)
  pbtd?: number;         // plug-back total depth (m)
  location?: WellLocation;
  /** Free archetype tag (producer/injector/…); not load-bearing. */
  _wellType?: string;
}

/** Open-hole section. `bitSize` in inches; `top`/`bot` in metres. */
export interface OpenHoleSection { bitSize: number; top: number; bot: number; }

export type CasingType = 'conductor' | 'surface' | 'intermediate' | 'production' | 'liner' | 'tubing';

/** A cased-hole / tubular string. OD/ID inches; top/bot metres. */
export interface CasingString {
  od: number; id?: number; top: number; bot: number;
  grade?: string; weight?: number; type?: CasingType;
}

export interface Perforation {
  top: number; bot: number; label?: string; perfID?: number; color?: string;
}

/** An in-string completion component (the stack that fills SVTC's gap). Either
 *  `top`/`bot` (absolute m) or a cumulative `length` (m) from the previous. */
export interface Completion {
  description?: string;
  tool_comp: ToolComp;
  od?: number;
  top?: number; bot?: number; length?: number;
  /** Optional per-instance params forwarded to the cadtrain part bake (W1). */
  params?: Record<string, number | string>;
}

/** Annular cement interval (paired to an open-hole/casing section). */
export interface CementInterval { od: number; top: number; bot: number; }

/** A survey station — measured depth (m), deviation/inclination (°), azimuth (°).
 *  Presence of a multi-station `profile` ⇒ a deviated/horizontal well. */
export interface SurveyStation { md: number; dev: number; az: number; }

export interface Wson {
  meta: WsonMeta;
  oh?: OpenHoleSection[];
  ch?: CasingString[];
  perforations?: Perforation[];
  completions?: Completion[];
  cementing?: CementInterval[];
  profile?: SurveyStation[];
}

/** True when the well has a non-trivial survey (deviated/horizontal). */
export function isDeviated(w: Wson): boolean {
  return Array.isArray(w.profile) && w.profile.length > 1 &&
    w.profile.some((s) => Number(s.dev) > 0.5);
}

/** Resolve a completion's absolute [top, bot] in metres, accumulating `length`
 *  from the previous component's bottom when `top`/`bot` are absent. */
export function completionExtents(comps: Completion[]): { top: number; bot: number }[] {
  let cursor = 0;
  return comps.map((c) => {
    if (Number.isFinite(c.top as number) && Number.isFinite(c.bot as number)) {
      cursor = c.bot as number;
      return { top: c.top as number, bot: c.bot as number };
    }
    const len = Number.isFinite(c.length as number) ? (c.length as number) : 0;
    const top = cursor; const bot = cursor + len; cursor = bot;
    return { top, bot };
  });
}

export interface WsonIssue { level: 'error' | 'warn'; path: string; message: string; }

/** Lint a WSON document — ports SVTC's informal validate.js rules. Returns a
 *  flat issue list (does NOT throw); empty = clean. */
export function lintWson(w: Wson): WsonIssue[] {
  const out: WsonIssue[] = [];
  const err = (path: string, message: string) => out.push({ level: 'error', path, message });
  const warn = (path: string, message: string) => out.push({ level: 'warn', path, message });

  if (!w || typeof w !== 'object') { err('', 'not an object'); return out; }
  if (!w.meta?.wellName || !String(w.meta.wellName).trim()) err('meta.wellName', 'well name is required');

  // Casing: OD 1–36", top < bot, nesting (deeper string ⇒ smaller-or-equal OD).
  const ch = w.ch ?? [];
  ch.forEach((c, i) => {
    if (!(c.od >= 1 && c.od <= 36)) warn(`ch[${i}].od`, `casing OD ${c.od}" out of 1–36"`);
    if (!(c.top < c.bot)) err(`ch[${i}]`, `top ${c.top} must be < bot ${c.bot}`);
  });
  for (let i = 1; i < ch.length; i++) {
    if (ch[i].bot > ch[i - 1].bot && ch[i].od > ch[i - 1].od) {
      warn(`ch[${i}].od`, `deeper string has larger OD than ch[${i - 1}] (nesting violated)`);
    }
  }

  // Open hole + cement + perfs: ordering.
  (w.oh ?? []).forEach((o, i) => { if (!(o.top < o.bot)) err(`oh[${i}]`, `top ${o.top} must be < bot ${o.bot}`); });
  (w.cementing ?? []).forEach((c, i) => { if (!(c.top < c.bot)) err(`cementing[${i}]`, `top ${c.top} must be < bot ${c.bot}`); });
  (w.perforations ?? []).forEach((p, i) => { if (!(p.top < p.bot)) err(`perforations[${i}]`, `top ${p.top} must be < bot ${p.bot}`); });

  // Completions: OD 0.5–12", a tool_comp key, valid extents.
  (w.completions ?? []).forEach((c, i) => {
    if (!c.tool_comp || !String(c.tool_comp).trim()) err(`completions[${i}].tool_comp`, 'missing tool_comp key');
    if (c.od != null && !(c.od >= 0.5 && c.od <= 12)) warn(`completions[${i}].od`, `completion OD ${c.od}" out of 0.5–12"`);
    const hasAbs = Number.isFinite(c.top as number) && Number.isFinite(c.bot as number);
    const hasLen = Number.isFinite(c.length as number);
    if (!hasAbs && !hasLen) err(`completions[${i}]`, 'needs top+bot or length');
  });

  // Survey: monotonic MD, dev 0–180, az 0–360.
  const prof = w.profile ?? [];
  prof.forEach((s, i) => {
    if (i > 0 && !(s.md >= prof[i - 1].md)) err(`profile[${i}].md`, `MD ${s.md} not monotonic`);
    if (!(s.dev >= 0 && s.dev <= 180)) warn(`profile[${i}].dev`, `deviation ${s.dev}° out of 0–180`);
    if (!(s.az >= 0 && s.az <= 360)) warn(`profile[${i}].az`, `azimuth ${s.az}° out of 0–360`);
  });

  return out;
}

/** Parse + lint a JSON string into a Wson. Throws on bad JSON or lint ERRORS
 *  (warnings are returned for display, not fatal). */
export function parseWson(text: string): { wson: Wson; issues: WsonIssue[] } {
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch (e: any) { throw new Error(`WSON parse failed: ${e?.message ?? e}`); }
  const wson = raw as Wson;
  const issues = lintWson(wson);
  const fatal = issues.filter((i) => i.level === 'error');
  if (fatal.length) throw new Error(`WSON invalid: ${fatal.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  return { wson, issues };
}
