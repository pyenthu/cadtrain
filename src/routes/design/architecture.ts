/**
 * architecture.ts — curated node/edge dataset for the /design interactive graph.
 *
 * Laid out as a **C4 "Container" diagram (level 2)**: one system boundary
 * ("CAD Train") holds four labeled container boxes, and the 29 component nodes
 * live INSIDE those containers via xyflow parent/extent nesting.
 *
 *   sys-cadtrain  (system boundary, variant:'system')
 *     ├─ c-webapp  Web App        — route pages + GraphEditorPane + Threlte viewer
 *     ├─ c-api     API layer      — /api/* endpoint groups
 *     ├─ c-kernel  CAD kernel     — composition graph/emit, Manifold WASM, engines, translator
 *     └─ c-volume  Volume store   — persistent parts / vocabulary / caches
 *
 * Component node kinds:
 *   route  — a SvelteKit page route (clickable → navigates)
 *   api    — an HTTP endpoint group
 *   lib    — an engine / pipeline stage
 *   store  — a persistent data sink
 *
 * Edge types:
 *   calls   — route → api (fetch / mutation)
 *   mounts  — route → lib (mounts a shared component)
 *   flow    — pipeline data flow (animated, bake pipeline)
 *   reads   — api → store (read)
 *   writes  — api → store (write)
 *   nav     — user navigation between routes
 *   summary — container → container relationship (C4-level arrow)
 *
 * xyflow nesting rules honoured here:
 *   - parents appear BEFORE their children in ARCH_NODES (system → containers → components)
 *   - child `position` is RELATIVE to its parent container's top-left
 *   - children carry `parentId` + `extent:'parent'`
 *   - container/system nodes carry explicit width/height (style string)
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
const SYS = { x: 0, y: 0, w: 1400, h: 740 };

// container boxes laid left→right inside the system boundary
const C = {
  webapp: { x: 24, y: 60, w: 470, h: 600 },
  api: { x: 534, y: 60, w: 252, h: 660 },
  kernel: { x: 826, y: 60, w: 252, h: 560 },
  volume: { x: 1118, y: 60, w: 252, h: 470 },
};

// within-container layout constants (relative to each container's top-left)
const PAD_X = 16;        // left inset for a single column
const COL_A = 16;        // web-app column A x
const COL_B = 240;       // web-app column B x
const HEAD = 48;         // top inset (clears the title chip)
const PITCH = 84;        // vertical gap between component nodes

// ──────────────────────────────────────────────────────────
// CONTAINER + SYSTEM NODES  (must come BEFORE their children)
//
// Authored with parent/extent nesting for readability, but FLATTENED to
// absolute coordinates at export time (see bottom of file).  @xyflow/svelte
// 1.x drops every edge whose endpoint is a nested child whose parent isn't
// measured at edge-build time (which happens when this graph renders below the
// fold) — getEdgePosition() returns null → zero `.svelte-flow__edge-path`
// elements.  Flattening keeps the C4 container BOXES as plain background nodes
// while letting edges resolve exactly like the old flat (working) version.
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
      blurb: 'Client-only SPA (SSR off). Route pages + the GraphEditorPane editor + the Threlte 3D viewer.',
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
      blurb: 'SvelteKit server endpoints (SSR). Proxy to the volume + run server-side bakes.',
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
      blurb: 'Graph → source → mesh. Composition graph/emit, the Manifold CSG kernel, engine primitives, the vocabulary translator.',
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
      blurb: 'One persistent volume — parts, RAG corpus, vocabulary, and the bake cache. Survives redeploys.',
    } satisfies ContainerNodeData,
  },
];

// ──────────────────────────────────────────────────────────
// COMPONENT NODES  (positions are RELATIVE to their parent container)
// ──────────────────────────────────────────────────────────
const ARCH_NODES_NESTED = [
  // ───────────────── Web App container (routes + GEP + viewer) ─────────────────
  // Column A
  {
    id: 'r-primitives',
    type: 'archNode',
    parentId: 'c-webapp',
    extent: 'parent',
    position: { x: COL_A, y: HEAD },
    data: {
      kind: 'route',
      label: '/primitives',
      href: '/primitives',
      blurb: 'Sidebar of volume parts + multi-tab graph editor (N × GraphEditorPane).',
    } satisfies ArchNodeData,
  },
  {
    id: 'r-graph-editor',
    type: 'archNode',
    parentId: 'c-webapp',
    extent: 'parent',
    position: { x: COL_A, y: HEAD + PITCH },
    data: {
      kind: 'route',
      label: '/graph-editor',
      href: '/graph-editor',
      blurb: 'The CAD editor — single primitive, full-screen. Mounts GraphEditorPane with ?id=&embed=1.',
    } satisfies ArchNodeData,
  },
  {
    id: 'r-vocab',
    type: 'archNode',
    parentId: 'c-webapp',
    extent: 'parent',
    position: { x: COL_A, y: HEAD + PITCH * 2 },
    data: {
      kind: 'route',
      label: '/vocab',
      href: '/vocab',
      blurb: 'Vocabulary editor — browse, infer, bake, promote vocabulary entries.',
    } satisfies ArchNodeData,
  },
  {
    id: 'r-fem',
    type: 'archNode',
    parentId: 'c-webapp',
    extent: 'parent',
    position: { x: COL_A, y: HEAD + PITCH * 3 },
    data: {
      kind: 'route',
      label: '/fem',
      href: '/fem',
      blurb: 'FEM index + /fem/[id] stress viewer + /fem/[id]/tension 3D viewer. Oilfield units.',
    } satisfies ArchNodeData,
  },
  {
    id: 'r-wells',
    type: 'archNode',
    parentId: 'c-webapp',
    extent: 'parent',
    position: { x: COL_A, y: HEAD + PITCH * 4 },
    data: {
      kind: 'route',
      label: '/wells',
      href: '/wells',
      blurb: 'WIP: 3D-first well schematic — WSON → 3D well diagram. Plan: docs/plans/well-schematic.md.',
    } satisfies ArchNodeData,
  },
  {
    id: 'r-forge',
    type: 'archNode',
    parentId: 'c-webapp',
    extent: 'parent',
    position: { x: COL_A, y: HEAD + PITCH * 5 },
    data: {
      kind: 'route',
      label: '/forge',
      href: '/forge',
      blurb: 'Image → 3D scaffold via FAL Hunyuan3D v2. Requires FAL_API_KEY.',
    } satisfies ArchNodeData,
  },
  // Column B
  {
    id: 'r-volume',
    type: 'archNode',
    parentId: 'c-webapp',
    extent: 'parent',
    position: { x: COL_B, y: HEAD },
    data: {
      kind: 'route',
      label: '/volume',
      href: '/volume',
      blurb: 'Volume file manager — browse + manage the persistent data volume.',
    } satisfies ArchNodeData,
  },
  {
    id: 'r-plan',
    type: 'archNode',
    parentId: 'c-webapp',
    extent: 'parent',
    position: { x: COL_B, y: HEAD + PITCH },
    data: {
      kind: 'route',
      label: '/plan',
      href: '/plan',
      blurb: 'Gantt roadmap — the single source of truth for project scope.',
    } satisfies ArchNodeData,
  },
  {
    id: 'r-design',
    type: 'archNode',
    parentId: 'c-webapp',
    extent: 'parent',
    position: { x: COL_B, y: HEAD + PITCH * 2 },
    data: {
      kind: 'route',
      label: '/design',
      href: '/design',
      blurb: 'This page — interactive architecture graph of the project.',
    } satisfies ArchNodeData,
  },
  {
    id: 'l-gep',
    type: 'archNode',
    parentId: 'c-webapp',
    extent: 'parent',
    position: { x: COL_B, y: HEAD + PITCH * 3 },
    data: {
      kind: 'lib',
      label: 'GraphEditorPane',
      blurb: 'The CAD editor component. Wires nodes, sockets, params. Mounts in /graph-editor (full-screen) and /primitives (multi-tab).',
    } satisfies ArchNodeData,
  },
  {
    id: 'l-threlte',
    type: 'archNode',
    parentId: 'c-webapp',
    extent: 'parent',
    position: { x: COL_B, y: HEAD + PITCH * 4 },
    data: {
      kind: 'lib',
      label: 'Threlte viewer',
      blurb: 'Declarative Three.js for Svelte. Mesh / GLB / SVG rendering, cutaway, per-part colour, Z-down convention.',
    } satisfies ArchNodeData,
  },

  // ───────────────── API layer container ─────────────────
  {
    id: 'a-primitives',
    type: 'archNode',
    parentId: 'c-api',
    extent: 'parent',
    position: { x: PAD_X, y: HEAD },
    data: {
      kind: 'api',
      label: '/api/primitives/*',
      blurb: 'list · save · source · delete · restore · move · rename · recognize · refine · preview · bake-preview · compile · prompts · instructions · profiles/*',
    } satisfies ArchNodeData,
  },
  {
    id: 'a-rag',
    type: 'archNode',
    parentId: 'c-api',
    extent: 'parent',
    position: { x: PAD_X, y: HEAD + PITCH },
    data: {
      kind: 'api',
      label: '/api/rag/*',
      blurb: 'rebuild · stats · scan-refs · prompt — BM25 retrieval + Claude → composition graph for generative authoring.',
    } satisfies ArchNodeData,
  },
  {
    id: 'a-vocab',
    type: 'archNode',
    parentId: 'c-api',
    extent: 'parent',
    position: { x: PAD_X, y: HEAD + PITCH * 2 },
    data: {
      kind: 'api',
      label: '/api/vocab/*',
      blurb: 'regenerate · infer · bake-proposed · promote · promote-proposed — vocabulary lifecycle endpoints.',
    } satisfies ArchNodeData,
  },
  {
    id: 'a-cache',
    type: 'archNode',
    parentId: 'c-api',
    extent: 'parent',
    position: { x: PAD_X, y: HEAD + PITCH * 3 },
    data: {
      kind: 'api',
      label: '/api/cache/*',
      blurb: 'stats (Railway health check) · bake-stats · clear — bake cache management.',
    } satisfies ArchNodeData,
  },
  {
    id: 'a-volume',
    type: 'archNode',
    parentId: 'c-api',
    extent: 'parent',
    position: { x: PAD_X, y: HEAD + PITCH * 4 },
    data: {
      kind: 'api',
      label: '/api/volume',
      blurb: 'Generic CRUD against the persistent volume. Auth via X-Volume-Token. Sub: backup, onedrive.',
    } satisfies ArchNodeData,
  },
  {
    id: 'a-forge',
    type: 'archNode',
    parentId: 'c-api',
    extent: 'parent',
    position: { x: PAD_X, y: HEAD + PITCH * 5 },
    data: {
      kind: 'api',
      label: '/api/forge/*',
      blurb: 'generate — Image → 3D via FAL Hunyuan3D v2. Needs FAL_API_KEY.',
    } satisfies ArchNodeData,
  },
  {
    id: 'a-manifest',
    type: 'archNode',
    parentId: 'c-api',
    extent: 'parent',
    position: { x: PAD_X, y: HEAD + PITCH * 6 },
    data: {
      kind: 'api',
      label: '/api/manifest',
      blurb: 'Machine-readable capability manifest — load-bearing operations, workflow links, LLM-friendly description.',
    } satisfies ArchNodeData,
  },

  // ───────────────── CAD kernel container ─────────────────
  {
    id: 'l-comp-graph',
    type: 'archNode',
    parentId: 'c-kernel',
    extent: 'parent',
    position: { x: PAD_X, y: HEAD },
    data: {
      kind: 'lib',
      label: 'composition-graph',
      blurb: 'Node types: Call · Container · Method · Mv · Rot · Repeat · Polygon · PolyRepeat. ArgValue = literal | expr | param.',
    } satisfies ArchNodeData,
  },
  {
    id: 'l-emit',
    type: 'archNode',
    parentId: 'c-kernel',
    extent: 'parent',
    position: { x: PAD_X, y: HEAD + PITCH },
    data: {
      kind: 'lib',
      label: 'composition-emit',
      blurb: 'Graph → source body (TypeScript). Parts carry meta.graph + emitted body text.',
    } satisfies ArchNodeData,
  },
  {
    id: 'l-manifold',
    type: 'archNode',
    parentId: 'c-kernel',
    extent: 'parent',
    position: { x: PAD_X, y: HEAD + PITCH * 2 },
    data: {
      kind: 'lib',
      label: 'Manifold WASM',
      blurb: 'WASM CSG kernel. Bakes the emitted source into a triangle mesh. Server-side (preview/bake-preview) or client-side (bake-worker.ts).',
    } satisfies ArchNodeData,
  },
  {
    id: 'l-bake-cache',
    type: 'archNode',
    parentId: 'c-kernel',
    extent: 'parent',
    position: { x: PAD_X, y: HEAD + PITCH * 3 },
    data: {
      kind: 'lib',
      label: 'bake-cache',
      blurb: 'Server-side bake cache keyed by part + param hash. Survives redeploys on the persistent volume.',
    } satisfies ArchNodeData,
  },
  {
    id: 'l-stdlib',
    type: 'archNode',
    parentId: 'c-kernel',
    extent: 'parent',
    position: { x: PAD_X, y: HEAD + PITCH * 4 },
    data: {
      kind: 'lib',
      label: 'stdlib / stdstale',
      blurb: 'Engine primitives canonical in src/: stdlib/ (active: r_cuboid, r_loft, r_weld_extrude) + stdstale/ (deprecated, still resolvable).',
    } satisfies ArchNodeData,
  },
  {
    id: 'l-rule-translator',
    type: 'archNode',
    parentId: 'c-kernel',
    extent: 'parent',
    position: { x: PAD_X, y: HEAD + PITCH * 5 },
    data: {
      kind: 'lib',
      label: 'rule-translator',
      blurb: 'Deterministic vocabulary → composition graph translator. BM25 retrieval → synonym match → extends → compose → hand-author.',
    } satisfies ArchNodeData,
  },

  // ───────────────── Volume store container ─────────────────
  {
    id: 's-primitives-vol',
    type: 'archNode',
    parentId: 'c-volume',
    extent: 'parent',
    position: { x: PAD_X, y: HEAD },
    data: {
      kind: 'store',
      label: 'primitives/ (volume)',
      blurb: 'Flat typed source files: <id>.prim.ts · .asm.ts · profiles .prvl.ts/.prex.ts. Categories: basic/ · completions/ · archive/.',
    } satisfies ArchNodeData,
  },
  {
    id: 's-rag-corpus',
    type: 'archNode',
    parentId: 'c-volume',
    extent: 'parent',
    position: { x: PAD_X, y: HEAD + PITCH },
    data: {
      kind: 'store',
      label: 'ai/rag/parts.jsonl',
      blurb: 'RAG corpus — BM25 index of all parts for generative authoring retrieval.',
    } satisfies ArchNodeData,
  },
  {
    id: 's-vocab-json',
    type: 'archNode',
    parentId: 'c-volume',
    extent: 'parent',
    position: { x: PAD_X, y: HEAD + PITCH * 2 },
    data: {
      kind: 'store',
      label: 'vocabulary.json',
      blurb: 'Curated vocabulary: docs/parts/vocabulary.json. Single source of truth for part kinds, params, rules.',
    } satisfies ArchNodeData,
  },
  {
    id: 's-bake-cache-vol',
    type: 'archNode',
    parentId: 'c-volume',
    extent: 'parent',
    position: { x: PAD_X, y: HEAD + PITCH * 3 },
    data: {
      kind: 'store',
      label: 'cache/ (volume)',
      blurb: 'Persistent bake cache — mesh/GLB results keyed by part + param hash. Survives redeploys.',
    } satisfies ArchNodeData,
  },
  {
    id: 's-volume-root',
    type: 'archNode',
    parentId: 'c-volume',
    extent: 'parent',
    position: { x: PAD_X, y: HEAD + PITCH * 4 },
    data: {
      kind: 'store',
      label: '$APP_DATA_DIR',
      blurb: 'Volume root: CADTRAIN_VOLUME_ROOT → RAILWAY_VOLUME_MOUNT_PATH → /app_data → ./.dev-volume. All persistent state lives here.',
    } satisfies ArchNodeData,
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
// resolve like the flat version did.
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

  // ── Fine-grained component edges ──
  // Routes → API calls
  { id: 'e-prim-api', source: 'r-primitives', target: 'a-primitives', data: { edgeKind: 'calls' } satisfies ArchEdgeData },
  { id: 'e-prim-rag', source: 'r-primitives', target: 'a-rag', data: { edgeKind: 'calls' } satisfies ArchEdgeData },
  { id: 'e-ge-api', source: 'r-graph-editor', target: 'a-primitives', data: { edgeKind: 'calls' } satisfies ArchEdgeData },
  { id: 'e-vocab-api', source: 'r-vocab', target: 'a-vocab', data: { edgeKind: 'calls' } satisfies ArchEdgeData },
  { id: 'e-vocab-rag', source: 'r-vocab', target: 'a-rag', data: { edgeKind: 'calls' } satisfies ArchEdgeData },
  { id: 'e-volume-api', source: 'r-volume', target: 'a-volume', data: { edgeKind: 'calls' } satisfies ArchEdgeData },
  { id: 'e-forge-api', source: 'r-forge', target: 'a-forge', data: { edgeKind: 'calls' } satisfies ArchEdgeData },
  { id: 'e-design-manifest', source: 'r-design', target: 'a-manifest', data: { edgeKind: 'calls' } satisfies ArchEdgeData },

  // Routes → lib (mounts)
  { id: 'e-prim-gep', source: 'r-primitives', target: 'l-gep', data: { edgeKind: 'mounts', label: 'N tabs' } satisfies ArchEdgeData },
  { id: 'e-ge-gep', source: 'r-graph-editor', target: 'l-gep', data: { edgeKind: 'mounts', label: 'full-screen' } satisfies ArchEdgeData },
  { id: 'e-prim-threlte', source: 'r-primitives', target: 'l-threlte', data: { edgeKind: 'mounts' } satisfies ArchEdgeData },

  // Bake pipeline flow
  { id: 'e-gep-cg', source: 'l-gep', target: 'l-comp-graph', data: { edgeKind: 'flow', label: 'edit' } satisfies ArchEdgeData },
  { id: 'e-cg-emit', source: 'l-comp-graph', target: 'l-emit', data: { edgeKind: 'flow', label: 'graph→source' } satisfies ArchEdgeData },
  { id: 'e-emit-manifold', source: 'l-emit', target: 'l-manifold', data: { edgeKind: 'flow', label: 'bake' } satisfies ArchEdgeData },
  { id: 'e-manifold-cache', source: 'l-manifold', target: 'l-bake-cache', data: { edgeKind: 'writes', label: 'cache' } satisfies ArchEdgeData },
  { id: 'e-manifold-threlte', source: 'l-manifold', target: 'l-threlte', data: { edgeKind: 'flow', label: 'mesh/GLB' } satisfies ArchEdgeData },
  { id: 'e-stdlib-manifold', source: 'l-stdlib', target: 'l-manifold', data: { edgeKind: 'flow', label: 'engines' } satisfies ArchEdgeData },

  // API → lib
  { id: 'e-api-prim-manifold', source: 'a-primitives', target: 'l-manifold', data: { edgeKind: 'calls', label: 'preview/bake' } satisfies ArchEdgeData },
  { id: 'e-api-rag-rule', source: 'a-rag', target: 'l-rule-translator', data: { edgeKind: 'calls' } satisfies ArchEdgeData },
  { id: 'e-vocab-rule', source: 'a-vocab', target: 'l-rule-translator', data: { edgeKind: 'calls' } satisfies ArchEdgeData },
  { id: 'e-api-cache', source: 'a-primitives', target: 'l-bake-cache', data: { edgeKind: 'reads' } satisfies ArchEdgeData },

  // API / lib → store (reads/writes)
  { id: 'e-api-prim-vol', source: 'a-primitives', target: 's-primitives-vol', data: { edgeKind: 'writes', label: 'save/delete' } satisfies ArchEdgeData },
  { id: 'e-api-rag-corpus', source: 'a-rag', target: 's-rag-corpus', data: { edgeKind: 'writes', label: 'rebuild' } satisfies ArchEdgeData },
  { id: 'e-vocab-json', source: 'a-vocab', target: 's-vocab-json', data: { edgeKind: 'reads' } satisfies ArchEdgeData },
  { id: 'e-cache-vol', source: 'l-bake-cache', target: 's-bake-cache-vol', data: { edgeKind: 'writes' } satisfies ArchEdgeData },
  { id: 'e-vol-root', source: 'a-volume', target: 's-volume-root', data: { edgeKind: 'reads' } satisfies ArchEdgeData },
];
