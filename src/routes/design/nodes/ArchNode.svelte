<script lang="ts">
  /**
   * ArchNode.svelte — a compact leaf component card (route / api / lib / store)
   * for the /design architecture graph. Small white rounded card with a thin
   * colored LEFT accent bar keyed by kind, plus JUST the label — no bulky
   * uppercase "kind" line. Route nodes click through to their live href.
   * Sized to the mfmesh reference (~150px wide, ~34px tall).
   */
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import type { ArchTreeNode } from '../architecture';

  let { data }: NodeProps<ArchTreeNode> = $props();

  const KIND: Record<string, { accent: string }> = {
    route: { accent: '#3b82f6' },
    api:   { accent: '#22c55e' },
    lib:   { accent: '#f97316' },
    store: { accent: '#a855f7' },
  };

  let k = $derived(KIND[data.treeKind] ?? KIND.lib);
</script>

<div
  class="arch-node"
  class:planned={data.planned}
  class:archived={data.archived}
  class:clickable={!!data.href}
  style="--accent:{k.accent};"
  title={data.blurb ?? ''}
>
  <Handle type="target" position={Position.Left} class="arch-handle" />
  <span class="bar" aria-hidden="true"></span>

  {#if data.href}
    <a href={data.href} class="label" target="_self">{data.label}</a>
  {:else}
    <span class="label">{data.label}</span>
  {/if}

  {#if data.planned}<span class="tag">planned</span>{/if}
  {#if data.archived}<span class="tag arch">arch</span>{/if}

  <Handle type="source" position={Position.Right} class="arch-handle" />
</div>

<style>
  .arch-node {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 152px;
    min-height: 34px;
    padding: 6px 10px 6px 6px;
    background: #ffffff;
    border: 1px solid #e6eaf0;
    border-radius: 9px;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
    transition: box-shadow 0.16s ease, transform 0.16s ease,
      border-color 0.16s ease;
  }
  .arch-node:hover {
    border-color: color-mix(in srgb, var(--accent) 50%, #e6eaf0);
    box-shadow: 0 2px 4px rgba(15, 23, 42, 0.06),
      0 8px 18px rgba(15, 23, 42, 0.1);
    transform: translateY(-1px);
  }

  /* thin left accent bar by kind */
  .bar {
    flex: 0 0 auto;
    width: 4px;
    align-self: stretch;
    border-radius: 4px;
    background: var(--accent);
  }

  .label {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 0.76rem;
    font-weight: 600;
    color: #1e293b;
    letter-spacing: -0.01em;
    line-height: 1.2;
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  a.label {
    color: #1d4ed8;
  }
  a.label:hover {
    text-decoration: underline;
  }

  .planned {
    opacity: 0.72;
    border-style: dashed;
  }
  .archived {
    opacity: 0.5;
    filter: grayscale(0.55);
  }

  .tag {
    flex: 0 0 auto;
    font-size: 0.5rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #b45309;
    background: #fef3c7;
    border-radius: 999px;
    padding: 1px 5px;
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
    background: #94a3b8 !important;
    border: 1.5px solid #fff !important;
    opacity: 0.65;
  }
</style>
