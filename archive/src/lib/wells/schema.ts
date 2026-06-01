/**
 * WSON — Well JSON. Output schema for cadtrain's /wells extraction
 * pipeline. Mirrors the shape consumed by sister-repo SVTC's drawing
 * apps (Wson2DRenderer.svelte, Wson3DScene.svelte, FmapApp.svelte,
 * DgeoMapView.svelte). The canonical reference is SVTC's
 * src/lib/apps/wson/CLAUDE.md (lines 108–148); update this file in
 * lockstep when SVTC's shape changes.
 *
 * One root object — not an array. Sections are independent arrays,
 * any of which may be empty for a given well.
 *
 * MD = measured depth, the depth measured along the wellbore (not TVD).
 * All depths are in feet (consistent with SVTC's renderers).
 */

// ─── Top-level ───────────────────────────────────────────────────────

export interface Wson {
  meta: WsonMeta;
  oh: WsonOpenHole[];
  ch: WsonCasing[];
  cementing: WsonCementing[];
  completions: WsonCompletion[];
  perforations: WsonPerforation[];
  strata: WsonStrata[];
  profile: WsonSurveyStation[];
}

// ─── meta — well identity, template hints, surface location ──────────

export interface WsonMeta {
  /** Well name as printed on the source document. */
  wellName: string;
  /** Total depth, MD (ft). */
  td: number;
  /** RKB → GL elevation (ft). Positive = RKB above ground level. */
  rkbToGl: number;
  /** One-line description (operator, field, etc.). */
  description?: string;
  /**
   * Schematic shape hint for SVTC's 2D renderer.
   * `J` = J-shaped deviated; `S` = S-shaped; `vertical` = no deviation.
   */
  _shape?: 'J' | 'S' | 'vertical';
  /**
   * Inclination band hint. SVTC chooses different render strategies
   * for vertical vs deviated wells.
   */
  _band?: 'vertical' | 'low-angle' | 'medium' | 'high' | 'horizontal';
  /** Surface location for fmap absorption. */
  location?: WsonLocation;
}

export interface WsonLocation {
  /** Project-local easting (ft or m, depends on `crs`). */
  x: number;
  /** Project-local northing. */
  y: number;
  /** CRS / projection name. Free-form; informational. */
  crs?: string;
  /** Optional WGS84 lon. */
  lon?: number;
  /** Optional WGS84 lat. */
  lat?: number;
}

// ─── oh — open hole intervals ────────────────────────────────────────

export interface WsonOpenHole {
  /** Bit size, OD (in). */
  bitSize: number;
  /** Top MD (ft). */
  top: number;
  /** Bottom MD (ft). */
  bot: number;
}

// ─── ch — casing strings ─────────────────────────────────────────────

export interface WsonCasing {
  /** Casing OD (in). */
  od: number;
  /** Casing ID (in). */
  id: number;
  /** Top MD (ft). */
  top: number;
  /** Bottom MD (ft). */
  bot: number;
  /** Grade — e.g. "L80", "P110". Free-form. */
  grade?: string;
  /** Weight per foot (lb/ft). */
  weight?: number;
  /** Casing type — e.g. "surface", "intermediate", "production", "liner". */
  type?: string;
}

// ─── cementing — cement annuli ───────────────────────────────────────

export interface WsonCementing {
  /** OD (in) of the casing this cement is BEHIND (annulus outer edge). */
  od: number;
  /** Top of cement, MD (ft). */
  top: number;
  /** Bottom of cement, MD (ft). */
  bot: number;
}

// ─── completions — tubing, packers, downhole tools ───────────────────
// IMPORTANT: tubing belongs HERE, not in ch[]. SVTC's renderer relies
// on this distinction; mixing them swaps render style + ordering rules.

export interface WsonCompletion {
  /** Free-form description as it reads on the source diagram. */
  description: string;
  /** Optional canonical tool-component id (e.g. "packer_element"). */
  tool_comp?: string;
  /** Outer diameter (in). */
  od: number;
  /** Top MD (ft). */
  top: number;
  /** Bottom MD (ft). */
  bot: number;
  /** Length (ft) when distinct from `bot - top` (e.g. extracted from tally). */
  length?: number;
  /** Number of joints (for tubing strings). */
  noJoints?: number;
  /** Average joint length (ft). */
  avgJointLength?: number;
  /**
   * If true, SVTC's renderer treats `top` as auto-derived from
   * adjacent components (not from the document).
   */
  autoTop?: boolean;
}

// ─── perforations — shot intervals ───────────────────────────────────

export interface WsonPerforation {
  /** Top of perf interval, MD (ft). */
  top: number;
  /** Bottom of perf interval, MD (ft). */
  bot: number;
  /** Label as printed on the source diagram (zone name, etc.). */
  label?: string;
}

// ─── strata — formation picks ────────────────────────────────────────

export interface WsonStrata {
  /** Formation name (e.g. "Smackover", "Eutaw"). */
  name: string;
  /** Top of formation, MD (ft). */
  top: number;
  /** Display color, hex. */
  color?: string;
}

// ─── profile — directional survey stations ───────────────────────────

export interface WsonSurveyStation {
  /** Measured depth (ft). */
  md: number;
  /** Inclination (degrees from vertical). */
  dev: number;
  /** Azimuth (degrees from north). */
  az: number;
}

// ─── helpers ─────────────────────────────────────────────────────────

/**
 * Empty-but-valid WSON skeleton. Useful for incremental extraction
 * and as a fallback when only `meta` could be recovered from a doc.
 */
export function emptyWson(meta: WsonMeta): Wson {
  return {
    meta,
    oh: [],
    ch: [],
    cementing: [],
    completions: [],
    perforations: [],
    strata: [],
    profile: [],
  };
}

/**
 * Lightweight structural validator. Returns an array of issue strings
 * — empty array means the WSON passes. Not a substitute for SVTC's
 * own runtime rules, but cheap enough to run before persisting.
 *
 * Catches the most common LLM extraction mistakes:
 *   - tubing put in ch[] instead of completions[]
 *   - top > bot on any interval
 *   - meta.td absent or non-positive
 *   - profile entries with non-monotonic md
 */
export function validateWson(w: Wson): string[] {
  const issues: string[] = [];

  if (!w.meta?.wellName) issues.push('meta.wellName is required');
  if (!w.meta?.td || w.meta.td <= 0) issues.push('meta.td must be positive');

  for (const [section, list] of [
    ['oh', w.oh],
    ['ch', w.ch],
    ['cementing', w.cementing],
    ['completions', w.completions],
    ['perforations', w.perforations],
  ] as const) {
    (list ?? []).forEach((it: { top: number; bot: number }, i: number) => {
      if (it.top > it.bot) {
        issues.push(`${section}[${i}].top (${it.top}) > bot (${it.bot})`);
      }
    });
  }

  // Heuristic: tubing in ch[] is the most common extraction mistake.
  for (const c of (w.ch ?? [])) {
    const t = (c.type ?? '').toLowerCase();
    if (t.includes('tubing')) {
      issues.push(
        `ch[] contains tubing (type="${c.type}") — tubing belongs in completions[], not ch[]`,
      );
    }
  }

  // Profile must have monotonic md.
  const profile = w.profile ?? [];
  for (let i = 1; i < profile.length; i++) {
    if (profile[i].md < profile[i - 1].md) {
      issues.push(`profile[${i}].md (${profile[i].md}) is less than previous`);
    }
  }

  return issues;
}
