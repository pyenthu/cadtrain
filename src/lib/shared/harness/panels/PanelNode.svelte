<script lang="ts">
  // PanelNode — recursively renders ONE node of the component tree: its component
  // (looked up by kind) plus a `kids` snippet that renders its children (HTML-style
  // nesting). Container/Card render {@render kids()}; leaf components ignore it.
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
    /** Bumps on any slot change → data panels re-fetch. */
    dataRev?: number;
    onBuild?: (p: string) => Promise<void>;
  } = $props();

  const Comp = $derived(panelComponent(node.kind));
</script>

{#snippet kids()}
  {#each node.children ?? [] as child (child.id)}
    <PanelNode node={child} {run} {fire} {select} {active} {params} {vars} {slots} {slotApi} {dataRev} {onBuild} />
  {/each}
{/snippet}

<!-- renderChild: render ONE child node (for components like Tabs that show a subset). -->
{#snippet renderChild(child: Panel)}
  <PanelNode node={child} {run} {fire} {select} {active} {params} {vars} {slots} {slotApi} {dataRev} {onBuild} />
{/snippet}

<Comp panel={node} {run} {fire} {select} {active} {params} {vars} {slots} {slotApi} {dataRev} {onBuild} {kids} {renderChild} />
