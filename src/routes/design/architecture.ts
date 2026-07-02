/**
 * architecture.ts — curated node/edge dataset for the /design interactive graph.
 *
 * Laid out as a **C4 "Container" diagram (level 2)**: one system boundary
 * ("CAD Train") holds four labeled container boxes, and ~56 component nodes
 * live INSIDE those containers via xyflow parent/extent nesting.
 *
 *   sys-cadtrain  (system boundary, variant:'system')
 *     ├─ c-webapp  Web App        — route pages + the GraphEditorPane editor cluster + Threlte viewer
 *     ├─ c-api     API layer       — /api/* endpoint groups
 *     ├─ c-kernel  CAD kernel      — composition graph/emit/bake, expr engine, Manifold WASM + welded mesh, engines, loader, RAG, translator
 *     └─ c-volume  Volume store    — persistent parts / profiles / vocabulary / RAG corpus / caches
 *
 * Component node kinds:
 *   route  — a SvelteKit page route (clickable → navigates)
 *   api    — an HTTP endpoint group
 *   lib    — an engine / pipeline stage / UI component
 *   store  — a persistent data sink
 *
 * Edge types:
 *   calls   — route → api (fetch) / api → kernel module
 *   mounts  — route → lib, or lib → child lib (Svelte component composition)
 *   flow    — pipeline data flow (animated, bake pipeline)
 *   reads   — api/lib → store (read)
 *   writes  — api/lib → store (write)
 *   nav     — user navigation between routes
 *   summary — container → container relationship (C4-level arrow)
 *
 * xyflow nesting rules honoured here:
 *   - parents appear BEFORE their children in ARCH_NODES (system → containers → components)
 *   - child `position` is RELATIVE to its parent container's top-left
 *   - children carry `parentId` + `extent:'parent'`
 *   - container/system nodes carry explicit width/height (style string)
 *   ...then everything is FLATTENED to absolute coordinates at export time
 *   (see the FLATTEN section) so edge endpoints resolve even below the fold.
 */

export type NodeKind = 'route' | 'api' | 'lib' | 'store';
export type EdgeKind = 'calls' | 'mounts' | 'flow' | 'reads' | 'writes' | 'nav' | 'summary';

export interface ArchNodeData {
  label: string;
  kind: NodeKind;
  href?: string;      // route / api — click target
  blurb?: string;     // tooltip / legend text
  planned?: boolean;  // grayed-out / dashed border
  archived?: boolean; // archived/deprecated node
}

export interface ContainerNodeData {
  label: string;
  variant: 'system' | 'container';
  tech?: string;      // technology label shown next to the title
  accent?: string;    // border / title colour
  blurb?: string;
}

export interface ArchEdgeData {
  edgeKind: EdgeKind;
  label?: string;
}

// ──────────────────────────────────────────────────────────
// CONTAINER GEOMETRY (absolute, within the system boundary)
//
// Children are positioned RELATIVE to these origins below.
// ──────────────────────────────────────────────────────────
const SYS = { x: 0, y: 0, w: 1788, h: 952 };

// container boxes laid left→right inside the system boundary
const C = {
  webapp: { x: 24, y: 56, w: 700, h: 862 },
  api: { x: 748, y: 56, w: 250, h: 862 },
  kernel: { x: 1026, y: 56, w: 470, h: 790 },
  volume: { x: 1524, y: 56, w: 240, h: 632 },
};

// within-container layout constants (relative to each container's top-left)
const HEAD = 50;        // top inset (clears the title chip)
const PITCH = 80;       // vertical gap between component nodes
const PAD_X = 16;       // single-column left inset (api + volume)
// web-app is 3 columns: routes · GEP editor cluster · viewer cluster
const WA = 16, WB = 240, WC = 464;
// kernel is 2 columns: graph→source pipeline · execution / engines / retrieval
const KA = 16, KB = 240;

const row = (i: number) => HEAD + PITCH * i;

// ──────────────────────────────────────────────────────────
// CONTAINER + SYSTEM NODES  (must come BEFORE their children)
// ──────────────────────────────────────────────────────────
const ARCH_CONTAINERS_NESTED = [
  {
    id: 'sys-cadtrain',
    type: 'containerNode',
    position: { x: SYS.x, y: SYS.y },
    width: SYS.w,
    height: SYS.h,
    style: `width:${SYS.w}px;height:${SYS.h}px;`,
    selectable: false,
    draggable: false,
    connectable: false,
    deletable: false,
    data: {
      label: 'CAD Train',
      variant: 'system',
      tech: 'Software System',
      accent: '#475569',
      blurb: 'The whole parametric-CAD pipeline — one SvelteKit app + WASM kernel over a persistent volume.',
    } satisfies ContainerNodeData,
  },
  {
    id: 'c-webapp',
    type: 'containerNode',
    position: { x: C.webapp.x, y: C.webapp.y },
    width: C.webapp.w,
    height: C.webapp.h,
    style: `width:${C.webapp.w}px;height:${C.webapp.h}px;`,
    parentId: 'sys-cadtrain',
    extent: 'parent',
    selectable: false,
    draggable: false,
    connectable: false,
    deletable: false,
    data: {
      label: 'Web App',
      variant: 'container',
      tech: 'SvelteKit · Svelte 5',
      accent: '#3b82f6',
      blurb: 'Client-only SPA (SSR off). Route pages · the decomposed GraphEditorPane editor · the Threlte 3D viewer.',
    } satisfies ContainerNodeData,
  },
  {
    id: 'c-api',
    type: 'containerNode',
    position: { x: C.api.x, y: C.api.y },
    width: C.api.w,
    height: C.api.h,
    style: `width:${C.api.w}px;height:${C.api.h}px;`,
    parentId: 'sys-cadtrain',
    extent: 'parent',
    selectable: false,
    draggable: false,
    connectable: false,
    deletable: false,
    data: {
      label: 'API layer',
      variant: 'container',
      tech: 'adapter-node',
      accent: '#22c55e',
      blurb: 'SvelteKit server endpoints (SSR). Proxy to the volume, run server-side bakes, dispatch Claude.',
    } satisfies ContainerNodeData,
  },
  {
    id: 'c-kernel',
    type: 'containerNode',
    position: { x: C.kernel.x, y: C.kernel.y },
    width: C.kernel.w,
    height: C.kernel.h,
    style: `width:${C.kernel.w}px;height:${C.kernel.h}px;`,
    parentId: 'sys-cadtrain',
    extent: 'parent',
    selectable: false,
    draggable: false,
    connectable: false,
    deletable: false,
    data: {
      label: 'CAD kernel',
      variant: 'container',
      tech: 'ManifoldCAD WASM',
      accent: '#f97316',
      blurb: 'Graph → source → mesh. Composition graph/emit/bake, the expr engine, the Manifold CSG core + welded-mesh toolkit, engine primitives, RAG + the vocabulary translator.',
    } satisfies ContainerNodeData,
  },
  {
    id: 'c-volume',
    type: 'containerNode',
    position: { x: C.volume.x, y: C.volume.y },
    width: C.volume.w,
    height: C.volume.h,
    style: `width:${C.volume.w}px;height:${C.volume.h}px;`,
    parentId: 'sys-cadtrain',
    extent: 'parent',
    selectable: false,
    draggable: false,
    connectable: false,
    deletable: false,
    data: {
      label: 'Volume store',
      variant: 'container',
      tech: '$APP_DATA_DIR',
      accent: '#a855f7',
      blurb: 'One persistent volume — parts, profiles, vocabulary, the RAG corpus and the bake cache. Survives redeploys.',
    } satisfies ContainerNodeData,
  },
];

// ──────────────────────────────────────────────────────────
// COMPONENT NODES  (positions are RELATIVE to their parent container)
// ──────────────────────────────────────────────────────────
const ARCH_NODES_NESTED = [
  // ═════════════ Web App container ═════════════
  // ── Column A: route pages ──
  {
    id: 'r-primitives', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WA, y: row(0) },
    data: { kind: 'route', label: '/primitives', href: '/primitives',
      blurb: 'Sidebar of volume parts + multi-tab graph editor (N × GraphEditorPane).' } satisfies ArchNodeData,
  },
  {
    id: 'r-graph-editor', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WA, y: row(1) },
    data: { kind: 'route', label: '/graph-editor', href: '/graph-editor',
      blurb: 'The CAD editor — single primitive, full-screen. Mounts GraphEditorPane with ?id=&embed=1.' } satisfies ArchNodeData,
  },
  {
    id: 'r-vocab', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WA, y: row(2) },
    data: { kind: 'route', label: '/vocab', href: '/vocab',
      blurb: 'Vocabulary editor — browse, infer, bake, promote vocabulary entries.' } satisfies ArchNodeData,
  },
  {
    id: 'r-wells', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WA, y: row(3) },
    data: { kind: 'route', label: '/wells', href: '/wells',
      blurb: 'WIP: 3D-first well schematic — WSON → 3D well diagram (WellScene). Plan: docs/plans/well-schematic.md.' } satisfies ArchNodeData,
  },
  {
    id: 'r-research', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WA, y: row(4) },
    data: { kind: 'route', label: '/research', href: '/research',
      blurb: 'Markdown research notes — node-editor study, parked leads, findings (rendered via marked).' } satisfies ArchNodeData,
  },
  {
    id: 'r-volume', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WA, y: row(5) },
    data: { kind: 'route', label: '/volume', href: '/volume',
      blurb: 'Volume file manager — browse + manage the persistent data volume.' } satisfies ArchNodeData,
  },
  {
    id: 'r-plan', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WA, y: row(6) },
    data: { kind: 'route', label: '/plan', href: '/plan',
      blurb: 'Gantt roadmap — the single source of truth for project scope (HTML/CSS Gantt + details popups).' } satisfies ArchNodeData,
  },
  {
    id: 'r-design', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WA, y: row(7) },
    data: { kind: 'route', label: '/design', href: '/design',
      blurb: 'This page — interactive C4 architecture graph of the project.' } satisfies ArchNodeData,
  },
  {
    id: 'r-fem', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WA, y: row(8) },
    data: { kind: 'route', label: '/fem', archived: true,
      blurb: 'Archived — FEM stress + 3D tension viewer (moved to archive/src/routes/fem/). Oilfield units.' } satisfies ArchNodeData,
  },
  {
    id: 'r-forge', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WA, y: row(9) },
    data: { kind: 'route', label: '/forge', archived: true,
      blurb: 'Archived — Image → 3D scaffold via FAL Hunyuan3D (moved to archive/src/routes/forge/).' } satisfies ArchNodeData,
  },

  // ── Column B: GraphEditorPane editor cluster (modularize K.65) ──
  {
    id: 'l-gep', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WB, y: row(0) },
    data: { kind: 'lib', label: 'GraphEditorPane',
      blurb: 'THE CAD editor shell. Node-graph canvas + bake. Mounts in /graph-editor (full-screen) and /primitives (one per tab).' } satisfies ArchNodeData,
  },
  {
    id: 'l-nodecard', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WB, y: row(1) },
    data: { kind: 'lib', label: 'NodeCard',
      blurb: 'Per-node SVG cards — call/method/mv/rot/repeat/container/polygon/poly_repeat + resize grip (Phase F).' } satisfies ArchNodeData,
  },
  {
    id: 'l-rightpane', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WB, y: row(2) },
    data: { kind: 'lib', label: 'RightPane',
      blurb: 'The 6-tab right column: 3D bake · SRC · MD · SVG · GLB · BREP. + PARAMS / PROPERTIES cards.' } satisfies ArchNodeData,
  },
  {
    id: 'l-sketch-ed', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WB, y: row(3) },
    data: { kind: 'lib', label: 'SketchEditorPane',
      blurb: 'Full-tab sketch editor + SketchNodeCard, backed by the per-instance SketchState class (Phase E).' } satisfies ArchNodeData,
  },
  {
    id: 'l-wire-state', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WB, y: row(4) },
    data: { kind: 'lib', label: 'wire-state / sockets',
      blurb: 'Per-instance WireState class — drag-to-wire sockets (from/mouse, start/endWireOn*) + pointer-capture (Phase C).' } satisfies ArchNodeData,
  },
  {
    id: 'l-expr-menu', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WB, y: row(5) },
    data: { kind: 'lib', label: 'ExpressionsMenu',
      blurb: 'The expr/ builder UI — ExpressionBuilderPopup + visual/src panes over the graph-exprs engine.' } satisfies ArchNodeData,
  },
  {
    id: 'l-ge-assist', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WB, y: row(6) },
    data: { kind: 'lib', label: 'ge-assist ✨',
      blurb: 'AI multi-shot loop — exposes editor mutation fns as Claude tools to patch the open graph (/api/rag/assist).' } satisfies ArchNodeData,
  },
  {
    id: 'l-paramgrid', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WB, y: row(7) },
    data: { kind: 'lib', label: 'ParamGrid',
      blurb: 'ParamSchema-driven param card grid. Shared chrome across /primitives + /vocab.' } satisfies ArchNodeData,
  },

  // ── Column C: viewer / scene cluster ──
  {
    id: 'l-threlte', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WC, y: row(0) },
    data: { kind: 'lib', label: 'Threlte viewer',
      blurb: 'Declarative Three.js for Svelte. Mesh / GLB / SVG rendering, cutaway, per-part colour, Z-down convention.' } satisfies ArchNodeData,
  },
  {
    id: 'l-dualcanvas', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WC, y: row(1) },
    data: { kind: 'lib', label: 'PrimitiveDualCanvas',
      blurb: 'Mesh + GLB dual canvas (+ PrimitiveDualScene). smoothShade gate; stable-args prop avoids re-mount loops.' } satisfies ArchNodeData,
  },
  {
    id: 'l-scene-controls', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WC, y: row(2) },
    data: { kind: 'lib', label: 'SceneControls',
      blurb: 'Camera / light / zScale + warp toggle; reads the shared scene-state rune store.' } satisfies ArchNodeData,
  },
  {
    id: 'l-wellscene', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WC, y: row(3) },
    data: { kind: 'lib', label: 'WellScene',
      blurb: 'The /wells 3D well diagram — WSON → assembled Three scene (src/lib/wells/).' } satisfies ArchNodeData,
  },
  {
    id: 'l-coi', type: 'archNode', parentId: 'c-webapp', extent: 'parent',
    position: { x: WC, y: row(4) },
    data: { kind: 'lib', label: 'cross-origin isolation',
      blurb: 'App-wide invariant: every response carries COOP:same-origin + COEP:require-corp (hooks.server.ts in prod · a vite dev-server middleware in dev) → self.crossOriginIsolated = true, which lets TrueForm\'s pthread WASM use SharedArrayBuffer. FORBIDS any non-same-origin / non-CORP subresource (a CDN font/script would be COEP-blocked); cadtrain serves assets same-origin + proxies its API under /api/*.' } satisfies ArchNodeData,
  },

  // ═════════════ API layer container ═════════════
  {
    id: 'a-prim-data', type: 'archNode', parentId: 'c-api', extent: 'parent',
    position: { x: PAD_X, y: row(0) },
    data: { kind: 'api', label: '/api/primitives (data)',
      blurb: 'list · save · source · delete · restore · move · rename · mkdir — proxied to the prod volume.' } satisfies ArchNodeData,
  },
  {
    id: 'a-prim-bake', type: 'archNode', parentId: 'c-api', extent: 'parent',
    position: { x: PAD_X, y: row(1) },
    data: { kind: 'api', label: '/api/primitives (bake)',
      blurb: 'preview · bake-preview · compile (dep-inlined script + scriptHash) — stay LOCAL (fast WASM), not proxied.' } satisfies ArchNodeData,
  },
  {
    id: 'a-prim-ai', type: 'archNode', parentId: 'c-api', extent: 'parent',
    position: { x: PAD_X, y: row(2) },
    data: { kind: 'api', label: '/api/primitives (AI)',
      blurb: 'refine · recognize · describe · prompts · instructions — Claude-assisted (anthropic-api / claude-cli backends).' } satisfies ArchNodeData,
  },
  {
    id: 'a-profiles', type: 'archNode', parentId: 'c-api', extent: 'parent',
    position: { x: PAD_X, y: row(3) },
    data: { kind: 'api', label: '/api/primitives/profiles',
      blurb: 'list · save · delete · resolve · source — profile-function (.prvl/.prex) endpoints.' } satisfies ArchNodeData,
  },
  {
    id: 'a-brep', type: 'archNode', parentId: 'c-api', extent: 'parent',
    position: { x: PAD_X, y: row(4) },
    data: { kind: 'api', label: '/api/brep/preview',
      blurb: 'Server-side OCCT BREP executor — graph → true-curve boundary representation for the BREP tab.' } satisfies ArchNodeData,
  },
  {
    id: 'a-rag', type: 'archNode', parentId: 'c-api', extent: 'parent',
    position: { x: PAD_X, y: row(5) },
    data: { kind: 'api', label: '/api/rag/*',
      blurb: 'rebuild · stats · scan-refs · prompt · assist — BM25 retrieval + Claude → composition graph (generative authoring).' } satisfies ArchNodeData,
  },
  {
    id: 'a-vocab', type: 'archNode', parentId: 'c-api', extent: 'parent',
    position: { x: PAD_X, y: row(6) },
    data: { kind: 'api', label: '/api/vocab/*',
      blurb: 'regenerate · infer · bake-proposed · promote · promote-proposed — vocabulary lifecycle endpoints.' } satisfies ArchNodeData,
  },
  {
    id: 'a-cache', type: 'archNode', parentId: 'c-api', extent: 'parent',
    position: { x: PAD_X, y: row(7) },
    data: { kind: 'api', label: '/api/cache/*',
      blurb: 'stats (Railway health check) · bake-stats · list · entry · clear · delete — bake-cache management.' } satisfies ArchNodeData,
  },
  {
    id: 'a-volume', type: 'archNode', parentId: 'c-api', extent: 'parent',
    position: { x: PAD_X, y: row(8) },
    data: { kind: 'api', label: '/api/volume',
      blurb: 'Generic CRUD against the persistent volume (X-Volume-Token). Sub: backup, onedrive.' } satisfies ArchNodeData,
  },
  {
    id: 'a-manifest', type: 'archNode', parentId: 'c-api', extent: 'parent',
    position: { x: PAD_X, y: row(9) },
    data: { kind: 'api', label: '/api/manifest',
      blurb: 'Machine-readable capability manifest — operations, workflow links, LLM-friendly description.' } satisfies ArchNodeData,
  },

  // ═════════════ CAD kernel container ═════════════
  // ── Column A: graph → source pipeline + 2D ──
  {
    id: 'l-comp-graph', type: 'archNode', parentId: 'c-kernel', extent: 'parent',
    position: { x: KA, y: row(0) },
    data: { kind: 'lib', label: 'composition-graph',
      blurb: 'Node-graph model (types/mutate/hydrate): Call · Container · Method · Mv · Rot · Repeat · Polygon · PolyRepeat. ArgValue = literal | expr | param.' } satisfies ArchNodeData,
  },
  {
    id: 'l-emit', type: 'archNode', parentId: 'c-kernel', extent: 'parent',
    position: { x: KA, y: row(1) },
    data: { kind: 'lib', label: 'composition-emit',
      blurb: 'Graph → emitted TypeScript body (+ composition-emit-profile for polygon/profile). Parts carry meta.graph + body.' } satisfies ArchNodeData,
  },
  {
    id: 'l-comp-bake', type: 'archNode', parentId: 'c-kernel', extent: 'parent',
    position: { x: KA, y: row(2) },
    data: { kind: 'lib', label: 'composition-bake',
      blurb: 'Graph bake orchestration — drives emit → sandbox → Manifold and assembles the result.' } satisfies ArchNodeData,
  },
  {
    id: 'l-comp-layout', type: 'archNode', parentId: 'c-kernel', extent: 'parent',
    position: { x: KA, y: row(3) },
    data: { kind: 'lib', label: 'composition-layout',
      blurb: 'Canvas auto-layout — positions nodes/sockets for the GraphEditorPane.' } satisfies ArchNodeData,
  },
  {
    id: 'l-exprs', type: 'archNode', parentId: 'c-kernel', extent: 'parent',
    position: { x: KA, y: row(4) },
    data: { kind: 'lib', label: 'graph-exprs / expr-schema',
      blurb: 'The expression engine — typed expr nodes, validation + emit. Feeds parameterised ArgValues into emitted source.' } satisfies ArchNodeData,
  },
  {
    id: 'l-sketch', type: 'archNode', parentId: 'c-kernel', extent: 'parent',
    position: { x: KA, y: row(5) },
    data: { kind: 'lib', label: 'sketch engine',
      blurb: 'compileSketch(ops) → (r,z) via Maker.js (line/spline/fillet/chamfer). Injected into the part sandbox as sketch(...).' } satisfies ArchNodeData,
  },
  {
    id: 'l-csg2d', type: 'archNode', parentId: 'c-kernel', extent: 'parent',
    position: { x: KA, y: row(6) },
    data: { kind: 'lib', label: 'csg-2d',
      blurb: 'CrossSection helpers (cs, extrude_csg, ext, resample) — the 2D profile → solid path.' } satisfies ArchNodeData,
  },
  {
    id: 'l-sandbox', type: 'archNode', parentId: 'c-kernel', extent: 'parent',
    position: { x: KA, y: row(7) },
    data: { kind: 'lib', label: 'primitive-sandbox',
      blurb: 'Sandboxed exec for part sources — injects the helper + welded-mesh + sketch toolkits, runs the geom function.' } satisfies ArchNodeData,
  },

  // ── Column B: execution · engines · cache · retrieval ──
  {
    id: 'l-manifold-mesh', type: 'archNode', parentId: 'c-kernel', extent: 'parent',
    position: { x: KB, y: row(0) },
    data: { kind: 'lib', label: 'manifold-mesh',
      blurb: 'The PRIMARY geometry builder — welded toolkit (gridPatch / capFan / weldAndBuild) with explicit Z-segmentation.' } satisfies ArchNodeData,
  },
  {
    id: 'l-manifold', type: 'archNode', parentId: 'c-kernel', extent: 'parent',
    position: { x: KB, y: row(1) },
    data: { kind: 'lib', label: 'Manifold WASM',
      blurb: 'WASM CSG core. Bakes emitted source into a triangle mesh — server-side (preview/bake) or client-side (worker).' } satisfies ArchNodeData,
  },
  {
    id: 'l-loader', type: 'archNode', parentId: 'c-kernel', extent: 'parent',
    position: { x: KB, y: row(2) },
    data: { kind: 'lib', label: 'primitive-loader',
      blurb: 'Resolves a part + its meta.uses deps (stdlib-first), feeds the sandbox. Backs /preview + /bake-preview.' } satisfies ArchNodeData,
  },
  {
    id: 'l-stdlib', type: 'archNode', parentId: 'c-kernel', extent: 'parent',
    position: { x: KB, y: row(3) },
    data: { kind: 'lib', label: 'stdlib engines',
      blurb: 'Active engine primitives in src/ (r_cuboid · r_loft · r_weld_extrude). Read-only, baked into the build via stdlib.ts.' } satisfies ArchNodeData,
  },
  {
    id: 'l-stdstale', type: 'archNode', parentId: 'c-kernel', extent: 'parent',
    position: { x: KB, y: row(4) },
    data: { kind: 'lib', label: 'stdstale engines',
      blurb: 'Deprecated-but-resolvable engines (r_revolve · r_extrude) so legacy parts keep baking.' } satisfies ArchNodeData,
  },
  {
    id: 'l-bake-cache', type: 'archNode', parentId: 'c-kernel', extent: 'parent',
    position: { x: KB, y: row(5) },
    data: { kind: 'lib', label: 'bake-cache',
      blurb: 'Server-side bake cache keyed by part + param hash. Persisted on the volume; survives redeploys.' } satisfies ArchNodeData,
  },
  {
    id: 'l-bake-client', type: 'archNode', parentId: 'c-kernel', extent: 'parent',
    position: { x: KB, y: row(6) },
    data: { kind: 'lib', label: 'client bake (worker)',
      blurb: 'bake-worker + bake-client — execute the compiled script in a browser Web Worker (💻 toggle). Kills the stale-bake bug.' } satisfies ArchNodeData,
  },
  {
    id: 'l-rule-translator', type: 'archNode', parentId: 'c-kernel', extent: 'parent',
    position: { x: KB, y: row(7) },
    data: { kind: 'lib', label: 'rule-translator',
      blurb: 'Deterministic vocabulary → composition graph (authoring/). synonym → extends → compose → hand-author.' } satisfies ArchNodeData,
  },
  {
    id: 'l-rag-corpus', type: 'archNode', parentId: 'c-kernel', extent: 'parent',
    position: { x: KB, y: row(8) },
    data: { kind: 'lib', label: 'rag-corpus / query',
      blurb: 'Builds + BM25-queries the parts corpus for generative-authoring retrieval (rag-corpus/query/prompt/l1).' } satisfies ArchNodeData,
  },
  {
    id: 'l-trueform', type: 'archNode', parentId: 'c-kernel', extent: 'parent',
    position: { x: KB, y: row(9) },
    data: { kind: 'lib', label: 'TrueForm (tf) — client',
      blurb: 'The 3rd geometry engine (TF tab). @polydera/trueform exact-mesh WASM kernel run CLIENT-SIDE on the main thread (trueform-client/adapter). Renders a from-scratch box today (proves the kernel inits); client + server are both the goal. Its pthread pool transfers a SharedArrayBuffer, so it needs cross-origin isolation.' } satisfies ArchNodeData,
  },

  // ═════════════ Volume store container ═════════════
  {
    id: 's-primitives-vol', type: 'archNode', parentId: 'c-volume', extent: 'parent',
    position: { x: PAD_X, y: row(0) },
    data: { kind: 'store', label: 'primitives/ (parts)',
      blurb: 'Flat typed sources: <id>.prim.ts · .asm.ts. Categories basic/ · completions/<family>/ · archive/.' } satisfies ArchNodeData,
  },
  {
    id: 's-profiles', type: 'archNode', parentId: 'c-volume', extent: 'parent',
    position: { x: PAD_X, y: row(1) },
    data: { kind: 'store', label: 'profiles (.prvl/.prex)',
      blurb: 'Profile-function sources — revolve (.prvl.ts) + extrude (.prex.ts) profiles referenced by parts.' } satisfies ArchNodeData,
  },
  {
    id: 's-vocab-json', type: 'archNode', parentId: 'c-volume', extent: 'parent',
    position: { x: PAD_X, y: row(2) },
    data: { kind: 'store', label: 'vocabulary.json',
      blurb: 'Curated vocabulary (docs/parts/vocabulary.json) — single source of truth for part kinds, params, rules.' } satisfies ArchNodeData,
  },
  {
    id: 's-rag-corpus', type: 'archNode', parentId: 'c-volume', extent: 'parent',
    position: { x: PAD_X, y: row(3) },
    data: { kind: 'store', label: 'ai/rag/parts.jsonl',
      blurb: 'RAG corpus — BM25 index of all parts for generative-authoring retrieval.' } satisfies ArchNodeData,
  },
  {
    id: 's-bake-cache-vol', type: 'archNode', parentId: 'c-volume', extent: 'parent',
    position: { x: PAD_X, y: row(4) },
    data: { kind: 'store', label: 'cache/ (bakes)',
      blurb: 'Persistent bake cache — mesh / GLB results keyed by part + param hash.' } satisfies ArchNodeData,
  },
  {
    id: 's-archive', type: 'archNode', parentId: 'c-volume', extent: 'parent',
    position: { x: PAD_X, y: row(5) },
    data: { kind: 'store', label: 'archive/ (soft-deleted)',
      blurb: 'Trashed parts, figures and test-recordings — where /api/primitives/delete moves things.' } satisfies ArchNodeData,
  },
  {
    id: 's-volume-root', type: 'archNode', parentId: 'c-volume', extent: 'parent',
    position: { x: PAD_X, y: row(6) },
    data: { kind: 'store', label: '$APP_DATA_DIR',
      blurb: 'Volume root: CADTRAIN_VOLUME_ROOT → RAILWAY_VOLUME_MOUNT_PATH → /app_data → ./.dev-volume. Local dev proxies to prod.' } satisfies ArchNodeData,
  },
];

// ──────────────────────────────────────────────────────────
// FLATTEN — parent/extent nesting → absolute coordinates
//
// xyflow renders nodes back-to-front in array order, and edges sit visually
// just above same-zIndex nodes. So we (1) keep the big container/system boxes
// FIRST (drawn behind), (2) push them to a negative zIndex so the edges draw
// over their translucent fills, and (3) convert every child's parent-relative
// position to an absolute one, dropping `parentId`/`extent` so edge endpoints
// resolve even when the graph renders below the fold (otherwise
// getEdgePosition() returns null → zero `.svelte-flow__edge-path` elements).
// ──────────────────────────────────────────────────────────
const CONTAINER_ORIGIN: Record<string, { x: number; y: number }> = {
  'sys-cadtrain': { x: SYS.x, y: SYS.y },
  'c-webapp': { x: C.webapp.x, y: C.webapp.y },
  'c-api': { x: C.api.x, y: C.api.y },
  'c-kernel': { x: C.kernel.x, y: C.kernel.y },
  'c-volume': { x: C.volume.x, y: C.volume.y },
};

type RawNode = {
  position: { x: number; y: number };
  parentId?: string;
  extent?: unknown;
  zIndex?: number;
  [k: string]: unknown;
};

function flattenToAbsolute<T extends RawNode>(nodes: T[], zIndex?: number): T[] {
  return nodes.map((n) => {
    const origin = n.parentId ? (CONTAINER_ORIGIN[n.parentId] ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
    // strip parentId + extent — the nesting is encoded purely in the coordinates now.
    const { parentId: _p, extent: _e, ...rest } = n;
    return {
      ...(rest as T),
      position: { x: origin.x + n.position.x, y: origin.y + n.position.y },
      ...(zIndex !== undefined ? { zIndex } : {}),
    };
  });
}

// Containers sit behind the edges (negative zIndex); components keep default 0
// so they paint above the edges.
export const ARCH_CONTAINERS = flattenToAbsolute(ARCH_CONTAINERS_NESTED as RawNode[], -1);
export const ARCH_NODES = flattenToAbsolute(ARCH_NODES_NESTED as RawNode[]);

// ──────────────────────────────────────────────────────────
// EDGE DEFINITIONS
// ──────────────────────────────────────────────────────────
export const ARCH_EDGES = [
  // ── Container-level C4 summary relationships (box → box) ──
  { id: 's-webapp-api', source: 'c-webapp', target: 'c-api', data: { edgeKind: 'summary', label: 'calls /api/*' } satisfies ArchEdgeData },
  { id: 's-api-kernel', source: 'c-api', target: 'c-kernel', data: { edgeKind: 'summary', label: 'bakes via' } satisfies ArchEdgeData },
  { id: 's-kernel-volume', source: 'c-kernel', target: 'c-volume', data: { edgeKind: 'summary', label: 'reads / writes' } satisfies ArchEdgeData },

  // ── Routes → API (fetch) ──
  { id: 'e-prim-data', source: 'r-primitives', target: 'a-prim-data', data: { edgeKind: 'calls' } satisfies ArchEdgeData },
  { id: 'e-prim-bake', source: 'r-primitives', target: 'a-prim-bake', data: { edgeKind: 'calls' } satisfies ArchEdgeData },
  { id: 'e-prim-profiles', source: 'r-primitives', target: 'a-profiles', data: { edgeKind: 'calls' } satisfies ArchEdgeData },
  { id: 'e-prim-rag', source: 'r-primitives', target: 'a-rag', data: { edgeKind: 'calls', label: '✨' } satisfies ArchEdgeData },
  { id: 'e-ge-data', source: 'r-graph-editor', target: 'a-prim-data', data: { edgeKind: 'calls' } satisfies ArchEdgeData },
  { id: 'e-ge-bake', source: 'r-graph-editor', target: 'a-prim-bake', data: { edgeKind: 'calls' } satisfies ArchEdgeData },
  { id: 'e-ge-brep', source: 'r-graph-editor', target: 'a-brep', data: { edgeKind: 'calls', label: 'BREP tab' } satisfies ArchEdgeData },
  { id: 'e-vocab-api', source: 'r-vocab', target: 'a-vocab', data: { edgeKind: 'calls' } satisfies ArchEdgeData },
  { id: 'e-vocab-rag', source: 'r-vocab', target: 'a-rag', data: { edgeKind: 'calls' } satisfies ArchEdgeData },
  { id: 'e-volume-api', source: 'r-volume', target: 'a-volume', data: { edgeKind: 'calls' } satisfies ArchEdgeData },
  { id: 'e-design-manifest', source: 'r-design', target: 'a-manifest', data: { edgeKind: 'calls' } satisfies ArchEdgeData },

  // ── Routes → lib (mounts) ──
  { id: 'e-prim-gep', source: 'r-primitives', target: 'l-gep', data: { edgeKind: 'mounts', label: 'N tabs' } satisfies ArchEdgeData },
  { id: 'e-ge-gep', source: 'r-graph-editor', target: 'l-gep', data: { edgeKind: 'mounts', label: 'full-screen' } satisfies ArchEdgeData },
  { id: 'e-prim-dual', source: 'r-primitives', target: 'l-dualcanvas', data: { edgeKind: 'mounts' } satisfies ArchEdgeData },
  { id: 'e-wells-scene', source: 'r-wells', target: 'l-wellscene', data: { edgeKind: 'mounts' } satisfies ArchEdgeData },
  { id: 'e-vocab-grid', source: 'r-vocab', target: 'l-paramgrid', data: { edgeKind: 'mounts' } satisfies ArchEdgeData },

  // ── GraphEditorPane internal composition (mounts) ──
  { id: 'e-gep-nodecard', source: 'l-gep', target: 'l-nodecard', data: { edgeKind: 'mounts' } satisfies ArchEdgeData },
  { id: 'e-gep-rightpane', source: 'l-gep', target: 'l-rightpane', data: { edgeKind: 'mounts' } satisfies ArchEdgeData },
  { id: 'e-gep-sketch', source: 'l-gep', target: 'l-sketch-ed', data: { edgeKind: 'mounts' } satisfies ArchEdgeData },
  { id: 'e-gep-wire', source: 'l-gep', target: 'l-wire-state', data: { edgeKind: 'mounts' } satisfies ArchEdgeData },
  { id: 'e-gep-expr', source: 'l-gep', target: 'l-expr-menu', data: { edgeKind: 'mounts' } satisfies ArchEdgeData },
  { id: 'e-gep-assist', source: 'l-gep', target: 'l-ge-assist', data: { edgeKind: 'mounts' } satisfies ArchEdgeData },
  { id: 'e-rightpane-dual', source: 'l-rightpane', target: 'l-dualcanvas', data: { edgeKind: 'mounts', label: '3D tab' } satisfies ArchEdgeData },
  { id: 'e-rightpane-ctrl', source: 'l-rightpane', target: 'l-scene-controls', data: { edgeKind: 'mounts' } satisfies ArchEdgeData },
  { id: 'e-dual-threlte', source: 'l-dualcanvas', target: 'l-threlte', data: { edgeKind: 'mounts' } satisfies ArchEdgeData },

  // ── Editor → kernel (graph edits flow into the model) ──
  { id: 'e-gep-cg', source: 'l-gep', target: 'l-comp-graph', data: { edgeKind: 'flow', label: 'edit' } satisfies ArchEdgeData },
  { id: 'e-assist-cg', source: 'l-ge-assist', target: 'l-comp-graph', data: { edgeKind: 'flow', label: '✨ patch' } satisfies ArchEdgeData },
  { id: 'e-layout-cg', source: 'l-comp-layout', target: 'l-comp-graph', data: { edgeKind: 'flow', label: 'layout' } satisfies ArchEdgeData },

  // ── Kernel bake pipeline (graph → source → mesh) ──
  { id: 'e-cg-emit', source: 'l-comp-graph', target: 'l-emit', data: { edgeKind: 'flow', label: 'graph→src' } satisfies ArchEdgeData },
  { id: 'e-exprs-emit', source: 'l-exprs', target: 'l-emit', data: { edgeKind: 'flow', label: 'expr' } satisfies ArchEdgeData },
  { id: 'e-sketch-emit', source: 'l-sketch', target: 'l-emit', data: { edgeKind: 'flow', label: 'profile' } satisfies ArchEdgeData },
  { id: 'e-emit-bake', source: 'l-emit', target: 'l-comp-bake', data: { edgeKind: 'flow', label: 'body' } satisfies ArchEdgeData },
  { id: 'e-bake-sandbox', source: 'l-comp-bake', target: 'l-sandbox', data: { edgeKind: 'flow' } satisfies ArchEdgeData },
  { id: 'e-sandbox-manifold', source: 'l-sandbox', target: 'l-manifold', data: { edgeKind: 'flow', label: 'exec' } satisfies ArchEdgeData },
  { id: 'e-mesh-manifold', source: 'l-manifold-mesh', target: 'l-manifold', data: { edgeKind: 'flow', label: 'weld' } satisfies ArchEdgeData },
  { id: 'e-csg2d-manifold', source: 'l-csg2d', target: 'l-manifold', data: { edgeKind: 'flow' } satisfies ArchEdgeData },
  { id: 'e-stdlib-sandbox', source: 'l-stdlib', target: 'l-sandbox', data: { edgeKind: 'flow', label: 'engines' } satisfies ArchEdgeData },
  { id: 'e-stdstale-sandbox', source: 'l-stdstale', target: 'l-sandbox', data: { edgeKind: 'flow', label: 'legacy' } satisfies ArchEdgeData },
  { id: 'e-loader-sandbox', source: 'l-loader', target: 'l-sandbox', data: { edgeKind: 'flow', label: 'deps' } satisfies ArchEdgeData },

  // ── Manifold output ──
  { id: 'e-manifold-cache', source: 'l-manifold', target: 'l-bake-cache', data: { edgeKind: 'writes', label: 'cache' } satisfies ArchEdgeData },
  { id: 'e-manifold-threlte', source: 'l-manifold', target: 'l-threlte', data: { edgeKind: 'flow', label: 'mesh/GLB' } satisfies ArchEdgeData },
  { id: 'e-client-threlte', source: 'l-bake-client', target: 'l-threlte', data: { edgeKind: 'flow', label: '⚡client' } satisfies ArchEdgeData },

  // ── Geometry-engine matrix: BREP (server OCCT, via a-brep above) · TrueForm (client) ──
  { id: 'e-ge-tf', source: 'r-graph-editor', target: 'l-trueform', data: { edgeKind: 'calls', label: 'TF tab' } satisfies ArchEdgeData },
  { id: 'e-tf-threlte', source: 'l-trueform', target: 'l-threlte', data: { edgeKind: 'flow', label: 'tf mesh' } satisfies ArchEdgeData },
  { id: 'e-coi-tf', source: 'l-coi', target: 'l-trueform', data: { edgeKind: 'flow', label: 'enables SAB' } satisfies ArchEdgeData },

  // ── API → kernel ──
  { id: 'e-apibake-loader', source: 'a-prim-bake', target: 'l-loader', data: { edgeKind: 'calls', label: 'preview' } satisfies ArchEdgeData },
  { id: 'e-apibake-bake', source: 'a-prim-bake', target: 'l-comp-bake', data: { edgeKind: 'calls' } satisfies ArchEdgeData },
  { id: 'e-apibake-cache', source: 'a-prim-bake', target: 'l-bake-cache', data: { edgeKind: 'reads' } satisfies ArchEdgeData },
  { id: 'e-apibake-client', source: 'a-prim-bake', target: 'l-bake-client', data: { edgeKind: 'flow', label: 'compile' } satisfies ArchEdgeData },
  { id: 'e-apiai-bake', source: 'a-prim-ai', target: 'l-comp-bake', data: { edgeKind: 'calls', label: 'verify' } satisfies ArchEdgeData },
  { id: 'e-brep-cg', source: 'a-brep', target: 'l-comp-graph', data: { edgeKind: 'calls', label: 'graph→OCCT' } satisfies ArchEdgeData },
  { id: 'e-rag-corpus', source: 'a-rag', target: 'l-rag-corpus', data: { edgeKind: 'calls' } satisfies ArchEdgeData },
  { id: 'e-rag-rule', source: 'a-rag', target: 'l-rule-translator', data: { edgeKind: 'calls' } satisfies ArchEdgeData },
  { id: 'e-vocab-rule', source: 'a-vocab', target: 'l-rule-translator', data: { edgeKind: 'calls' } satisfies ArchEdgeData },
  { id: 'e-cache-bakecache', source: 'a-cache', target: 'l-bake-cache', data: { edgeKind: 'reads' } satisfies ArchEdgeData },

  // ── API / kernel → store (reads / writes) ──
  { id: 'e-data-vol', source: 'a-prim-data', target: 's-primitives-vol', data: { edgeKind: 'writes', label: 'save/delete' } satisfies ArchEdgeData },
  { id: 'e-data-archive', source: 'a-prim-data', target: 's-archive', data: { edgeKind: 'writes', label: 'trash' } satisfies ArchEdgeData },
  { id: 'e-profiles-store', source: 'a-profiles', target: 's-profiles', data: { edgeKind: 'writes' } satisfies ArchEdgeData },
  { id: 'e-rag-jsonl', source: 'a-rag', target: 's-rag-corpus', data: { edgeKind: 'writes', label: 'rebuild' } satisfies ArchEdgeData },
  { id: 'e-vocab-json', source: 'a-vocab', target: 's-vocab-json', data: { edgeKind: 'reads' } satisfies ArchEdgeData },
  { id: 'e-cache-vol', source: 'l-bake-cache', target: 's-bake-cache-vol', data: { edgeKind: 'writes' } satisfies ArchEdgeData },
  { id: 'e-volapi-root', source: 'a-volume', target: 's-volume-root', data: { edgeKind: 'reads' } satisfies ArchEdgeData },
  { id: 'e-loader-vol', source: 'l-loader', target: 's-primitives-vol', data: { edgeKind: 'reads', label: 'source' } satisfies ArchEdgeData },
  { id: 'e-ragcorpus-jsonl', source: 'l-rag-corpus', target: 's-rag-corpus', data: { edgeKind: 'reads' } satisfies ArchEdgeData },
  { id: 'e-rule-vocabjson', source: 'l-rule-translator', target: 's-vocab-json', data: { edgeKind: 'reads' } satisfies ArchEdgeData },
];

// ──────────────────────────────────────────────────────────
// TREE VIEW MODEL
//
// The collapsible-tree /design surface drives layout from the parent/child
// HIERARCHY (system → 4 containers → their components) rather than the
// hand-placed C4 coordinates above. We re-expose the same node data — minus
// any positions — as a flat list that retains `parentId`, so a layout function
// can walk the tree and compute x/y itself (and reflow on collapse/expand).
//
// treeKind:
//   'system' | 'container'         — the C4 boxes (collapsible parents)
//   'route' | 'api' | 'lib' | 'store' — leaf components
// ──────────────────────────────────────────────────────────
export type ArchTreeKind = 'system' | 'container' | NodeKind;

export interface ArchTreeNode {
  id: string;
  parentId?: string;
  treeKind: ArchTreeKind;
  label: string;
  tech?: string;       // container/system only
  accent?: string;     // container/system only
  href?: string;       // route component → clickable
  blurb?: string;
  planned?: boolean;
  archived?: boolean;
}

export const ARCH_TREE_NODES: ArchTreeNode[] = [
  ...ARCH_CONTAINERS_NESTED.map((n): ArchTreeNode => {
    const d = n.data as ContainerNodeData;
    return {
      id: n.id,
      parentId: (n as { parentId?: string }).parentId,
      treeKind: d.variant,
      label: d.label,
      tech: d.tech,
      accent: d.accent,
      blurb: d.blurb,
    };
  }),
  ...ARCH_NODES_NESTED.map((n): ArchTreeNode => {
    const d = n.data as ArchNodeData;
    return {
      id: n.id,
      parentId: (n as { parentId?: string }).parentId,
      treeKind: d.kind,
      label: d.label,
      href: d.href,
      blurb: d.blurb,
      planned: d.planned,
      archived: d.archived,
    };
  }),
];
