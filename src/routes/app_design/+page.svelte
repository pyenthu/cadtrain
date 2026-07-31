<script lang="ts">
  // /app_design — the app design STUDIO, a FILE EDITOR (like Word for .app files).
  // A thin left rail: New · Open · Save · Save As · Preview · Launch. Open/Save use the
  // native File System Access picker (default to the Desktop, where the SAMPLE working dir
  // lives, but any location works). The AI builds the IN-MEMORY app (no server file needed),
  // so picker-opened files build too. See docs/architecture/app-harness.md.
  import VisualEditor from '$lib/shared/harness/VisualEditor.svelte';
  import AppSettings from '$lib/shared/harness/AppSettings.svelte';
  import LearnPanel from '$lib/shared/harness/LearnPanel.svelte';
  import ChatPanel from '$lib/shared/harness/ChatPanel.svelte';
  import { validateManifest } from '$lib/appkit/manifest/validate';
  import { autoDoc } from '$lib/appkit/manifest/doc';
  import { createLocalStore } from '$lib/appkit/store/local-backend';
  import type { AppManifest } from '$lib/appkit/manifest/types';

  const store = createLocalStore(); // no-FSA save fallback only (writes to the SAMPLE dir)
  const W = typeof window !== 'undefined' ? (window as any) : undefined;
  const hasFSA = !!W && 'showOpenFilePicker' in W;
  const PICK = { types: [{ description: 'App file', accept: { 'application/json': ['.app.json', '.app', '.json'] } }], startIn: 'desktop' };

  let app = $state<AppManifest | null>(null);
  let fileHandle = $state<any>(null); // File System Access handle (write-back target)
  let fileName = $state('');
  let status = $state('');
  let view = $state<'split' | 'design' | 'preview' | 'text' | 'doc'>('split');
  let leftTab = $state<'tree' | 'vars' | 'style' | 'data' | 'events' | 'learn'>('tree'); // the split's left-sidebar icon tabs
  let aiOpen = $state(false); // the ✨ AI prompter popover (right edge of the tab strip)
  let leftWidth = $state(380); // px width of the design pane — dragged via the full-height vertical divider

  /** Drag the whole vertical divider (not a corner grip) to resize the left design pane.
   *  Uses POINTER CAPTURE on the divider itself — the live-preview <iframe> swallows pointer
   *  events, so window-level listeners lose `pointermove` (drag dies) and never see `pointerup`
   *  (so it kept resizing after mouse-up). Capturing routes every event for this pointer to the
   *  divider, over the iframe or anything else, until we release it. */
  function startResize(e: PointerEvent) {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const id = e.pointerId;
    const startX = e.clientX;
    const startW = leftWidth;
    try { el.setPointerCapture(id); } catch { /* older engines — falls back to bubbling */ }

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      leftWidth = Math.max(240, Math.min(startW + (ev.clientX - startX), window.innerWidth - 52 - 300));
    };
    const stop = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', stop);
      el.removeEventListener('pointercancel', stop);
      try { el.releasePointerCapture(id); } catch { /* already released */ }
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
  }
  let prompt = $state('');
  let building = $state(false);
  let inputEl = $state<HTMLInputElement>();
  let previewToken = $state(''); // the /app/local session the Preview iframe renders (server-side)
  let previewBusy = $state(false);
  let autoCompile = $state(true); // re-render the preview on every edit (debounced); user default ON

  function idOf(): string {
    return (app?.app || fileName.replace(/\.app(\.json)?$/, '') || 'untitled').replace(/[^a-zA-Z0-9_-]/g, '_') || 'untitled';
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

  // ⬆ Promote the current COMPOSITION to the volume as a reusable component — appears in the
  // tree's ＋ palette under "Saved components" (distinct from 💾 which writes the .app file, and
  // ★ which promotes the app to the design-RAG). Stored at <volume>/app-templates/<name>.json.
  async function promoteToVolume() {
    if (!app?.panels?.length) return;
    status = 'promoting to volume…';
    try {
      const r = await fetch('/api/app/templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: app.title || app.app || 'component', tree: $state.snapshot(app.panels) }),
      });
      if (!r.ok) throw new Error(await r.text());
      const { id } = await r.json();
      status = `promoted “${id}” to volume — find it in ＋ Add`;
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
    view = 'split';
    previewToken = ''; // fresh preview for the newly-opened app
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
    view = 'split';
    previewToken = '';
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
        const h = await W.showSaveFilePicker({ ...PICK, suggestedName: `${idOf()}.app.json` });
        await writeHandle(h);
        fileHandle = h;
        fileName = h.name ?? `${idOf()}.app.json`;
        status = `saved ${fileName}`;
      } catch (e: any) {
        if (e?.name !== 'AbortError') status = String(e);
      }
    } else {
      await store.save?.(idOf(), $state.snapshot(app) as AppManifest);
      status = `saved ${idOf()}.app.json (SAMPLE)`;
    }
  }

  /** Shared AI edit: send the whole .app + a prompt to the SERVER builder (provider = cloud/cli/
   *  local, the chat's model toggle), swap in the result. */
  async function runGenerate(promptText: string, provider?: string): Promise<{ ok: boolean; steps?: number }> {
    if (!app || !promptText.trim()) return { ok: false };
    building = true;
    status = 'building…';
    try {
      const r = await fetch('/api/app/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app: $state.snapshot(app), prompt: promptText, ...(provider ? { provider } : {}) }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      app = j.app;
      status = `AI built (${j.steps} steps) — Save to keep`;
      return { ok: true, steps: j.steps };
    } catch (e) {
      status = String(e);
      return { ok: false };
    } finally {
      building = false;
    }
  }

  /** The chat's build entry — routes by the model toggle. cli/cloud/local → the server endpoint;
   *  PHI → the in-browser WebLLM path (client-side, zero API, runs on WebGPU). */
  async function chatBuild(promptText: string, provider: 'cli' | 'cloud' | 'phi'): Promise<{ ok: boolean; steps?: number; error?: string }> {
    if (!app || !promptText.trim()) return { ok: false, error: 'no app / empty prompt' };
    if (provider === 'phi') {
      building = true;
      try {
        const mod = await import('$lib/appkit/ai/webllm-build');
        if (!mod.isWebGPUAvailable()) throw new Error('WebGPU unavailable — use Chrome/Edge desktop for Phi');
        if (!mod.phiReady()) {
          status = 'loading Phi (one-time ~2.4 GB)…';
          await mod.loadPhi((p) => (status = `Phi ${Math.round(p.progress * 100)}% — ${p.text}`));
        }
        status = 'Phi building…';
        const out = await mod.buildAppWithPhi(app, promptText, '');
        app = { ...app }; // nudge reactivity after in-place dispatch
        serverPreview();
        status = `Phi built (${out.trace.length} steps)`;
        return { ok: true, steps: out.trace.length };
      } catch (e) {
        status = String(e);
        return { ok: false, error: String(e) };
      } finally {
        building = false;
      }
    }
    const r = await runGenerate(promptText, provider);
    return { ok: r.ok, steps: r.steps, error: r.ok ? undefined : status };
  }

  async function build() {
    if ((await runGenerate(prompt)).ok) prompt = '';
  }

  /** Component-scoped AI: the ⚙ popover's ✨ bar — the builder targets ONE component. */
  async function scopedBuild(panelId: string, kind: string, userPrompt: string): Promise<boolean> {
    const scoped =
      `Modify ONLY the component with id "${panelId}" (a "${kind}") in this app. Request: ${userPrompt}\n` +
      `Use setComponentProp / setPanelProp to change its props, style, class, events (on), or source; ` +
      `use patchApp to add any app-level variable (computed) or event this component needs. ` +
      `Do NOT add, remove, or restructure any other component.`;
    return runGenerate(scoped);
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

  // Initial render when a preview view opens (once — while there's no token yet).
  $effect(() => {
    if (app && (view === 'split' || view === 'preview') && !previewToken) serverPreview();
  });
  // Auto-compile: re-render on every edit (debounced) ONLY when the toggle is on (default off).
  $effect(() => {
    if (!app || (view !== 'split' && view !== 'preview') || !autoCompile) return;
    void JSON.stringify($state.snapshot(app)); // track edits
    const t = setTimeout(() => serverPreview(), 500);
    return () => clearTimeout(t);
  });

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

{#snippet previewPane()}
  <div class="preview-wrap">
    <div class="preview-bar">
      <strong class="pv-file">{fileName || `${idOf()}.app`}</strong>
      {#if status}<span class="pv-status">{status}</span>{/if}
      <span class="pv-tag">server-rendered · /app/local/{previewToken || '…'}{previewBusy ? ' · rendering…' : ''}</span>
      <label class="pv-auto" title="re-render on every edit (else use ↻)"><input type="checkbox" bind:checked={autoCompile} /> auto-compile</label>
      <button class="pv-refresh" onclick={() => serverPreview()} disabled={previewBusy}>↻ re-render</button>
    </div>
    {#if previewToken}
      <iframe class="preview-frame" src="/app/local/{previewToken}" title="server-rendered app preview"></iframe>
    {:else}
      <div class="pv-loading">{previewBusy ? 'rendering on server…' : 'preview appears as you edit'}</div>
    {/if}
  </div>
{/snippet}

<div class="studio">
  <nav class="rail" aria-label="App design tools">
    <button title="New app" onclick={() => newApp()}>＋</button>
    <button title="Open .app…" onclick={() => openFile()}>📂</button>
    <button title="Save" onclick={() => save()} disabled={!app}>💾</button>
    <button title="Save As…" onclick={() => saveAs()} disabled={!app}>⤓</button>
    <span class="sp"></span>
    <button title="Design + live preview (split)" class:on={view === 'split'} onclick={() => (view = 'split')} disabled={!app}>✎</button>
    <button title="Preview only (server-rendered)" class:on={view === 'preview'} onclick={() => openPreview()} disabled={!app}>👁</button>
    <button title="Text (.app JSON)" class:on={view === 'text'} onclick={() => (view = 'text')} disabled={!app}>&lt;/&gt;</button>
    <button title="Doc (Markdown)" class:on={view === 'doc'} onclick={() => (view = 'doc')} disabled={!app}>📄</button>
    <button title="★ Add this app to the shared design-RAG" onclick={() => promote()} disabled={!app}>★</button>
    <button title="Promote to volume — save this composition as a reusable component" onclick={() => promoteToVolume()} disabled={!app}>📦</button>
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
      <div class="work" class:split={view === 'split'}>
        {#if view === 'split'}
          <aside class="pane-left" style="width:{leftWidth}px">
            <nav class="left-tabs">
              <button class:on={leftTab === 'tree'} onclick={() => (leftTab = 'tree')} title="Component tree">☰</button>
              <button class:on={leftTab === 'vars'} onclick={() => (leftTab = 'vars')} title="Variables">ƒ</button>
              <button class:on={leftTab === 'events'} onclick={() => (leftTab = 'events')} title="Events">⚡</button>
              <button class:on={leftTab === 'style'} onclick={() => (leftTab = 'style')} title="Style">🎨</button>
              <button class:on={leftTab === 'data'} onclick={() => (leftTab = 'data')} title="Data structures">▦</button>
              <button class:on={leftTab === 'learn'} onclick={() => (leftTab = 'learn')} title="Learn — promote good builds, report bad ones">🎓</button>
              <span class="left-spacer"></span>
              <button class="ai-tab" class:on={aiOpen} onclick={() => (aiOpen = !aiOpen)} title="Build with AI">✨</button>
            </nav>
            <div class="left-body">
              {#if leftTab === 'tree'}
                <VisualEditor {app} onScopedBuild={scopedBuild} />
              {:else if leftTab === 'learn'}
                <LearnPanel {app} />
              {:else}
                <AppSettings {app} tab={leftTab} />
              {/if}
            </div>
            {#if aiOpen}
              <div class="ai-pop">
                <div class="ai-h">
                  <span>Build with AI</span>
                  <button class="ai-x" onclick={() => (aiOpen = false)} title="close">✕</button>
                </div>
                <p class="ai-hint">Describe the app or a change — it edits the tree in place.</p>
                <textarea bind:value={prompt} placeholder="e.g. add a casings table with od / id / top / bot columns"
                  disabled={building}
                  onkeydown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') build(); }}></textarea>
                <div class="ai-foot">
                  <span class="ai-kbd">⌘↵ to run</span>
                  <button class="ai" onclick={() => build()} disabled={building || !prompt.trim()}>
                    {building ? 'building…' : '✨ Build with AI'}
                  </button>
                </div>
              </div>
            {/if}
          </aside>
          <div class="pane-divider" role="separator" aria-orientation="vertical" title="drag to resize" onpointerdown={startResize}></div>
          <div class="pane-right">{@render previewPane()}</div>
        {:else if view === 'preview'}
          {@render previewPane()}
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
          <VisualEditor {app} onScopedBuild={scopedBuild} />
        {/if}
      </div>
    {/if}
  </main>

  {#if app}<ChatPanel onBuild={chatBuild} />{/if}

  <!-- No `accept` filter: mobile pickers (iOS treats .app as an app-bundle UTI) grey out .app
       files when one is set. onPick reads the text + validates JSON, so any file is safe. -->
  <input bind:this={inputEl} type="file" style="display:none" onchange={onPick} />
</div>

<style>
  /* grid-template-rows:100% + overflow:hidden bound the layout to the viewport, so a long design
     scrolls INSIDE its pane instead of growing the row (which pushed the rail's bottom buttons
     off-screen). */
  .studio { position: fixed; inset: 0; display: grid; grid-template-columns: 52px 1fr; grid-template-rows: 100%; overflow: hidden; font: 13px system-ui, Arial, sans-serif; color: #0f172a; background: #fff; }
  .rail { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 0; background: #0f172a; overflow-y: auto; overflow-x: hidden; }
  .rail button { flex: 0 0 auto; }
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
  /* left-sidebar icon tabs */
  .left-tabs { display: flex; align-items: center; gap: 2px; padding: 6px 6px 0; border-bottom: 1px solid #e5e7eb; background: #f8fafc; flex: 0 0 auto; }
  .left-tabs button { width: 30px; height: 28px; display: grid; place-items: center; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #64748b; font-size: 14px; cursor: pointer; border-radius: 6px 6px 0 0; }
  .left-tabs button:hover { background: #eef2f6; color: #0f172a; }
  .left-tabs button.on { color: #0369a1; border-bottom-color: #0369a1; background: #fff; }
  .left-tabs .left-spacer { flex: 1; }
  .left-tabs .ai-tab { width: auto; padding: 0 10px; height: 24px; margin-bottom: 4px; border: 1.5px solid #a855f7; border-radius: 7px; color: #7c3aed; background: #faf5ff; font-size: 15px; }
  .left-tabs .ai-tab:hover { background: #f3e8ff; color: #7c3aed; }
  .left-tabs .ai-tab.on { color: #fff; background: #7c3aed; border-color: #7c3aed; }
  .left-body { flex: 1; min-height: 0; overflow: auto; }
  /* ✨ AI prompter — a popover anchored to the top-right of the left pane */
  .ai-pop { position: absolute; top: 40px; right: 6px; width: 300px; z-index: 40; display: flex; flex-direction: column; gap: 8px; padding: 12px; background: #fff; border: 1px solid #d8b4fe; border-radius: 10px; box-shadow: 0 10px 30px rgba(15, 23, 42, .18); }
  .ai-pop .ai-h { display: flex; align-items: center; justify-content: space-between; font: 700 13px system-ui; color: #0f172a; }
  .ai-pop .ai-x { width: 22px; height: 22px; border: 0; background: transparent; color: #94a3b8; font-size: 13px; cursor: pointer; border-radius: 5px; }
  .ai-pop .ai-x:hover { background: #f1f5f9; color: #0f172a; }
  .ai-pop .ai-hint { margin: 0; color: #64748b; font-size: 12px; line-height: 1.4; }
  .ai-pop textarea { min-height: 110px; padding: 9px 11px; border: 1px solid #cbd5e1; border-radius: 8px; font: 13px system-ui; resize: vertical; }
  .ai-pop .ai-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .ai-pop .ai-kbd { color: #94a3b8; font-size: 11px; }
  .ai-pop .ai { padding: 8px 12px; border: 1px solid #7c3aed; border-radius: 8px; background: #7c3aed; color: #fff; font: 600 13px system-ui; cursor: pointer; }
  .ai-pop .ai:disabled { opacity: .5; cursor: default; }
  .work { flex: 1; min-height: 0; overflow: auto; }
  .work.split { display: flex; overflow: hidden; padding: 0; }
  .work.split .pane-left { position: relative; flex: 0 0 auto; min-width: 240px; max-width: 70%; overflow: hidden; display: flex; flex-direction: column; }
  /* full-height drag handle sitting on the vertical border (not a corner grip) */
  .work.split .pane-divider { flex: 0 0 5px; align-self: stretch; background: #e5e7eb; cursor: col-resize; touch-action: none; transition: background .12s; }
  .work.split .pane-divider:hover, .work.split .pane-divider:active { background: #0369a1; }
  .work.split .pane-right { flex: 1; min-width: 0; overflow: hidden; }
  .preview-wrap { display: flex; flex-direction: column; height: 100%; }
  .preview-bar { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid #e5e7eb; background: #f8fafc; }
  .pv-file { font-size: 13px; color: #0f172a; }
  .pv-status { font-size: 11px; color: #16a34a; }
  .pv-tag { font: 500 11px ui-monospace, monospace; color: #94a3b8; }
  .pv-auto { margin-left: auto; display: flex; align-items: center; gap: 5px; font: 500 11px system-ui; color: #475569; cursor: pointer; }
  .pv-refresh { padding: 3px 10px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; font: 600 11px system-ui; cursor: pointer; }
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
