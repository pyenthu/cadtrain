<script lang="ts">
  // Container / Card — a component that HOLDS children (nesting). Renders the `kids`
  // snippet from PanelNode. `card` gets a bordered surface; plain container is transparent.
  import type { Panel } from '$lib/appkit/manifest/types';
  import type { Snippet } from 'svelte';
  let { panel, kids }: { panel: Panel; kids?: Snippet } = $props();
  const card = $derived(panel.kind === 'card');
</script>

<div class="container" class:card>
  {#if kids}{@render kids()}{:else}<div class="empty">empty {panel.kind} — nest components inside</div>{/if}
</div>

<style>
  .container { display: flex; flex-direction: column; gap: 8px; height: 100%; }
  .container.card { border: 1px solid var(--h-border, #e5e7eb); border-radius: 8px; padding: 10px; background: var(--h-surface, #fff); }
  .empty { color: var(--h-muted, #94a3b8); font-style: italic; font-size: 12px; }
</style>
