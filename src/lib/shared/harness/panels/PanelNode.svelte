<script lang="ts">
  // PanelNode — recursively renders ONE node of the component tree: its component (by kind) +
  // a `kids` snippet for children (HTML-style nesting). Container/Card/Tabs render {@render
  // kids()}; leaf components ignore it.
  //
  // BEHAVIOR children: a `popover`/`tooltip` child does NOT render inline — the harness attaches
  // it to THIS node (parent) and shows it floating on parent CLICK (popover) / HOVER (tooltip).
  import type { Panel, Binding, EventMap, SlotValue, SlotApi } from '$lib/appkit/manifest/types';
  import { panelComponent } from './registry';
  import { styleFromProps, hasStyleProps } from '$lib/appkit/catalog/components';
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
    applyStyle = true,
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
    /** False for a TOP-LEVEL panel: HarnessView's grid cell already carries the style props, so
     *  styling here too would double the padding/border. Nested panels default to true. */
    applyStyle?: boolean;
  } = $props();

  const Comp = $derived(panelComponent(node.kind));
  const pre = $derived(preloaded?.[node.id]);

  // Shared STYLE props (width/height/background/css/…). A NESTED panel never reaches HarnessView's
  // grid cell — its parent component renders it — so the wrapper has to live here too.
  // It is emitted ONLY when the panel actually carries style props: an unstyled panel must produce
  // exactly the markup it did before this existed, or we'd insert a div between (say) statgrid and
  // its stat children and break their CSS grid parent-child relationship on every existing app.
  const styled = $derived(applyStyle && hasStyleProps(node.props as Record<string, unknown>));
  const inlineStyle = $derived(styleFromProps(node.props as Record<string, unknown>));
  const cssClass = $derived(String((node.props as Record<string, unknown>)?.class ?? ''));

  // Split behavior children (popover/tooltip → attach to this node) from regular (render inline).
  const regular = $derived((node.children ?? []).filter((c) => c.kind !== 'popover' && c.kind !== 'tooltip'));
  const popover = $derived((node.children ?? []).find((c) => c.kind === 'popover'));
  const tooltip = $derived((node.children ?? []).find((c) => c.kind === 'tooltip'));
  let popOpen = $state(false);
  let tipOpen = $state(false);

  // Escape closes an open (non-modal) popover — listener lives only while it's open.
  $effect(() => {
    if (!popOpen || popover?.props?.modal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') popOpen = false; };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

{#snippet kids()}
  {#each regular as child (child.id)}
    <PanelNode node={child} {run} {fire} {select} {active} {params} {vars} {slots} {slotApi} {dataRev} {preloaded} {onBuild} />
  {/each}
{/snippet}

{#snippet renderChild(child: Panel)}
  <PanelNode node={child} {run} {fire} {select} {active} {params} {vars} {slots} {slotApi} {dataRev} {preloaded} {onBuild} />
{/snippet}

{#snippet bare()}
  <Comp panel={node} {run} {fire} {select} {active} {params} {vars} {slots} {slotApi} {dataRev} {onBuild} {kids} {renderChild} preloaded={pre} />
{/snippet}

{#snippet comp()}
  {#if styled}
    <div class="pn-style {cssClass}" style={inlineStyle}>{@render bare()}</div>
  {:else}
    {@render bare()}
  {/if}
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
      <!-- Light-dismiss backdrop (default). It MUST stopPropagation: without it the click bubbled
           up to .pn-anchor's toggle handler, which reopened the popover — so "click outside" did
           nothing and the popover felt modal. Opt into a sticky popover with props.modal. -->
      {#if !popover.props?.modal}
        <div class="pn-backdrop" role="presentation" onclick={(e) => { e.stopPropagation(); popOpen = false; }}></div>
      {/if}
      <div class="pn-popover" role="presentation" onclick={(e) => e.stopPropagation()}>{@render renderChild(popover)}</div>
    {/if}
    {#if tooltip && tipOpen}<div class="pn-tooltip">{@render renderChild(tooltip)}</div>{/if}
  </div>
{:else}
  {@render comp()}
{/if}

<style>
  /* The style-props wrapper. min-width:0 so a styled panel inside a grid/flex parent can still
     shrink (without it, a wide table would blow out its track). No other opinions — everything
     visible comes from the panel's own style props. */
  .pn-style { min-width: 0; }
  .pn-anchor { position: relative; }
  .pn-backdrop { position: fixed; inset: 0; z-index: 999; }
  .pn-popover { position: absolute; z-index: 1000; top: 100%; left: 0; margin-top: 4px; background: var(--h-surface, #fff); border: 1px solid var(--h-border, #e5e7eb); border-radius: 8px; box-shadow: 0 10px 30px rgba(2, 6, 23, 0.16); padding: 10px; }
  .pn-tooltip { position: absolute; z-index: 1001; bottom: 100%; left: 50%; transform: translateX(-50%); margin-bottom: 6px; background: #0f172a; color: #fff; border-radius: 6px; padding: 4px 8px; white-space: nowrap; pointer-events: none; }
</style>
