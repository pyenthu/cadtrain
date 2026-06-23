/**
 * architecture.ts — curated node/edge dataset for the /design interactive graph.
 *
 * Node kinds:
 *   route  — a SvelteKit page route (clickable → navigates)
 *   api    — an HTTP endpoint group (shows in graph)
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
 */

export type NodeKind = 'route' | 'api' | 'lib' | 'store';
export type EdgeKind = 'calls' | 'mounts' | 'flow' | 'reads' | 'writes' | 'nav';

export interface ArchNodeData {
  label: string;
  kind: NodeKind;
  href?: string;      // route / api — click target
  blurb?: string;     // tooltip / legend text
  planned?: boolean;  // grayed-out / dashed border
  archived?: boolean; // archived/deprecated node
}

export interface ArchEdgeData {
  edgeKind: EdgeKind;
  label?: string;
}

// ─────────────────────────────────────────────
// COLUMN X POSITIONS (hand-tuned left-to-right)
//   0: Routes
// 280: API groups
// 580: lib / pipeline
// 860: store
// ─────────────────────────────────────────────
const COL = { route: 0, api: 290, lib: 590, store: 880 };

// ──────────────────────────────────────────────────────────
// NODE DEFINITIONS
// ──────────────────────────────────────────────────────────
export const ARCH_NODES = [
  // ── ROUTES ──
  {
    id: 'r-primitives',
    type: 'archNode',
    position: { x: COL.route, y: 0 },
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
    position: { x: COL.route, y: 80 },
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
    position: { x: COL.route, y: 160 },
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
    position: { x: COL.route, y: 240 },
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
    position: { x: COL.route, y: 320 },
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
    position: { x: COL.route, y: 400 },
    data: {
      kind: 'route',
      label: '/forge',
      href: '/forge',
      blurb: 'Image → 3D scaffold via FAL Hunyuan3D v2. Requires FAL_API_KEY.',
    } satisfies ArchNodeData,
  },
  {
    id: 'r-volume',
    type: 'archNode',
    position: { x: COL.route, y: 480 },
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
    position: { x: COL.route, y: 560 },
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
    position: { x: COL.route, y: 640 },
    data: {
      kind: 'route',
      label: '/design',
      href: '/design',
      blurb: 'This page — interactive architecture graph of the project.',
    } satisfies ArchNodeData,
  },

  // ── API GROUPS ──
  {
    id: 'a-primitives',
    type: 'archNode',
    position: { x: COL.api, y: 0 },
    data: {
      kind: 'api',
      label: '/api/primitives/*',
      blurb: 'list · save · source · delete · restore · move · rename · recognize · refine · preview · bake-preview · compile · prompts · instructions · profiles/*',
    } satisfies ArchNodeData,
  },
  {
    id: 'a-rag',
    type: 'archNode',
    position: { x: COL.api, y: 160 },
    data: {
      kind: 'api',
      label: '/api/rag/*',
      blurb: 'rebuild · stats · scan-refs · prompt — BM25 retrieval + Claude → composition graph for generative authoring.',
    } satisfies ArchNodeData,
  },
  {
    id: 'a-vocab',
    type: 'archNode',
    position: { x: COL.api, y: 240 },
    data: {
      kind: 'api',
      label: '/api/vocab/*',
      blurb: 'regenerate · infer · bake-proposed · promote · promote-proposed — vocabulary lifecycle endpoints.',
    } satisfies ArchNodeData,
  },
  {
    id: 'a-cache',
    type: 'archNode',
    position: { x: COL.api, y: 320 },
    data: {
      kind: 'api',
      label: '/api/cache/*',
      blurb: 'stats (Railway health check) · bake-stats · clear — bake cache management.',
    } satisfies ArchNodeData,
  },
  {
    id: 'a-volume',
    type: 'archNode',
    position: { x: COL.api, y: 400 },
    data: {
      kind: 'api',
      label: '/api/volume',
      blurb: 'Generic CRUD against the persistent volume. Auth via X-Volume-Token. Sub: backup, onedrive.',
    } satisfies ArchNodeData,
  },
  {
    id: 'a-forge',
    type: 'archNode',
    position: { x: COL.api, y: 480 },
    data: {
      kind: 'api',
      label: '/api/forge/*',
      blurb: 'generate — Image → 3D via FAL Hunyuan3D v2. Needs FAL_API_KEY.',
    } satisfies ArchNodeData,
  },
  {
    id: 'a-manifest',
    type: 'archNode',
    position: { x: COL.api, y: 560 },
    data: {
      kind: 'api',
      label: '/api/manifest',
      blurb: 'Machine-readable capability manifest — load-bearing operations, workflow links, LLM-friendly description.',
    } satisfies ArchNodeData,
  },

  // ── LIB / PIPELINE STAGES ──
  {
    id: 'l-gep',
    type: 'archNode',
    position: { x: COL.lib, y: 0 },
    data: {
      kind: 'lib',
      label: 'GraphEditorPane',
      blurb: 'The CAD editor component. Wires nodes, sockets, params. Mounts in /graph-editor (full-screen) and /primitives (multi-tab).',
    } satisfies ArchNodeData,
  },
  {
    id: 'l-comp-graph',
    type: 'archNode',
    position: { x: COL.lib, y: 100 },
    data: {
      kind: 'lib',
      label: 'composition-graph',
      blurb: 'Node types: Call · Container · Method · Mv · Rot · Repeat · Polygon · PolyRepeat. ArgValue = literal | expr | param.',
    } satisfies ArchNodeData,
  },
  {
    id: 'l-emit',
    type: 'archNode',
    position: { x: COL.lib, y: 200 },
    data: {
      kind: 'lib',
      label: 'composition-emit',
      blurb: 'Graph → source body (TypeScript). Parts carry meta.graph + emitted body text.',
    } satisfies ArchNodeData,
  },
  {
    id: 'l-manifold',
    type: 'archNode',
    position: { x: COL.lib, y: 300 },
    data: {
      kind: 'lib',
      label: 'Manifold WASM',
      blurb: 'WASM CSG kernel. Bakes the emitted source into a triangle mesh. Server-side (preview/bake-preview) or client-side (bake-worker.ts).',
    } satisfies ArchNodeData,
  },
  {
    id: 'l-bake-cache',
    type: 'archNode',
    position: { x: COL.lib, y: 400 },
    data: {
      kind: 'lib',
      label: 'bake-cache',
      blurb: 'Server-side bake cache keyed by part + param hash. Survives redeploys on the persistent volume.',
    } satisfies ArchNodeData,
  },
  {
    id: 'l-threlte',
    type: 'archNode',
    position: { x: COL.lib, y: 500 },
    data: {
      kind: 'lib',
      label: 'Threlte viewer',
      blurb: 'Declarative Three.js for Svelte. Mesh / GLB / SVG rendering, cutaway, per-part colour, Z-down convention.',
    } satisfies ArchNodeData,
  },
  {
    id: 'l-stdlib',
    type: 'archNode',
    position: { x: COL.lib, y: 600 },
    data: {
      kind: 'lib',
      label: 'stdlib / stdstale',
      blurb: 'Engine primitives canonical in src/: stdlib/ (active: r_cuboid, r_loft, r_weld_extrude) + stdstale/ (deprecated, still resolvable).',
    } satisfies ArchNodeData,
  },
  {
    id: 'l-rule-translator',
    type: 'archNode',
    position: { x: COL.lib, y: 700 },
    data: {
      kind: 'lib',
      label: 'rule-translator',
      blurb: 'Deterministic vocabulary → composition graph translator. BM25 retrieval → synonym match → extends → compose → hand-author.',
    } satisfies ArchNodeData,
  },

  // ── STORES ──
  {
    id: 's-primitives-vol',
    type: 'archNode',
    position: { x: COL.store, y: 0 },
    data: {
      kind: 'store',
      label: 'primitives/ (volume)',
      blurb: 'Flat typed source files: <id>.prim.ts · .asm.ts · profiles .prvl.ts/.prex.ts. Categories: basic/ · completions/ · archive/.',
    } satisfies ArchNodeData,
  },
  {
    id: 's-rag-corpus',
    type: 'archNode',
    position: { x: COL.store, y: 100 },
    data: {
      kind: 'store',
      label: 'ai/rag/parts.jsonl',
      blurb: 'RAG corpus — BM25 index of all parts for generative authoring retrieval.',
    } satisfies ArchNodeData,
  },
  {
    id: 's-vocab-json',
    type: 'archNode',
    position: { x: COL.store, y: 200 },
    data: {
      kind: 'store',
      label: 'vocabulary.json',
      blurb: 'Curated vocabulary: docs/parts/vocabulary.json. Single source of truth for part kinds, params, rules.',
    } satisfies ArchNodeData,
  },
  {
    id: 's-bake-cache-vol',
    type: 'archNode',
    position: { x: COL.store, y: 300 },
    data: {
      kind: 'store',
      label: 'cache/ (volume)',
      blurb: 'Persistent bake cache — mesh/GLB results keyed by part + param hash. Survives redeploys.',
    } satisfies ArchNodeData,
  },
  {
    id: 's-volume-root',
    type: 'archNode',
    position: { x: COL.store, y: 400 },
    data: {
      kind: 'store',
      label: '$APP_DATA_DIR',
      blurb: 'Volume root: CADTRAIN_VOLUME_ROOT → RAILWAY_VOLUME_MOUNT_PATH → /app_data → ./.dev-volume. All persistent state lives here.',
    } satisfies ArchNodeData,
  },
];

// ──────────────────────────────────────────────────────────
// EDGE DEFINITIONS
// ──────────────────────────────────────────────────────────
export const ARCH_EDGES = [
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

  // API → store (reads/writes)
  { id: 'e-api-prim-vol', source: 'a-primitives', target: 's-primitives-vol', data: { edgeKind: 'writes', label: 'save/delete' } satisfies ArchEdgeData },
  { id: 'e-api-rag-corpus', source: 'a-rag', target: 's-rag-corpus', data: { edgeKind: 'writes', label: 'rebuild' } satisfies ArchEdgeData },
  { id: 'e-vocab-json', source: 'a-vocab', target: 's-vocab-json', data: { edgeKind: 'reads' } satisfies ArchEdgeData },
  { id: 'e-cache-vol', source: 'l-bake-cache', target: 's-bake-cache-vol', data: { edgeKind: 'writes' } satisfies ArchEdgeData },
  { id: 'e-vol-root', source: 'a-volume', target: 's-volume-root', data: { edgeKind: 'reads' } satisfies ArchEdgeData },
];
