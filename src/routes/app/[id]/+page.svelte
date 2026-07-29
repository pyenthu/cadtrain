<script lang="ts">
  // /app/[id] — LAUNCH a .app: preview/run only, single-page, straight from the file.
  // Like opening a .docx — no design chrome (create/design/save/build live in /app_design).
  import { page } from '$app/stores';
  import HarnessView from '$lib/shared/harness/HarnessView.svelte';
  import { createLocalStore } from '$lib/appkit/store/local-backend';
  import type { AppManifest } from '$lib/appkit/manifest/types';

  const store = createLocalStore();
  let id = $derived($page.params.id);
  let app = $state<AppManifest | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    const _id = id;
    error = null;
    app = null;
    store.load(_id).then((a) => { app = a; }).catch((e) => { error = String(e); });
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
