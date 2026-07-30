<script lang="ts">
  // Tooltip — a BEHAVIOR component: nested in a parent, the harness (PanelNode) attaches it and
  // shows it on parent HOVER (floating). Content = props.text or its children. BUNDLE component.
  import type { Panel } from '$lib/appkit/manifest/types';
  import type { Snippet } from 'svelte';
  let { panel, kids }: { panel: Panel; kids?: Snippet } = $props();
  const text = $derived(panel.props?.text as string | undefined);
</script>

{#if text}<span class="tip-text">{text}</span>{:else if kids}{@render kids()}{/if}

<style>
  .tip-text { font: 12px system-ui; }
</style>
