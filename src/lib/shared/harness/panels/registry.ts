// PanelKind registry (Layer 4) — kind → Svelte component. Every render now lives in a
// BUNDLE (src/lib/app_components/<Name>/<Name>.svelte, co-located with its meta.ts). Adding a
// new kind = drop a bundle + add a line here + a PANEL_KIND (verbs/gui.ts). See
// src/lib/app_components/CLAUDE.md.
import type { Component } from 'svelte';
import List from '$lib/app_components/List/List.svelte';
import Form from '$lib/app_components/Form/Form.svelte';
import DataGrid from '$lib/app_components/DataGrid/DataGrid.svelte';
import EditableTable from '$lib/app_components/EditableTable/EditableTable.svelte';
import Text from '$lib/app_components/Text/Text.svelte';
import Heading from '$lib/app_components/Heading/Heading.svelte';
import Divider from '$lib/app_components/Divider/Divider.svelte';
import Button from '$lib/app_components/Button/Button.svelte';
import Container from '$lib/app_components/Container/Container.svelte';
import Toolbar from '$lib/app_components/Toolbar/Toolbar.svelte';
import Tabs from '$lib/app_components/Tabs/Tabs.svelte';
import File from '$lib/app_components/File/File.svelte';
import Chat from '$lib/app_components/Chat/Chat.svelte';
import Bake3d from '$lib/app_components/Bake3d/Bake3d.svelte';
import Placeholder from '$lib/app_components/Placeholder/Placeholder.svelte';
import Sidebar from '$lib/app_components/Sidebar/Sidebar.svelte';
import VerticalToolbar from '$lib/app_components/VerticalToolbar/VerticalToolbar.svelte';
import MenuButton from '$lib/app_components/MenuButton/MenuButton.svelte';
import Popover from '$lib/app_components/Popover/Popover.svelte';
import Tooltip from '$lib/app_components/Tooltip/Tooltip.svelte';
import IconButton from '$lib/app_components/IconButton/IconButton.svelte';
import Gantt from '$lib/app_components/Gantt/Gantt.svelte';
import WellSchematic from '$lib/app_components/WellSchematic/WellSchematic.svelte';
import NodeTree from '$lib/app_components/NodeTree/NodeTree.svelte';
import Stat from '$lib/app_components/Stat/Stat.svelte';
import StatGrid from '$lib/app_components/StatGrid/StatGrid.svelte';
import Chart from '$lib/app_components/Chart/Chart.svelte';
import DataTable from '$lib/app_components/DataTable/DataTable.svelte';
import Cad3d from '$lib/app_components/Cad3d/Cad3d.svelte';

export const PANEL_COMPONENTS: Record<string, Component<any>> = {
  list: List,
  form: Form,
  table: Form, // an editable list<record> table (a form with a table control)
  grid: DataGrid, // a read-only data GRID from any source (http/data verb)
  datatable: DataTable, // read-only grid + client sort/search/paging/totals (superset of grid)
  edittable: EditableTable, // editable rows in LOCAL state; on.save persists
  text: Text,
  heading: Heading, // h1/h2/h3
  divider: Divider, // <hr>/labeled rule
  chat: Chat, // the AI-build surface
  bake3d: Bake3d, // bakes the active doc → stats
  svg: Placeholder,
  container: Container, // holds children (nesting) — transparent wrapper
  card: Container, // holds children — bordered surface
  div: Container, // generic block container (HTML-style)
  col: Container, // vertical stack of children
  button: Button, // fires on.click (a verb binding or a sequence)
  tabs: Tabs, // tabbed container — children are tabs
  toolbar: Toolbar, // horizontal row of children (buttons)
  row: Toolbar, // horizontal row of children
  file: File, // open/save a DATA file into a slot (§0.5 data model)
  sidebar: Sidebar, // collapsible side panel holding children
  vtoolbar: VerticalToolbar, // vertical icon rail (left dock)
  menu: MenuButton, // button → dropdown menu (children = items)
  popover: Popover, // behavior child — attaches to parent, opens on parent click (PanelNode)
  tooltip: Tooltip, // behavior child — attaches to parent, shows on hover (PanelNode)
  iconbutton: IconButton, // button with a searchable icon + label
  gantt: Gantt, // roadmap timeline — task bars by start/end, coloured by status, lane swimlanes
  wellschematic: WellSchematic, // SVG well cross-section — casing/tubing/perfs from seeded vars
  nodetree: NodeTree, // SSR-safe SVG architecture graph — nodes+edges laid L→R by depth
  stat: Stat, // KPI stat tile — big number + label + optional delta/sparkline
  statgrid: StatGrid, // responsive auto-flow grid of tiles (holds children)
  chart: Chart, // SSR-safe SVG data chart — bar/line/area/pie/donut from a seeded var
  cad3d: Cad3d, // interactive 3D CAD viewer — client island; server-baked mesh (computeMode:server)
};

export function panelComponent(kind: string): Component<any> {
  return PANEL_COMPONENTS[kind] ?? Placeholder;
}
