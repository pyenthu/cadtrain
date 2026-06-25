<script lang="ts">
  /**
   * ContainerNode.svelte — a compact collapsible HUB pill for the /design graph.
   * Used for the system root and the four C4 containers. Shows the label, a
   * collapse caret (▸/▾) and a child-count badge; clicking the pill (or caret)
   * collapses/expands its subtree. The toggle is wired by the parent via
   * data.onToggle. Sized to the mfmesh reference — a pill, not a giant card.
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
  class="hub"
  class:system={isSystem}
  class:collapsed={data.collapsed}
  style="--accent:{accent};"
  onclick={toggle}
  title={data.blurb ?? ''}
  aria-expanded={!data.collapsed}
>
  <Handle type="target" position={Position.Left} class="hub-handle" />
  <span class="bar" aria-hidden="true"></span>

  <span class="caret" aria-hidden="true">{data.collapsed ? '▸' : '▾'}</span>
  <span class="label">{data.label}</span>
  <span class="count" class:on={data.collapsed}>{data.childCount}</span>

  <Handle type="source" position={Position.Right} class="hub-handle" />
</button>

<style>
  .hub {
    all: unset;
    box-sizing: border-box;
    position: relative;
    display: flex;
    align-items: center;
    gap: 7px;
    width: 168px;
    min-height: 36px;
    padding: 6px 9px 6px 6px;
    cursor: pointer;
    border-radius: 9px;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, #e2e8f0);
    background: #ffffff;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06),
      0 4px 12px rgba(15, 23, 42, 0.06);
    transition: box-shadow 0.16s ease, transform 0.16s ease,
      border-color 0.16s ease;
  }
  .hub:hover {
    border-color: color-mix(in srgb, var(--accent) 60%, #e2e8f0);
    box-shadow: 0 2px 4px rgba(15, 23, 42, 0.07),
      0 10px 22px rgba(15, 23, 42, 0.12);
    transform: translateY(-1px);
  }
  .hub:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* the system root — slightly larger + a touch heavier */
  .hub.system {
    width: 184px;
    min-height: 40px;
  }
  .hub.system .label {
    font-size: 0.86rem;
  }

  /* thick rounded left accent bar (the colored cue from the reference) */
  .bar {
    flex: 0 0 auto;
    width: 5px;
    align-self: stretch;
    border-radius: 5px;
    background: var(--accent);
  }

  .caret {
    flex: 0 0 auto;
    width: 12px;
    text-align: center;
    font-size: 0.66rem;
    color: var(--accent);
  }

  .label {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 0.79rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: #0f172a;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .count {
    flex: 0 0 auto;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.62rem;
    font-weight: 700;
    color: #fff;
    background: var(--accent);
    border-radius: 999px;
    line-height: 1;
  }
  .count.on {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }

  :global(.hub-handle) {
    width: 7px !important;
    height: 7px !important;
    min-width: 0 !important;
    min-height: 0 !important;
    background: var(--accent) !important;
    border: 1.5px solid #fff !important;
    opacity: 0.6;
  }
</style>
