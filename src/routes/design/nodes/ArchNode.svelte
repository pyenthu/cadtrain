<script lang="ts">
  /**
   * ArchNode.svelte — a leaf component card (route / api / lib / store) for the
   * collapsible /design tree. Clean white card with a left accent bar keyed by
   * kind; route nodes click through to their live href.
   */
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import type { ArchTreeNode } from '../architecture';

  let { data }: NodeProps<ArchTreeNode> = $props();

  const KIND: Record<string, { accent: string; tint: string; label: string }> = {
    route: { accent: '#3b82f6', tint: '#eff5ff', label: 'route' },
    api:   { accent: '#22c55e', tint: '#f0fdf4', label: 'api' },
    lib:   { accent: '#f97316', tint: '#fff7ed', label: 'lib' },
    store: { accent: '#a855f7', tint: '#fbf3ff', label: 'store' },
  };

  let k = $derived(KIND[data.treeKind] ?? KIND.lib);
</script>

<div
  class="arch-node"
  class:planned={data.planned}
  class:archived={data.archived}
  class:clickable={!!data.href}
  style="--accent:{k.accent}; --tint:{k.tint};"
  title={data.blurb ?? ''}
>
  <Handle type="target" position={Position.Left} class="arch-handle" />
  <span class="bar" aria-hidden="true"></span>

  <div class="body">
    <span class="kind">{k.label}</span>
    {#if data.href}
      <a href={data.href} class="label" target="_self">{data.label}</a>
    {:else}
      <span class="label">{data.label}</span>
    {/if}
  </div>

  {#if data.planned}<span class="tag">planned</span>{/if}
  {#if data.archived}<span class="tag arch">archived</span>{/if}

  <Handle type="source" position={Position.Right} class="arch-handle" />
</div>

<style>
  .arch-node {
    position: relative;
    display: flex;
    align-items: center;
    gap: 9px;
    width: 232px;
    min-height: 46px;
    padding: 8px 12px 8px 8px;
    background: #ffffff;
    border: 1px solid #e8ecf1;
    border-radius: 11px;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04),
      0 4px 12px rgba(15, 23, 42, 0.05);
    transition: box-shadow 0.18s ease, transform 0.18s ease,
      border-color 0.18s ease;
  }
  .arch-node:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, #e8ecf1);
    box-shadow: 0 2px 4px rgba(15, 23, 42, 0.06),
      0 10px 24px rgba(15, 23, 42, 0.1);
    transform: translateY(-1px);
  }

  /* left accent bar by kind */
  .bar {
    flex: 0 0 auto;
    width: 4px;
    align-self: stretch;
    border-radius: 4px;
    background: var(--accent);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .kind {
    font-size: 0.56rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    line-height: 1.4;
  }
  .label {
    font-size: 0.8rem;
    font-weight: 650;
    color: #1e293b;
    letter-spacing: -0.01em;
    line-height: 1.25;
    text-decoration: none;
    word-break: break-word;
  }
  a.label {
    color: #1d4ed8;
  }
  a.label:hover {
    text-decoration: underline;
  }

  .planned {
    opacity: 0.7;
    border-style: dashed;
  }
  .archived {
    opacity: 0.5;
    filter: grayscale(0.55);
  }

  .tag {
    margin-left: auto;
    align-self: flex-start;
    font-size: 0.54rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #b45309;
    background: #fef3c7;
    border-radius: 999px;
    padding: 1px 6px;
    white-space: nowrap;
  }
  .tag.arch {
    color: #64748b;
    background: #f1f5f9;
  }

  :global(.arch-handle) {
    width: 6px !important;
    height: 6px !important;
    min-width: 0 !important;
    min-height: 0 !important;
    background: var(--accent) !important;
    border: 1.5px solid #fff !important;
    opacity: 0.5;
  }
</style>
