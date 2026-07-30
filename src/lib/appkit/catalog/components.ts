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

/** Aggregated from the bundle metas — data · layout · input · display · ai. */
export const COMPONENT_CATALOG: ComponentMeta[] = [
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
  ...menuMetas,
  ...textMetas,
  ...headingMetas,
  ...dividerMetas,
  ...bake3dMetas,
  ...placeholderMetas,
  ...fileMetas,
  ...chatMetas,
];

export function getComponentMeta(kind: string): ComponentMeta | undefined {
  return COMPONENT_CATALOG.find((c) => c.kind === kind);
}
