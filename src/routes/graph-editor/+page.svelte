<script lang="ts">
  /**
   * /graph-editor — standalone single-primitive editor page.
   *
   * Thin shell around `$lib/shared/GraphEditorPane.svelte`. Reads `?id=`
   * and `?embed=` from the URL and forwards them as props. The same
   * component is also mounted (N times) inside the /primitives tabbed
   * wrapper — one source of truth, two surfaces.
   *
   * Empty/missing `?id` → component opens a fresh `test_graph_a` graph.
   */
  import { onMount } from 'svelte';
  import GraphEditorPane from '$lib/shared/graph-editor/GraphEditorPane.svelte';

  let id = $state<string | null>(null);
  let embed = $state(false);
  let ready = $state(false);

  onMount(() => {
    try {
      const u = new URL(window.location.href);
      id = u.searchParams.get('id');
      embed = u.searchParams.get('embed') === '1';
    } catch { /* URL parse failure — fall through to defaults */ }
    ready = true;
  });
</script>

{#if ready}
  <GraphEditorPane {id} {embed} />
{/if}
