<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import type { ArchNodeData } from '../architecture';

  let { data }: NodeProps<ArchNodeData> = $props();

  const KIND_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
    route: { bg: '#eef4ff', border: '#3b82f6', text: '#1e3a8a', badge: '#3b82f6' },
    api:   { bg: '#f0fdf4', border: '#22c55e', text: '#14532d', badge: '#22c55e' },
    lib:   { bg: '#fff7ed', border: '#f97316', text: '#7c2d12', badge: '#f97316' },
    store: { bg: '#fdf4ff', border: '#a855f7', text: '#581c87', badge: '#a855f7' },
  };

  const KIND_LABELS: Record<string, string> = {
    route: 'route',
    api:   'api',
    lib:   'lib',
    store: 'store',
  };

  let colors = $derived(KIND_COLORS[data.kind] ?? KIND_COLORS.lib);
</script>

<div
  class="arch-node"
  class:planned={data.planned}
  class:archived={data.archived}
  style="
    --bg: {colors.bg};
    --border: {colors.border};
    --text: {colors.text};
    --badge: {colors.badge};
  "
  title={data.blurb ?? ''}
>
  <Handle type="target" position={Position.Left} class="arch-handle" />
  <div class="kind-badge">{KIND_LABELS[data.kind]}</div>
  {#if data.href}
    <a href={data.href} class="node-label" target="_self">{data.label}</a>
  {:else}
    <span class="node-label">{data.label}</span>
  {/if}
  {#if data.planned}
    <div class="status-tag">planned</div>
  {/if}
  {#if data.archived}
    <div class="status-tag archived-tag">archived</div>
  {/if}
  <Handle type="source" position={Position.Right} class="arch-handle" />
</div>

<style>
  .arch-node {
    min-width: 160px;
    max-width: 220px;
    padding: 8px 12px 9px;
    background: var(--bg);
    border: 1.5px solid var(--border);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.07);
    transition: box-shadow 0.15s;
    cursor: default;
  }
  .arch-node:hover {
    box-shadow: 0 4px 14px rgba(0,0,0,0.13);
  }
  .arch-node.planned {
    opacity: 0.6;
    border-style: dashed;
  }
  .arch-node.archived {
    opacity: 0.45;
    filter: grayscale(0.5);
  }

  .kind-badge {
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #fff;
    background: var(--badge);
    border-radius: 4px;
    padding: 1px 5px;
    align-self: flex-start;
    line-height: 1.4;
  }

  .node-label {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--text);
    text-decoration: none;
    letter-spacing: -0.01em;
    line-height: 1.3;
    word-break: break-all;
  }
  a.node-label:hover {
    text-decoration: underline;
  }

  .status-tag {
    font-size: 0.6rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #b45309;
    background: #fef3c7;
    border-radius: 4px;
    padding: 1px 5px;
    align-self: flex-start;
  }
  .archived-tag {
    color: #6b7280;
    background: #f3f4f6;
  }

  /* xyflow renders the Handle as its own element — reach it with :global */
  :global(.arch-handle) {
    width: 7px;
    height: 7px;
    background: var(--border);
    border: 1.5px solid #fff;
    opacity: 0.55;
  }
</style>
