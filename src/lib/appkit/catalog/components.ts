// src/lib/appkit/catalog/components.ts — the COMPONENT catalog (headless metadata).
//
// Every component's metadata now lives in its BUNDLE (app_components/<Name>/meta.ts, exporting
// `metas: ComponentMeta[]`); this file just AGGREGATES them into COMPONENT_CATALOG. The types
// (ComponentMeta etc.) are defined here — bundle metas import them with `import type` (pure, no
// runtime cycle). This metadata feeds the studio search bar + the settings popover.
//
// Invariant (guarded by the test): every `kind` here is a real PanelKind (verbs/gui.ts).
import { metas as listMetas } from '$lib/app_components/List/meta';
import { metas as formMetas } from '$lib/app_components/Form/meta';
import { metas as dataGridMetas } from '$lib/app_components/DataGrid/meta';
import { metas as editTableMetas } from '$lib/app_components/EditableTable/meta';
import { metas as containerMetas } from '$lib/app_components/Container/meta';
import { metas as toolbarMetas } from '$lib/app_components/Toolbar/meta';
import { metas as tabsMetas } from '$lib/app_components/Tabs/meta';
import { metas as buttonMetas } from '$lib/app_components/Button/meta';
import { metas as textMetas } from '$lib/app_components/Text/meta';
import { metas as headingMetas } from '$lib/app_components/Heading/meta';
import { metas as dividerMetas } from '$lib/app_components/Divider/meta';
import { metas as bake3dMetas } from '$lib/app_components/Bake3d/meta';
import { metas as placeholderMetas } from '$lib/app_components/Placeholder/meta';
import { metas as fileMetas } from '$lib/app_components/File/meta';
import { metas as chatMetas } from '$lib/app_components/Chat/meta';
import { metas as sidebarMetas } from '$lib/app_components/Sidebar/meta';
import { metas as vtoolbarMetas } from '$lib/app_components/VerticalToolbar/meta';
import { metas as menuMetas } from '$lib/app_components/MenuButton/meta';
import { metas as popoverMetas } from '$lib/app_components/Popover/meta';
import { metas as tooltipMetas } from '$lib/app_components/Tooltip/meta';
import { metas as iconButtonMetas } from '$lib/app_components/IconButton/meta';
import { metas as ganttMetas } from '$lib/app_components/Gantt/meta';
import { metas as wellSchematicMetas } from '$lib/app_components/WellSchematic/meta';
import { metas as nodeTreeMetas } from '$lib/app_components/NodeTree/meta';
import { metas as statMetas } from '$lib/app_components/Stat/meta';
import { metas as statGridMetas } from '$lib/app_components/StatGrid/meta';
import { metas as chartMetas } from '$lib/app_components/Chart/meta';
import { metas as dataTableMetas } from '$lib/app_components/DataTable/meta';
import { metas as cad3dMetas } from '$lib/app_components/Cad3d/meta';

export interface PropSpec {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'color';
  label?: string;
  default?: unknown;
  /** For type:'select'. */
  options?: string[];
  /** Auto-promote this prop into `app.vars[panelId]` (promote-props.ts)? Default TRUE.
   *  The STYLE props opt OUT: they are presentation, not app state, and promoting ~9 of them on
   *  every panel of every app would bloat `vars` (and therefore the RAG grounding, which renders
   *  each panel's props) with noise the model must then read past. */
  promote?: boolean;
  /** Presentation-only: rendered as CSS by the harness rather than passed to the component.
   *  Grouped under the ⚙ Style tab instead of Props. */
  style?: boolean;
}

export type ComponentGroup = 'layout' | 'data' | 'input' | 'display' | '3d' | 'ai';

/** How a component gets its data when the app is SERVER-rendered (app-server-render.md):
 *  - 'static' — no data source; pure structure → HTML.
 *  - 'server' — the server resolves the panel's source up-front and bakes data into the HTML.
 *  - 'client' — a thin island that fetches onMount (needs the browser). */
export type DataMode = 'static' | 'server' | 'client';

/** WHERE a component's heavy geometry compute (the CAD engine bake) runs — a sibling knob to
 *  `dataMode` (app-server-render.md §computeMode). Only compute-heavy components (cad3d) set it.
 *  - 'server' (default) — the engine + the part's source stay SERVER-side; the client fetches
 *    only the baked mesh (via /api/app/cad-bake). Protected: no engine/source ships. Costs server CPU.
 *  - 'client' — runs the WASM engine in the BROWSER (worker-bake) to offload the server / go
 *    offline. Tradeoff: ships the engine + that part's compiled script (geometry logic exposed).
 *    FUTURE — not implemented in v0. */
export type ComputeMode = 'server' | 'client';

export interface ComponentMeta {
  /** The PanelKind (matches the render registry + PANEL_KINDS). */
  kind: string;
  name: string;
  description: string;
  group: ComponentGroup;
  tags: string[];
  /** How this component's data is resolved under server-render (default 'static'). */
  dataMode?: DataMode;
  /** WHERE this component's heavy geometry compute runs (default 'server' when unset for the
   *  compute-heavy kinds). server = fetch baked geometry, engine stays server-side; client =
   *  worker-bake, ships the engine (future). See ComputeMode. */
  computeMode?: ComputeMode;
  /** Container/card hold nested children. */
  acceptsChildren?: boolean;
  /** Typed props surfaced in the per-component editor. */
  props?: PropSpec[];
  /** Verb groups this component's source/actions can bind to (the wiring picker). */
  wiresTo?: Array<'data' | 'mutate'>;
  /** One crisp sentence: WHEN to reach for this component vs its alternatives. Feeds the AI
   *  component-knowledge card so a (esp. LOCAL) model picks the RIGHT kind — not generic text/list. */
  useWhen?: string;
  /** A concrete panel object exactly as it'd appear in the .app tree (id, kind, realistic
   *  props/source/on). Shown verbatim in the card so the model calls the component correctly. */
  example?: Record<string, unknown>;
}

// ── Shared STYLE props — every component gets these ───────────────────────────
// `props.class` / `props.style` were ALREADY honoured by HarnessView, but no component declared
// them, so they were invisible to the ⚙ editor, the AI tool schema, API.md and the RAG dictionary
// — an escape hatch nobody could discover. These declare the common ones properly, once, for all
// kinds (merged in COMPONENT_CATALOG below) rather than editing 29 meta.ts files.
//
// All are `promote: false` (presentation, not app state — see PropSpec.promote) and
// `style: true` (the harness turns them into CSS; they are never passed to the component).
// `css` is the escape hatch: any declarations at all, appended last so it can override.
export const STYLE_PROPS: PropSpec[] = [
  { name: 'width', type: 'string', label: 'Width', promote: false, style: true },
  { name: 'height', type: 'string', label: 'Height', promote: false, style: true },
  { name: 'background', type: 'color', label: 'Background', promote: false, style: true },
  { name: 'color', type: 'color', label: 'Text colour', promote: false, style: true },
  { name: 'padding', type: 'string', label: 'Padding', promote: false, style: true },
  { name: 'radius', type: 'string', label: 'Corner radius', promote: false, style: true },
  { name: 'border', type: 'string', label: 'Border', promote: false, style: true },
  { name: 'align', type: 'select', label: 'Text align', options: ['', 'left', 'center', 'right'], promote: false, style: true },
  { name: 'class', type: 'string', label: 'CSS class', promote: false, style: true },
  { name: 'css', type: 'string', label: 'Custom CSS', promote: false, style: true },
];

const STYLE_PROP_NAMES = new Set(STYLE_PROPS.map((p) => p.name));

/** Is this prop name one of the shared style props (not a component-specific prop)? */
export function isStyleProp(name: string): boolean {
  return STYLE_PROP_NAMES.has(name);
}

/** A bare number means px; anything else (%, rem, calc(…), 100vh) passes through verbatim. */
function len(v: unknown): string {
  const s = String(v).trim();
  return s !== '' && Number.isFinite(Number(s)) ? `${s}px` : s;
}

/** Build the inline CSS for a panel's shared style props. Pure + SSR-safe, so the server-render
 *  path and the client harness produce byte-identical output (no hydration mismatch).
 *  `css` is appended LAST so a hand-written declaration always wins over the typed props. */
export function styleFromProps(props: Record<string, unknown> | undefined): string {
  if (!props) return '';
  const out: string[] = [];
  const put = (decl: string, v: unknown) => {
    if (v === undefined || v === null || String(v).trim() === '') return;
    out.push(`${decl}:${decl === 'width' || decl === 'height' || decl === 'padding' || decl === 'border-radius' ? len(v) : String(v).trim()}`);
  };
  put('width', props.width);
  put('height', props.height);
  put('background', props.background);
  put('color', props.color);
  put('padding', props.padding);
  put('border-radius', props.radius);
  put('border', props.border);
  put('text-align', props.align);
  // Escape hatch, last → highest priority. Tolerates a trailing ';' or none.
  const css = props.css ?? props.style; // `style` kept as a back-compat alias (pre-existing apps)
  if (css !== undefined && String(css).trim() !== '') out.push(String(css).trim().replace(/;\s*$/, ''));
  return out.join(';');
}

/** Does this panel carry ANY shared style prop? Used to skip the wrapper entirely when it
 *  doesn't — an unstyled panel must render exactly as it did before this feature existed. */
export function hasStyleProps(props: Record<string, unknown> | undefined): boolean {
  if (!props) return false;
  return STYLE_PROPS.some((s) => {
    const v = props[s.name];
    return v !== undefined && v !== null && String(v).trim() !== '';
  }) || (props.style !== undefined && String(props.style).trim() !== '');
}

/** Aggregated from the bundle metas — data · layout · input · display · ai. */
const RAW_CATALOG: ComponentMeta[] = [
  ...listMetas,
  ...formMetas,
  ...dataGridMetas,
  ...editTableMetas,
  ...containerMetas,
  ...toolbarMetas,
  ...vtoolbarMetas,
  ...sidebarMetas,
  ...tabsMetas,
  ...buttonMetas,
  ...iconButtonMetas,
  ...menuMetas,
  ...textMetas,
  ...headingMetas,
  ...dividerMetas,
  ...popoverMetas,
  ...tooltipMetas,
  ...ganttMetas,
  ...wellSchematicMetas,
  ...nodeTreeMetas,
  ...chartMetas,
  ...statMetas,
  ...statGridMetas,
  ...dataTableMetas,
  ...cad3dMetas,
  ...bake3dMetas,
  ...placeholderMetas,
  ...fileMetas,
  ...chatMetas,
];

/** Every component gains the shared STYLE props (width/height/background/… + the `css` escape
 *  hatch) — declared ONCE here rather than repeated across 29 meta.ts files. A component that
 *  declares its own prop of the same name WINS (its spec is kept, the shared one dropped), so a
 *  kind with e.g. a bespoke `height` semantic is never clobbered. */
export const COMPONENT_CATALOG: ComponentMeta[] = RAW_CATALOG.map((m) => {
  const own = new Set((m.props ?? []).map((p) => p.name));
  return { ...m, props: [...(m.props ?? []), ...STYLE_PROPS.filter((s) => !own.has(s.name))] };
});

export function getComponentMeta(kind: string): ComponentMeta | undefined {
  return COMPONENT_CATALOG.find((c) => c.kind === kind);
}

