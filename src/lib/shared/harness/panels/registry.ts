// PanelKind registry (Layer 4) — kind → Svelte component. Adding a new kind is a
// code change here (the AI can only COMPOSE existing kinds — the D1/D5 boundary).
import type { Component } from 'svelte';
import ListPanel from './ListPanel.svelte';
import FormPanel from './FormPanel.svelte';
import TextPanel from './TextPanel.svelte';
import PlaceholderPanel from './PlaceholderPanel.svelte';
import ChatPanel from './ChatPanel.svelte';
import Bake3dPanel from './Bake3dPanel.svelte';

export const PANEL_COMPONENTS: Record<string, Component<any>> = {
  list: ListPanel,
  form: FormPanel,
  table: FormPanel, // a table panel is a form with a single table control
  text: TextPanel,
  chat: ChatPanel, // the AI-build surface
  bake3d: Bake3dPanel, // bakes the active doc → stats (interactive canvas = follow-up)
  svg: PlaceholderPanel,
};

export function panelComponent(kind: string): Component<any> {
  return PANEL_COMPONENTS[kind] ?? PlaceholderPanel;
}
