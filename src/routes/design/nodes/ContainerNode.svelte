<script lang="ts">
  /**
   * ContainerNode.svelte — a C4 "boundary"/"container" box for the /design graph.
   *
   * Renders a labeled, translucent, bordered rectangle that sits BEHIND the
   * component nodes parented into it (xyflow auto-raises children above parents).
   * Two variants:
   *   - 'system'    → the dashed outer system boundary ("CAD Train")
   *   - 'container' → a solid-tinted C4 container box (Web App, API, …)
   *
   * The node is sized by the explicit width/height set on the node object
   * (applied to the .svelte-flow__node wrapper as a style string); this root
   * fills 100% of that. Handles are present (low opacity) so container-level
   * summary edges can connect box→box.
   */
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import type { ContainerNodeData } from '../architecture';

  let { data }: NodeProps<ContainerNodeData> = $props();

  const accent = $derived(data.accent ?? '#64748b');
  const isSystem = $derived(data.variant === 'system');
</script>

<div
  class="container-node"
  class:system={isSystem}
  style="--accent: {accent};"
>
  <Handle type="target" position={Position.Left} class="container-handle" />

  <div class="container-title">
    {#if data.tech}
      <span class="title-label">{data.label}</span>
      <span class="title-tech">{data.tech}</span>
    {:else}
      <span class="title-label">{data.label}</span>
    {/if}
  </div>

  <Handle type="source" position={Position.Right} class="container-handle" />
</div>

<style>
  .container-node {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    border: 1.5px solid var(--accent);
    border-radius: 12px;
    background: color-mix(in srgb, var(--accent) 6%, #ffffff);
    position: relative;
  }

  /* The outer system boundary — dashed, neutral, larger title */
  .container-node.system {
    border-style: dashed;
    border-width: 2px;
    background: color-mix(in srgb, var(--accent) 4%, #ffffff);
    border-radius: 16px;
  }

  .container-title {
    position: absolute;
    top: -1px;
    left: 14px;
    transform: translateY(-50%);
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    padding: 3px 10px;
    background: var(--accent);
    border-radius: 6px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
    white-space: nowrap;
  }
  .container-node.system .container-title {
    top: 0;
    background: var(--accent);
    border-radius: 8px;
    padding: 4px 12px;
  }

  .title-label {
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: #ffffff;
  }
  .container-node.system .title-label {
    font-size: 0.86rem;
    letter-spacing: 0.01em;
  }
  .title-tech {
    font-size: 0.62rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: rgba(255, 255, 255, 0.82);
  }

  :global(.container-handle) {
    width: 6px;
    height: 6px;
    background: var(--accent);
    border: 1.5px solid #fff;
    opacity: 0.45;
  }
</style>
