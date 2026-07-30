// Per-component EDITOR registry — kind → an optional <Name>Editor.svelte from the bundle.
// The tree settings popover renders the custom editor when present; otherwise it falls back to
// the generic props form (driven by meta.props). See src/lib/app_components/CLAUDE.md.
import type { Component } from 'svelte';
import EditableTableEditor from '$lib/app_components/EditableTable/EditableTableEditor.svelte';

export const PANEL_EDITORS: Record<string, Component<any>> = {
  edittable: EditableTableEditor,
};

/** The custom editor for a kind, or undefined → use the generic props form. */
export function panelEditor(kind: string): Component<any> | undefined {
  return PANEL_EDITORS[kind];
}
