<script lang="ts">
  // PanelNode — recursively renders ONE node of the component tree: its component
  // (looked up by kind) plus a `kids` snippet that renders its children (HTML-style
  // nesting). Container/Card render {@render kids()}; leaf components ignore it.
  import type { Panel, Binding, EventMap } from '$lib/appkit/manifest/types';
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
    onBuild,
  }: {
    node: Panel;
    run: (b?: Binding, item?: unknown) => Promise<unknown>;
    fire?: (n: { on?: EventMap } | undefined, event: string, item?: unknown) => Promise<void>;
    select?: (item: unknown) => void;
    active?: string;
    params?: Record<string, unknown>;
    vars?: Record<string, unknown>;
    onBuild?: (p: string) => Promise<void>;
  } = $props();

  const Comp = $derived(panelComponent(node.kind));
</script>

{#snippet kids()}
  {#each node.children ?? [] as child (child.id)}
    <PanelNode node={child} {run} {fire} {select} {active} {params} {vars} {onBuild} />
  {/each}
{/snippet}

<Comp panel={node} {run} {fire} {select} {active} {params} {vars} {onBuild} {kids} />
