<script lang="ts">
  // VerticalToolbar — a vertical rail that holds children (typically icon buttons), docked
  // to the left like the /app_design studio rail. Renders the kids snippet in a flex column.
  // props.align: start | center | end | between (controls vertical justify-content).
  //
  // The VERTICAL sibling of Toolbar. BUNDLE component (app_components/VerticalToolbar/) —
  // render + meta.ts co-located. See src/lib/app_components/CLAUDE.md.
  import type { Panel } from '$lib/appkit/manifest/types';
  import type { Snippet } from 'svelte';
  let { panel, kids }: { panel: Panel; kids?: Snippet } = $props();
  const justify = $derived(
    ({ start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between' }[
      (panel.props?.align as string) ?? 'start'
    ]) ?? 'flex-start',
  );
</script>

<div class="vtoolbar" style="justify-content:{justify}">
  {#if kids}{@render kids()}{:else}<span class="empty">empty toolbar — nest buttons inside</span>{/if}
</div>

<style>
  .vtoolbar {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    height: 100%;
    padding: 8px;
    border-right: 1px solid var(--h-border, #e2e8f0);
    background: var(--h-surface, #fff);
  }
  .empty { color: var(--h-muted, #94a3b8); font-style: italic; font-size: 12px; }
</style>
