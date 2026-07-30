<script lang="ts">
  // Sidebar — a collapsible side panel that HOLDS children (nesting). Renders the `kids`
  // snippet from PanelNode inside a bordered surface docked left/right. A ▸/▾ toggle
  // hides/shows the body. props: side | title | width | collapsible.
  //
  // BUNDLE component (app_components/Sidebar/) — render + meta.ts co-located. See
  // src/lib/app_components/CLAUDE.md.
  import type { Panel } from '$lib/appkit/manifest/types';
  import type { Snippet } from 'svelte';
  let { panel, kids }: { panel: Panel; kids?: Snippet } = $props();

  const side = $derived((panel.props?.side as string) === 'right' ? 'right' : 'left');
  const title = $derived(panel.props?.title as string | undefined);
  const width = $derived(Number(panel.props?.width) || 220);
  const collapsible = $derived(panel.props?.collapsible !== false);

  let open = $state(true);
</script>

<div class="sidebar" class:right={side === 'right'} style="width:{width}px">
  {#if title || collapsible}
    <div class="head">
      {#if collapsible}
        <button class="toggle" onclick={() => (open = !open)} aria-label={open ? 'Collapse' : 'Expand'}>
          {open ? '▾' : '▸'}
        </button>
      {/if}
      {#if title}<span class="title">{title}</span>{/if}
    </div>
  {/if}
  {#if open}
    <div class="body">
      {#if kids}{@render kids()}{:else}<div class="empty">empty sidebar — nest components inside</div>{/if}
    </div>
  {/if}
</div>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    border: 1px solid var(--h-border, #e5e7eb);
    border-radius: 8px;
    background: var(--h-surface, #fff);
    color: var(--h-text, #0f172a);
    overflow: hidden;
    flex: 0 0 auto;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--h-border, #e5e7eb);
    background: var(--h-head, #f8fafc);
    font-size: 12px;
    font-weight: 600;
  }
  .toggle {
    border: none;
    background: transparent;
    color: var(--h-muted, #94a3b8);
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    padding: 0;
  }
  .title { color: var(--h-text, #0f172a); }
  .body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    overflow: auto;
    flex: 1 1 auto;
  }
  .empty { color: var(--h-muted, #94a3b8); font-style: italic; font-size: 12px; }
</style>
