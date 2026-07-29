// PanelKind registry (Layer 4) — kind → Svelte component. Adding a new kind is a
// code change here (the AI can only COMPOSE existing kinds — the D1/D5 boundary).
import type { Component } from 'svelte';
import ListPanel from './ListPanel.svelte';
import FormPanel from './FormPanel.svelte';
import TextPanel from './TextPanel.svelte';
import PlaceholderPanel from './PlaceholderPanel.svelte';

export const PANEL_COMPONENTS: Record<string, Component<any>> = {
  list: ListPanel,
  form: FormPanel,
  table: FormPanel, // a table panel is a form with a single table control
  text: TextPanel,
  bake3d: PlaceholderPanel, // rung 3: mount the 3D bake
  svg: PlaceholderPanel,
  chat: PlaceholderPanel,
};

export function panelComponent(kind: string): Component<any> {
  return PANEL_COMPONENTS[kind] ?? PlaceholderPanel;
}
