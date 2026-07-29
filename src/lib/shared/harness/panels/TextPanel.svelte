<script lang="ts">
  import type { Panel } from '$lib/appkit/manifest/types';
  let { panel }: { panel: Panel } = $props();
</script>

<p class="text">{(panel.text as string) ?? '(text panel)'}</p>

<style>
  .text { margin: 0; color: #334155; }
</style>
