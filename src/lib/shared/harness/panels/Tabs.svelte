<script lang="ts">
  // Tabs — a tabbed container. Each child is a tab; the tab label is the child's title
  // (or props.labels[i]). Renders only the ACTIVE child via renderChild (from PanelNode).
  import type { Panel } from '$lib/appkit/manifest/types';
  import type { Snippet } from 'svelte';
  let {
    panel,
    renderChild,
  }: { panel: Panel; renderChild?: Snippet<[Panel]> } = $props();
  const children = $derived((panel.children ?? []) as Panel[]);
  const labels = $derived(((panel.props?.labels as string[]) ?? []) as string[]);
  let active = $state(0);
  const label = (c: Panel, i: number) => labels[i] ?? c.title ?? c.id ?? `Tab ${i + 1}`;
</script>

<div class="tabs">
  <div class="tabbar" role="tablist">
    {#each children as c, i (c.id)}
      <button class="tab" class:on={active === i} role="tab" aria-selected={active === i} onclick={() => (active = i)}>
        {label(c, i)}
      </button>
    {/each}
  </div>
  <div class="tabbody">
    {#if children[active] && renderChild}{@render renderChild(children[active])}{:else}<div class="empty">no tabs — nest components as children</div>{/if}
  </div>
</div>

<style>
  .tabs { display: flex; flex-direction: column; gap: 8px; height: 100%; }
  .tabbar { display: flex; gap: 2px; border-bottom: 1px solid var(--h-border, #e5e7eb); }
  .tab { padding: 6px 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--h-muted, #64748b); font: 600 12px system-ui; cursor: pointer; }
  .tab.on { color: var(--h-accent, #0369a1); border-bottom-color: var(--h-accent, #0369a1); }
  .tabbody { flex: 1; min-height: 0; overflow: auto; }
  .empty { color: var(--h-muted, #94a3b8); font-style: italic; font-size: 12px; }
</style>
