/**
 * gen-design-diagrams.mjs — ONE command that regenerates ALL THREE /design
 * snapshot data files from the live codebase, so the Architecture tabs never
 * drift from the source they describe:
 *
 *   bun scripts/gen-design-diagrams.mjs
 *
 *   1. src/routes/design/folder-tree.ts    — the src/ LOC tree (walks src/;
 *      reuses writeFolderTree() from scripts/gen-folder-tree.mjs)
 *   2. src/routes/design/gep-modules.ts    — the GraphEditorPane module graph
 *      (nodes = files under src/lib/shared/graph-editor/**, loc = line count,
 *      cluster/role from a curated config, edges grepped from imports/mounts)
 *   3. src/routes/design/domain-classes.ts — the composition-graph Mermaid
 *      class diagram (class LIST + GraphNode inheritance edges re-derived from
 *      the `GraphNode` union in composition-graph-types.ts; namespaces + field
 *      lines spliced from a curated config)
 *
 * architecture.ts + c4.ts stay HAND-CURATED (editorial) — this script never
 * touches them.
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { writeFolderTree } from './gen-folder-tree.mjs';

const DESIGN_DIR = 'src/routes/design';

const countLoc = (p) => { try { const t = readFileSync(p, 'utf8'); return t ? t.split('\n').length : 0; } catch { return 0; } };

// ════════════════════════════════════════════════════════════════════════
// 2. gep-modules.ts — GraphEditorPane module graph
// ════════════════════════════════════════════════════════════════════════

const GEP_DIR = 'src/lib/shared/graph-editor';

const GEP_CLUSTERS = [
  { id: 'shell',    label: 'Shell',      color: '#475569' },
  { id: 'nodecard', label: 'Node cards', color: '#f97316' },
  { id: 'wiring',   label: 'Wiring',     color: '#3b82f6' },
  { id: 'sketch',   label: 'Sketch',     color: '#22c55e' },
  { id: 'spline',   label: 'Spline',     color: '#14b8a6' },
  { id: 'expr',     label: 'Expr',       color: '#a855f7' },
  { id: 'preview',  label: 'Preview',    color: '#ec4899' },
  { id: 'bake',     label: 'Bake',       color: '#f59e0b' },
  { id: 'menus',    label: 'Menus / popovers', color: '#6366f1' },
  { id: 'rightrail',label: 'Right rail', color: '#06b6d4' },
  { id: 'geometry', label: 'Geometry',   color: '#ef4444' },
];

/**
 * Curated per-file config (cluster · label · role · kind · split), ORDERED as
 * the current gep-modules.ts renders. loc is NOT here — it is recomputed live.
 * A file discovered on disk but absent here gets a heuristic default (see
 * heuristicMeta) + an empty role, and the run WARNs so it can be curated.
 */
const GEP_CONFIG = [
  // ── Shell ──
  { id: 'GraphEditorPane.svelte', label: 'GraphEditorPane', cluster: 'shell', kind: 'shell',
    role: 'Root editor pane: canvas, state orchestration, node-drop/bake/keyboard actions; mounts everything',
    split: '7 extraction candidates: node-palette · canvas-interaction · expr-actions · bake-orchestration · part-actions · keymap/save · CSS' },

  // ── Node cards ──
  { id: 'NodeCard.svelte', label: 'NodeCard', cluster: 'nodecard', kind: 'component',
    role: 'Per-node-type SVG card renderer (call/method/mv/rot/txfmn/repeat/list/polygon/sketch/expr/spline/material/warp)',
    split: '6 candidates: split the {#if n.type} chain into NodeCard.<Type>.svelte per card' },
  { id: 'RepeatEditorPane.svelte', label: 'RepeatEditorPane', cluster: 'nodecard', kind: 'component',
    role: 'Repeat-node pattern editor pane' },

  // ── Wiring ──
  { id: 'wire-state.svelte.ts', label: 'wire-state', cluster: 'wiring', kind: 'state',
    role: 'Wire drag/connect state machine (per-instance class)' },
  { id: 'WireLayer.svelte', label: 'WireLayer', cluster: 'wiring', kind: 'component',
    role: 'SVG wire/edge rendering layer' },
  { id: 'canvas-interaction.svelte.ts', label: 'canvas-interaction', cluster: 'wiring', kind: 'state',
    role: 'Canvas pan/zoom/pointer interaction state' },
  { id: 'pointer-capture.ts', label: 'pointer-capture', cluster: 'wiring', kind: 'logic',
    role: 'Implicit pointer-capture release helper' },

  // ── Sketch ──
  { id: 'sketch-state.svelte.ts', label: 'sketch-state', cluster: 'sketch', kind: 'state',
    role: 'Sketch editing reactive state (per-instance class)' },
  { id: 'SketchEditorPane.svelte', label: 'SketchEditorPane', cluster: 'sketch', kind: 'component',
    role: 'Full-screen sketch editor pane' },
  { id: 'SketchNodeCard.svelte', label: 'SketchNodeCard', cluster: 'sketch', kind: 'component',
    role: 'Card renderer for sketch nodes' },

  // ── Spline ──
  { id: 'spline-state.svelte.ts', label: 'spline-state', cluster: 'spline', kind: 'state',
    role: 'Spline editing reactive state' },
  { id: 'SplineScene.svelte', label: 'SplineScene', cluster: 'spline', kind: 'component',
    role: 'Spline canvas/scene renderer' },
  { id: 'SplineEditorPopup.svelte', label: 'SplineEditorPopup', cluster: 'spline', kind: 'component',
    role: 'Spline editor popup wrapper' },

  // ── Expr ──
  { id: 'expr/ExpressionBuilderPopup.svelte', label: 'ExpressionBuilderPopup', cluster: 'expr', kind: 'component',
    role: 'Expression builder popup shell' },
  { id: 'expr/ExprImperativeBlocks.svelte', label: 'ExprImperativeBlocks', cluster: 'expr', kind: 'component',
    role: 'Imperative block editor' },
  { id: 'expr/ExpressionsMenu.svelte', label: 'ExpressionsMenu', cluster: 'expr', kind: 'component',
    role: 'Expression defs menu' },
  { id: 'expr/ExpressionSrcPane.svelte', label: 'ExpressionSrcPane', cluster: 'expr', kind: 'component',
    role: 'Expression source text pane + completions' },
  { id: 'expr/ExprCodeEditor.svelte', label: 'ExprCodeEditor', cluster: 'expr', kind: 'component',
    role: 'Low-level code editor widget (CodeMirror)' },

  // ── Preview ──
  { id: 'PolyPreview.svelte', label: 'PolyPreview', cluster: 'preview', kind: 'component',
    role: 'Polygon preview SVG renderer' },
  { id: 'poly-preview-state.svelte.ts', label: 'poly-preview-state', cluster: 'preview', kind: 'state',
    role: 'Polygon preview reactive state' },
  { id: 'ProfilePreview.svelte', label: 'ProfilePreview', cluster: 'preview', kind: 'component',
    role: 'Profile preview SVG renderer' },
  { id: 'profile-preview-state.svelte.ts', label: 'profile-preview-state', cluster: 'preview', kind: 'state',
    role: 'Profile preview reactive state' },

  // ── Bake ──
  { id: 'graph-editor-bake.svelte.ts', label: 'graph-editor-bake.svelte', cluster: 'bake', kind: 'state',
    role: 'Reactive bake glue (drift check, refresh call args, ExpectedParams)' },
  { id: 'graph-editor-bake.ts', label: 'graph-editor-bake', cluster: 'bake', kind: 'logic',
    role: 'Bake helpers: extractGraph/DrawingMd, callDrift' },
  { id: 'tf-recipe-timing.ts', label: 'tf-recipe-timing', cluster: 'bake', kind: 'logic',
    role: 'TF recipe pending/unsupported/server-key logic' },
  { id: 'BakeMenu.svelte', label: 'BakeMenu', cluster: 'bake', kind: 'component',
    role: 'Bake options menu' },

  // ── Menus / popovers ──
  { id: 'Popovers.svelte', label: 'Popovers', cluster: 'menus', kind: 'component',
    role: 'Aggregated popovers (profile picker, expr, etc.)' },
  { id: 'CanvasMenu.svelte', label: 'CanvasMenu', cluster: 'menus', kind: 'component',
    role: 'Canvas context/add menu' },
  { id: 'AiMenu.svelte', label: 'AiMenu', cluster: 'menus', kind: 'component',
    role: 'AI-assist menu' },
  { id: 'AutoWireSuggestPanel.svelte', label: 'AutoWireSuggestPanel', cluster: 'menus', kind: 'component',
    role: 'Auto-wire suggestion panel' },
  { id: 'MaterialEditorPopover.svelte', label: 'MaterialEditorPopover', cluster: 'menus', kind: 'component',
    role: 'Material color/opacity popover' },
  { id: 'delete-confirm.svelte.ts', label: 'delete-confirm', cluster: 'menus', kind: 'state',
    role: 'Delete-confirm state helper' },
  { id: 'popover-clamp.ts', label: 'popover-clamp', cluster: 'menus', kind: 'logic',
    role: 'Popover viewport/drag clamping' },
  { id: 'ge-assist.svelte.ts', label: 'ge-assist.svelte', cluster: 'menus', kind: 'state',
    role: 'AI assist session (reactive)' },
  { id: 'ge-assist.ts', label: 'ge-assist', cluster: 'menus', kind: 'logic',
    role: 'AI assist core logic' },

  // ── Right rail ──
  { id: 'RightPane.svelte', label: 'RightPane', cluster: 'rightrail', kind: 'component',
    role: 'Right preview rail; lazy-mounts PrimitiveDualCanvas, TF recipe status' },
  { id: 'PropertiesCard.svelte', label: 'PropertiesCard', cluster: 'rightrail', kind: 'component',
    role: 'Graph/part properties panel' },
  { id: 'ParamsCard.svelte', label: 'ParamsCard', cluster: 'rightrail', kind: 'component',
    role: 'Params list card with delete-confirm' },

  // ── Geometry ──
  { id: 'geom.ts', label: 'geom', cluster: 'geometry', kind: 'logic',
    role: 'Socket/card layout geometry math (positions, sizes) — the shared hub' },
  { id: 'args.ts', label: 'args', cluster: 'geometry', kind: 'logic',
    role: 'Arg/profile producer label + expr parse helpers' },
  { id: 'graph-layout-actions.ts', label: 'graph-layout-actions', cluster: 'geometry', kind: 'logic',
    role: 'Auto-layout / push-apart / obstacle separation' },
  { id: 'node-palette.ts', label: 'node-palette', cluster: 'geometry', kind: 'logic',
    role: 'Pure node-drop graph builders (buildSolidDrop, …) extracted from the GEP shell' },
];

/** Heuristic cluster/kind/label for a file not in GEP_CONFIG (drift). */
function heuristicMeta(relId) {
  const lower = relId.toLowerCase();
  const base = relId.split('/').pop();
  const label = base.replace(/\.svelte\.ts$/, '').replace(/\.(svelte|ts|js)$/, '');
  let cluster = 'shell';
  const pick = (kw, c) => { if (lower.includes(kw)) cluster = c; };
  // most-specific last wins
  pick('geom', 'geometry'); pick('layout', 'geometry'); pick('palette', 'geometry'); pick('args', 'geometry');
  pick('right', 'rightrail'); pick('properties', 'rightrail'); pick('params', 'rightrail');
  pick('menu', 'menus'); pick('popover', 'menus'); pick('ai', 'menus'); pick('material', 'menus');
  pick('bake', 'bake');
  pick('preview', 'preview');
  pick('expr/', 'expr');
  pick('spline', 'spline');
  pick('sketch', 'sketch');
  pick('wire', 'wiring'); pick('pointer', 'wiring'); pick('canvas-interaction', 'wiring');
  pick('nodecard', 'nodecard');
  const kind = base.endsWith('.svelte') ? 'component'
    : base.endsWith('.svelte.ts') ? 'state'
    : 'logic';
  return { cluster, kind, label, role: '' };
}

/** Collect every non-test source file under GEP_DIR (+ expr/), rel to GEP_DIR. */
function listGepFiles() {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(join(dir, e.name), childRel); continue; }
      if (e.name.endsWith('.test.ts')) continue;
      if (/\.(svelte|ts|js)$/.test(e.name)) out.push(childRel);
    }
  };
  walk(GEP_DIR, '');
  return out;
}

/** Resolve an import specifier (rel to `fromRel`'s dir) to a node id, or null. */
function resolveGepImport(fromRel, spec, nodeSet) {
  if (!spec.startsWith('.')) return null;
  const dir = fromRel.includes('/') ? fromRel.slice(0, fromRel.lastIndexOf('/')) : '';
  // posix normalize join(dir, spec)
  const parts = (dir ? dir.split('/') : []);
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  const base = parts.join('/');
  for (const ext of ['', '.ts', '.svelte.ts', '.js']) {
    const cand = base + ext;
    if (nodeSet.has(cand)) return cand;
  }
  return null;
}

/** Grep a file's sibling import/mount edges. */
function gepEdgesFor(relId, nodeSet) {
  const content = readFileSync(join(GEP_DIR, relId), 'utf8');
  const edges = new Map(); // target -> kind (mounts wins)
  const importRe = /(?:import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*(?:\{[^}]*\})?\s+from\s+)?|import\s*\(\s*)['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(content))) {
    const localName = m[1];
    const spec = m[2];
    const target = resolveGepImport(relId, spec, nodeSet);
    if (!target || target === relId) continue;
    const isComponent = target.endsWith('.svelte') && !target.endsWith('.svelte.ts');
    let kind = 'imports';
    if (isComponent && localName && new RegExp(`<${localName}[\\s/>]`).test(content)) kind = 'mounts';
    if (edges.get(target) !== 'mounts') edges.set(target, kind);
  }
  return edges;
}

function writeGepModules() {
  const files = listGepFiles();
  const nodeSet = new Set(files);
  const cfg = new Map(GEP_CONFIG.map(c => [c.id, c]));

  // Node records (config order first, then any drift files appended).
  const seen = new Set();
  const records = [];
  const push = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const c = cfg.get(id) || heuristicMeta(id);
    records.push({ id, ...c, loc: countLoc(join(GEP_DIR, id)) });
  };
  const drift = [];
  for (const c of GEP_CONFIG) { if (nodeSet.has(c.id)) push(c.id); else console.warn(`  ⚠ gep: config file gone: ${c.id}`); }
  for (const id of files) { if (!seen.has(id)) { drift.push(id); push(id); } }
  if (drift.length) console.warn(`  ⚠ gep: ${drift.length} unconfigured file(s) → heuristic cluster: ${drift.join(', ')}`);

  // Emit nodes grouped by cluster (GEP_CLUSTERS order).
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const nodeLines = [];
  for (const cl of GEP_CLUSTERS) {
    const group = records.filter(r => r.cluster === cl.id);
    if (!group.length) continue;
    nodeLines.push(`  // ── ${cl.label} ──`);
    for (const r of group) {
      const lines = [
        `  { id: '${esc(r.id)}', label: '${esc(r.label)}', cluster: '${r.cluster}', loc: ${r.loc}, kind: '${r.kind}',`,
        `    role: '${esc(r.role)}'` + (r.split ? ',' : ' },'),
      ];
      if (r.split) lines.push(`    split: '${esc(r.split)}' },`);
      nodeLines.push(lines.join('\n'));
    }
  }

  // Edges: grep every node, sort by source cluster/order then target.
  const order = new Map(records.map((r, i) => [r.id, i]));
  const links = [];
  for (const r of records) {
    const es = gepEdgesFor(r.id, nodeSet);
    for (const [target, kind] of es) links.push({ source: r.id, target, kind });
  }
  links.sort((a, b) =>
    (order.get(a.source) - order.get(b.source)) ||
    (order.get(a.target) - order.get(b.target)));

  const linkLines = links.map(l =>
    l.kind === 'mounts'
      ? `  M('${esc(l.source)}', '${esc(l.target)}', 'mounts'),`
      : `  M('${esc(l.source)}', '${esc(l.target)}'),`);

  const clusterLines = GEP_CLUSTERS.map(c =>
    `  { id: '${c.id}',${' '.repeat(Math.max(1, 10 - c.id.length))}label: '${c.label}',${' '.repeat(Math.max(1, 12 - c.label.length))}color: '${c.color}' },`);

  const out = `/**
 * gep-modules.ts — module map of the GraphEditorPane (GEP) editor cluster,
 * i.e. every file under \`src/lib/shared/graph-editor/*\`, rendered as a compact
 * force-directed graph on the /design "GEP module" tab (GepModuleGraph.svelte).
 *
 * Nodes = files (radius ∝ LOC, colour = cluster). Links = internal
 * import/mount edges. Test files are omitted (noise for a structure view).
 * External dependency targets ($lib/cad/composition-graph, graph-to-tf, …) are
 * omitted here to keep the map focused on the editor's own decomposition.
 *
 * AUTO-GENERATED by scripts/gen-design-diagrams.mjs (loc = live line count,
 * edges = grepped imports/mounts, cluster/role from a curated config inside the
 * script). Regenerate with: bun scripts/gen-design-diagrams.mjs
 */

export interface GepCluster {
  id: string;
  label: string;
  color: string;
}

export interface GepModuleNode {
  id: string;          // stable id = filename (unique within graph-editor/)
  label: string;       // short display label
  cluster: string;     // GepCluster.id
  loc: number;
  role: string;        // one-line responsibility (tooltip)
  kind?: 'shell' | 'component' | 'state' | 'logic';
  /** For over-sized files: a one-line summary of extraction candidates (tooltip). */
  split?: string;
}

export interface GepModuleLink {
  source: string;
  target: string;
  kind?: 'imports' | 'mounts';
}

export const GEP_CLUSTERS: GepCluster[] = [
${clusterLines.join('\n')}
];

export const GEP_MODULE_NODES: GepModuleNode[] = [
${nodeLines.join('\n')}
];

const M = (source: string, target: string, kind: 'imports' | 'mounts' = 'imports'): GepModuleLink => ({ source, target, kind });

export const GEP_MODULE_LINKS: GepModuleLink[] = [
${linkLines.join('\n')}
];
`;
  writeFileSync(join(DESIGN_DIR, 'gep-modules.ts'), out);
  return { nodes: records.length, links: links.length };
}

// ════════════════════════════════════════════════════════════════════════
// 3. domain-classes.ts — composition-graph Mermaid class diagram
// ════════════════════════════════════════════════════════════════════════

const TYPES_SRC = 'src/lib/cad/composition-graph-types.ts';

// Curated CoreModel classes (value/aggregate types — not GraphNode variants).
const CORE_CLASSES = [
  { name: 'Graph', stereotype: 'aggregate root', fields: [
    '+Map~GraphNode~ nodes', '+NodeId root', '+Map~ParamSchema~ params', '+Edge[] edges',
    '+string[] imports', '+Map~LayoutXY~ layout', '+PartAppearance appearance'] },
  { name: 'GraphNode', stereotype: 'union base', fields: ['+NodeId id', '+string type'] },
  { name: 'ArgValue', stereotype: 'value union', fields: ['+literal|expr|param kind'] },
  { name: 'Literal', fields: ['+number|string|bool value'] },
  { name: 'Expr', fields: ['+string expr'] },
  { name: 'Param', fields: ['+string param'] },
  { name: 'ParamSchema', fields: ['+number default', '+number step'] },
  { name: 'Edge', fields: ['+NodeId from', '+string key', '+string param'] },
  { name: 'LayoutXY', fields: ['+number x', '+number y'] },
];

// Curated GraphNode-variant classes grouped into producer namespaces. The SET
// of `name`s here is validated against the parsed `GraphNode` union; a union
// member missing here → WARN + appended to an Uncategorized namespace.
const NODE_NAMESPACES = [
  { ns: 'SolidProducers', classes: [
    { name: 'CallNode',   fields: ['+string src', '+string alias', '+Map~ArgValue~ args'] },
    { name: 'MethodNode', fields: ['+CsgOp op', '+NodeId obj', '+NodeId arg'] },
  ] },
  { ns: 'ProfileProducers', classes: [
    { name: 'PolygonNode',     fields: ['+PolygonEntry[] points'] },
    { name: 'PolyRepeatNode',  fields: ['+ArgValue count', '+ArgValue r', '+ArgValue z', '+string loopVar'] },
    { name: 'SketchNode',      fields: ['+SketchOpEntry[] ops', '+ArgValue segments'] },
    { name: 'SketchRepeatNode',fields: ['+ArgValue count', '+string loopVar'] },
    { name: 'SplineNode',      fields: ['+number[3][] points', '+ArgValue samples', '+bool closed'] },
    { name: 'ExprNode',        fields: ['+NodeId defId', '+Map~ArgValue~ bindings'] },
  ] },
  { ns: 'Transforms', classes: [
    { name: 'MvNode',    fields: ['+NodeId child', '+ArgValue[3] offset'] },
    { name: 'RotNode',   fields: ['+NodeId child', '+ArgValue[3] rot'] },
    { name: 'TxfmnNode', fields: ['+NodeId child', '+ArgValue[3] rot', '+ArgValue[3] offset'] },
    { name: 'WarpNode',  fields: ['+NodeId child', '+ArgValue path', '+ArgValue refine'] },
  ] },
  { ns: 'Containers', classes: [
    { name: 'ContainerNode', fields: ['+list|stack|group type', '+NodeId[] children', '+Map childCounts'] },
    { name: 'RepeatNode',    fields: ['+NodeId[] children', '+ArgValue count', '+RepeatOp op', '+string loopVar'] },
  ] },
  { ns: 'Appearance', classes: [
    { name: 'MaterialNode', fields: ['+string material', '+string colorOuter', '+number opacity'] },
  ] },
];

const RELATIONSHIPS = [
  'Graph "1" o-- "*" GraphNode : nodes',
  'Graph "1" o-- "*" ParamSchema : params',
  'Graph "1" o-- "*" Edge : edges',
  'CallNode ..> ArgValue : args',
  'MethodNode ..> GraphNode : obj/arg',
  'ContainerNode ..> GraphNode : children',
  'WarpNode ..> GraphNode : child',
];

/** Parse the `export type GraphNode = A | B | …;` union member list. */
function parseGraphNodeUnion(src) {
  const m = src.match(/export type GraphNode\s*=\s*([\s\S]*?);/);
  if (!m) throw new Error('could not find `export type GraphNode = …` in ' + TYPES_SRC);
  return m[1].split('|').map(s => s.trim()).filter(Boolean);
}

/** Render one Mermaid class: single-line unless it carries a stereotype. */
function renderClass(c) {
  if (c.stereotype) {
    const lines = [`    class ${c.name} {`, `      <<${c.stereotype}>>`];
    for (const f of c.fields) lines.push(`      ${f}`);
    lines.push('    }');
    return lines.join('\n');
  }
  return `    class ${c.name} { ${c.fields.join('; ')} }`;
}

function writeDomainClasses() {
  const src = readFileSync(TYPES_SRC, 'utf8');
  const union = parseGraphNodeUnion(src);
  const unionSet = new Set(union);

  // Validate curated node classes against the parsed union (drift detection).
  const curated = NODE_NAMESPACES.flatMap(g => g.classes.map(c => c.name));
  const curatedSet = new Set(curated);
  const missing = union.filter(n => !curatedSet.has(n));   // in union, uncurated
  const stale = curated.filter(n => !unionSet.has(n));      // curated, gone from union
  if (stale.length) console.warn(`  ⚠ domain: curated class not in GraphNode union: ${stale.join(', ')}`);

  const namespaces = NODE_NAMESPACES.map(g => ({
    ns: g.ns,
    classes: g.classes.filter(c => unionSet.has(c.name)),
  }));
  if (missing.length) {
    console.warn(`  ⚠ domain: GraphNode union member(s) not curated → Uncategorized: ${missing.join(', ')}`);
    namespaces.push({ ns: 'Uncategorized', classes: missing.map(name => ({ name, fields: ['+NodeId id', '+string type'] })) });
  }

  // Inheritance edges follow curated/namespace order, then any appended drift.
  const nodeOrder = [...curated.filter(n => unionSet.has(n)), ...missing];

  const nsBlocks = [];
  nsBlocks.push('  namespace CoreModel {\n' + CORE_CLASSES.map(renderClass).join('\n') + '\n  }');
  for (const g of namespaces) {
    if (!g.classes.length) continue;
    nsBlocks.push(`  namespace ${g.ns} {\n` + g.classes.map(renderClass).join('\n') + '\n  }');
  }

  const inherit = [
    '  ArgValue <|-- Literal',
    '  ArgValue <|-- Expr',
    '  ArgValue <|-- Param',
    '',
    ...nodeOrder.map(n => `  GraphNode <|-- ${n}`),
  ];

  const body = [
    'classDiagram',
    '  direction TB',
    '',
    nsBlocks.join('\n\n'),
    '',
    inherit.join('\n'),
    '',
    ...RELATIONSHIPS.map(r => '  ' + r),
  ].join('\n');

  const out = `/**
 * domain-classes.ts — the composition-graph DOMAIN MODEL as a Mermaid class
 * diagram, for the /design "Class model" tab (UmlClassDiagram.svelte).
 *
 * Source of truth: src/lib/cad/composition-graph-types.ts. The GraphNode class
 * LIST + inheritance edges are AUTO-DERIVED from the \`GraphNode\` union by
 * scripts/gen-design-diagrams.mjs — so an added/removed node type surfaces on
 * the next regen. The namespace grouping + per-class FIELD lines are a curated,
 * readability-trimmed splice inside the script (the diagram shows key fields
 * only, e.g. \`+Map~GraphNode~ nodes\` for \`Record<NodeId, GraphNode>\`), NOT a
 * raw field parse. Regenerate with: bun scripts/gen-design-diagrams.mjs
 */
export const DOMAIN_CLASS_DIAGRAM = \`${body}
\`;
`;
  writeFileSync(join(DESIGN_DIR, 'domain-classes.ts'), out);
  return { classes: CORE_CLASSES.length + union.length, unionMembers: union.length, missing: missing.length };
}

// ════════════════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════════════════

console.log('Regenerating /design snapshots from the live codebase…');
const ft = writeFolderTree();
console.log(`  1. folder-tree.ts    — ${ft.files} files · ${ft.folders} folders · ${ft.loc.toLocaleString('en-US')} LOC`);
const gm = writeGepModules();
console.log(`  2. gep-modules.ts    — ${gm.nodes} nodes · ${gm.links} edges`);
const dc = writeDomainClasses();
console.log(`  3. domain-classes.ts — ${dc.classes} classes (${dc.unionMembers} GraphNode variants${dc.missing ? `, ${dc.missing} uncurated` : ''})`);
console.log('Done. (architecture.ts + c4.ts are hand-curated — untouched.)');
