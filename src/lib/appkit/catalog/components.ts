// src/lib/appkit/catalog/components.ts — the COMPONENT catalog (headless metadata).
//
// Each entry describes ONE PanelKind: its display name, search tags, typed props, whether
// it accepts children, and which verb groups it wires to. This metadata is what the studio
// search bar (Increment 8) and the per-component editors (Increment 9) read — the RENDER
// components stay in src/lib/shared/harness/panels/ (UI), this is the pure catalog side.
//
// Invariant (guarded by the test): every `kind` here is a real PanelKind (verbs/gui.ts).

export interface PropSpec {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'color';
  label?: string;
  default?: unknown;
  /** For type:'select'. */
  options?: string[];
}

export type ComponentGroup = 'layout' | 'data' | 'input' | 'display' | '3d' | 'ai';

/** How a component gets its data when the app is SERVER-rendered (app-server-render.md):
 *  - 'static' — no data source; pure structure → HTML.
 *  - 'server' — the server resolves the panel's source up-front and bakes data into the HTML.
 *  - 'client' — a thin island that fetches onMount (needs the browser). */
export type DataMode = 'static' | 'server' | 'client';

export interface ComponentMeta {
  /** The PanelKind (matches the render registry + PANEL_KINDS). */
  kind: string;
  name: string;
  description: string;
  group: ComponentGroup;
  tags: string[];
  /** How this component's data is resolved under server-render (default 'static'). */
  dataMode?: DataMode;
  /** Container/card hold nested children. */
  acceptsChildren?: boolean;
  /** Typed props surfaced in the per-component editor. */
  props?: PropSpec[];
  /** Verb groups this component's source/actions can bind to (the wiring picker). */
  wiresTo?: Array<'data' | 'mutate'>;
}

export const COMPONENT_CATALOG: ComponentMeta[] = [
  {
    kind: 'list',
    name: 'List',
    description: 'A selectable list of documents/rows. Bind source to a data verb; click selects.',
    dataMode: 'server',
    group: 'data',
    tags: ['list', 'menu', 'select', 'docs', 'rows', 'items'],
    wiresTo: ['data'],
  },
  {
    kind: 'form',
    name: 'Form',
    description: "A document's params as editable fields + tables (list<record> controls).",
    dataMode: 'server',
    group: 'data',
    tags: ['form', 'params', 'fields', 'edit', 'inputs'],
    wiresTo: ['data', 'mutate'],
  },
  {
    kind: 'table',
    name: 'Table',
    description: 'Tabular rows of a list<record> param with columns; add/edit rows.',
    dataMode: 'server',
    group: 'data',
    tags: ['table', 'grid', 'rows', 'columns', 'spreadsheet', 'records'],
    wiresTo: ['data', 'mutate'],
  },
  {
    kind: 'grid',
    name: 'Data Grid',
    description: 'A read-only data table from any source (http / data verb). Columns from props.columns or inferred.',
    dataMode: 'server',
    group: 'data',
    tags: ['grid', 'table', 'data', 'rows', 'columns', 'results', 'json'],
    props: [{ name: 'columns', type: 'string', label: 'Columns (comma-sep)' }],
    wiresTo: ['data'],
  },
  {
    kind: 'edittable',
    name: 'Editable Table',
    description: 'Rows editable in LOCAL client state (add/edit/delete instant, no round-trip); on.save persists to the server. Seeded from source (SSR).',
    dataMode: 'server',
    group: 'data',
    tags: ['edit', 'table', 'rows', 'form', 'input', 'crud', 'spreadsheet', 'local'],
    props: [
      { name: 'columns', type: 'string', label: 'Columns (comma-sep)' },
      { name: 'addLabel', type: 'string', label: 'Add-row label', default: '+ Add row' },
    ],
    wiresTo: ['data', 'mutate'],
  },
  {
    kind: 'tabs',
    name: 'Tabs',
    description: 'A tabbed container — each child is a tab (label from its title or props.labels).',
    group: 'layout',
    tags: ['tabs', 'tabbed', 'sections', 'pages', 'nest'],
    acceptsChildren: true,
    props: [{ name: 'labels', type: 'string', label: 'Tab labels (comma-sep)' }],
  },
  {
    kind: 'toolbar',
    name: 'Toolbar',
    description: 'A horizontal row that holds children (buttons). props.align: start|center|end|between.',
    group: 'layout',
    tags: ['toolbar', 'row', 'buttons', 'actions', 'bar', 'nest'],
    acceptsChildren: true,
    props: [{ name: 'align', type: 'select', label: 'Align', options: ['start', 'center', 'end', 'between'], default: 'start' }],
  },
  {
    kind: 'bake3d',
    name: '3D Bake',
    description: 'Bakes the active doc through the engine → geometry stats (verts/tris).',
    dataMode: 'server',
    group: '3d',
    tags: ['3d', 'bake', 'geometry', 'render', 'manifold', 'mesh'],
    wiresTo: ['data'],
  },
  {
    kind: 'svg',
    name: 'SVG',
    description: 'A 2D SVG view of a doc (placeholder until wired).',
    dataMode: 'server',
    group: 'display',
    tags: ['svg', '2d', 'diagram', 'vector'],
    wiresTo: ['data'],
  },
  {
    kind: 'text',
    name: 'Text',
    description: 'A text label. Props text/size/weight/align/color; text can be a $vars/$params ref.',
    group: 'display',
    tags: ['text', 'label', 'heading', 'paragraph', 'caption', 'stat'],
    props: [
      { name: 'text', type: 'string', label: 'Text', default: 'Text' },
      { name: 'size', type: 'select', label: 'Size', options: ['xs', 'sm', 'md', 'lg', 'xl', '2xl'], default: 'md' },
      { name: 'weight', type: 'select', label: 'Weight', options: ['400', '600', '700'], default: '400' },
      { name: 'align', type: 'select', label: 'Align', options: ['left', 'center', 'right'], default: 'left' },
      { name: 'color', type: 'color', label: 'Color' },
      { name: 'muted', type: 'boolean', label: 'Muted' },
    ],
  },
  {
    kind: 'button',
    name: 'Button',
    description: 'A button that fires on.click (a verb binding or a sequence). Props label/variant.',
    group: 'input',
    tags: ['button', 'action', 'click', 'submit', 'trigger'],
    props: [
      { name: 'label', type: 'string', label: 'Label', default: 'Button' },
      { name: 'variant', type: 'select', label: 'Variant', options: ['solid', 'ghost'], default: 'solid' },
    ],
    wiresTo: ['data', 'mutate'],
  },
  {
    kind: 'container',
    name: 'Container',
    description: 'A transparent wrapper that holds nested children (layout/grouping).',
    group: 'layout',
    tags: ['container', 'group', 'stack', 'wrapper', 'layout', 'nest'],
    acceptsChildren: true,
  },
  {
    kind: 'card',
    name: 'Card',
    description: 'A bordered surface that holds nested children (a titled group).',
    group: 'layout',
    tags: ['card', 'panel', 'box', 'surface', 'group', 'nest'],
    acceptsChildren: true,
  },
  {
    kind: 'file',
    name: 'File',
    description: 'Open / Save / Save As a DATA file into a slot (§0.5). Components read it via loadData.',
    dataMode: 'client',
    group: 'data',
    tags: ['file', 'open', 'save', 'load', 'data', 'slot', 'import', 'picker'],
    props: [
      { name: 'slot', type: 'string', label: 'Slot', default: 'data' },
      { name: 'label', type: 'string', label: 'Label' },
      { name: 'type', type: 'string', label: 'File type hint (.wson,.json)' },
    ],
  },
  {
    kind: 'chat',
    name: 'AI Chat',
    description: 'The AI-build surface — a prompt box that edits the app.',
    dataMode: 'client',
    group: 'ai',
    tags: ['chat', 'ai', 'prompt', 'assistant', 'build'],
  },
];

export function getComponentMeta(kind: string): ComponentMeta | undefined {
  return COMPONENT_CATALOG.find((c) => c.kind === kind);
}
