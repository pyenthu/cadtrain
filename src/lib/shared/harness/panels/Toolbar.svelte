<script lang="ts">
  // Toolbar — a horizontal row that holds children (typically buttons). Renders the
  // kids snippet in a flex row. props.align: start | center | end | between.
  import type { Panel } from '$lib/appkit/manifest/types';
  import type { Snippet } from 'svelte';
  let { panel, kids }: { panel: Panel; kids?: Snippet } = $props();
  const justify = $derived(
    ({ start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between' }[
      (panel.props?.align as string) ?? 'start'
    ]) ?? 'flex-start',
  );
</script>

<div class="toolbar" style="justify-content:{justify}">
  {#if kids}{@render kids()}{:else}<span class="empty">empty toolbar — nest buttons inside</span>{/if}
</div>

<style>
  .toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .empty { color: var(--h-muted, #94a3b8); font-style: italic; font-size: 12px; }
</style>
