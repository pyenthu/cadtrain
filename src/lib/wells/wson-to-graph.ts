/**
 * wson-to-graph — the WSON → composition-graph translator.
 *
 * THE point of this module (skill: "the agreed architecture"): a well is drawn
 * ONLY through the CAD graph mechanism, never a bespoke renderer. Every element
 * is a `bw_*` volume part, so a well is just an assembly graph — the same thing
 * `/primitives` bakes, and the same thing `GraphEditorPane` edits. Translate the
 * well into that language and the engines (Manifold · TrueForm · BREP) and the
 * editor come along for free.
 *
 * The output is a REAL `Graph` (`$lib/graph/composition-graph-types`), not a
 * wells-private intermediate, precisely so the well can be saved as a volume
 * `.asm.ts` (carrying `meta.graph`) and mounted with `<GraphEditorPane {id} />`.
 *
 * RUNG 2: every structural section becomes a Call — open holes, cement intervals
 * and casing strings — each placed down-hole by an `Mv` node.
 *
 * RUNG 3: a DEVIATED well is bent along its survey — ONE spline + ONE warp for
 * the WHOLE well, placed just before the output (`buildSurveyWarp` below).
 *
 * RUNG 5: the in-string COMPLETION jewelry (tubing / nipple / pup / packer /
 * hanger / mule shoe) — each `tool_comp` code resolves to a `bw_*` part through
 * an EXPLICIT map (`COMPLETION_PART_MAP`), placed by an `Mv` at a depth resolved
 * through the AUTO-TOP chain (`recomputeAutoTops`). Emitted AFTER the structural
 * sections so the order stays OUTER → INNER. Perforations have no `bw_*` element
 * yet, so they are reported + skipped (never invented).
 *
 * WHY Mv AND NOT A `top` PARAM: only `bw_casing` even declares `top`, and its
 * body ignores it (`mv(solid, [0,0,0])` is hardcoded), so passing `top` silently
 * places every string at surface. Placement therefore lives in the GRAPH, where
 * it is visible and editable, via one `Mv` per element. Z-down: +z is down-hole.
 *
 * NO FALLBACK: an untranslatable well throws `WsonTranslateError`. We never
 * emit a stand-in shape — a wrong well is worse than a visible error.
 */
import type { ArgValue, CallNode, ContainerNode, Graph, GraphNode, MvNode, NodeId, ParamSchema, SplineNode, WarpNode } from '$lib/graph/composition-graph-types';
import { asExpr, asLiteral, asParam } from '$lib/graph/composition-graph-types';
import { exprBlockMember } from '$lib/graph/graph-exprs';
import { normaliseKey, resolveStructural } from './registry';
import { buildTrajectory } from './assemble';
import { isDeviated, recomputeAutoTops } from './wson';
import type { BarrierRole, CasingString, CementInterval, CementSpan, Completion, OpenHoleSection, Wson } from './wson';

/** The assembly-level param every generated well exposes, so segment count stays
 *  a single dial on the well rather than a literal baked into each element —
 *  mirrors the hand-built `w_multi_string`. */
export const SEGMENTS_PARAM = 'segments';

/** Matches `w_multi_string`'s dial so generated + hand-built wells look alike. */
const SEGMENTS_SCHEMA: ParamSchema = { default: 24, step: 1 };

/** Derived dimensions carry binary-float noise ((9.625-8.835)/2 = 0.39499…96),
 *  which would land verbatim in the saved `.asm.ts`. Round to a precision far
 *  finer than any real tubular tolerance so the file stays readable + stable. */
const clean = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Thrown when a well cannot be expressed as a graph. Surface it; never draw. */
export class WsonTranslateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WsonTranslateError';
  }
}

const ROOT_ID: NodeId = 'n_root';

/** One translated element: the Call plus the Mv that places it down-hole. */
interface Element {
  call: CallNode;
  mv: MvNode;
}

/** The renderer's fallback outer diameter when no open-hole section covers a
 *  cement interval (`WellSchematic3D`: `cm.od * 1.15`). Mirrored so 3D and the
 *  graph agree on annulus size. */
const CEMENT_NO_HOLE_RATIO = 1.15;

/**
 * Cement fills the annulus between the casing it cements and the hole around it.
 *
 * `CementInterval.od` is the INNER diameter — the casing being cemented, not the
 * outer wall. The sample wells make that unambiguous: their `cementing` OD list
 * is exactly their `ch` OD list. The OUTER diameter is the bit size at the
 * interval's midpoint, which is precisely what `WellSchematic3D` does:
 *
 *     inner = cm.od
 *     outer = outerBitAtDepth((top + bot) / 2) ?? cm.od * 1.15
 *
 * Cross-check: a 9.625" casing cemented in a 12.25" hole → wall 1.3125, the value
 * `w_multi_string` hand-encodes. Mirrored here so the graph and the 3D scene
 * describe the same annulus.
 *
 * @throws WsonTranslateError when the hole is not wider than the casing — a
 *   degenerate annulus we must surface rather than bake inside-out.
 */
function cementDims(wson: Wson, interval: CementInterval, i: number): { od: number; wall: number } {
  const mid = (interval.top + interval.bot) / 2;
  const hole = (wson.oh ?? []).find((o) => mid >= o.top && mid <= o.bot);
  const outer = hole ? hole.bitSize : interval.od * CEMENT_NO_HOLE_RATIO;
  const wall = (outer - interval.od) / 2;
  if (!(wall > 0)) {
    throw new WsonTranslateError(
      `cement interval ${i} has a non-positive annulus (casing od=${interval.od}, hole od=${outer})`,
    );
  }
  return { od: clean(outer), wall: clean(wall) };
}

// ─── #996: cement as a DERIVED annulus (outer boundary − casing) ─────────────
//
// Cement is NOT an authored `{od,id}` part — it is `outerBoundary − casingOD`,
// clipped axially to `[TOC, shoe]`, where the outer boundary is the NEAREST
// casing-ID / open-hole wall radially OUTSIDE the string at each depth. Because
// that boundary changes with depth (open hole below the previous shoe, then the
// previous casing's ID up in the lap zone), the interval is SEGMENTED at every
// tubular/hole breakpoint and one concentric annulus is built per segment.
// Algorithm + NORSOK D-010 grounding: docs/research/cement-annulus-detection.md.
//
// DERIVED, not authored: change the casing program and the cement re-derives for
// free. Distinct from the legacy `wson.cementing` array (an authored inner-OD
// interval) — the two coexist; a well typically uses one or the other.

/** Radial gap tolerance (inches) — a candidate outer boundary must clear the
 *  casing OD by at least this to count (guards degenerate / zero-gap annuli). */
const CEMENT_EPS_R = 1e-4;
/** Axial contiguity tolerance (metres) when merging adjacent equal-OD segments. */
const CEMENT_EPS_Z = 1e-6;

/** One derived cement annulus segment — the geometry (od/id inches, top/bot
 *  metres) PLUS the barrier metadata (annulus letter + NORSOK role). Exported so
 *  a test can pin the derivation directly and the viewer can colour per WBS. */
export interface DerivedCementSegment {
  /** Index into `wson.ch` of the cemented string this annulus wraps. */
  stringIndex: number;
  /** Annulus letter (A/B/C…) — radial nesting identity (NORSOK convention). */
  annulus: string;
  /** NORSOK barrier role for blue/red WBS colouring. */
  role: BarrierRole;
  /** Axial span (metres, Z-down): `top` shallower, `bot` deeper. */
  top: number; bot: number;
  /** Outer diameter (inches) = nearest boundary radially outside the string. */
  od: number;
  /** Inner diameter (inches) = the cemented string's OD (annulus inner wall). */
  id: number;
  /** What bounds the annulus on the outside at this segment. */
  against: 'openhole' | 'casing';
}

/** A radial boundary with its depth span — a casing OD/ID wall or an open-hole
 *  wall, in the units they are authored (radius inches, depth metres). */
interface CementBoundary {
  kind: 'holeWall' | 'casingInner' | 'casingOuter';
  r: number; top: number; bot: number;
}

/** Every radial boundary in the casing + hole program, each with its depth span.
 *  A casing contributes its OUTER (od/2) and, when known, INNER (id/2) walls; an
 *  open-hole section contributes its wall (bitSize/2). */
function collectCementBoundaries(wson: Wson): CementBoundary[] {
  const bs: CementBoundary[] = [];
  (wson.ch ?? []).forEach((c) => {
    bs.push({ kind: 'casingOuter', r: c.od / 2, top: c.top, bot: c.bot });
    if (c.id != null) bs.push({ kind: 'casingInner', r: c.id / 2, top: c.top, bot: c.bot });
  });
  (wson.oh ?? []).forEach((o) => {
    bs.push({ kind: 'holeWall', r: o.bitSize / 2, top: o.top, bot: o.bot });
  });
  return bs;
}

/** The annulus letter for the cement OUTSIDE the casing at `stringIndex`. Radial
 *  nesting per NORSOK: annulus **A** is the innermost (tubing ↔ production-casing)
 *  void, so cement OUTSIDE the innermost casing sits in **B**, the next casing out
 *  in **C**, … Ranks casings by OD ascending (smallest = innermost) and reserves
 *  'A' for the tubing annulus we do not cement. */
function cementAnnulusLetter(chs: CasingString[], stringIndex: number): string {
  const od = chs[stringIndex].od;
  // rank = how many OTHER casings are radially INSIDE this one (strictly smaller).
  const rank = chs.filter((c, i) => i !== stringIndex && c.od < od).length;
  // +1 reserves 'A' for the innermost (tubing↔casing) annulus — cement is on casings.
  return String.fromCharCode(65 + rank + 1);
}

/**
 * DERIVE the cement annulus segments for every casing string carrying a `cement`
 * spec. Per the algorithm in the research doc: for each cemented interval, cut at
 * every boundary breakpoint, and between consecutive cuts take the NEAREST
 * boundary radially outside the string OD (an open-hole wall or a larger casing's
 * ID) as the annulus outer wall; merge adjacent equal-OD runs.
 *
 * Emits NOTHING for an uncemented string, a string with no TOC, a segment with no
 * outer boundary, or a degenerate (zero/negative) annulus — surfaced via `warn`,
 * never fabricated (never invent a TOC or bake an inside-out annulus).
 *
 * PURE — no graph/DOM. `warn` is optional (defaults to a no-op) so a test can
 * capture the skip reasons.
 */
export function deriveCementSegments(
  wson: Wson,
  warn: (msg: string) => void = () => {},
): DerivedCementSegment[] {
  const chs = wson.ch ?? [];
  const boundaries = collectCementBoundaries(wson);
  const out: DerivedCementSegment[] = [];

  chs.forEach((S, stringIndex) => {
    const spec = S.cement;
    if (!spec) return;
    // Cemented interval(s): explicit multi-interval (stage cementing) OVERRIDES
    // the single [TOC, shoe]. No TOC and no intervals ⇒ uncemented ⇒ emit nothing.
    const intervals: CementSpan[] = (spec.intervals && spec.intervals.length)
      ? spec.intervals
      : (spec.toc != null ? [{ top: spec.toc, bot: S.bot }] : []);
    if (!intervals.length) return;

    const rInner = S.od / 2;
    const role: BarrierRole = spec.role ?? 'primary';
    const annulus = cementAnnulusLetter(chs, stringIndex);

    for (const iv of intervals) {
      if (!(iv.bot > iv.top)) {
        warn(`cement string ${stringIndex}: non-positive interval [${iv.top}, ${iv.bot}]`);
        continue;
      }
      // Breakpoints: the interval ends + every boundary span endpoint that falls
      // STRICTLY inside, so the outer boundary is constant between consecutive cuts.
      const cuts = new Set<number>([iv.top, iv.bot]);
      for (const b of boundaries) {
        if (b.top > iv.top && b.top < iv.bot) cuts.add(b.top);
        if (b.bot > iv.top && b.bot < iv.bot) cuts.add(b.bot);
      }
      const sorted = [...cuts].sort((a, b) => a - b);

      const segs: DerivedCementSegment[] = [];
      for (let k = 0; k < sorted.length - 1; k++) {
        const d0 = sorted[k], d1 = sorted[k + 1];
        const dm = (d0 + d1) / 2;
        // Candidate outer radii: boundaries covering the segment midpoint, strictly
        // OUTSIDE the casing OD, that are a VOID-facing wall (a hole face, or a
        // larger casing's ID). The string's own OD (casingOuter) + ID are excluded
        // by kind + radius. NEAREST (min radius) wins → the radial A/B/C nesting.
        let rOuter = Infinity;
        let against: 'openhole' | 'casing' = 'openhole';
        for (const b of boundaries) {
          if (!(b.top <= dm && dm <= b.bot)) continue;
          if (b.r <= rInner + CEMENT_EPS_R) continue;
          if (b.kind !== 'holeWall' && b.kind !== 'casingInner') continue;
          if (b.r < rOuter) { rOuter = b.r; against = b.kind === 'holeWall' ? 'openhole' : 'casing'; }
        }
        if (!Number.isFinite(rOuter)) {
          warn(`cement string ${stringIndex}: no outer boundary at ${dm}m — open annulus, skipped`);
          continue;
        }
        if (rOuter - rInner < CEMENT_EPS_R) {
          warn(`cement string ${stringIndex}: degenerate annulus at ${dm}m (od ${S.od} ≥ hole)`);
          continue;
        }
        segs.push({
          stringIndex, annulus, role,
          top: clean(d0), bot: clean(d1),
          od: clean(rOuter * 2), id: clean(rInner * 2),
          against,
        });
      }
      // Collapse artificial cuts: adjacent, contiguous, same-OD, same-boundary runs.
      for (const s of segs) {
        const prev = out[out.length - 1];
        if (prev && prev.stringIndex === s.stringIndex && prev.against === s.against
            && Math.abs(prev.od - s.od) < CEMENT_EPS_R && Math.abs(prev.bot - s.top) < CEMENT_EPS_Z) {
          prev.bot = s.bot;
        } else {
          out.push({ ...s });
        }
      }
    }
  });

  return out;
}

/** Build the Call + its placing Mv. `top` is the element's down-hole start (m). */
function element(
  idBase: string,
  alias: string,
  src: string,
  args: Record<string, ArgValue>,
  top: number,
): Element {
  const callId = `n_${idBase}`;
  const call: CallNode = { id: callId, type: 'call', src, alias, args };
  const mv: MvNode = {
    id: `n_${idBase}_mv`,
    type: 'mv',
    child: callId,
    // Z-down: a positive z offset moves the element DOWN the hole.
    offset: [asLiteral(0), asLiteral(0), asLiteral(clean(top))],
  };
  return { call, mv };
}

/** Shared arg build for a structural section: od/wall/length off `resolveStructural`
 *  (the ONE existing kind→part+params policy) + the assembly's segments dial. */
function structuralArgs(
  kind: Parameters<typeof resolveStructural>[0],
  dims: Parameters<typeof resolveStructural>[1],
  lengthM: number,
  opts: { wall?: number; segments: boolean },
): Record<string, ArgValue> {
  const { params } = resolveStructural(kind, dims, lengthM);
  const args: Record<string, ArgValue> = {};
  if (params.od != null) args.od = asLiteral(clean(params.od));
  const wall = opts.wall ?? params.wall;
  if (wall != null) args.wall = asLiteral(clean(wall));
  if (params.length != null) args.length = asLiteral(clean(params.length));
  // `bw_prod_tubing` has no segments dial; only wire it where the part declares it.
  if (opts.segments) args.segments = asParam(SEGMENTS_PARAM);
  return args;
}

function requirePositiveLength(what: string, i: number, top: number, bot: number): void {
  if (!(bot > top)) {
    throw new WsonTranslateError(`${what} ${i} has non-positive length (top=${top}, bot=${bot})`);
  }
}

// ─── RUNG 5: completion string (in-string bw_* jewelry) ─────────────────────

/**
 * EXPLICIT `tool_comp` → `bw_*` part map. `tool_comp` is a FREE STRING (SVTC
 * infers a render style by substring), so we NORMALISE it (registry `normaliseKey`:
 * UPPER, non-alnum → `_`) and match it EXACTLY — no substring fallback, no default
 * part. The mapped ids are the canonical wells element parts (wells skill:
 * casing→bw_casing … packer→bw_packer …). An UNMAPPED code THROWS — NO FALLBACK,
 * because a wrong completion is worse than a visible error. Extend as new `bw_*`
 * parts land.
 *
 * Frequencies across the sample corpus (why these six): MISC.TUBING (41),
 * MISC.TUBING_PUP (17), tbgHanger (11), FLOW_CONTROL.NIPPLE_R_LANDING (10),
 * MISC.MULE_SHOE (10), PACKERS.PACKER_BAKER_PERMANENT (6). A pup is a short
 * tubing joint, so both TUBING codes resolve to the plain concentric
 * `bw_prod_tubing` (the collared `bw_tubing` is NOT the skill's canonical tubing
 * element).
 *
 * ── IMPORTED PLACEHOLDERS (2026-07-10) ──────────────────────────────────────
 * The four codes below blanked wells 05 + 09 entirely (`wsonToGraph` threw, so
 * the GRAPH tab rendered "Cannot express this well as a graph"). They now map to
 * real, named volume parts under `well_parts/imported/` whose geometry is a plain
 * bored tube. This is NOT a silent fallback: each is its own NAMED part, visible
 * in the sidebar, editable in the graph editor, and its `drawingMd` says in the
 * first line that the shape is a placeholder and names the part to port from.
 *
 * They are NOT aliased to the look-alike `g_*` parts in `completions/svtc`
 * (`g_trsssv_sp`, `g_gauge_mandrel`, `g_packer_ahr_ahc`) even though the names
 * match exactly — those are compjson-inferred revolves with an EMPTY `params`
 * schema, i.e. FIXED geometry. `g_trsssv_sp` bakes od 3.56in × 11.1in no matter
 * what, and its own meta warns the inferred length diverges 85% from catalogue.
 * Every completion here is fed `od` + `length` from its WSON row, so aliasing a
 * fixed part would bake the wrong size at the wrong depth span — silently. A
 * parametric stub is the honest placeholder. Porting the real profiles into
 * parametric `bw_*` parts is TODO (#42f).
 *
 * Still deliberately NOT mapped (→ throw): MISC.SIDE_POCKET_MANDREL (6) — the
 * `g_side_pocket_mandrel` part exists but is likewise fixed-geometry.
 */
const COMPLETION_PART_MAP: Record<string, string> = {
  TBGHANGER: 'bw_hanger',
  MISC_TUBING: 'bw_prod_tubing',
  MISC_TUBING_PUP: 'bw_prod_tubing',
  FLOW_CONTROL_NIPPLE_R_LANDING: 'bw_nipple',
  MISC_MULE_SHOE: 'bw_mule_shoe',
  PACKERS_PACKER_BAKER_PERMANENT: 'bw_packer',
  // Imported placeholders — plain tubes, geometry pending (see block comment).
  MISC_PUP_PERF: 'bw_pup_perf',                 // 05 · Perforated Pup (tail pipe)
  FLOW_CONTROL_TRSSSV_SP: 'bw_trsssv_sp',       // 09 · TRSSSV-SP surface-controlled SSSV
  MISC_GAUGE_MANDREL: 'bw_gauge_mandrel',       // 09 · Gauge Mandrel (P/T monitoring)
  PACKERS_PACKER_AHR_AHC: 'bw_packer_ahr_ahc',  // 09 · Packer AHR-AHC (HPHT permanent)
};

/** The imported placeholder parts, by id. Their geometry is a plain bored tube,
 *  not the real component — see COMPLETION_PART_MAP's block comment. Exported so
 *  a test can pin the set and the UI can badge them. */
export const PLACEHOLDER_PART_IDS: ReadonlySet<string> = new Set([
  'bw_pup_perf', 'bw_trsssv_sp', 'bw_gauge_mandrel', 'bw_packer_ahr_ahc',
]);

/** Resolve a completion's `tool_comp` to a `bw_*` part id. Throws (naming the
 *  index) when the code is missing/empty — the corpus has real rows with no
 *  `tool_comp` — and (naming the code + index) when it is present but unmapped.
 *  NO FALLBACK on either path. */
function resolveCompletionPart(toolComp: string | undefined, i: number): string {
  const raw = String(toolComp ?? '').trim();
  if (!raw) {
    throw new WsonTranslateError(
      `completion ${i} has a missing/empty tool_comp — cannot resolve a bw_* part`,
    );
  }
  const partId = COMPLETION_PART_MAP[normaliseKey(raw)];
  if (!partId) {
    throw new WsonTranslateError(
      `completion ${i} has an unmapped tool_comp "${raw}" — no bw_* part is registered for it`,
    );
  }
  return partId;
}

/** Extra AXIAL params a `bw_*` part needs, derived from the row so they land in
 *  the same unit as `length`.
 *
 *  The well is authored in a MIXED unit space: radial quantities (`od`) are the
 *  WSON row's INCHES, axial quantities (`length`, and the `Mv` depth) are METRES.
 *  A `bw_*` part's own defaults are all authored in inches (`unit: 'in'`). So a
 *  RADIAL param may safely fall through to its default — it is already inches —
 *  but any AXIAL param we fail to pass keeps an inch number in a metre scene and
 *  bakes ~39x too long.
 *
 *  Measured: `bw_packer`'s `seal_len` defaults to 6 (in). Passing only
 *  `{od, length: 0.5}` baked a **6.0**-long packer with **genus -1** (the seal
 *  band overshot the 0.5 body at both ends and split the solid in two). Supplying
 *  `seal_len` in metres gives z-span == length and genus 1.
 *
 *  Ratios are the part's OWN authored proportions, so a resized packer keeps its
 *  shape: seal_len/length = 6/24, seal_od/od = 9.5/8.681. */
const PACKER_SEAL_LEN_RATIO = 6 / 24;
const PACKER_SEAL_OD_RATIO = 9.5 / 8.681;

const EXTRA_AXIAL_DIMS: Record<
  string,
  (c: Completion, lengthM: number) => Record<string, number>
> = {
  bw_packer: (c, lengthM) => ({
    seal_len: clean(lengthM * PACKER_SEAL_LEN_RATIO),
    ...(c.od != null ? { seal_od: clean(c.od * PACKER_SEAL_OD_RATIO) } : {}),
  }),
};

/** Args for a completion Call: OD (inches, from the WSON row) + the section's
 *  down-hole length (metres) — the SAME mixed-unit convention as `structuralArgs`
 *  (od inches / length metres; the scene exaggerates radially). RADIAL params
 *  (id / wall / seat / bevel…) fall through to the `bw_*` part's own inch
 *  defaults, which is correct. AXIAL params must be supplied — see
 *  `EXTRA_AXIAL_DIMS`. */
function completionArgs(c: Completion, lengthM: number, partId: string): Record<string, ArgValue> {
  const args: Record<string, ArgValue> = {};
  if (c.od != null) args.od = asLiteral(clean(c.od));
  if (lengthM > 0) args.length = asLiteral(clean(lengthM));
  if (lengthM > 0) {
    for (const [k, v] of Object.entries(EXTRA_AXIAL_DIMS[partId]?.(c, lengthM) ?? {})) {
      args[k] = asLiteral(v);
    }
  }
  return args;
}

// ─── RUNG 3: deviated-survey warp ───────────────────────────────────────────

/** Target spacing (m) of interpolated control points inside a BUILDING survey
 *  segment. Inter-station segments that change inclination/azimuth are
 *  subdivided at ~this spacing so `resampleSpline`'s Catmull-Rom rounds each
 *  corner LOCALLY rather than bulging across the whole segment; straight runs
 *  keep only their endpoints (a Catmull-Rom through collinear points stays
 *  straight — `buildTrajectory` interpolates LINEARLY within a station span, so
 *  intra-segment samples are collinear and add nothing there). */
const SURVEY_CTRL_STEP_M = 150;
/** Cap on interpolated control points inserted into ONE building segment —
 *  bounds the emitted `points` literal on a long, gentle build. */
const SURVEY_MAX_SUBDIV = 8;
/** `resampleSpline` output resolution ≈ one sample per this many metres of
 *  trajectory (clamped 24…128) — the equally-arc-length-spaced path the warp
 *  bends along. Generous is cheap: only the control `points` are literal in the
 *  source; the resample itself runs at bake. */
const SURVEY_SAMPLE_STEP_M = 40;
/** Build-time subdivision handed to `warpSpline` so flat-walled parts bend as
 *  arcs not chords. Mirrors the canonical `w1_oh_warp`; `warp-spline` self-limits
 *  it on already-dense meshes (the tube elements), so it mostly no-ops here. */
const SURVEY_WARP_REFINE = 4;
/** FIXED, deterministic node ids for the single survey spline + warp — never
 *  `newNodeId()` (random), so re-translating an unchanged well is byte-identical.
 *  Distinct from every element id (`n_oh_*` / `n_cem_* / n_csg_*` + `_mv`). */
const SURVEY_SPLINE_ID: NodeId = 'n_survey_spline';
const SURVEY_WARP_ID: NodeId = 'n_survey_warp';

/**
 * Bend a deviated well along its survey: ONE control-point spline sampled from
 * the trajectory + ONE multi-input warp that bends EVERY element's placing Mv
 * along it. Reuses assemble.ts's average-angle `buildTrajectory` (no second
 * survey walk) so the 3D scene, the 2D schematic and this graph share one
 * trajectory.
 *
 * WHY `originZ = 0` IS LOAD-BEARING: each element is placed down-hole by
 * `mv([0,0,top])`, so its local z runs `top … bot` = its true MD interval.
 * `warpSpline` maps a vertex's z to arc-length `s = z − originZ`; with
 * `originZ = 0` that is `s = z = MD`, and because the average-angle walk makes
 * the trajectory's arc-length equal MD (see `buildTrajectory`), every element
 * bends at its TRUE station. WITHOUT it each part would re-zero to its own
 * bounding-box min and all elements would restart at the spline origin — the
 * whole well would collapse back to surface.
 *
 * @throws WsonTranslateError — NO FALLBACK: a survey flagged deviated but
 *   unusable (fewer than 2 finite stations, zero MD span, or no lateral
 *   displacement) is surfaced, never emitted as a straight well dressed up as
 *   deviated.
 */
function buildSurveyWarp(wson: Wson, elements: Element[]): { spline: SplineNode; warp: WarpNode } {
  const prof = (wson.profile ?? [])
    .filter((s) => Number.isFinite(s.md))
    .sort((a, b) => a.md - b.md);
  if (prof.length < 2) {
    throw new WsonTranslateError(
      'deviated survey has fewer than 2 finite-MD stations — cannot build a trajectory',
    );
  }
  const firstMD = prof[0].md;
  const lastMD = prof[prof.length - 1].md;
  if (!(lastMD > firstMD)) {
    throw new WsonTranslateError(
      `deviated survey has a non-positive MD span (first=${firstMD}, last=${lastMD})`,
    );
  }

  // Depth range the geometry occupies (Z-down MD), read from the raw sections.
  const spans = [...(wson.oh ?? []), ...(wson.cementing ?? []), ...(wson.ch ?? [])];
  const minTop = Math.min(...spans.map((s) => s.top));
  const maxBot = Math.max(...spans.map((s) => s.bot));
  const mdStart = Math.min(firstMD, minTop);
  // Cover the deepest geometry AND the last station, so the final build is
  // shaped even when no element reaches all the way down to it.
  const mdEnd = Math.max(maxBot, lastMD);

  const at = buildTrajectory(wson.profile);

  // Control points: every station (the EXACT trajectory corners) + interpolated
  // points through BUILD segments; straight runs contribute only their endpoints.
  const mds: number[] = [];
  const pushMD = (md: number) => {
    if (!mds.length || Math.abs(md - mds[mds.length - 1]) > 1e-6) mds.push(md);
  };
  if (mdStart < firstMD - 1e-6) pushMD(mdStart); // geometry above the survey top
  for (let i = 0; i < prof.length; i++) {
    pushMD(prof[i].md);
    if (i === prof.length - 1) break;
    const a = prof[i], b = prof[i + 1];
    const dDev = Math.abs(b.dev - a.dev);
    const dAz = Math.abs(((b.az - a.az + 540) % 360) - 180); // wrap-safe |Δaz| in [0,180]
    const avgDev = (a.dev + b.dev) / 2;
    // A segment "builds" when inclination changes, or azimuth turns while
    // already inclined (an azimuth change at dev≈0 does not move the well).
    const builds = dDev > 0.5 || (avgDev > 0.5 && dAz > 0.5);
    if (!builds) continue;
    const dMD = b.md - a.md;
    const nSub = Math.max(2, Math.min(SURVEY_MAX_SUBDIV, Math.round(dMD / SURVEY_CTRL_STEP_M)));
    for (let k = 1; k < nSub; k++) pushMD(a.md + (dMD * k) / nSub);
  }
  if (mdEnd > lastMD + 1e-6) pushMD(mdEnd); // geometry below the survey bottom

  const points: [number, number, number][] = mds.map((md) => {
    const p = at(md);
    return [clean(p[0]), clean(p[1]), clean(p[2])];
  });
  if (points.length < 2) {
    throw new WsonTranslateError('deviated survey yielded fewer than 2 trajectory points');
  }
  // NO FALLBACK: a "deviated" survey that walks perfectly vertical (every finite
  // station at dev≈0) produces no lateral displacement — bending along it is a
  // no-op, so surface it rather than emit a straight well as if it were bent.
  const maxLateral = points.reduce((m, p) => Math.max(m, Math.hypot(p[0], p[1])), 0);
  if (!(maxLateral > 1e-6)) {
    throw new WsonTranslateError(
      'deviated survey produces no lateral displacement — trajectory is vertical (unusable)',
    );
  }

  const samples = Math.max(24, Math.min(128, Math.round((mdEnd - mdStart) / SURVEY_SAMPLE_STEP_M)));
  const spline: SplineNode = {
    id: SURVEY_SPLINE_ID,
    type: 'spline',
    points,
    samples: asLiteral(samples),
    closed: false,
  };

  const mvIds = elements.map((e) => e.mv.id);
  const warp: WarpNode = {
    id: SURVEY_WARP_ID,
    type: 'warp',
    // `child` is the legacy single-slot (first solid); `children[]` carries ALL
    // solids, so the warp emits a bare `[warpSpline(a,…), warpSpline(b,…)]` LIST
    // producer — each element bent SEPARATELY (never composed, so a string inside
    // a transparent open hole stays an independent body). Mirrors w1_oh_warp.
    child: mvIds[0] ?? null,
    children: mvIds,
    // exprBlockMember(SURVEY_SPLINE_ID,'path') === '_x_n_survey_spline_path' — the
    // SAME const the spline node lowers to (composition-emit.emitSplineBlocks).
    path: asExpr(exprBlockMember(SURVEY_SPLINE_ID, 'path')),
    refine: asLiteral(SURVEY_WARP_REFINE),
    // originZ = 0 → s = z = MD → every element bends at its TRUE station (see the
    // doc-comment). Set EXPLICITLY, not left to the multi-warp auto-default, so a
    // single-element deviated well still places absolutely.
    originZ: asLiteral(0),
  };

  return { spline, warp };
}

/**
 * Translate a WSON well into a composition graph of `bw_*` Calls.
 *
 * Emission order is OUTER → INNER (open hole, cement, casing), matching the
 * hand-built `w_multi_string` so a generated well reads the same way in the
 * editor and the transparent outer shells render over the inner strings.
 *
 * @throws WsonTranslateError when the well has no structural sections at all, or
 *   any section has non-positive length. Both are authoring errors we must show.
 */
export function wsonToGraph(wson: Wson): Graph {
  const elements: Element[] = [];

  (wson.oh ?? []).forEach((o: OpenHoleSection, i) => {
    requirePositiveLength('open hole', i, o.top, o.bot);
    elements.push(element(
      `oh_${i}`, `OH_${i + 1}`, 'bw_open_hole',
      structuralArgs('openhole', { od: o.bitSize }, o.bot - o.top, { segments: true }),
      o.top,
    ));
  });

  (wson.cementing ?? []).forEach((c: CementInterval, i) => {
    requirePositiveLength('cement interval', i, c.top, c.bot);
    const { od, wall } = cementDims(wson, c, i);
    elements.push(element(
      `cem_${i}`, `CEM_${i + 1}`, 'bw_cement',
      structuralArgs('cement', { od }, c.bot - c.top, { wall, segments: true }),
      c.top,
    ));
  });

  // #996 — DERIVED cement: each casing carrying a `cement` spec grows its annulus
  // (nearest outer boundary − casing OD) as one-or-more per-segment `bw_cement`
  // Calls, clipped to [TOC, shoe] and segmented at every tubular/hole breakpoint
  // (so an open-hole→cased-lap transition splits into 2 concentric annuli). Each
  // carries its annulus letter (A/B/C…) in the alias for the editor + WBS. Emitted
  // OUTER→INNER (before casing). ADDITIVE — coexists with the authored `cementing`
  // array above; a well typically authors one or the other.
  deriveCementSegments(wson).forEach((seg, i) => {
    const wall = clean((seg.od - seg.id) / 2);
    elements.push(element(
      `dcem_${seg.stringIndex}_${i}`, `CEM_${seg.annulus}_${i + 1}`, 'bw_cement',
      structuralArgs('cement', { od: seg.od }, seg.bot - seg.top, { wall, segments: true }),
      seg.top,
    ));
  });

  (wson.ch ?? []).forEach((c: CasingString, i) => {
    requirePositiveLength('casing', i, c.top, c.bot);
    elements.push(element(
      `csg_${i}`, `CSG_${i + 1}`, 'bw_casing',
      structuralArgs('casing', { od: c.od, id: c.id }, c.bot - c.top, { segments: true }),
      c.top,
    ));
  });

  if (elements.length === 0) {
    throw new WsonTranslateError(
      'well has no structural sections (oh / cementing / ch are all empty) — nothing to translate',
    );
  }

  // RUNG 5: the in-string completion jewelry, INSIDE the casing. Depth is resolved
  // through the AUTO-TOP chain (recomputeAutoTops) BEFORE it becomes an Mv — an
  // auto item follows its predecessor's bot, a manual item holds its MD — so a
  // freshly-parsed contiguous string reproduces its own depths and an edited one
  // stays contiguous. Emitted AFTER oh/cement/casing so the order is OUTER → INNER
  // (transparency reads correctly). NO FALLBACK: resolveCompletionPart throws on a
  // missing/empty or unmapped tool_comp.
  recomputeAutoTops(wson.completions ?? []).forEach((c: Completion, i) => {
    const top = c.top as number;
    const bot = c.bot as number;
    requirePositiveLength('completion', i, top, bot);
    const src = resolveCompletionPart(c.tool_comp, i);
    elements.push(element(
      `comp_${i}`, `COMP_${i + 1}`, src,
      completionArgs(c, bot - top, src),
      top,
    ));
  });

  // Perforations: SKIPPED, not emitted. There is no `bw_perforation` element part
  // on the volume (verified 404 via /api/primitives/source), so per NO-FALLBACK
  // we do NOT invent a stand-in — perfs stay a reported gap until a `bw_*` perf
  // element exists. (The 2D schematic still draws them from `wson.perforations`.)

  const nodes: Record<NodeId, GraphNode> = {};
  for (const { call, mv } of elements) {
    nodes[call.id] = call;
    nodes[mv.id] = mv;
  }

  // A straight/vertical well outputs each element's Mv directly (the Call is
  // consumed by the Mv). A DEVIATED well (RUNG 3) bends ALL of them along ONE
  // survey spline: the root's SOLE output becomes that warp, so the whole well
  // follows a single trajectory. Non-deviated wells are untouched here (the same
  // Mv-id children as before) → byte-identical to RUNG 2.
  let rootChildren: NodeId[] = elements.map((e) => e.mv.id);
  if (isDeviated(wson) && (wson.profile?.length ?? 0) >= 2) {
    const { spline, warp } = buildSurveyWarp(wson, elements);
    nodes[spline.id] = spline;
    nodes[warp.id] = warp;
    rootChildren = [warp.id];
  }

  const root: ContainerNode = { id: ROOT_ID, type: 'list', children: rootChildren };
  nodes[ROOT_ID] = root;

  return {
    nodes,
    root: ROOT_ID,
    // `segments` MUST be declared: the Calls wire their segments slot to
    // `p.segments`, and emit only writes a `meta.params` row (and the geom
    // function's arg) for params the graph declares.
    params: { [SEGMENTS_PARAM]: { ...SEGMENTS_SCHEMA } },
    imports: [...new Set(elements.map((e) => e.call.src))],
    // Denormalised + rebuilt by hydrateGraph (edges via collectEdges, layout via
    // its default grid pass), so an empty seed is correct rather than lossy.
    edges: [],
    layout: {},
  };
}
