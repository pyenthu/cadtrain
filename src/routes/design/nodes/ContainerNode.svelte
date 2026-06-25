<script lang="ts">
  /**
   * ContainerNode.svelte — a collapsible PARENT card for the /design tree.
   * Used for the system root and the four C4 containers. Shows a caret (▸/▾)
   * plus a child-count badge; clicking the card (or caret) collapses/expands
   * its subtree. The actual toggle is wired by the parent via data.onToggle.
   */
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import type { ArchTreeNode } from '../architecture';

  type Data = ArchTreeNode & {
    collapsed: boolean;
    childCount: number;
    onToggle: (id: string) => void;
  };

  let { id, data }: NodeProps<Data> = $props();

  const accent = $derived(data.accent ?? '#475569');
  const isSystem = $derived(data.treeKind === 'system');

  function toggle(e: MouseEvent) {
    e.stopPropagation();
    data.onToggle(id);
  }
</script>

<button
  type="button"
  class="group-node"
  class:system={isSystem}
  class:collapsed={data.collapsed}
  style="--accent:{accent};"
  onclick={toggle}
  title={data.blurb ?? ''}
  aria-expanded={!data.collapsed}
>
  <Handle type="target" position={Position.Left} class="group-handle" />

  <span class="caret" aria-hidden="true">{data.collapsed ? '▸' : '▾'}</span>

  <span class="text">
    <span class="label">{data.label}</span>
    {#if data.tech}<span class="tech">{data.tech}</span>{/if}
  </span>

  <span class="count" class:on={data.collapsed}>{data.childCount}</span>

  <Handle type="source" position={Position.Right} class="group-handle" />
</button>

<style>
  .group-node {
    all: unset;
    box-sizing: border-box;
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 250px;
    min-height: 54px;
    padding: 10px 12px 10px 14px;
    cursor: pointer;
    border-radius: 13px;
    border: 1.5px solid color-mix(in srgb, var(--accent) 40%, #e2e8f0);
    border-left: 5px solid var(--accent);
    background:
      linear-gradient(180deg,
        color-mix(in srgb, var(--accent) 9%, #ffffff),
        color-mix(in srgb, var(--accent) 4%, #ffffff));
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05),
      0 6px 18px rgba(15, 23, 42, 0.07);
    transition: box-shadow 0.18s ease, transform 0.18s ease,
      border-color 0.18s ease;
  }
  .group-node:hover {
    border-color: var(--accent);
    box-shadow: 0 3px 6px rgba(15, 23, 42, 0.07),
      0 12px 28px rgba(15, 23, 42, 0.12);
    transform: translateY(-1px);
  }
  .group-node:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* the system root — bigger, dashed, neutral */
  .group-node.system {
    width: 268px;
    min-height: 60px;
    border-style: dashed;
    border-left-style: solid;
    border-radius: 16px;
  }
  .group-node.system .label {
    font-size: 0.96rem;
  }

  .caret {
    flex: 0 0 auto;
    width: 16px;
    text-align: center;
    font-size: 0.7rem;
    color: var(--accent);
    transition: transform 0.18s ease;
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    margin-right: auto;
  }
  .label {
    font-size: 0.85rem;
    font-weight: 750;
    letter-spacing: -0.01em;
    color: #0f172a;
    line-height: 1.2;
  }
  .tech {
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: color-mix(in srgb, var(--accent) 55%, #475569);
  }

  .count {
    flex: 0 0 auto;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.66rem;
    font-weight: 700;
    color: #fff;
    background: var(--accent);
    border-radius: 999px;
    line-height: 1;
  }
  .count.on {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }

  :global(.group-handle) {
    width: 7px !important;
    height: 7px !important;
    min-width: 0 !important;
    min-height: 0 !important;
    background: var(--accent) !important;
    border: 1.5px solid #fff !important;
    opacity: 0.5;
  }
</style>
