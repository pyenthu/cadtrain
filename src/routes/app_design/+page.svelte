<script lang="ts">
  // /app_design — the app design STUDIO, a FILE EDITOR (like Word for .app files).
  // A thin left rail: New · Open · Save · Save As · Preview · Launch. Open/Save use the
  // native File System Access picker (default to the Desktop, where the SAMPLE working dir
  // lives, but any location works). The AI builds the IN-MEMORY app (no server file needed),
  // so picker-opened files build too. See docs/architecture/app-harness.md.
  import VisualEditor from '$lib/shared/harness/VisualEditor.svelte';
  import HarnessView from '$lib/shared/harness/HarnessView.svelte';
  import { validateManifest } from '$lib/appkit/manifest/validate';
  import { createLocalStore } from '$lib/appkit/store/local-backend';
  import type { AppManifest } from '$lib/appkit/manifest/types';

  const store = createLocalStore(); // used by Launch (copy into the SAMPLE working dir)
  const W = typeof window !== 'undefined' ? (window as any) : undefined;
  const hasFSA = !!W && 'showOpenFilePicker' in W;
  const PICK = { types: [{ description: 'App file', accept: { 'application/json': ['.app'] } }], startIn: 'desktop' };

  let app = $state<AppManifest | null>(null);
  let fileHandle = $state<any>(null); // File System Access handle (write-back target)
  let fileName = $state('');
  let status = $state('');
  let preview = $state(false);
  let prompt = $state('');
  let building = $state(false);
  let inputEl = $state<HTMLInputElement>();

  function idOf(): string {
    return (app?.app || fileName.replace(/\.app$/, '') || 'untitled').replace(/[^a-zA-Z0-9_-]/g, '_') || 'untitled';
  }
  const serialize = () => `${JSON.stringify($state.snapshot(app), null, 2)}\n`;

  function load(text: string, name: string, handle: any) {
    const res = validateManifest(JSON.parse(text));
    if (!res.ok) { status = res.errors.join('; '); return; }
    app = res.app;
    fileHandle = handle;
    fileName = name;
    preview = false;
    status = handle ? `opened ${name}` : `opened ${name} (read-only — Save As to write)`;
  }

  async function openFile() {
    status = '';
    if (hasFSA) {
      try {
        const [h] = await W.showOpenFilePicker(PICK);
        const f = await h.getFile();
        load(await f.text(), f.name, h);
      } catch (e: any) {
        if (e?.name !== 'AbortError') status = String(e);
      }
    } else {
      inputEl?.click();
    }
  }
  async function onPick(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) load(await f.text(), f.name, null);
  }

  function newApp() {
    app = { app: 'untitled', title: 'Untitled', docType: 'app', panels: [], popovers: [] };
    fileHandle = null;
    fileName = '';
    preview = false;
    status = 'new app — Save As to write a file';
  }

  async function writeHandle(h: any) {
    const w = await h.createWritable();
    await w.write(serialize());
    await w.close();
  }
  async function save() {
    if (!app) return;
    status = 'saving…';
    try {
      if (fileHandle) { await writeHandle(fileHandle); status = `saved ${fileName}`; }
      else await saveAs();
    } catch (e) { status = String(e); }
  }
  async function saveAs() {
    if (!app) return;
    if (hasFSA) {
      try {
        const h = await W.showSaveFilePicker({ ...PICK, suggestedName: `${idOf()}.app` });
        await writeHandle(h);
        fileHandle = h;
        fileName = h.name ?? `${idOf()}.app`;
        status = `saved ${fileName}`;
      } catch (e: any) {
        if (e?.name !== 'AbortError') status = String(e);
      }
    } else {
      await store.save?.(idOf(), $state.snapshot(app) as AppManifest);
      status = `saved ${idOf()}.app (SAMPLE)`;
    }
  }

  async function build() {
    if (!app || !prompt.trim()) return;
    building = true;
    status = 'building…';
    try {
      const r = await fetch('/api/app/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app: $state.snapshot(app), prompt }),
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

  async function launch() {
    if (!app) return;
    // /app/[id] reads the SAMPLE working dir — copy the current app there, then open it.
    const id = idOf();
    try {
      await store.save?.(id, $state.snapshot(app) as AppManifest);
      W?.open(`/app/${id}`, '_blank');
    } catch (e) {
      status = String(e);
    }
  }
</script>

<div class="studio">
  <nav class="rail" aria-label="App design tools">
    <button title="New app" onclick={() => newApp()}>＋</button>
    <button title="Open .app…" onclick={() => openFile()}>📂</button>
    <button title="Save" onclick={() => save()} disabled={!app}>💾</button>
    <button title="Save As…" onclick={() => saveAs()} disabled={!app}>⤓</button>
    <span class="sp"></span>
    <button title="Design / Preview" class:on={preview} onclick={() => (preview = !preview)} disabled={!app}>👁</button>
    <button title="Launch in a new tab" onclick={() => launch()} disabled={!app}>↗</button>
  </nav>

  <main class="canvas">
    {#if !app}
      <div class="empty">
        <p><strong>App Design</strong></p>
        <p>Open a <code>.app</code> file (📂) or start a New one (＋).</p>
        <p class="dim">Files live wherever you like — the working set is in <code>~/Desktop/SAMPLE</code>.</p>
      </div>
    {:else}
      <div class="bar">
        <strong>{app.title ?? idOf()}</strong>
        <span class="fn">{fileName || `${idOf()}.app · unsaved`}</span>
        <span class="mode">{preview ? 'preview' : 'design'}</span>
        {#if status}<span class="status">{status}</span>{/if}
      </div>
      <div class="build">
        <input bind:value={prompt} placeholder="describe what to build or change…" disabled={building}
          onkeydown={(e) => e.key === 'Enter' && build()} />
        <button class="ai" onclick={() => build()} disabled={building || !prompt.trim()}>✨ Build with AI</button>
      </div>
      <div class="work">
        {#if preview}<HarnessView {app} />{:else}<VisualEditor {app} />{/if}
      </div>
    {/if}
  </main>

  <input bind:this={inputEl} type="file" accept=".app,application/json" style="display:none" onchange={onPick} />
</div>

<style>
  .studio { position: fixed; inset: 0; display: grid; grid-template-columns: 52px 1fr; font: 13px system-ui, Arial, sans-serif; color: #0f172a; background: #fff; }
  .rail { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 0; background: #0f172a; }
  .rail button { width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; font-size: 17px; border: 0; border-radius: 8px; background: transparent; color: #e2e8f0; cursor: pointer; }
  .rail button:hover:not(:disabled) { background: #1e293b; }
  .rail button.on { background: #0369a1; color: #fff; }
  .rail button:disabled { opacity: .35; cursor: default; }
  .rail .sp { flex: 1; }
  .canvas { display: flex; flex-direction: column; min-width: 0; }
  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: #64748b; }
  .empty p { margin: 0; }
  .empty .dim { color: #94a3b8; font-size: 12px; }
  .empty code { font: 12px ui-monospace, monospace; background: #f1f5f9; padding: 1px 5px; border-radius: 4px; }
  .bar { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid #e5e7eb; }
  .bar strong { font-size: 14px; }
  .bar .fn { font: 12px ui-monospace, monospace; color: #94a3b8; }
  .bar .mode { font: 600 10px system-ui; text-transform: uppercase; letter-spacing: .5px; color: #64748b; background: #f1f5f9; padding: 2px 7px; border-radius: 10px; }
  .bar .status { margin-left: auto; font-size: 11px; color: #16a34a; }
  .build { display: flex; gap: 8px; padding: 8px 14px; border-bottom: 1px solid #eef2f6; background: #fafafa; }
  .build input { flex: 1; padding: 6px 9px; border: 1px solid #cbd5e1; border-radius: 6px; font: 13px system-ui; }
  .build .ai { padding: 6px 12px; border: 1px solid #7c3aed; border-radius: 6px; background: #7c3aed; color: #fff; font: 600 12px system-ui; cursor: pointer; }
  .build .ai:disabled { opacity: .5; cursor: default; }
  .work { flex: 1; min-height: 0; overflow: auto; }
</style>
