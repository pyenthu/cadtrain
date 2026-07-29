<script lang="ts">
  import { page } from '$app/stores';
  import HarnessView from '$lib/shared/harness/HarnessView.svelte';
  import { createMemoryStore } from '$lib/appkit/store/app-store';
  import { validateManifest } from '$lib/appkit/manifest/validate';
  import type { AppManifest } from '$lib/appkit/manifest/types';
  // Bundled example .app (self-contained). Real .app loading (local drive / path)
  // is the AppStore's local backend — deferred; rung 2 seeds an in-memory store.
  import wellsRaw from '$lib/appkit/manifest/examples/wells.app?raw';

  const EXAMPLES: Record<string, AppManifest> = {};
  for (const raw of [wellsRaw]) {
    const res = validateManifest(JSON.parse(raw));
    if (res.ok) EXAMPLES[res.app.app] = res.app;
  }
  const store = createMemoryStore(EXAMPLES);

  let id = $derived($page.params.id);
  let app = $state<AppManifest | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    const _id = id;
    error = null;
    app = null;
    store
      .load(_id)
      .then((a) => { app = structuredClone(a); })
      .catch((e) => { error = String(e); });
  });
</script>

<div class="app-shell">
  {#if error}
    <div class="msg err">{error}</div>
  {:else if app}
    <HarnessView {app} />
  {:else}
    <div class="msg">Loading…</div>
  {/if}
</div>

<style>
  .app-shell { position: fixed; inset: 0; background: #fff; }
  .msg { padding: 40px; text-align: center; color: #64748b; font: 14px system-ui; }
  .msg.err { color: #dc2626; }
</style>
