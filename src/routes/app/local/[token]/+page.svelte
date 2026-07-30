<script lang="ts">
  // /app/local/[token] — LAUNCH a local .app: server-rendered first paint (data resolved in
  // +page.server.ts from the parked session), then hydrated for client reactivity. Same view
  // as /app/[id]. See docs/plans/app-server-render.md.
  import HarnessView from '$lib/shared/harness/HarnessView.svelte';
  import type { AppManifest } from '$lib/appkit/manifest/types';

  let { data }: { data: { app: AppManifest; preloaded: Record<string, unknown> } } = $props();
</script>

<div class="app-shell">
  <HarnessView app={data.app} preloaded={data.preloaded} />
</div>

<style>
  .app-shell { position: fixed; inset: 0; background: #fff; }
</style>
