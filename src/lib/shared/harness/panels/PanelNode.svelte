<script lang="ts">
  // PanelNode — recursively renders ONE node of the component tree: its component
  // (looked up by kind) plus a `kids` snippet that renders its children (HTML-style
  // nesting). Container/Card render {@render kids()}; leaf components ignore it.
  import type { Panel, Binding } from '$lib/appkit/manifest/types';
  import { panelComponent } from './registry';
  import PanelNode from './PanelNode.svelte';

  let {
    node,
    run,
    select,
    active,
    params,
    onBuild,
  }: {
    node: Panel;
    run: (b?: Binding, item?: unknown) => Promise<unknown>;
    select?: (item: unknown) => void;
    active?: string;
    params?: Record<string, unknown>;
    onBuild?: (p: string) => Promise<void>;
  } = $props();

  const Comp = $derived(panelComponent(node.kind));
</script>

{#snippet kids()}
  {#each node.children ?? [] as child (child.id)}
    <PanelNode node={child} {run} {select} {active} {params} {onBuild} />
  {/each}
{/snippet}

<Comp panel={node} {run} {select} {active} {params} {onBuild} {kids} />
