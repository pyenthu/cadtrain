<script lang="ts">
  // StatGrid — a responsive auto-flow grid that HOLDS children (nesting), laying each child
  // out as an equal tile. Renders the `kids` snippet from PanelNode (like Container), but into
  // a CSS grid. By default columns auto-fill at `minTileWidth`; set `columns` for a fixed count.
  //
  // BUNDLE component (app_components/StatGrid/) — render + meta.ts co-located. See
  // src/lib/app_components/CLAUDE.md.
  import type { Panel } from '$lib/appkit/manifest/types';
  import type { Snippet } from 'svelte';
  let { panel, kids }: { panel: Panel; kids?: Snippet } = $props();

  const p = $derived((panel.props ?? {}) as Record<string, unknown>);
  const minTileWidth = $derived(Math.max(1, Number(p.minTileWidth ?? 200)));
  const columns = $derived(p.columns != null && Number(p.columns) > 0 ? Math.floor(Number(p.columns)) : 0);
  const gap = $derived(Math.max(0, Number(p.gap ?? 12)));
  const templateColumns = $derived(
    columns > 0 ? `repeat(${columns}, 1fr)` : `repeat(auto-fill, minmax(${minTileWidth}px, 1fr))`,
  );
</script>

<div class="statgrid" style="grid-template-columns:{templateColumns}; gap:{gap}px">
  {#if kids}{@render kids()}{:else}<div class="empty">empty stat grid — nest stat / chart / card tiles inside</div>{/if}
</div>

<style>
  .statgrid { display: grid; width: 100%; }
  .empty {
    grid-column: 1 / -1;
    color: var(--h-muted, #94a3b8);
    font-style: italic;
    font-size: 12px;
    border: 1px dashed var(--h-border, #e5e7eb);
    border-radius: 8px;
    padding: 12px;
    text-align: center;
  }
</style>
