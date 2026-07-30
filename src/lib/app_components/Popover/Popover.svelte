<script lang="ts">
  // Popover — a BEHAVIOR component: nested in a parent, the harness (PanelNode) attaches it to
  // that parent and opens it (floating, anchored) on PARENT CLICK; it never renders inline. Here
  // it just styles + renders its own children — the popover CONTENT (which may include buttons /
  // components with event triggers). BUNDLE component. See src/lib/app_components/CLAUDE.md.
  import type { Panel } from '$lib/appkit/manifest/types';
  import type { Snippet } from 'svelte';
  let { panel, kids }: { panel: Panel; kids?: Snippet } = $props();
  const title = $derived(panel.props?.title as string | undefined);
</script>

<div class="pop">
  {#if title}<div class="pop-title">{title}</div>{/if}
  {#if kids}{@render kids()}{:else}<span class="pop-empty">empty popover — nest content inside</span>{/if}
</div>

<style>
  .pop { min-width: 160px; display: flex; flex-direction: column; gap: 6px; }
  .pop-title { font: 600 12px system-ui; color: var(--h-text, #0f172a); }
  .pop-empty { color: var(--h-muted, #94a3b8); font-style: italic; font-size: 12px; }
</style>
