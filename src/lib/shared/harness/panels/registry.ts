// PanelKind registry (Layer 4) — kind → Svelte component. Adding a new kind is a
// code change here (the AI can only COMPOSE existing kinds — the D1/D5 boundary).
import type { Component } from 'svelte';
import ListPanel from './ListPanel.svelte';
import FormPanel from './FormPanel.svelte';
import TextPanel from './TextPanel.svelte';
import PlaceholderPanel from './PlaceholderPanel.svelte';
import ChatPanel from './ChatPanel.svelte';
import Bake3dPanel from './Bake3dPanel.svelte';
import Container from './Container.svelte';
import Button from './Button.svelte';
import Tabs from './Tabs.svelte';
import Toolbar from './Toolbar.svelte';
import Table from './Table.svelte';
import File from './File.svelte';

export const PANEL_COMPONENTS: Record<string, Component<any>> = {
  list: ListPanel,
  form: FormPanel,
  table: FormPanel, // an editable list<record> table (a form with a table control)
  grid: Table, // a read-only data GRID from any source (http/data verb)
  text: TextPanel,
  chat: ChatPanel, // the AI-build surface
  bake3d: Bake3dPanel, // bakes the active doc → stats (interactive canvas = follow-up)
  svg: PlaceholderPanel,
  container: Container, // holds children (nesting) — transparent wrapper
  card: Container, // holds children — bordered surface
  button: Button, // fires on.click (a verb binding or a sequence)
  tabs: Tabs, // tabbed container — children are tabs
  toolbar: Toolbar, // horizontal row of children (buttons)
  file: File, // open/save a DATA file into a slot (§0.5 data model)
};

export function panelComponent(kind: string): Component<any> {
  return PANEL_COMPONENTS[kind] ?? PlaceholderPanel;
}
