/**
 * well-part-map.ts — PURE reverse-maps from a BAKED well part id back to the WSON
 * it came from (#42h layer toggles + #42b click-to-inspect). No DOM / Svelte /
 * Three — headless-tested (`well-part-map.test.ts`) like the rest of the wells
 * model layer.
 *
 * TWO id shapes flow through /wells, and these helpers accept BOTH:
 *
 *  1. The EMITTED VAR NAME — the actual `WellPart.id` a bake returns and a 3D
 *     pick reports (`well-graph-bake.ts` → `WellPart.id`). `wson-to-graph.ts`
 *     names each element `<PREFIX>_<n>` where `n` is 1-BASED within its WSON
 *     array and the prefix encodes the kind:
 *        OH_*   ← open hole   (wson.oh)          → showOpenHole
 *        CEM_*  ← cement       (wson.cementing)   → showCement
 *        CSG_*  ← casing       (wson.ch)          → showCasing
 *        COMP_* ← completion   (wson.completions) → showCompletions
 *     Perforations are NOT emitted as parts (no `bw_perforation`), so there is no
 *     `PERF_` var and a perf is never 3D-pickable — the 2D view still draws them.
 *     This var name carries BOTH the kind (prefix) and the source index (number),
 *     so it is the only form the inspector back-map can resolve.
 *
 *  2. The REGISTRY PART ID — the `bw_*` composite a Call node references
 *     (`bw_casing`, `bw_prod_tubing`, `bw_packer`, …). It names the kind but NOT
 *     the instance, so it maps to a LAYER but cannot be back-mapped to one source
 *     element. Recognised here so a caller holding either id gets a layer.
 *
 * NB: tubing has no distinct layer via the var name — a tubing string emits as a
 * `COMP_`/`CSG_` var — so `showTubing` is only reachable through the `bw_prod_
 * tubing` / `bw_tubing` registry id (the plan's known "layer gap"; distinct perf/
 * tubing var prefixes are a `wson-to-graph.ts` follow-up).
 */
import type { WellElementKind, WellInspectorElement } from './well-inspector';

/** The `WellLayerFlags` keys (mirrors `routes/wells/view-settings.ts`
 *  `WellLayerFlags` — kept local so `src/lib/` does not import from
 *  `src/routes/`; the test asserts the two stay in sync). */
export type WellLayerKey =
  | 'showOpenHole' | 'showCasing' | 'showCement'
  | 'showTubing' | 'showCompletions' | 'showPerforations';

/** Emit var-name prefix → the source element kind it encodes. */
const VARNAME_KIND: Record<string, WellElementKind> = {
  OH: 'openhole',
  CEM: 'cement',
  CSG: 'casing',
  COMP: 'completion',
};

/** Source element kind → its layer flag. */
const KIND_LAYER: Record<WellElementKind, WellLayerKey> = {
  openhole: 'showOpenHole',
  cement: 'showCement',
  casing: 'showCasing',
  completion: 'showCompletions',
  perf: 'showPerforations',
};

/** `bw_*` registry part id → layer flag. Only the structural body kinds map 1:1;
 *  every other `bw_*` is in-string jewelry → the completions layer. */
const BW_LAYER: Record<string, WellLayerKey> = {
  bw_open_hole: 'showOpenHole',
  bw_cement: 'showCement',
  bw_casing: 'showCasing',
  bw_prod_tubing: 'showTubing',
  bw_tubing: 'showTubing',
};

/**
 * Parse an EMITTED VAR NAME (`CSG_2`, `COMP_5`, `OH_1`) into its source kind +
 * 0-BASED array index. Returns `null` for anything that is not a recognised
 * `<PREFIX>_<n>` var (a `bw_*` registry id, a `part_N` fallback, junk) — those
 * do not carry an instance index. Pure.
 */
export function parsePartId(partId: string | null | undefined): { kind: WellElementKind; index: number } | null {
  const m = /^([A-Za-z]+)_(\d+)$/.exec(String(partId ?? '').trim());
  if (!m) return null;
  const kind = VARNAME_KIND[m[1].toUpperCase()];
  if (!kind) return null;
  const n = Number.parseInt(m[2], 10);
  if (!Number.isInteger(n) || n < 1) return null; // var names are 1-based
  return { kind, index: n - 1 };
}

/**
 * Map a baked part id back to the layer flag that shows/hides it — for the #42h
 * layer toggles (`parts.filter(p => layers[layerForPartId(p.id)!])`). Accepts an
 * emit var name (`CSG_3`) OR a `bw_*` registry id (`bw_casing`). Returns `null`
 * for an unrecognised id (the caller should show it rather than hide it). Pure.
 */
export function layerForPartId(partId: string | null | undefined): WellLayerKey | null {
  const id = String(partId ?? '').trim();
  if (!id) return null;

  // Registry `bw_*` id (lowercase) — kind only, no instance index.
  if (/^bw_/i.test(id)) {
    const low = id.toLowerCase();
    return BW_LAYER[low] ?? 'showCompletions'; // any other bw_* is jewelry
  }

  // Emit var name — resolve via the prefix (index part is irrelevant to a layer).
  const parsed = parsePartId(id);
  if (parsed) return KIND_LAYER[parsed.kind];

  // A prefix with no trailing index (defensive: `CSG`, `OH`) still resolves.
  const token = id.replace(/_.*$/, '').toUpperCase();
  const kind = VARNAME_KIND[token];
  return kind ? KIND_LAYER[kind] : null;
}

/**
 * Back-map a baked part id to the ONE source `WellInspectorElement` it was built
 * from — the #42b 3D-pick → inspector cross-link. `elements` is
 * `inspectorElementsFromWson(doc)`; matched on `kind` + 0-based `index`, so it is
 * stable regardless of the list's ordering. Only an emit VAR NAME resolves (it
 * carries the instance index); a `bw_*` id or an unknown id returns `null`. Pure.
 */
export function inspectorElementForPartId(
  partId: string | null | undefined,
  elements: readonly WellInspectorElement[],
): WellInspectorElement | null {
  const parsed = parsePartId(partId);
  if (!parsed) return null;
  return elements.find((e) => e.kind === parsed.kind && e.index === parsed.index) ?? null;
}
