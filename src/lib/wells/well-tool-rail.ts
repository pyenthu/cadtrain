/**
 * well-tool-rail.ts — PURE descriptor data + types for `WellToolRail.svelte`.
 *
 * The tool rail's add-element buttons are DERIVED from the wells registry
 * (`registry.ts`) so they always cover the real `bw_*` (structural well body)
 * and `g_*` (completion catalogue) parts:
 *   - STRUCTURAL_ITEMS  ← `WellElementKind`  (open-hole / casing / cement / tubing)
 *   - COMPLETION_ITEMS  ← `WellCompCategory` (packer / nipple / valve / … ) minus
 *     the structural `tubing` + the `generic` fallback, coloured by `CATEGORY_COLOR`
 *   - PERFORATION_ITEM  ← the perforation interval (not a registry category)
 *
 * Keeping the descriptors here (no DOM / Svelte / Manifold) makes them unit
 * testable and keeps the `.svelte` component thin. The `well-tool-rail.test.ts`
 * guard fails if a new `WellCompCategory` lands in the registry without a rail
 * button — so the rail can't silently fall out of sync with the part library.
 */
import { CATEGORY_COLOR, type WellCompCategory, type WellElementKind } from './registry';

/** Structural well-body element kinds (resolve to `bw_*` parts). */
export type StructuralType = WellElementKind;
/** Completion catalogue categories the rail can add (resolve to `g_*` parts).
 *  Excludes the structural `tubing` (added via the structural group) and the
 *  `generic` tube fallback (not a user-chosen element). */
export type CompletionType = Exclude<WellCompCategory, 'tubing' | 'generic'>;
/** Every element the rail can add to a well. */
export type WellElementType = StructuralType | CompletionType | 'perforation';

/** A placement/selection tool (sets `activeTool`, no geometry). */
export type WellToolName = 'select' | 'measure';
/** The rendered surface (mirrors `WellViewSettings.viewMode`). */
export type WellViewMode = '2d' | '3d';
/** Camera framing presets for the 3D view. */
export type WellCameraPreset = 'iso' | 'front' | 'top';
/** File / export actions (SVTC `WsonToolbar` parity). */
export type WellFileAction = 'new' | 'open' | 'save' | 'export-png' | 'export-glb' | 'export-svg';

/** One add-element button descriptor. `icon` = an inline 16×16 stroke path. */
export interface RailItem {
  type: WellElementType;
  label: string;
  tip: string;
  icon: string;
  /** Dot / accent colour (structural fixed here; completions via CATEGORY_COLOR). */
  color: string;
  group: 'structural' | 'completion' | 'perforation';
}

// ── Structural well body (bw_* parts) ────────────────────────────────────────
// Colours mirror the existing WellElementRail dots so the two rails read alike.
export const STRUCTURAL_ITEMS: RailItem[] = [
  { type: 'openhole', label: 'Open hole', tip: 'Open-hole section', group: 'structural',
    color: '#c084fc', icon: 'M5 2v12M11 2v12' },
  { type: 'casing', label: 'Casing', tip: 'Casing / liner string', group: 'structural',
    color: '#94a3b8', icon: 'M5 2v12M11 2v12M5 2h6M5 14h6' },
  { type: 'cement', label: 'Cement', tip: 'Cement sheath', group: 'structural',
    color: '#d6c7a1', icon: 'M4 3h8v10H4zM4 6h8M4 9h8' },
  { type: 'tubing', label: 'Tubing', tip: 'Production tubing', group: 'structural',
    color: '#eab308', icon: 'M6.5 2v12M9.5 2v12' },
];

/** Completion categories in rail order, with labels + icons. Colour comes from
 *  the registry's `CATEGORY_COLOR` so it can't drift from the 3D scene tint. */
const COMPLETION_DEFS: { type: CompletionType; label: string; tip: string; icon: string }[] = [
  { type: 'packer', label: 'Packer', tip: 'Packer (sets / isolates)',
    icon: 'M6 2v12M10 2v12M3 6.5h3M3 9.5h3M10 6.5h3M10 9.5h3' },
  { type: 'nipple', label: 'Nipple', tip: 'Landing nipple',
    icon: 'M6 2v12M10 2v12M6 6h4M6 10h4' },
  { type: 'valve', label: 'Valve', tip: 'Safety valve (TRSSV)',
    icon: 'M8 2v3M8 11v3M3.5 8a4.5 4.5 0 0 1 9 0a4.5 4.5 0 0 1-9 0' },
  { type: 'ssd', label: 'Sliding sleeve', tip: 'Sliding sleeve door (SSD)',
    icon: 'M6 2v12M10 2v12M6 5h4M6 8h4M6 11h4' },
  { type: 'mandrel', label: 'Mandrel', tip: 'Gas-lift / side-pocket mandrel',
    icon: 'M6 2v12M10 2v12M6 6q2 2 4 0M6 10q2 2 4 0' },
  { type: 'shoe', label: 'Shoe', tip: 'Mule shoe / bell guide',
    icon: 'M6 2v8l-2 4M10 2v8l2 4' },
  { type: 'hanger', label: 'Hanger', tip: 'Tubing hanger',
    icon: 'M3 4h10M6 4v10M10 4v10M4 8h8' },
  { type: 'plug', label: 'Plug', tip: 'Plug / bridge plug',
    icon: 'M4 6h8v4H4zM6 6V4M10 6V4' },
  { type: 'crossover', label: 'Crossover', tip: 'Crossover / joint',
    icon: 'M5 2v5l6 2v5M11 2v5L5 9v5' },
  { type: 'drillpipe', label: 'Drill pipe', tip: 'Drill-pipe joint / stand',
    icon: 'M6.5 2v12M9.5 2v12M5 5h6M5 11h6' },
];

export const COMPLETION_ITEMS: RailItem[] = COMPLETION_DEFS.map((d) => ({
  ...d,
  color: CATEGORY_COLOR[d.type],
  group: 'completion' as const,
}));

export const PERFORATION_ITEM: RailItem = {
  type: 'perforation', label: 'Perforation', tip: 'Perforation interval', group: 'perforation',
  color: '#ef4444', icon: 'M6 2v12M10 2v12M3 5h3M3 8h3M3 11h3M10 5h3M10 8h3M10 11h3',
};

/** Every add-element descriptor, in rail order. */
export const ADD_ITEMS: RailItem[] = [...STRUCTURAL_ITEMS, ...COMPLETION_ITEMS, PERFORATION_ITEM];

/** Placement/selection tools (the pointer group). */
export const TOOL_ITEMS: { id: WellToolName; label: string; tip: string; icon: string }[] = [
  { id: 'select', label: 'Select', tip: 'Select / move (V)', icon: 'M3 2l10 5-4 1.6L7.7 13z' },
  { id: 'measure', label: 'Measure', tip: 'Measure depth (MD)', icon: 'M3 3v10h2M3 5h2M3 7h3M3 9h2M3 11h2' },
];

/** Camera framing presets. */
export const CAMERA_ITEMS: { id: WellCameraPreset; label: string; tip: string; icon: string }[] = [
  { id: 'iso', label: '3D', tip: '3D isometric view', icon: 'M8 2l5 3v6l-5 3-5-3V5zM8 2v12M3 5l5 3 5-3' },
  { id: 'front', label: 'Front', tip: 'Front elevation', icon: 'M3 2h10v12H3zM3 6h10' },
  { id: 'top', label: 'Plan', tip: 'Plan (top-down)', icon: 'M8 8m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0M8 3v10M3 8h10' },
];

/** File / export actions (SVTC WsonToolbar parity). */
export const FILE_ITEMS: { id: WellFileAction; label: string; tip: string; icon: string }[] = [
  { id: 'new', label: 'New', tip: 'New .wson', icon: 'M4 2h5l3 3v9H4zM9 2v3h3' },
  { id: 'open', label: 'Open', tip: 'Open folder / files', icon: 'M2 4h4l1 2h7v7H2zM2 6h12' },
  { id: 'save', label: 'Save', tip: 'Save .wson', icon: 'M3 2h8l2 2v10H3zM5 2v4h6V2M5 10h6' },
  { id: 'export-png', label: 'Export', tip: 'Export (PNG / GLB / SVG)', icon: 'M8 2v8M5 7l3 3 3-3M2 13h12' },
];
