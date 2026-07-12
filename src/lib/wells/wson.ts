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

/** NORSOK D-010 well-barrier role — for Well-Barrier-Schematic colouring
 *  (primary = blue, secondary = red, none = uncoloured). */
export type BarrierRole = 'primary' | 'secondary' | 'none';

/** A single cemented depth span (metres, Z-down). Used for STAGE cementing
 *  (DV tool) where set cement occupies two-or-more DISJOINT intervals. */
export interface CementSpan { top: number; bot: number; }

/** Per-string cement SPEC (#996) — the ONLY authored cement input in the derived
 *  model. Cement is NOT an authored `{od,id}` part: its geometry is DERIVED
 *  (nearest outer boundary − casing OD) from the casing/hole program, so only the
 *  AXIAL extent + barrier metadata are authored here.
 *   - `toc` — top of cement (metres, shallower than the string shoe). The single
 *     [toc, shoe] cemented span.
 *   - `intervals` — OVERRIDES `toc` for STAGE cementing (disjoint spans).
 *   - `role` — NORSOK barrier role (blue/red WBS colouring).
 *   - `verified` — barrier verification status (bond log / displacement calc).
 *  ADDITIVE / optional: a string with no `cement` is UNCEMENTED — we never invent
 *  a TOC (an invented cement top is a false barrier claim, per the research doc). */
export interface CasingCement {
  toc?: number;
  intervals?: CementSpan[];
  role?: BarrierRole;
  verified?: boolean;
}

/** A cased-hole / tubular string. OD/ID inches; top/bot metres. */
export interface CasingString {
  od: number; id?: number; top: number; bot: number;
  grade?: string; weight?: number; type?: CasingType;
  /** Per-string cement spec (#996). Absent ⇒ uncemented (no cement derived). */
  cement?: CasingCement;
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
  /** AUTO-TOP anchoring (SVTC parity, TODO #25). Default (absent / not `false`) =
   *  AUTO: this item's `top` follows the PREVIOUS item's `bot`, so a string is
   *  authored top-to-bottom and stays contiguous when an upstream length changes.
   *  `false` = MANUAL: the item holds its own absolute MD (an SSSV / profile
   *  nipple / ESP piece pinned at a fixed depth) and the chain resumes after it.
   *  Resolved by `recomputeAutoTops`. */
  autoTop?: boolean;
  /** RENDER-only multiplier on the drawn OD (SVTC parity) — visual emphasis, does
   *  NOT change the modelled OD. Absent ⇒ 1. */
  od_multiplier?: number;
  /** Joint count + average joint length (m) — carried by real completion reports
   *  (the Desktop `xlsxtowson` cases) for tallies; not load-bearing for geometry. */
  noJoints?: number;
  avgJointLength?: number;
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

/** Re-pin completion tops through the AUTO-TOP chain (SVTC's `recomputeAutoTops`,
 *  TODO #25 — ground truth `~/code/SVTC/src/lib/apps/wson/WsonApp.svelte`). Walk
 *  the list top-to-bottom:
 *    - an AUTO item (`autoTop !== false`, the DEFAULT) starts at the PREVIOUS
 *      item's `bot`, PRESERVING its own length, so the string stays contiguous
 *      when an upstream length is edited;
 *    - a MANUAL item (`autoTop === false`) HOLDS its own absolute MD (a fixed-
 *      depth SSSV / profile nipple / ESP piece) and the chain resumes after it;
 *    - the first item always holds its own top (no predecessor).
 *  An item's length is `bot - top` (a length-only row falls back to its `length`
 *  field), so "editing a length drives `bot = top + len`". PURE — returns new
 *  rows, never mutates its input. This is the anchor model both a completions
 *  worksheet and the WSON→graph translator resolve depths through. */
export function recomputeAutoTops(comps: Completion[]): Completion[] {
  const lengthOf = (c: Completion): number => {
    const span = (c.bot as number) - (c.top as number);
    if (Number.isFinite(span)) return span;
    return Number.isFinite(c.length as number) ? (c.length as number) : 0;
  };
  const out: Completion[] = [];
  let prevBot = 0;
  comps.forEach((c, i) => {
    const isAuto = c.autoTop !== false;
    if (isAuto && i > 0) {
      const top = prevBot;
      const bot = top + lengthOf(c);
      out.push({ ...c, top, bot });
      prevBot = bot;
    } else {
      // Manual, or the first row: hold this item's MD. A row lacking an absolute
      // top is anchored at the running cursor (0 for the first row).
      const top = Number.isFinite(c.top as number) ? (c.top as number) : prevBot;
      const bot = Number.isFinite(c.bot as number) ? (c.bot as number) : top + lengthOf(c);
      out.push({ ...c, top, bot });
      prevBot = bot;
    }
  });
  return out;
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
  // Per-string cement spec (#996): TOC shallower than the shoe; interval ordering.
  ch.forEach((c, i) => {
    const cem = c.cement;
    if (!cem) return;
    if (cem.toc != null && !(cem.toc < c.bot)) {
      warn(`ch[${i}].cement.toc`, `TOC ${cem.toc} must be shallower than shoe ${c.bot}`);
    }
    (cem.intervals ?? []).forEach((iv, j) => {
      if (!(iv.top < iv.bot)) err(`ch[${i}].cement.intervals[${j}]`, `top ${iv.top} must be < bot ${iv.bot}`);
    });
  });

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
