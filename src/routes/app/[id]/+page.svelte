<script lang="ts">
  import { page } from '$app/stores';
  import HarnessView from '$lib/shared/harness/HarnessView.svelte';
  import VisualEditor from '$lib/shared/harness/VisualEditor.svelte';
  import { createLocalStore } from '$lib/appkit/store/local-backend';
  import type { AppManifest } from '$lib/appkit/manifest/types';

  // DYNAMIC: the .app is read from a real file at RUNTIME via /api/app/load (the
  // local-dir backend). Edit the file → reload → live. No rebuild. Any .app loads.
  const store = createLocalStore();

  let id = $derived($page.params.id);
  let app = $state<AppManifest | null>(null);
  let error = $state<string | null>(null);
  let saved = $state('');
  let editMode = $state(false);

  $effect(() => {
    const _id = id;
    error = null;
    app = null;
    saved = '';
    store.load(_id).then((a) => { app = a; }).catch((e) => { error = String(e); });
  });

  // Persist AI/user .app edits back to the file (atomic on the server) — the
  // "iterate" half of build-via-AI: load → edit via verbs → save → reload.
  async function save() {
    if (!app) return;
    saved = 'saving…';
    try {
      await store.save?.(id, $state.snapshot(app) as AppManifest);
      saved = 'saved ✓';
    } catch (e) {
      saved = String(e);
    }
  }

  // The AI-build surface: a prompt → /api/app/build → the AI calls gui verbs → the
  // returned manifest replaces `app`, so the harness re-renders what the AI built.
  async function build(prompt: string) {
    const r = await fetch('/api/app/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, prompt }),
    });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json();
    app = j.app;
    saved = `AI built (${j.steps} steps)`;
  }
</script>

<div class="app-shell">
  <div class="app-bar">
    <a class="back" href="/app">← apps</a>
    <span class="who">{id}.app</span>
    <button class="mode" onclick={() => (editMode = !editMode)} disabled={!app}>{editMode ? '▶ preview' : '✎ edit'}</button>
    <button class="save" onclick={() => save()} disabled={!app}>Save .app</button>
    {#if saved}<span class="saved">{saved}</span>{/if}
  </div>
  <div class="app-body">
    {#if error}
      <div class="msg err">{error}</div>
    {:else if app}
      {#if editMode}
        <VisualEditor {app} />
      {:else}
        <HarnessView {app} onBuild={build} />
      {/if}
    {:else}
      <div class="msg">Loading…</div>
    {/if}
  </div>
</div>

<style>
  .app-shell { position: fixed; inset: 0; background: #fff; display: flex; flex-direction: column; }
  .app-bar { display: flex; align-items: center; gap: 12px; padding: 6px 12px; border-bottom: 1px solid #e5e7eb; background: #fff; font: 13px system-ui; }
  .app-bar .back { text-decoration: none; color: #64748b; }
  .app-bar .who { font: 600 12px ui-monospace, monospace; color: #0f172a; }
  .app-bar .mode { margin-left: auto; font: 600 11px system-ui; padding: 4px 10px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; cursor: pointer; }
  .app-bar .save { font: 600 11px system-ui; padding: 4px 10px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; cursor: pointer; }
  .app-bar .save:disabled { opacity: .5; cursor: default; }
  .app-bar .saved { font: 11px system-ui; color: #16a34a; }
  .app-body { flex: 1; min-height: 0; }
  .msg { padding: 40px; text-align: center; color: #64748b; font: 14px system-ui; }
  .msg.err { color: #dc2626; }
</style>
