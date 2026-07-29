<script lang="ts">
  // /app_design — the app design STUDIO. Create/select an .app, design it (visual editor
  // + AI build), preview, and SAVE the .app file. Composes the existing pieces: the local
  // store (load/list/save), VisualEditor (gui verbs), HarnessView (preview), and
  // /api/app/generate (AI build). See docs/architecture/app-harness.md §15 (three surfaces).
  import { onMount } from 'svelte';
  import { createLocalStore } from '$lib/appkit/store/local-backend';
  import VisualEditor from '$lib/shared/harness/VisualEditor.svelte';
  import HarnessView from '$lib/shared/harness/HarnessView.svelte';
  import type { AppManifest } from '$lib/appkit/manifest/types';

  const store = createLocalStore();

  let apps = $state<Array<{ id: string; title?: string }>>([]);
  let currentId = $state<string | null>(null);
  let app = $state<AppManifest | null>(null);
  let newName = $state('');
  let status = $state('');
  let preview = $state(false);
  let prompt = $state('');
  let building = $state(false);

  async function refresh() {
    apps = await store.list().catch(() => []);
  }
  onMount(refresh);

  async function open(id: string) {
    currentId = id;
    status = '';
    preview = false;
    app = await store.load(id).catch((e) => {
      status = String(e);
      return null as any;
    });
  }

  /** A minimal starter manifest for a new app (a chat panel to build from). */
  function scaffold(id: string): AppManifest {
    return {
      app: id,
      title: id,
      docType: 'app',
      panels: [{ id: 'chat', kind: 'chat', title: 'Build with AI', source: { verb: 'listPanelKinds' } }],
      popovers: [],
    };
  }

  async function createApp() {
    const id = newName.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!id) return;
    try {
      await store.save?.(id, scaffold(id));
      newName = '';
      await refresh();
      await open(id);
      status = 'created ✓';
    } catch (e) {
      status = String(e);
    }
  }

  async function save() {
    if (!app || !currentId) return;
    status = 'saving…';
    try {
      await store.save?.(currentId, $state.snapshot(app) as AppManifest);
      status = 'saved ✓';
      await refresh();
    } catch (e) {
      status = String(e);
    }
  }

  async function build() {
    if (!currentId || !prompt.trim()) return;
    building = true;
    status = 'building…';
    try {
      const r = await fetch('/api/app/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: currentId, prompt }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      app = j.app;
      prompt = '';
      status = `AI built (${j.steps} steps) — Save to keep`;
    } catch (e) {
      status = String(e);
    } finally {
      building = false;
    }
  }
</script>

<div class="studio">
  <aside class="sidebar">
    <h2>App Design</h2>
    <div class="new">
      <input bind:value={newName} placeholder="new app name" onkeydown={(e) => e.key === 'Enter' && createApp()} />
      <button onclick={() => createApp()} disabled={!newName.trim()} title="create">＋</button>
    </div>
    <ul>
      {#each apps as a (a.id)}
        <li>
          <button class:on={currentId === a.id} onclick={() => open(a.id)}>
            {a.title ?? a.id}<span>/{a.id}</span>
          </button>
        </li>
      {/each}
      {#if !apps.length}<li class="empty">no apps — create one above</li>{/if}
    </ul>
    <a class="foot" href="/app">▶ run apps →</a>
  </aside>

  <main class="canvas">
    {#if !app}
      <div class="empty-main">Select or create an app to design.</div>
    {:else}
      <div class="toolbar">
        <strong>{app.title ?? currentId}</strong>
        <span class="ext">{currentId}.app</span>
        <button class="tgl" onclick={() => (preview = !preview)}>{preview ? '✎ design' : '▶ preview'}</button>
        <button class="save" onclick={() => save()}>Save .app</button>
        <a class="launch" href={`/app/${currentId}`} target="_blank" rel="noopener">Launch ↗</a>
        {#if status}<span class="status">{status}</span>{/if}
      </div>
      <div class="build-row">
        <input bind:value={prompt} placeholder="describe what to build or change…" disabled={building}
          onkeydown={(e) => e.key === 'Enter' && build()} />
        <button class="ai" onclick={() => build()} disabled={building || !prompt.trim()}>✨ Build with AI</button>
      </div>
      <div class="work">
        {#if preview}
          <HarnessView {app} />
        {:else}
          <VisualEditor {app} />
        {/if}
      </div>
    {/if}
  </main>
</div>

<style>
  .studio { position: fixed; inset: 0; display: grid; grid-template-columns: 240px 1fr; font: 13px system-ui, Arial, sans-serif; color: #0f172a; background: #fff; }
  .sidebar { border-right: 1px solid #e5e7eb; background: #f8fafc; display: flex; flex-direction: column; padding: 12px; gap: 10px; overflow: auto; }
  .sidebar h2 { margin: 0; font-size: 15px; }
  .new { display: flex; gap: 6px; }
  .new input { flex: 1; min-width: 0; padding: 5px 7px; border: 1px solid #cbd5e1; border-radius: 6px; }
  .new button { padding: 5px 10px; border: 1px solid #0369a1; border-radius: 6px; background: #0369a1; color: #fff; font-weight: 700; cursor: pointer; }
  .sidebar ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; flex: 1; }
  .sidebar li button { width: 100%; display: flex; justify-content: space-between; align-items: center; text-align: left; padding: 7px 9px; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; cursor: pointer; }
  .sidebar li button.on { border-color: #0369a1; background: #eff6ff; color: #0c4a6e; font-weight: 600; }
  .sidebar li button span { color: #94a3b8; font: 11px ui-monospace, monospace; }
  .sidebar .empty { color: #94a3b8; font-style: italic; padding: 6px 4px; }
  .sidebar .foot { color: #64748b; text-decoration: none; font-size: 12px; }
  .canvas { display: flex; flex-direction: column; min-width: 0; }
  .empty-main { flex: 1; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-style: italic; }
  .toolbar { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid #e5e7eb; }
  .toolbar strong { font-size: 14px; }
  .toolbar .ext { font: 12px ui-monospace, monospace; color: #94a3b8; }
  .toolbar .tgl { margin-left: auto; }
  .toolbar button { font: 600 11px system-ui; padding: 4px 10px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; cursor: pointer; }
  .toolbar .status { font-size: 11px; color: #16a34a; }
  .build-row { display: flex; gap: 8px; padding: 8px 14px; border-bottom: 1px solid #eef2f6; background: #fafafa; }
  .build-row input { flex: 1; padding: 6px 9px; border: 1px solid #cbd5e1; border-radius: 6px; font: 13px system-ui; }
  .build-row .ai { padding: 6px 12px; border: 1px solid #7c3aed; border-radius: 6px; background: #7c3aed; color: #fff; font: 600 12px system-ui; cursor: pointer; }
  .build-row .ai:disabled { opacity: .5; cursor: default; }
  .work { flex: 1; min-height: 0; overflow: auto; }
</style>
