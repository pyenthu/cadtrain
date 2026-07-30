<script lang="ts">
  // /app_design — the app design STUDIO, a FILE EDITOR (like Word for .app files).
  // A thin left rail: New · Open · Save · Save As · Preview · Launch. Open/Save use the
  // native File System Access picker (default to the Desktop, where the SAMPLE working dir
  // lives, but any location works). The AI builds the IN-MEMORY app (no server file needed),
  // so picker-opened files build too. See docs/architecture/app-harness.md.
  import VisualEditor from '$lib/shared/harness/VisualEditor.svelte';
  import { validateManifest } from '$lib/appkit/manifest/validate';
  import { autoDoc } from '$lib/appkit/manifest/doc';
  import { createLocalStore } from '$lib/appkit/store/local-backend';
  import type { AppManifest } from '$lib/appkit/manifest/types';

  const store = createLocalStore(); // no-FSA save fallback only (writes to the SAMPLE dir)
  const W = typeof window !== 'undefined' ? (window as any) : undefined;
  const hasFSA = !!W && 'showOpenFilePicker' in W;
  const PICK = { types: [{ description: 'App file', accept: { 'application/json': ['.app'] } }], startIn: 'desktop' };

  let app = $state<AppManifest | null>(null);
  let fileHandle = $state<any>(null); // File System Access handle (write-back target)
  let fileName = $state('');
  let status = $state('');
  let view = $state<'design' | 'preview' | 'text' | 'doc'>('design');
  let prompt = $state('');
  let building = $state(false);
  let inputEl = $state<HTMLInputElement>();
  let previewToken = $state(''); // the /app/local session the Preview iframe renders (server-side)
  let previewBusy = $state(false);

  function idOf(): string {
    return (app?.app || fileName.replace(/\.app$/, '') || 'untitled').replace(/[^a-zA-Z0-9_-]/g, '_') || 'untitled';
  }
  const serialize = () => `${JSON.stringify($state.snapshot(app), null, 2)}\n`;

  // Minimal safe Markdown → HTML for the Doc view (headings · bold · inline code · list items).
  function mdToHtml(md: string): string {
    const esc = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc
      .replace(/^### (.*)$/gm, '<h3>$1</h3>')
      .replace(/^## (.*)$/gm, '<h2>$1</h2>')
      .replace(/^# (.*)$/gm, '<h1>$1</h1>')
      .replace(/^\s*- (.*)$/gm, '<li>$1</li>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n{2,}/g, '<br/><br/>');
  }

  // ★ Promote the current app into the shared design-RAG (golden pair). The Doc (📄) is
  // the retrieval KEY — edit it first to describe what the app does; empty → auto-summary.
  async function promote() {
    if (!app) return;
    const snap = $state.snapshot(app) as any;
    const md = (app.doc && app.doc.trim()) || autoDoc(snap);
    status = 'adding to RAG…';
    try {
      const r = await fetch('/api/app/promote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: app.title || app.app, md, app: snap }),
      });
      if (!r.ok) throw new Error(await r.text());
      const { name } = await r.json();
      status = `★ added to the RAG as “${name}”`;
    } catch (e) {
      status = `promote failed: ${String((e as any)?.message ?? e)}`;
    }
  }

  function load(text: string, name: string, handle: any) {
    const res = validateManifest(JSON.parse(text));
    if (!res.ok) { status = res.errors.join('; '); return; }
    app = res.app;
    fileHandle = handle;
    fileName = name;
    view = 'design';
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
    view = 'design';
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

  // Preview = SERVER-rendered (same path as Launch): park the current app → iframe /app/local.
  // Explicit (on entering Preview + a manual refresh) — edits happen in Design (client), so we
  // don't round-trip per keystroke.
  async function serverPreview() {
    if (!app) return;
    previewBusy = true;
    try {
      const r = await fetch('/api/app/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app: $state.snapshot(app), name: fileName || app.title || app.app }),
      });
      if (!r.ok) throw new Error(await r.text());
      previewToken = (await r.json()).token;
    } catch (e) {
      status = `preview failed: ${String((e as any)?.message ?? e)}`;
    } finally {
      previewBusy = false;
    }
  }
  function openPreview() {
    view = 'preview';
    serverPreview();
  }

  async function launch() {
    if (!app) return;
    // Server-render the CURRENT app (works for a picked local file or a freshly-built one,
    // saved or not): park it in a session → open /app/local/[token], which SSRs it.
    try {
      const r = await fetch('/api/app/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Prefer the opened FILE NAME for the route slug (so it reads e.g. /app/local/wells-…).
        body: JSON.stringify({ app: $state.snapshot(app), name: fileName || app.title || app.app }),
      });
      if (!r.ok) throw new Error(await r.text());
      const { token } = await r.json();
      W?.open(`/app/local/${token}`, '_blank');
    } catch (e) {
      status = `launch failed: ${String((e as any)?.message ?? e)}`;
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
    <button title="Design (visual editor)" class:on={view === 'design'} onclick={() => (view = 'design')} disabled={!app}>✎</button>
    <button title="Preview (server-rendered)" class:on={view === 'preview'} onclick={() => openPreview()} disabled={!app}>👁</button>
    <button title="Text (.app JSON)" class:on={view === 'text'} onclick={() => (view = 'text')} disabled={!app}>&lt;/&gt;</button>
    <button title="Doc (Markdown)" class:on={view === 'doc'} onclick={() => (view = 'doc')} disabled={!app}>📄</button>
    <button title="★ Add this app to the shared design-RAG" onclick={() => promote()} disabled={!app}>★</button>
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
        <span class="mode">{view}</span>
        {#if status}<span class="status">{status}</span>{/if}
      </div>
      <div class="build">
        <input bind:value={prompt} placeholder="describe what to build or change…" disabled={building}
          onkeydown={(e) => e.key === 'Enter' && build()} />
        <button class="ai" onclick={() => build()} disabled={building || !prompt.trim()}>✨ Build with AI</button>
      </div>
      <div class="work">
        {#if view === 'preview'}
          <div class="preview-wrap">
            <div class="preview-bar">
              <span class="pv-tag">server-rendered · /app/local/{previewToken || '…'}</span>
              <button class="pv-refresh" onclick={() => serverPreview()} disabled={previewBusy}>↻ re-render</button>
            </div>
            {#if previewToken}
              <iframe class="preview-frame" src="/app/local/{previewToken}" title="server-rendered app preview"></iframe>
            {:else}
              <div class="pv-loading">{previewBusy ? 'rendering on server…' : 'preview'}</div>
            {/if}
          </div>
        {:else if view === 'text'}
          <pre class="text-view">{JSON.stringify(app, null, 2)}</pre>
        {:else if view === 'doc'}
          <div class="doc-view">
            <textarea class="doc-src" value={app.doc ?? ''}
              placeholder="Describe this app in Markdown… (leave empty → the auto-summary shows on the right)"
              oninput={(e) => { if (app) app.doc = e.currentTarget.value; }}></textarea>
            <div class="doc-prev">{@html mdToHtml(app.doc || autoDoc(app))}</div>
          </div>
        {:else}
          <VisualEditor {app} />
        {/if}
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
  .preview-wrap { display: flex; flex-direction: column; height: 100%; }
  .preview-bar { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid #e5e7eb; background: #f8fafc; }
  .pv-tag { font: 500 11px ui-monospace, monospace; color: #64748b; }
  .pv-refresh { margin-left: auto; padding: 3px 10px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; font: 600 11px system-ui; cursor: pointer; }
  .pv-refresh:disabled { opacity: .5; cursor: default; }
  .preview-frame { flex: 1; min-height: 0; width: 100%; border: 0; background: #fff; }
  .pv-loading { flex: 1; display: grid; place-items: center; color: #94a3b8; font: 13px system-ui; font-style: italic; }
  .text-view { margin: 0; padding: 14px; font: 12px/1.5 ui-monospace, monospace; color: #0f172a; white-space: pre; height: 100%; box-sizing: border-box; }
  .doc-view { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: #e5e7eb; height: 100%; }
  .doc-src { border: 0; padding: 14px; font: 13px/1.6 ui-monospace, monospace; resize: none; outline: none; }
  .doc-prev { padding: 14px 18px; overflow: auto; background: #fff; line-height: 1.55; color: #0f172a; }
  .doc-prev :global(h1) { font-size: 20px; margin: 0 0 8px; }
  .doc-prev :global(h2) { font-size: 15px; margin: 14px 0 6px; }
  .doc-prev :global(h3) { font-size: 13px; margin: 10px 0 4px; }
  .doc-prev :global(code) { font: 12px ui-monospace, monospace; background: #f1f5f9; padding: 1px 4px; border-radius: 3px; }
  .doc-prev :global(li) { margin-left: 18px; }
</style>
