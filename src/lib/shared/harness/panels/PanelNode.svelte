<script lang="ts">
  // PanelNode — recursively renders ONE node of the component tree: its component (by kind) +
  // a `kids` snippet for children (HTML-style nesting). Container/Card/Tabs render {@render
  // kids()}; leaf components ignore it.
  //
  // BEHAVIOR children: a `popover`/`tooltip` child does NOT render inline — the harness attaches
  // it to THIS node (parent) and shows it floating on parent CLICK (popover) / HOVER (tooltip).
  import type { Panel, Binding, EventMap, SlotValue, SlotApi } from '$lib/appkit/manifest/types';
  import { panelComponent } from './registry';
  import PanelNode from './PanelNode.svelte';

  let {
    node,
    run,
    fire,
    select,
    active,
    params,
    vars,
    slots,
    slotApi,
    dataRev,
    preloaded,
    onBuild,
  }: {
    node: Panel;
    run: (b?: Binding, item?: unknown) => Promise<unknown>;
    fire?: (n: { on?: EventMap } | undefined, event: string, item?: unknown) => Promise<void>;
    select?: (item: unknown) => void;
    active?: string;
    params?: Record<string, unknown>;
    vars?: Record<string, unknown>;
    slots?: Record<string, SlotValue>;
    slotApi?: SlotApi;
    dataRev?: number;
    preloaded?: Record<string, unknown>;
    onBuild?: (p: string) => Promise<void>;
  } = $props();

  const Comp = $derived(panelComponent(node.kind));
  const pre = $derived(preloaded?.[node.id]);

  // Split behavior children (popover/tooltip → attach to this node) from regular (render inline).
  const regular = $derived((node.children ?? []).filter((c) => c.kind !== 'popover' && c.kind !== 'tooltip'));
  const popover = $derived((node.children ?? []).find((c) => c.kind === 'popover'));
  const tooltip = $derived((node.children ?? []).find((c) => c.kind === 'tooltip'));
  let popOpen = $state(false);
  let tipOpen = $state(false);
</script>

{#snippet kids()}
  {#each regular as child (child.id)}
    <PanelNode node={child} {run} {fire} {select} {active} {params} {vars} {slots} {slotApi} {dataRev} {preloaded} {onBuild} />
  {/each}
{/snippet}

{#snippet renderChild(child: Panel)}
  <PanelNode node={child} {run} {fire} {select} {active} {params} {vars} {slots} {slotApi} {dataRev} {preloaded} {onBuild} />
{/snippet}

{#snippet comp()}
  <Comp panel={node} {run} {fire} {select} {active} {params} {vars} {slots} {slotApi} {dataRev} {onBuild} {kids} {renderChild} preloaded={pre} />
{/snippet}

{#if popover || tooltip}
  <div
    class="pn-anchor"
    role="presentation"
    onclick={popover ? () => (popOpen = !popOpen) : undefined}
    onmouseenter={tooltip ? () => (tipOpen = true) : undefined}
    onmouseleave={tooltip ? () => (tipOpen = false) : undefined}
  >
    {@render comp()}
    {#if popover && popOpen}
      <div class="pn-backdrop" role="presentation" onclick={() => (popOpen = false)}></div>
      <div class="pn-popover" role="presentation" onclick={(e) => e.stopPropagation()}>{@render renderChild(popover)}</div>
    {/if}
    {#if tooltip && tipOpen}<div class="pn-tooltip">{@render renderChild(tooltip)}</div>{/if}
  </div>
{:else}
  {@render comp()}
{/if}

<style>
  .pn-anchor { position: relative; }
  .pn-backdrop { position: fixed; inset: 0; z-index: 999; }
  .pn-popover { position: absolute; z-index: 1000; top: 100%; left: 0; margin-top: 4px; background: var(--h-surface, #fff); border: 1px solid var(--h-border, #e5e7eb); border-radius: 8px; box-shadow: 0 10px 30px rgba(2, 6, 23, 0.16); padding: 10px; }
  .pn-tooltip { position: absolute; z-index: 1001; bottom: 100%; left: 50%; transform: translateX(-50%); margin-bottom: 6px; background: #0f172a; color: #fff; border-radius: 6px; padding: 4px 8px; white-space: nowrap; pointer-events: none; }
</style>
