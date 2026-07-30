<script lang="ts">
  // /app/[id] — LAUNCH a .app: server-rendered first paint (data resolved in +page.server.ts),
  // then hydrated for full client reactivity. Preview/run only, no design chrome (create/design/
  // save/build live in /app_design). See docs/plans/app-server-render.md.
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
