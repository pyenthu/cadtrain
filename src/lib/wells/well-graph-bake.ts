/**
 * well-graph-bake — bake a WSON well through the PRIMITIVES pipeline.
 *
 * This is the whole of `/wells` 3D geometry. There is no bespoke renderer and no
 * hand-drawn THREE geometry: a well is translated to the composition graph
 * (`wsonToGraph`), emitted as an ordinary assembly source, compiled by
 * `/api/primitives/compile`, and baked by the SAME client Web-Worker that bakes
 * every `/primitives` part. NO FALLBACK — an engine failure is surfaced, never
 * papered over with a stand-in (see the `wells` skill).
 *
 * Two facts govern the shape of this module.
 *
 * 1. **Never render the composed body.** The emitted well returns a LIST of
 *    elements, one `bw_*` per WSON row, each independently warped along the one
 *    survey spline. `M.compose` on OVERLAPPING bodies is a UNION, and every well
 *    element sits inside the open hole — composing them collapses the well to the
 *    open hole alone. `autoPlace` therefore keeps them as separate `_parts`, which
 *    the bake surfaces as `parts[]`. Render those.
 *
 * 2. **Axial rings must exist BEFORE the warp** (Rule 25), so their spacing is a
 *    BAKE option, not a warp-node option, and it is derived from the survey's
 *    curvature rather than the absolute `WARP_AXIAL_MAX_ZSPAN` constant — which is
 *    sized for a ~40-unit CAD part and costs 5.9x on a 1 km well for sag four
 *    orders of magnitude below visibility. See `./axial-density`.
 *
 * `wellBakeSpec` is PURE (no fetch, no Manifold, no DOM) so the whole decision
 * layer is unit-tested; `bakeWell` is the thin I/O shell around it.
 */
import type { Wson } from './wson';
import { wsonToGraph } from './wson-to-graph';
import { hydrateGraph } from '$lib/graph/composition-graph-hydrate';
import { emitGraph } from '$lib/graph/composition-emit';
import { axialSpanForSurvey } from './axial-density';
import type { SurveyStation } from '$lib/graph/survey-to-xyz';

/** The bake identity of a well. `name` must satisfy the compile endpoint's
 *  `/^[a-z_][a-z0-9_]*$/i`, so it is derived, not taken from the well name. */
export const WELL_PART_NAME = 'w_wells_preview';

export interface WellBakeSpecOptions {
  /** Half-section cutaway. Undefined → the bake's auto threshold. */
  cutaway?: boolean;
  /** Circular segment count for every element. Lower = faster draft bakes. */
  segments?: number;
  /** Override the derived axial ring spacing. Rarely needed; the derivation
   *  already respects a sag budget. */
  axialMaxZSpan?: number | null;
}

export interface WellBakeSpec {
  /** The emitted assembly source — an ordinary `.asm.ts`, never saved anywhere. */
  source: string;
  name: string;
  /** Bake params (the emitted well exposes `segments`). */
  params: Record<string, unknown>;
  /** `BakeOptions` for `bakeClient.run` / `runCompiledManifold`. */
  options: { cutaway?: boolean; segments?: number; axialMaxZSpan?: number | null };
  /** True when the well carries a survey and therefore warps along a spline. */
  deviated: boolean;
}

/** The widest RADIAL half-size in the well, in the geometry's radial unit
 *  (inches — WSON `od`/`bitSize`). Sets the absolute sag budget. Falls back to a
 *  sane 13" (a 26" surface hole) for a well with no tubulars at all. */
export function wellMaxRadius(wson: Wson): number {
  let maxDia = 0;
  for (const o of wson.oh ?? []) maxDia = Math.max(maxDia, o.bitSize ?? 0);
  for (const c of wson.ch ?? []) maxDia = Math.max(maxDia, c.od ?? 0);
  for (const c of wson.completions ?? []) maxDia = Math.max(maxDia, c.od ?? 0);
  return maxDia > 0 ? maxDia / 2 : 13;
}

/**
 * Everything needed to bake this well, decided purely. Throws whatever
 * `wsonToGraph` throws (unmapped `tool_comp`, non-positive annulus, …) — the
 * NO-FALLBACK contract: a well that cannot be expressed as a graph is an error,
 * not a stand-in.
 */
export function wellBakeSpec(wson: Wson, opts: WellBakeSpecOptions = {}): WellBakeSpec {
  const graph = wsonToGraph(wson);
  const emitted = emitGraph(hydrateGraph(graph), { id: WELL_PART_NAME });
  const errors = emitted.validationErrors ?? [];
  if (errors.length) {
    throw new Error(`well graph did not emit cleanly: ${errors.slice(0, 3).join('; ')}`);
  }

  const profile = (wson.profile ?? []) as SurveyStation[];
  const deviated = profile.length > 1;

  // Straight hole ⇒ no warp ⇒ the dial is irrelevant; pass `null` so a lean
  // revolve is not needlessly re-lathed. Deviated ⇒ derive from the survey.
  const axial = opts.axialMaxZSpan !== undefined
    ? opts.axialMaxZSpan
    : deviated
      ? axialSpanForSurvey(profile, wellMaxRadius(wson))
      : null;

  return {
    source: emitted.source,
    name: WELL_PART_NAME,
    params: opts.segments != null ? { segments: opts.segments } : {},
    options: {
      ...(opts.cutaway !== undefined ? { cutaway: opts.cutaway } : {}),
      ...(opts.segments != null ? { segments: opts.segments } : {}),
      axialMaxZSpan: axial,
    },
    deviated,
  };
}

/** One baked well element, ready to mount as a mesh. */
export interface WellPart {
  /** Emitted var name — `OH_1`, `CEM_2`, `CSG_3`, `COMP_5`. Stable across bakes,
   *  so it is a usable Svelte `{#each}` key and a selection id. */
  id: string;
  geo: import('three').BufferGeometry;
  appearance?: import('$lib/shared/viewer/part-appearance').PartAppearance;
}

export interface BakedWell {
  parts: WellPart[];
  cutParts?: WellPart[];
  deviated: boolean;
  scriptHash: string;
}

/**
 * Compile + bake a well, returning its per-element geometry.
 *
 * Browser-only (the bake runs in a Web Worker; Manifold cannot init on the main
 * thread under the app-wide COEP `require-corp`). Headless callers should use
 * `wellBakeSpec` + `runCompiledManifold` directly, as the tests do.
 */
export async function bakeWell(
  wson: Wson,
  opts: WellBakeSpecOptions = {},
  fetchFn: typeof fetch = fetch,
): Promise<BakedWell> {
  const spec = wellBakeSpec(wson, opts);

  const res = await fetchFn('/api/primitives/compile', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: spec.name, source: spec.source }),
  });
  if (!res.ok) throw new Error(`well compile failed: HTTP ${res.status}`);
  const compiled = await res.json();
  if (!compiled?.supported) {
    throw new Error(`well compile unsupported: ${compiled?.reason ?? 'unknown reason'}`);
  }

  const { bakeClient, isCancelled } = await import('$lib/engines/manifold/bake-client');
  const result = await bakeClient.run({
    script: compiled.script,
    scriptHash: compiled.scriptHash,
    params: spec.params,
    options: { ...spec.options, ...(compiled.partColors ? { parts: compiled.partColors } : {}) },
  });
  if (isCancelled(result)) throw new Error('well bake superseded');

  // `parts[]` is the point — see the module header. A well that produced no
  // separate parts means the emit collapsed to a single body; surface it rather
  // than silently rendering the fused open hole.
  if (!result.parts?.length) {
    throw new Error('well bake returned no separate parts — refusing to render the composed body');
  }

  const toParts = (ps: NonNullable<typeof result.parts>): WellPart[] =>
    ps.map((p, i) => ({ id: p.id ?? `part_${i}`, geo: p.geo, appearance: p.appearance }));

  return {
    parts: toParts(result.parts),
    cutParts: result.cutParts?.length ? toParts(result.cutParts) : undefined,
    deviated: spec.deviated,
    scriptHash: compiled.scriptHash,
  };
}
