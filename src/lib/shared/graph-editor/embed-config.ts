// ─────────────────────────────────────────────────────────────────────────
// embed-config.ts — feature-flag surface for embedding the graph editor.
//
// The graph editor (GraphEditorPane + RightPane) is mounted in three places:
//   /graph-editor — full-screen, standalone.
//   /primitives   — sidebar (parts list) + N tabbed GraphEditorPane panes.
//   /vocab        — inside the vocab editor's Editor tab.
// …and it's meant to be dropped into OTHER surfaces too (starting with
// /wells, later external apps). Those hosts want the ENGINES + node-graph
// editor but their OWN chrome: their own tool rail, no SVG tab, the editor
// as a popover, only the Manifold engine, etc.
//
// `EmbedConfig` is a small, all-optional bag of on/off switches over the
// REAL, existing UI surfaces. `resolveEmbedConfig(partial?)` fills in the
// defaults; the DEFAULTS reproduce today's full UI EXACTLY — passing nothing
// (or nothing relevant) is a zero-behaviour-change no-op. Turning a flag OFF
// hides exactly that surface.
//
// This module is PURE (no Svelte, no DOM). The `.svelte` files import the
// resolved config + `isTabVisible` and gate rendering on them, keeping the
// component diffs tiny. Unit-tested in embed-config.test.ts.
// ─────────────────────────────────────────────────────────────────────────

/** The right-pane tab ids — kept in exact sync with RightPane.svelte's
 *  `type RightTab`. Order here is the canonical display order (matches the
 *  tab-button order in RightPane's template). */
export type RightPaneTab =
  | 'bake'      // MF_CLIENT — Manifold, client-side WASM bake (also the "2D preview" for profile graphs)
  | 'tf'        // TF — TrueForm, client-side native bake
  | 'source'    // SRC — emitted .asm.ts source
  | 'md'        // MD — drawing markdown
  | 'svg'       // SVG — half-section silhouette
  | 'glb'       // GLB — exported gltf view
  | 'brep'      // BREP — server-side OpenCascade (OCCT) render
  | 'brepsvg'   // BREP-SVG — server-side OCCT true-boundary (HLR) → SVG projection
  | 'mfserver'; // MF_SERVER — Manifold, server-side (Node) bake

/** The three geometry KERNELS the editor can render a part with. Each maps to
 *  one or more engine TABS (see ENGINE_TABS). Turning an engine off removes
 *  its tab(s) from the right pane; the non-engine tabs (source/md/svg/glb) are
 *  unaffected. */
export type EditorEngine = 'manifold' | 'trueform' | 'brep';

/** Embeddable editor config — EVERY field optional. Omitting a field (or the
 *  whole object) resolves to today's full UI. */
export interface EmbedConfig {
  /** Which right-pane tabs are available. `undefined` = ALL tabs (no
   *  restriction). Provide a subset to restrict the tab bar to just those ids;
   *  `[]` hides every tab. Unknown ids are ignored (never crash). Further
   *  intersected with `engines` — an engine tab only shows when its engine is
   *  also enabled. */
  tabs?: RightPaneTab[];
  /** Which geometry engines are selectable. `undefined` = all three. An engine
   *  turned off removes its engine tab(s) (manifold → bake + mfserver,
   *  trueform → tf, brep → brep). Unknown ids ignored. */
  engines?: EditorEngine[];
  /** The /primitives parts-list sidebar (`<aside class="prim-rail">`). Default
   *  `true`. Off = the host provides its own navigation. */
  sidebar?: boolean;
  /** The graph canvas vertical toolbar/palette (`<aside class="ge-vrail">` —
   *  drop-op, +part, undo/redo, wire, save, bake, AI, …). Default `true`.
   *  Off = the host drives the graph via its own controls / the API. */
  toolbar?: boolean;
  /** The whole tabbed right pane (the `<RightPane>` column + its divider).
   *  Default `true`. Off = canvas-only (node graph with no preview column). */
  rightPane?: boolean;
  /** The node-graph canvas pane (`<section class="ge-canvas-pane">` + the
   *  canvas↔pane divider). Default `true`. Off = the RIGHT pane fills the whole
   *  editor — a chrome-free RENDER of the baked graph with no node canvas (the
   *  inverse of `rightPane:false`). `/wells` uses this for its clean 3D view.
   *  Turning BOTH `graphCanvas` and `rightPane` off leaves an empty shell. */
  graphCanvas?: boolean;
  /** Present the editor as a floating popover/panel rather than filling its
   *  container inline. Default `false`. Adds `.ge-root.popover` styling. */
  popover?: boolean;
  /** The RIGHT pane's tab BAR (the vertical `.ge-pane-tabs` strip of tab
   *  buttons — MF_CLIENT / TF / SRC / …). Default `true`. Off = the tab bar is
   *  hidden and the active tab's content fills the pane. `/wells`' clean 3D view
   *  turns this OFF: it pins a single `bake` tab, so the lone "MF_CLIENT" button
   *  is redundant (the full engine tabs live in the ✎ edit-graph popover). This
   *  is EXPLICIT — it does not auto-hide based on the tab count. */
  tabBar?: boolean;
}

/** The fully-resolved config the components consume. All fields concrete. */
export interface ResolvedEmbedConfig {
  /** Effective, ordered tab ids to show (requested ∩ engine-allowed). */
  tabs: RightPaneTab[];
  /** Effective, ordered engine ids that are enabled. */
  engines: EditorEngine[];
  sidebar: boolean;
  toolbar: boolean;
  rightPane: boolean;
  graphCanvas: boolean;
  popover: boolean;
  tabBar: boolean;
}

/** Canonical tab display order — the ONLY source of truth for "all tabs". */
export const ALL_TABS: readonly RightPaneTab[] = [
  'bake', 'tf', 'source', 'md', 'svg', 'glb', 'brep', 'brepsvg', 'mfserver',
];

/** Canonical engine order. */
export const ALL_ENGINES: readonly EditorEngine[] = ['manifold', 'trueform', 'brep'];

/** Which tabs each engine owns. A tab NOT listed here (source/md/svg/glb) is
 *  engine-agnostic and always allowed (subject only to `tabs`). */
export const ENGINE_TABS: Record<EditorEngine, readonly RightPaneTab[]> = {
  manifold: ['bake', 'mfserver'],
  trueform: ['tf'],
  brep: ['brep', 'brepsvg'],
};

/** Tabs that are NOT tied to any engine — always allowed unless `tabs` excludes them. */
const NON_ENGINE_TABS: readonly RightPaneTab[] = ['source', 'md', 'svg', 'glb'];

const TAB_SET = new Set<RightPaneTab>(ALL_TABS);
const ENGINE_SET = new Set<EditorEngine>(ALL_ENGINES);

/** Keep only valid, de-duplicated members of `allowed`, in canonical order. */
function normalizeList<T>(
  requested: readonly T[] | undefined,
  allowed: readonly T[],
  valid: Set<T>,
): T[] {
  // undefined ⇒ no restriction ⇒ the full canonical list.
  if (requested === undefined) return [...allowed];
  const want = new Set(requested.filter((x) => valid.has(x)));
  return allowed.filter((x) => want.has(x));
}

/**
 * Resolve a partial embed config into a fully-concrete one.
 *
 * Passing `undefined` / `{}` (or any object with no recognized keys) yields
 * the FULL current UI: every tab, every engine, sidebar + toolbar + right pane
 * on, popover off — i.e. byte-for-byte today's behaviour.
 */
export function resolveEmbedConfig(partial?: Partial<EmbedConfig> | null): ResolvedEmbedConfig {
  const p = partial ?? {};

  const engines = normalizeList(p.engines, ALL_ENGINES, ENGINE_SET);

  // Tabs allowed by the enabled engines: the engine-agnostic tabs + each
  // enabled engine's own tab(s).
  const engineAllowed = new Set<RightPaneTab>(NON_ENGINE_TABS);
  for (const e of engines) for (const t of ENGINE_TABS[e]) engineAllowed.add(t);

  // Requested tabs (undefined ⇒ all), then intersect with what the engines
  // permit, in canonical order.
  const requested = normalizeList(p.tabs, ALL_TABS, TAB_SET);
  const tabs = requested.filter((t) => engineAllowed.has(t));

  return {
    tabs,
    engines,
    sidebar: p.sidebar ?? true,
    toolbar: p.toolbar ?? true,
    rightPane: p.rightPane ?? true,
    graphCanvas: p.graphCanvas ?? true,
    popover: p.popover ?? false,
    tabBar: p.tabBar ?? true,
  };
}

/** Is `tab` visible under this resolved config? */
export function isTabVisible(cfg: ResolvedEmbedConfig, tab: RightPaneTab): boolean {
  return cfg.tabs.includes(tab);
}

// ─── URL-query parsing (used by the /primitives wrapper) ────────────────────
// An external host can iframe /primitives?sidebar=0&tabs=bake,source&… to
// embed the multi-tab editor with its own chrome. `parseEmbedFromSearch`
// turns those query params into a Partial<EmbedConfig>, or `undefined` when
// NONE of the recognized keys are present (so the default path forwards the
// legacy `embed={true}` and nothing changes).

function parseBool(v: string | null): boolean | undefined {
  if (v == null) return undefined;
  const s = v.trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  return undefined;
}

function parseCsv(v: string | null): string[] | undefined {
  if (v == null) return undefined;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Parse embed flags from a URLSearchParams. Returns `undefined` when no
 * recognized key is present. Recognized keys:
 *   sidebar, toolbar, rightpane|rightPane, graphcanvas|graphCanvas, popover  → boolean (0/1/true/false/…)
 *   tabs      → comma list of RightPaneTab ids
 *   engines   → comma list of EditorEngine ids
 * Invalid list members are dropped by resolveEmbedConfig; here we only shape.
 */
export function parseEmbedFromSearch(sp: URLSearchParams): Partial<EmbedConfig> | undefined {
  const out: Partial<EmbedConfig> = {};
  let any = false;

  const sidebar = parseBool(sp.get('sidebar'));
  if (sidebar !== undefined) { out.sidebar = sidebar; any = true; }
  const toolbar = parseBool(sp.get('toolbar'));
  if (toolbar !== undefined) { out.toolbar = toolbar; any = true; }
  const rightPane = parseBool(sp.get('rightpane') ?? sp.get('rightPane'));
  if (rightPane !== undefined) { out.rightPane = rightPane; any = true; }
  const graphCanvas = parseBool(sp.get('graphcanvas') ?? sp.get('graphCanvas'));
  if (graphCanvas !== undefined) { out.graphCanvas = graphCanvas; any = true; }
  const popover = parseBool(sp.get('popover'));
  if (popover !== undefined) { out.popover = popover; any = true; }
  const tabBar = parseBool(sp.get('tabbar') ?? sp.get('tabBar'));
  if (tabBar !== undefined) { out.tabBar = tabBar; any = true; }

  const tabs = parseCsv(sp.get('tabs'));
  if (tabs !== undefined) { out.tabs = tabs as RightPaneTab[]; any = true; }
  const engines = parseCsv(sp.get('engines'));
  if (engines !== undefined) { out.engines = engines as EditorEngine[]; any = true; }

  return any ? out : undefined;
}
