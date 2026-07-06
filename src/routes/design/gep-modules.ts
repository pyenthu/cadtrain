/**
 * gep-modules.ts — module map of the GraphEditorPane (GEP) editor cluster,
 * i.e. every file under `src/lib/shared/graph-editor/*`, rendered as a compact
 * force-directed graph on the /design "GEP module" tab (GepModuleGraph.svelte).
 *
 * Nodes = files (radius ∝ LOC, colour = cluster). Links = internal
 * import/mount edges. Test files are omitted (noise for a structure view).
 * External dependency targets ($lib/cad/composition-graph, graph-to-tf, …) are
 * omitted here to keep the map focused on the editor's own decomposition.
 *
 * Data captured 2026-07-06 from a read-only file scan (LOC via wc -l, edges via
 * import grep). Refresh when the cluster is re-modularized — this is a curated
 * snapshot, not a live introspection.
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

export const GEP_MODULE_NODES: GepModuleNode[] = [
  // ── Shell ──
  { id: 'GraphEditorPane.svelte', label: 'GraphEditorPane', cluster: 'shell', loc: 4456, kind: 'shell',
    role: 'Root editor pane: canvas, state orchestration, node-drop/bake/keyboard actions; mounts everything',
    split: '7 extraction candidates: node-palette · canvas-interaction · expr-actions · bake-orchestration · part-actions · keymap/save · CSS' },

  // ── Node cards ──
  { id: 'NodeCard.svelte', label: 'NodeCard', cluster: 'nodecard', loc: 2453, kind: 'component',
    role: 'Per-node-type SVG card renderer (call/method/mv/rot/txfmn/repeat/list/polygon/sketch/expr/spline/material/warp)',
    split: '6 candidates: split the {#if n.type} chain into NodeCard.<Type>.svelte per card' },
  { id: 'RepeatEditorPane.svelte', label: 'RepeatEditorPane', cluster: 'nodecard', loc: 298, kind: 'component',
    role: 'Repeat-node pattern editor pane' },

  // ── Wiring ──
  { id: 'wire-state.svelte.ts', label: 'wire-state', cluster: 'wiring', loc: 444, kind: 'state',
    role: 'Wire drag/connect state machine (per-instance class)' },
  { id: 'WireLayer.svelte', label: 'WireLayer', cluster: 'wiring', loc: 551, kind: 'component',
    role: 'SVG wire/edge rendering layer' },
  { id: 'canvas-interaction.svelte.ts', label: 'canvas-interaction', cluster: 'wiring', loc: 96, kind: 'state',
    role: 'Canvas pan/zoom/pointer interaction state' },
  { id: 'pointer-capture.ts', label: 'pointer-capture', cluster: 'wiring', loc: 19, kind: 'logic',
    role: 'Implicit pointer-capture release helper' },

  // ── Sketch ──
  { id: 'sketch-state.svelte.ts', label: 'sketch-state', cluster: 'sketch', loc: 773, kind: 'state',
    role: 'Sketch editing reactive state (per-instance class)' },
  { id: 'SketchEditorPane.svelte', label: 'SketchEditorPane', cluster: 'sketch', loc: 645, kind: 'component',
    role: 'Full-screen sketch editor pane' },
  { id: 'SketchNodeCard.svelte', label: 'SketchNodeCard', cluster: 'sketch', loc: 268, kind: 'component',
    role: 'Card renderer for sketch nodes' },

  // ── Spline ──
  { id: 'spline-state.svelte.ts', label: 'spline-state', cluster: 'spline', loc: 149, kind: 'state',
    role: 'Spline editing reactive state' },
  { id: 'SplineScene.svelte', label: 'SplineScene', cluster: 'spline', loc: 282, kind: 'component',
    role: 'Spline canvas/scene renderer' },
  { id: 'SplineEditorPopup.svelte', label: 'SplineEditorPopup', cluster: 'spline', loc: 253, kind: 'component',
    role: 'Spline editor popup wrapper' },

  // ── Expr ──
  { id: 'expr/ExpressionBuilderPopup.svelte', label: 'ExpressionBuilderPopup', cluster: 'expr', loc: 522, kind: 'component',
    role: 'Expression builder popup shell' },
  { id: 'expr/ExprImperativeBlocks.svelte', label: 'ExprImperativeBlocks', cluster: 'expr', loc: 485, kind: 'component',
    role: 'Imperative block editor' },
  { id: 'expr/ExpressionsMenu.svelte', label: 'ExpressionsMenu', cluster: 'expr', loc: 263, kind: 'component',
    role: 'Expression defs menu' },
  { id: 'expr/ExpressionSrcPane.svelte', label: 'ExpressionSrcPane', cluster: 'expr', loc: 195, kind: 'component',
    role: 'Expression source text pane + completions' },
  { id: 'expr/ExprCodeEditor.svelte', label: 'ExprCodeEditor', cluster: 'expr', loc: 131, kind: 'component',
    role: 'Low-level code editor widget (CodeMirror)' },

  // ── Preview ──
  { id: 'PolyPreview.svelte', label: 'PolyPreview', cluster: 'preview', loc: 442, kind: 'component',
    role: 'Polygon preview SVG renderer' },
  { id: 'poly-preview-state.svelte.ts', label: 'poly-preview-state', cluster: 'preview', loc: 382, kind: 'state',
    role: 'Polygon preview reactive state' },
  { id: 'ProfilePreview.svelte', label: 'ProfilePreview', cluster: 'preview', loc: 166, kind: 'component',
    role: 'Profile preview SVG renderer' },
  { id: 'profile-preview-state.svelte.ts', label: 'profile-preview-state', cluster: 'preview', loc: 199, kind: 'state',
    role: 'Profile preview reactive state' },

  // ── Bake ──
  { id: 'graph-editor-bake.svelte.ts', label: 'graph-editor-bake.svelte', cluster: 'bake', loc: 127, kind: 'state',
    role: 'Reactive bake glue (drift check, refresh call args, ExpectedParams)' },
  { id: 'graph-editor-bake.ts', label: 'graph-editor-bake', cluster: 'bake', loc: 50, kind: 'logic',
    role: 'Bake helpers: extractGraph/DrawingMd, callDrift' },
  { id: 'tf-recipe-timing.ts', label: 'tf-recipe-timing', cluster: 'bake', loc: 52, kind: 'logic',
    role: 'TF recipe pending/unsupported/server-key logic' },
  { id: 'BakeMenu.svelte', label: 'BakeMenu', cluster: 'bake', loc: 105, kind: 'component',
    role: 'Bake options menu' },

  // ── Menus / popovers ──
  { id: 'Popovers.svelte', label: 'Popovers', cluster: 'menus', loc: 569, kind: 'component',
    role: 'Aggregated popovers (profile picker, expr, etc.)' },
  { id: 'CanvasMenu.svelte', label: 'CanvasMenu', cluster: 'menus', loc: 118, kind: 'component',
    role: 'Canvas context/add menu' },
  { id: 'AiMenu.svelte', label: 'AiMenu', cluster: 'menus', loc: 231, kind: 'component',
    role: 'AI-assist menu' },
  { id: 'AutoWireSuggestPanel.svelte', label: 'AutoWireSuggestPanel', cluster: 'menus', loc: 120, kind: 'component',
    role: 'Auto-wire suggestion panel' },
  { id: 'MaterialEditorPopover.svelte', label: 'MaterialEditorPopover', cluster: 'menus', loc: 111, kind: 'component',
    role: 'Material color/opacity popover' },
  { id: 'delete-confirm.svelte.ts', label: 'delete-confirm', cluster: 'menus', loc: 77, kind: 'state',
    role: 'Delete-confirm state helper' },
  { id: 'popover-clamp.ts', label: 'popover-clamp', cluster: 'menus', loc: 65, kind: 'logic',
    role: 'Popover viewport/drag clamping' },
  { id: 'ge-assist.svelte.ts', label: 'ge-assist.svelte', cluster: 'menus', loc: 186, kind: 'state',
    role: 'AI assist session (reactive)' },
  { id: 'ge-assist.ts', label: 'ge-assist', cluster: 'menus', loc: 234, kind: 'logic',
    role: 'AI assist core logic' },

  // ── Right rail ──
  { id: 'RightPane.svelte', label: 'RightPane', cluster: 'rightrail', loc: 785, kind: 'component',
    role: 'Right preview rail; lazy-mounts PrimitiveDualCanvas, TF recipe status' },
  { id: 'PropertiesCard.svelte', label: 'PropertiesCard', cluster: 'rightrail', loc: 177, kind: 'component',
    role: 'Graph/part properties panel' },
  { id: 'ParamsCard.svelte', label: 'ParamsCard', cluster: 'rightrail', loc: 168, kind: 'component',
    role: 'Params list card with delete-confirm' },

  // ── Geometry ──
  { id: 'geom.ts', label: 'geom', cluster: 'geometry', loc: 584, kind: 'logic',
    role: 'Socket/card layout geometry math (positions, sizes) — the shared hub' },
  { id: 'args.ts', label: 'args', cluster: 'geometry', loc: 79, kind: 'logic',
    role: 'Arg/profile producer label + expr parse helpers' },
  { id: 'graph-layout-actions.ts', label: 'graph-layout-actions', cluster: 'geometry', loc: 174, kind: 'logic',
    role: 'Auto-layout / push-apart / obstacle separation' },
  { id: 'node-palette.ts', label: 'node-palette', cluster: 'geometry', loc: 120, kind: 'logic',
    role: 'Pure node-drop graph builders (buildSolidDrop, …) extracted from the GEP shell' },
];

const M = (source: string, target: string, kind: 'imports' | 'mounts' = 'imports'): GepModuleLink => ({ source, target, kind });

export const GEP_MODULE_LINKS: GepModuleLink[] = [
  // Shell → everything
  M('GraphEditorPane.svelte', 'geom.ts'),
  M('GraphEditorPane.svelte', 'graph-layout-actions.ts'),
  M('GraphEditorPane.svelte', 'args.ts'),
  M('GraphEditorPane.svelte', 'poly-preview-state.svelte.ts'),
  M('GraphEditorPane.svelte', 'profile-preview-state.svelte.ts'),
  M('GraphEditorPane.svelte', 'ge-assist.svelte.ts'),
  M('GraphEditorPane.svelte', 'popover-clamp.ts'),
  M('GraphEditorPane.svelte', 'pointer-capture.ts'),
  M('GraphEditorPane.svelte', 'wire-state.svelte.ts'),
  M('GraphEditorPane.svelte', 'sketch-state.svelte.ts'),
  M('GraphEditorPane.svelte', 'spline-state.svelte.ts'),
  M('GraphEditorPane.svelte', 'canvas-interaction.svelte.ts'),
  M('GraphEditorPane.svelte', 'graph-editor-bake.svelte.ts'),
  M('GraphEditorPane.svelte', 'node-palette.ts'),
  M('GraphEditorPane.svelte', 'PolyPreview.svelte', 'mounts'),
  M('GraphEditorPane.svelte', 'ProfilePreview.svelte', 'mounts'),
  M('GraphEditorPane.svelte', 'RightPane.svelte', 'mounts'),
  M('GraphEditorPane.svelte', 'WireLayer.svelte', 'mounts'),
  M('GraphEditorPane.svelte', 'Popovers.svelte', 'mounts'),
  M('GraphEditorPane.svelte', 'PropertiesCard.svelte', 'mounts'),
  M('GraphEditorPane.svelte', 'ParamsCard.svelte', 'mounts'),
  M('GraphEditorPane.svelte', 'NodeCard.svelte', 'mounts'),
  M('GraphEditorPane.svelte', 'SketchNodeCard.svelte', 'mounts'),
  M('GraphEditorPane.svelte', 'SketchEditorPane.svelte', 'mounts'),
  M('GraphEditorPane.svelte', 'RepeatEditorPane.svelte', 'mounts'),
  M('GraphEditorPane.svelte', 'CanvasMenu.svelte', 'mounts'),
  M('GraphEditorPane.svelte', 'BakeMenu.svelte', 'mounts'),
  M('GraphEditorPane.svelte', 'AiMenu.svelte', 'mounts'),
  M('GraphEditorPane.svelte', 'AutoWireSuggestPanel.svelte', 'mounts'),
  M('GraphEditorPane.svelte', 'SplineEditorPopup.svelte', 'mounts'),
  M('GraphEditorPane.svelte', 'MaterialEditorPopover.svelte', 'mounts'),
  M('GraphEditorPane.svelte', 'expr/ExpressionBuilderPopup.svelte', 'mounts'),
  M('GraphEditorPane.svelte', 'expr/ExpressionsMenu.svelte', 'mounts'),

  // NodeCard
  M('NodeCard.svelte', 'geom.ts'),
  M('NodeCard.svelte', 'args.ts'),
  M('NodeCard.svelte', 'graph-editor-bake.svelte.ts'),
  M('NodeCard.svelte', 'delete-confirm.svelte.ts'),
  M('NodeCard.svelte', 'SketchNodeCard.svelte', 'mounts'),
  M('NodeCard.svelte', 'Popovers.svelte'),
  M('NodeCard.svelte', 'sketch-state.svelte.ts'),
  M('NodeCard.svelte', 'wire-state.svelte.ts'),

  // SketchNodeCard
  M('SketchNodeCard.svelte', 'geom.ts'),
  M('SketchNodeCard.svelte', 'args.ts'),
  M('SketchNodeCard.svelte', 'delete-confirm.svelte.ts'),
  M('SketchNodeCard.svelte', 'sketch-state.svelte.ts'),
  M('SketchNodeCard.svelte', 'wire-state.svelte.ts'),

  // Right rail
  M('RightPane.svelte', 'tf-recipe-timing.ts'),
  M('ParamsCard.svelte', 'geom.ts'),
  M('ParamsCard.svelte', 'delete-confirm.svelte.ts'),

  // Wiring
  M('WireLayer.svelte', 'geom.ts'),
  M('wire-state.svelte.ts', 'pointer-capture.ts'),

  // Sketch
  M('sketch-state.svelte.ts', 'geom.ts'),
  M('sketch-state.svelte.ts', 'args.ts'),
  M('sketch-state.svelte.ts', 'pointer-capture.ts'),
  M('sketch-state.svelte.ts', 'wire-state.svelte.ts'),
  M('SketchEditorPane.svelte', 'geom.ts'),
  M('SketchEditorPane.svelte', 'args.ts'),
  M('SketchEditorPane.svelte', 'sketch-state.svelte.ts'),
  M('SketchEditorPane.svelte', 'wire-state.svelte.ts'),

  // Geometry
  M('graph-layout-actions.ts', 'geom.ts'),

  // Preview
  M('poly-preview-state.svelte.ts', 'geom.ts'),
  M('PolyPreview.svelte', 'geom.ts'),
  M('PolyPreview.svelte', 'poly-preview-state.svelte.ts'),
  M('profile-preview-state.svelte.ts', 'poly-preview-state.svelte.ts'),
  M('ProfilePreview.svelte', 'geom.ts'),
  M('ProfilePreview.svelte', 'profile-preview-state.svelte.ts'),
  M('ProfilePreview.svelte', 'poly-preview-state.svelte.ts'),

  // Menus
  M('RepeatEditorPane.svelte', 'args.ts'),
  M('Popovers.svelte', 'popover-clamp.ts'),
  M('Popovers.svelte', 'args.ts'),
  M('graph-editor-bake.svelte.ts', 'graph-editor-bake.ts'),
  M('ge-assist.svelte.ts', 'ge-assist.ts'),
  M('AiMenu.svelte', 'popover-clamp.ts'),
  M('AiMenu.svelte', 'ge-assist.svelte.ts'),
  M('AutoWireSuggestPanel.svelte', 'popover-clamp.ts'),

  // Spline
  M('SplineEditorPopup.svelte', 'SplineScene.svelte', 'mounts'),
  M('SplineEditorPopup.svelte', 'popover-clamp.ts'),

  // Expr
  M('expr/ExpressionBuilderPopup.svelte', 'expr/ExpressionSrcPane.svelte', 'mounts'),
  M('expr/ExpressionBuilderPopup.svelte', 'expr/ExprImperativeBlocks.svelte', 'mounts'),
  M('expr/ExpressionBuilderPopup.svelte', 'popover-clamp.ts'),
  M('expr/ExprImperativeBlocks.svelte', 'expr/ExpressionSrcPane.svelte', 'mounts'),
];
