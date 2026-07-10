/**
 * gen-api-docs.mjs — regenerate the /design "API docs" snapshot data module
 * from the graphify knowledge graph, so the docs never drift from the code:
 *
 *   bun scripts/gen-api-docs.mjs                 # reads graphify-out/graph.json
 *   GRAPHIFY_GRAPH=/abs/path/graph.json bun scripts/gen-api-docs.mjs
 *   bun scripts/gen-api-docs.mjs /abs/path/graph.json
 *
 * Emits ONE file:
 *   src/routes/design/api-docs.ts — `export const apiDocs = { exports, endpoints,
 *   modules } as const`, where:
 *     • endpoints — every `+server.ts` route under src/routes/api/ (route path,
 *       file, HTTP methods, graphify community). Routes/list come from the graph
 *       nodes; the HTTP methods are read from the endpoint source (an exported
 *       GET/POST/… handler), falling back to graphify `contains` edges when the
 *       source is not on disk.
 *     • exports — the public declaration surface across src/lib (every top-level
 *       symbol graphify extracted, minus test files + control-flow noise), tagged
 *       with its file and top-level lib module.
 *     • modules — one per code sub-package of src/lib (file/export counts + a
 *       curated one-line responsibility summary).
 *
 * Modeled on scripts/gen-design-diagrams.mjs. Pure snapshot generator: it only
 * reads the graph (+ endpoint sources) and writes the one data module — it never
 * touches the volume or any API. Regenerate with: bun scripts/gen-api-docs.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// ── input / output ──────────────────────────────────────────────────────────
const GRAPH_PATH =
  process.env.GRAPHIFY_GRAPH ||
  process.argv[2] ||
  join(process.cwd(), 'graphify-out', 'graph.json');

if (!existsSync(GRAPH_PATH)) {
  console.error(`✗ graph not found: ${GRAPH_PATH}`);
  console.error('  Pass a path, set GRAPHIFY_GRAPH, or run graphify to produce graphify-out/graph.json.');
  process.exit(1);
}

const OUT = join('src', 'routes', 'design', 'api-docs.ts');

// ── helpers ──────────────────────────────────────────────────────────────────
const basename = (p) => (p || '').split('/').pop();
/** A "file" node's label is just the basename; a "symbol" node's label is a name. */
const isFileNode = (n) => n.label === basename(n.source_file);
const isTestFile = (sf) => /\.(test|spec)\.[tj]s$/.test(sf || '');
/** The immediate sub-package of src/lib for a path, or '(root)' for src/lib/*.ts. */
const libModuleOf = (sf) => {
  const m = (sf || '').match(/^src\/lib\/([^/]+)\//);
  return m ? m[1] : '(root)';
};

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const HTTP_SET = new Set(HTTP_METHODS);
const methodRank = (m) => {
  const i = HTTP_METHODS.indexOf(m);
  return i === -1 ? 99 : i;
};

// Control-flow pseudo-symbols graphify sometimes emits as call sites — not exports.
const CONTROL_FLOW = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'else', 'try', 'do', 'return',
  'typeof', 'await', 'throw', 'case', 'default', 'break', 'continue', 'yield',
]);
const isControlFlow = (label) => CONTROL_FLOW.has((label || '').replace(/\(\)$/, ''));

// Curated one-line responsibilities per src/lib sub-package (drift-tolerant:
// a discovered module absent here gets a generic structural summary + a WARN).
const MODULE_SUMMARY = {
  cad: 'Composition graph + geometry: node model, emit/layout/bake, Manifold + welded-mesh helpers, and the stdlib engine primitives (r_cuboid, r_loft, r_weld_extrude, r_revolve).',
  wells: 'WSON → 3D well-schematic engine: parse/lint, trajectory + DTX survey, per-element parts, and Manifold/TrueForm assembly + cutaway.',
  server: 'Volume + persistence layer: root resolution (volume.ts), primitive path resolution + loader/baker, stdlib registry, and the bake cache.',
  shared: 'Cross-domain UI: GraphEditorPane (the CAD editor) and its graph-editor module cluster, canvases, PrimitiveView, FloatingPanel, and shared widgets.',
  authoring: 'Vocabulary → source translators: the deterministic rule-translator turning vocabulary records into part source.',
  '(root)': 'Top-level lib utilities (e.g. rate limiting) not owned by a sub-package.',
};

// ── load ─────────────────────────────────────────────────────────────────────
const g = JSON.parse(readFileSync(GRAPH_PATH, 'utf8'));
const nodes = g.nodes || [];
const links = g.links || [];
const byId = new Map(nodes.map((n) => [n.id, n]));

// file id → contained symbol nodes (graphify "contains" edges)
const containedSyms = new Map();
for (const l of links) {
  if (l.relation !== 'contains') continue;
  const arr = containedSyms.get(l.source) || containedSyms.set(l.source, []).get(l.source);
  const t = byId.get(l.target);
  if (t) arr.push(t);
}

// ── 1. endpoints ─────────────────────────────────────────────────────────────
const SERVER_RE = /^src\/routes\/api\/.*\/\+server\.ts$/;
const EXPORT_HANDLER_RE = /export\s+(?:async\s+)?(?:const|let|function)\s+([A-Z]+)\b/g;

function methodsFor(node) {
  // Prefer reading the endpoint source (catches `export const GET` which
  // graphify does not surface as a symbol); fall back to `contains` edges.
  const found = new Set();
  try {
    const src = readFileSync(join(process.cwd(), node.source_file), 'utf8');
    let m;
    while ((m = EXPORT_HANDLER_RE.exec(src))) if (HTTP_SET.has(m[1])) found.add(m[1]);
  } catch {
    /* source not on disk — use the graph instead */
  }
  if (!found.size) {
    for (const s of containedSyms.get(node.id) || []) {
      const name = s.label.replace(/\(\)$/, '');
      if (HTTP_SET.has(name)) found.add(name);
    }
  }
  return [...found].sort((a, b) => methodRank(a) - methodRank(b));
}

const endpoints = nodes
  .filter((n) => isFileNode(n) && SERVER_RE.test(n.source_file || ''))
  .map((n) => ({
    route: (n.source_file.replace(/^src\/routes/, '').replace(/\/\+server\.ts$/, '')) || '/',
    file: n.source_file,
    methods: methodsFor(n),
    community: n.community ?? null,
  }))
  .sort((a, b) => a.route.localeCompare(b.route));

// ── 2. exports (public declaration surface across src/lib) ───────────────────
const seenExport = new Set();
const exportsList = nodes
  .filter(
    (n) =>
      !isFileNode(n) &&
      (n.source_file || '').startsWith('src/lib/') &&
      !isTestFile(n.source_file) &&
      !isControlFlow(n.label),
  )
  .map((n) => ({ name: n.label, file: n.source_file, module: libModuleOf(n.source_file) }))
  .filter((e) => {
    const k = `${e.file}::${e.name}`;
    if (seenExport.has(k)) return false;
    seenExport.add(k);
    return true;
  })
  .sort((a, b) => a.module.localeCompare(b.module) || a.file.localeCompare(b.file) || a.name.localeCompare(b.name));

// ── 3. modules (one per src/lib sub-package) ─────────────────────────────────
const moduleAgg = new Map(); // id → { files:Set, exports:number }
for (const n of nodes) {
  const sf = n.source_file || '';
  if (!sf.startsWith('src/lib/')) continue;
  if (isTestFile(sf)) continue;
  const id = libModuleOf(sf);
  if (id === 'test-stubs') continue; // test helper, not a product module
  const agg = moduleAgg.get(id) || moduleAgg.set(id, { files: new Set(), exports: 0 }).get(id);
  if (isFileNode(n)) agg.files.add(sf);
  else if (!isControlFlow(n.label)) agg.exports += 1;
}
const modules = [...moduleAgg.entries()]
  .map(([id, agg]) => {
    if (!MODULE_SUMMARY[id]) console.warn(`  ⚠ modules: no curated summary for '${id}' → generic`);
    return {
      id,
      path: id === '(root)' ? 'src/lib' : `src/lib/${id}`,
      files: agg.files.size,
      exports: agg.exports,
      summary: MODULE_SUMMARY[id] || `${agg.files.size} file(s), ${agg.exports} export(s) under src/lib/${id}.`,
    };
  })
  .sort((a, b) => b.exports - a.exports || a.id.localeCompare(b.id));

// ── emit ─────────────────────────────────────────────────────────────────────
const J = (v) => JSON.stringify(v);
const endpointLines = endpoints
  .map((e) => `  { route: ${J(e.route)}, file: ${J(e.file)}, methods: ${J(e.methods)}, community: ${J(e.community)} },`)
  .join('\n');
const exportLines = exportsList
  .map((e) => `  { name: ${J(e.name)}, file: ${J(e.file)}, module: ${J(e.module)} },`)
  .join('\n');
const moduleLines = modules
  .map((m) => `  { id: ${J(m.id)}, path: ${J(m.path)}, files: ${m.files}, exports: ${m.exports}, summary: ${J(m.summary)} },`)
  .join('\n');

const out = `/**
 * api-docs.ts — snapshot of the codebase's API surface for the /design "Docs"
 * tab: the src/routes/api endpoint catalog, the public declaration surface
 * across src/lib, and a per-module responsibility summary.
 *
 * AUTO-GENERATED from the graphify knowledge graph by scripts/gen-api-docs.mjs.
 * \`endpoints\`/\`exports\`/\`modules\` are derived from graph nodes + source_file
 * fields (endpoint HTTP methods are read from the endpoint source). \`exports\`
 * is the top-level declaration surface graphify extracted (test files +
 * control-flow noise removed), not an \`export\`-keyword parse.
 * Regenerate with: bun scripts/gen-api-docs.mjs
 */

export interface ApiEndpoint {
  /** Route path, e.g. '/api/cache/stats'. */
  route: string;
  /** Source file, e.g. 'src/routes/api/cache/stats/+server.ts'. */
  file: string;
  /** Exported HTTP handlers, canonical order (may be empty if none extracted). */
  methods: string[];
  /** graphify community id, or null. */
  community: number | null;
}

export interface LibExport {
  /** Symbol name as graphify labelled it, e.g. 'parseWson()' or 'GraphEditorController'. */
  name: string;
  /** Source file the symbol lives in. */
  file: string;
  /** Top-level src/lib sub-package, e.g. 'cad' | 'wells' | '(root)'. */
  module: string;
}

export interface LibModule {
  /** Sub-package id, e.g. 'cad'. */
  id: string;
  /** Directory path, e.g. 'src/lib/cad'. */
  path: string;
  /** Non-test source file count. */
  files: number;
  /** Public export count. */
  exports: number;
  /** One-line responsibility summary. */
  summary: string;
}

const endpoints: ApiEndpoint[] = [
${endpointLines}
];

const libExports: LibExport[] = [
${exportLines}
];

const modules: LibModule[] = [
${moduleLines}
];

export const apiDocs = {
  /** Where this snapshot was generated from. */
  meta: {
    source: 'graphify-out/graph.json',
    nodeCount: ${nodes.length},
    endpointCount: ${endpoints.length},
    exportCount: ${exportsList.length},
    moduleCount: ${modules.length},
  },
  exports: libExports,
  endpoints,
  modules,
} as const;
`;

writeFileSync(OUT, out);
console.log(
  `api-docs.ts — ${endpoints.length} endpoints · ${exportsList.length} exports · ${modules.length} modules ` +
    `(from ${nodes.length} graph nodes)`,
);
