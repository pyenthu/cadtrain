<script lang="ts">
  // Generic surface for a single primitive — canvas on the left,
  // tabbed control panel on the right (Params | Source).
  //
  // Apply / Save contract (locked in plan per-primitive-svelte-views):
  //   - Drag a slider / type into a number input:  pending edit
  //                                                (orange-bar state)
  //   - Apply (Enter, or button):                  commit to runtime
  //                                                → re-render canvas
  //   - Save defaults:                             rewrite `default:`
  //                                                literals in source.ts
  //   - Save source:                               write current
  //                                                editor buffer
  //
  // Source.ts is canonical. Editing meta lives there as
  // `export const meta = {...}`. Save callbacks emit upward — this
  // component doesn't talk to the API itself.
  import PrimitiveCanvas from './PrimitiveCanvas.svelte';
  import PrimitiveGlbCanvas from './PrimitiveGlbCanvas.svelte';
  import CodeEditor from './CodeEditor.svelte';
  import ProfileEditor from './ProfileEditor.svelte';
  import ParamGrid from './ParamGrid.svelte';
  import { untrack } from 'svelte';

  type ParamSchema = {
    label?: string;
    type?: 'number' | 'boolean' | 'polygon' | 'enum';
    min?: number;
    max?: number;
    step?: number;
    options?: string[];
    default: number | [number, number][];
    unit?: string;
    /** Polygon params only: Z-down vertical axis for the Profile editor
     *  (revolve profiles are (r,z) with z increasing downward). */
    yDown?: boolean;
    hLabel?: string;
    vLabel?: string;
  };

  let {
    id,
    name = id,
    description = '',
    paramSchema,
    editable = false,
    initialSource = '',
    serverSource = '',
    onSaveSource,
    onSaveDefaults,
    onReloadSource,
  }: {
    id: string;
    name?: string;
    description?: string;
    paramSchema: Record<string, ParamSchema>;
    editable?: boolean;
    initialSource?: string;
    serverSource?: string;
    onSaveSource?: (newSource: string) => Promise<void> | void;
    onSaveDefaults?: (applied: Record<string, number>) => Promise<void> | void;
    onReloadSource?: () => Promise<void> | void;
  } = $props();

  let paramOrder = $derived(Object.keys(paramSchema));

  // Initial state from props is a deliberate one-time read (untrack).
  // Parent uses `{#key selected.id}` to remount on primitive change.
  // Values are `number` for scalar params and `[number, number][]` for
  // polygon params. The schema's `type` decides the renderer + how the
  // value flows into appliedArgs (polygons are JSON.stringify'd).
  let applied = $state<Record<string, number | [number, number][]>>(
    untrack(() => Object.fromEntries(Object.entries(paramSchema).map(([k, v]) => [k, v.default as any]))),
  );
  let pending = $state<Record<string, number | [number, number][]>>(untrack(() => ({ ...applied })));
  let editedSource = $state(untrack(() => initialSource));

  // First polygon-typed param (if any). The Profile tab edits this
  // one; multi-polygon primitives aren't a real use case yet.
  let polygonParamName = $derived(paramOrder.find((k) => paramSchema[k].type === 'polygon') ?? null);
  let hasProfile = $derived(polygonParamName !== null);

  let tab = $state<'params' | 'profile' | 'source' | 'ai'>('params');

  // ── AI tab ───────────────────────────────────────────────────────────
  // Mirrors the /components inspector AI tab. Talks directly to the
  // /api/primitives/{refine,prompts,instructions} endpoints (this view is
  // primitive-specific, so the no-API convention is relaxed just here).
  // Only shown for editable (volume) primitives — bundle primitives have
  // no on-volume <id>/ dir to hold prompts.json / instructions.md.
  let aiSub = $state<'prompt' | 'history'>('prompt');
  let aiPrompt = $state('');
  let aiStatus = $state<'idle' | 'sending' | 'pending' | 'error'>('idle');
  let aiProposal = $state<string | null>(null);
  let aiError = $state<string | null>(null);
  let aiHistory = $state<Array<{ prompt: string; ts: number; accepted?: boolean }>>([]);
  let instr = $state('');
  let instrStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
  let aiLoaded = $state(false);

  async function loadAi() {
    if (aiLoaded) return;
    aiLoaded = true;
    try {
      const r = await fetch(`/api/primitives/prompts?id=${encodeURIComponent(id)}`);
      if (r.ok) { const d = await r.json(); aiHistory = Array.isArray(d?.history) ? d.history : []; }
    } catch { /* no history yet */ }
    try {
      const r = await fetch(`/api/volume?path=${encodeURIComponent(`primitives/${id}/instructions.md`)}`, { cache: 'no-store' });
      if (r.ok) instr = await r.text();
    } catch { /* no instructions yet */ }
  }
  // Lazy-load history + instructions the first time the AI tab is opened.
  $effect(() => { if (tab === 'ai') loadAi(); });

  async function persistHistory() {
    try {
      await fetch('/api/primitives/prompts', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, history: aiHistory }),
      });
    } catch { /* best-effort */ }
  }

  async function submitRefine() {
    const prompt = aiPrompt.trim();
    if (!prompt || aiStatus === 'sending') return;
    aiStatus = 'sending';
    aiError = null;
    aiProposal = null;
    try {
      const r = await fetch('/api/primitives/refine', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, source: editedSource, prompt, instructions: instr }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) { aiStatus = 'error'; aiError = d?.error || `HTTP ${r.status}`; return; }
      aiProposal = d.source;
      aiStatus = 'pending';
    } catch (e: any) {
      aiStatus = 'error'; aiError = e?.message ?? String(e);
    }
  }
  function acceptProposal() {
    if (aiProposal == null) return;
    editedSource = aiProposal;
    aiHistory = [...aiHistory, { prompt: aiPrompt.trim(), ts: Date.now(), accepted: true }];
    aiProposal = null; aiStatus = 'idle'; aiPrompt = '';
    persistHistory();
  }
  function rejectProposal() {
    aiHistory = [...aiHistory, { prompt: aiPrompt.trim(), ts: Date.now(), accepted: false }];
    aiProposal = null; aiStatus = 'idle';
    persistHistory();
  }
  async function saveInstructions() {
    instrStatus = 'saving';
    try {
      const r = await fetch('/api/primitives/instructions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, instructions: instr }),
      });
      instrStatus = r.ok ? 'saved' : 'error';
    } catch { instrStatus = 'error'; }
  }

  // GLB cutaway toggle — defaults off so users see the full bake first.
  // The Mesh pane is ALWAYS cutaway (baked into manifoldToCutVC), so
  // this toggle gives the GLB pane visual parity on demand. Reacts to
  // the same appliedArgs signal as the canvas, so it re-bakes only on
  // Apply, not on every slider drag.
  let glbCut = $state(false);

  // Polygon params travel to the server as JSON strings; scalars as
  // numbers. Order follows the meta param-order.
  let appliedArgs = $derived(paramOrder.map((k) => {
    const v = applied[k] ?? paramSchema[k].default;
    if (paramSchema[k].type === 'polygon') return JSON.stringify(v);
    return v as number;
  }));

  // Dirty if any scalar mismatches OR any polygon's JSON serialization
  // differs (cheap structural compare via stringify).
  let paramsDirty = $derived(
    paramOrder.some((k) => {
      const p = pending[k] ?? paramSchema[k].default;
      const a = applied[k] ?? paramSchema[k].default;
      if (paramSchema[k].type === 'polygon') return JSON.stringify(p) !== JSON.stringify(a);
      return p !== a;
    }),
  );
  let sourceDirty = $derived(editedSource !== serverSource);

  function setPending(k: string, v: number) { pending = { ...pending, [k]: v }; }
  function apply() { applied = { ...pending }; }
  function revert() { pending = { ...applied }; }
  // Commit a single param (Enter / drag-scrub / enum / boolean) — mirrors
  // the /components prop-card behaviour where each param commits on its own
  // Enter or drag rather than waiting for a global Apply.
  function commitOne(k: string, v: number) {
    pending = { ...pending, [k]: v };
    applied = { ...applied, [k]: v };
  }

  let saving = $state(false);
  async function saveSource() {
    if (!onSaveSource) return;
    saving = true;
    try { await onSaveSource(editedSource); } finally { saving = false; }
  }
  async function saveDefaults() {
    if (!onSaveDefaults) return;
    saving = true;
    try { await onSaveDefaults(applied); } finally { saving = false; }
  }

  // Drag-to-resize the right panel. Width is held in component state
  // and clamped to a sensible range so the user can't drag it off
  // either edge.
  let sideWidth = $state(420);
  let dragging = $state(false);
  function beginDrag(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = true;
  }
  function endDrag(e: PointerEvent) {
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    dragging = false;
  }
  function dragMove(e: PointerEvent) {
    if (!dragging) return;
    const container = (e.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const next = rect.right - e.clientX;
    sideWidth = Math.max(260, Math.min(900, next));
  }
</script>

<div class="pv-root">
  <header class="pv-head">
    <div class="pv-title">
      <h1>{name}</h1>
      {#if description}<p class="pv-desc">{description}</p>{/if}
    </div>
  </header>

  <div class="pv-split" style="--side-width: {sideWidth}px;">
    <div class="pv-canvas-pane">
      <!-- Always pass `source` so the preview runs through the sandbox
           path (which has a first-export fallback when the function
           name differs from the directory id, e.g. dir
           `profile_extrude_v2` containing `export function profile_extrude`).
           The bundle fast-path can't handle that mismatch. -->
      <div class="pv-canvas-stack">
        <div class="pv-canvas-half">
          <div class="pv-canvas-label">Mesh (live)</div>
          <PrimitiveCanvas {id} {name} args={appliedArgs} source={editedSource} />
        </div>
        <div class="pv-canvas-half">
          <div class="pv-canvas-label">GLB (bake preview)</div>
          <label class="pv-canvas-toggle" title="Show the half-sectioned bake (same cut plane as the Mesh pane).">
            <input type="checkbox" bind:checked={glbCut} />
            <span>Cutaway</span>
          </label>
          <PrimitiveGlbCanvas {id} {name} args={appliedArgs} source={editedSource} cut={glbCut} />
        </div>
      </div>
    </div>

    <div
      class="pv-resizer"
      class:dragging
      role="separator"
      aria-orientation="vertical"
      onpointerdown={beginDrag}
      onpointermove={dragMove}
      onpointerup={endDrag}
      onpointercancel={endDrag}
    ></div>

    <aside class="pv-side">
      <div class="pv-tabs" role="tablist">
        <button class="pv-tab" class:active={tab === 'params'} onclick={() => (tab = 'params')} type="button" role="tab">
          <span class="pv-ic">⚙</span> Params
          {#if paramsDirty}<span class="pv-dot"></span>{/if}
        </button>
        {#if hasProfile}
          <button class="pv-tab" class:active={tab === 'profile'} onclick={() => (tab = 'profile')} type="button" role="tab">
            <span class="pv-ic">◧</span> Profile
          </button>
        {/if}
        <button class="pv-tab" class:active={tab === 'source'} onclick={() => (tab = 'source')} type="button" role="tab">
          <span class="pv-ic">🛠</span> Source
          {#if sourceDirty}<span class="pv-dot"></span>{/if}
        </button>
        {#if editable}
          <button class="pv-tab pv-tab-ai" class:active={tab === 'ai'} onclick={() => (tab = 'ai')} type="button" role="tab">
            <span class="pv-ic">✦</span> AI
          </button>
        {/if}
      </div>

      {#if tab === 'params'}
        <div class="pv-pane pv-params">
          <div class="pv-pane-head">
            <span class="pv-pill" class:dirty={paramsDirty}>{paramsDirty ? 'pending — press Enter to apply' : 'applied'}</span>
            <div class="pv-spacer"></div>
            <button class="pv-btn" onclick={apply} type="button" disabled={!paramsDirty}>Apply</button>
            <button class="pv-btn" onclick={revert} type="button" disabled={!paramsDirty}>Revert</button>
            {#if onSaveDefaults}
              <button class="pv-btn primary" onclick={saveDefaults} type="button" disabled={!editable || saving}>Save defaults</button>
            {/if}
          </div>
          <div class="pv-params-grid">
            <ParamGrid
              schema={paramSchema}
              {pending}
              {applied}
              onPending={setPending}
              onCommit={commitOne}
            />
          </div>
        </div>
      {:else if tab === 'profile' && polygonParamName}
        {@const pname = polygonParamName}
        <div class="pv-pane pv-profile">
          <div class="pv-pane-head">
            <span class="pv-pname">{paramSchema[pname].label ?? pname}</span>
            <span class="pv-pill" class:dirty={paramsDirty}>{(pending[pname] as [number, number][])?.length ?? 0} verts</span>
            <div class="pv-spacer"></div>
            <button class="pv-btn" onclick={apply} type="button" disabled={!paramsDirty}>Apply</button>
            <button class="pv-btn" onclick={revert} type="button" disabled={!paramsDirty}>Revert</button>
          </div>
          <ProfileEditor
            value={pending[pname] as [number, number][]}
            yDown={paramSchema[pname].yDown ?? false}
            hLabel={paramSchema[pname].hLabel ?? (paramSchema[pname].yDown ? 'r →' : 'x →')}
            vLabel={paramSchema[pname].vLabel ?? (paramSchema[pname].yDown ? 'z ↓' : 'y ↑')}
            onChange={(next) => { pending = { ...pending, [pname]: next }; }}
            onApply={apply}
          />
        </div>
      {:else if tab === 'ai'}
        <div class="pv-pane pv-ai">
          <div class="pv-pane-head">
            <button class="pv-subtab" class:active={aiSub === 'prompt'} onclick={() => (aiSub = 'prompt')} type="button">Prompt</button>
            <button class="pv-subtab" class:active={aiSub === 'history'} onclick={() => (aiSub = 'history')} type="button">History · {aiHistory.length}</button>
          </div>
          <div class="pv-ai-body">
            {#if aiSub === 'prompt'}
              <div class="pv-ai-sec">
                <div class="pv-ai-h">Refine source</div>
                <textarea class="pv-ai-prompt" rows="3" bind:value={aiPrompt} placeholder="Describe the change… e.g. 'add a chamfer param to the bore'"></textarea>
                <div class="pv-ai-row">
                  <button class="pv-btn primary" type="button" disabled={aiStatus === 'sending' || aiStatus === 'pending' || !aiPrompt.trim()} onclick={submitRefine}>
                    {aiStatus === 'sending' ? '✦ Refining…' : '✦ Refine source'}
                  </button>
                  {#if aiStatus === 'error'}<span class="pv-ai-err">{aiError}</span>{/if}
                </div>
                {#if aiProposal != null}
                  <div class="pv-ai-proposal">
                    <div class="pv-ai-h">Proposed source</div>
                    <pre class="pv-ai-pre">{aiProposal}</pre>
                    <div class="pv-ai-row">
                      <button class="pv-btn primary" type="button" onclick={acceptProposal}>Accept → Source</button>
                      <button class="pv-btn" type="button" onclick={rejectProposal}>Reject</button>
                    </div>
                    <p class="pv-ai-note">Accept loads it into the Source tab — review + Save source to persist.</p>
                  </div>
                {/if}
              </div>
              <div class="pv-ai-sec">
                <div class="pv-ai-h">Instructions <span class="pv-ai-sub">(sent with each refine)</span></div>
                <textarea class="pv-ai-prompt" rows="6" bind:value={instr} placeholder="Persistent notes about this primitive — vocabulary, constraints, conventions…"></textarea>
                <div class="pv-ai-row">
                  <button class="pv-btn" type="button" disabled={instrStatus === 'saving'} onclick={saveInstructions}>{instrStatus === 'saving' ? 'Saving…' : instrStatus === 'saved' ? 'Saved ✓' : 'Save instructions'}</button>
                </div>
              </div>
            {:else}
              {#if aiHistory.length === 0}
                <div class="pv-ai-empty">No prompts yet.</div>
              {:else}
                <div class="pv-ai-hist">
                  {#each [...aiHistory].reverse() as h (h.ts)}
                    <button class="pv-ai-hrow" type="button" onclick={() => { aiPrompt = h.prompt; aiSub = 'prompt'; }}>
                      <span class="pv-ai-hmark" class:ok={h.accepted === true} class:no={h.accepted === false}>{h.accepted === true ? '✓' : h.accepted === false ? '✗' : '·'}</span>
                      <span class="pv-ai-hprompt">{h.prompt}</span>
                    </button>
                  {/each}
                </div>
              {/if}
            {/if}
          </div>
        </div>
      {:else}
        <div class="pv-pane pv-source">
          <div class="pv-pane-head">
            <span class="pv-pill" class:dirty={sourceDirty}>{sourceDirty ? 'modified' : 'in sync'}</span>
            <div class="pv-spacer"></div>
            {#if onReloadSource}<button class="pv-btn" onclick={onReloadSource} type="button">Reload</button>{/if}
            {#if onSaveSource}
              <button class="pv-btn primary" onclick={saveSource} type="button" disabled={!editable || saving || !sourceDirty}>Save source</button>
            {/if}
          </div>
          <div class="pv-editor-wrap">
            <CodeEditor
              value={editedSource}
              lang="typescript"
              readonly={!editable}
              variant="default"
              onChange={(next) => { editedSource = next; }}
              onSave={editable ? () => saveSource() : undefined}
            />
          </div>
        </div>
      {/if}
    </aside>
  </div>
</div>

<style>
  .pv-root { display: grid; grid-template-rows: auto 1fr; height: 100%; min-height: 0; font: 13px Arial; color: #222; padding: 0 6px 6px; gap: 4px; box-sizing: border-box; }

  .pv-head { padding: 0 6px 4px; border-bottom: 1px solid #eee; }
  .pv-title h1 { margin: 0; font: 700 14px monospace; color: #cc2222; line-height: 1.2; }
  .pv-desc { margin: 2px 0 0; color: #555; font-size: 11px; max-width: 720px; line-height: 1.3; }

  .pv-split { display: grid; grid-template-columns: 1fr 6px var(--side-width, 420px); min-height: 0; height: 100%; gap: 0; }

  .pv-canvas-pane { background: #1a1a1a; min-height: 0; overflow: hidden; border-radius: 4px; padding: 6px; }
  .pv-canvas-stack { display: grid; grid-template-rows: 1fr 1fr; gap: 6px; height: 100%; min-height: 0; }
  .pv-canvas-half { position: relative; min-height: 0; border-radius: 4px; overflow: hidden; }
  .pv-canvas-label { position: absolute; top: 6px; left: 8px; z-index: 5; font: 600 10px Arial; color: #fff; background: rgba(0,0,0,0.6); padding: 2px 8px; border-radius: 3px; pointer-events: none; }
  .pv-canvas-toggle { position: absolute; top: 6px; right: 8px; z-index: 5; display: flex; align-items: center; gap: 4px; font: 600 10px Arial; color: #fff; background: rgba(0,0,0,0.6); padding: 2px 8px; border-radius: 3px; cursor: pointer; user-select: none; }
  .pv-canvas-toggle input { width: 12px; height: 12px; margin: 0; cursor: pointer; accent-color: #cc2222; }
  .pv-canvas-toggle:hover { background: rgba(204,34,34,0.6); }

  .pv-resizer { background: transparent; cursor: col-resize; position: relative; }
  .pv-resizer::before { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; transform: translateX(-50%); background: #eee; transition: background 0.15s; }
  .pv-resizer:hover::before, .pv-resizer.dragging::before { background: #cc2222; }

  .pv-side { display: flex; flex-direction: column; min-height: 0; min-width: 0; border: 1px solid #eee; border-radius: 4px; background: #fff; overflow: hidden; }
  .pv-tabs { display: flex; border-bottom: 1px solid #eee; background: #fafafa; }
  .pv-tab { background: transparent; border: 0; padding: 8px 14px; font: 600 12px Arial; color: #666; cursor: pointer; display: flex; align-items: center; gap: 6px; border-bottom: 2px solid transparent; }
  .pv-tab:hover { color: #cc2222; }
  .pv-tab.active { color: #cc2222; border-bottom-color: #cc2222; background: #fff; }
  .pv-dot { width: 6px; height: 6px; border-radius: 50%; background: #cc2222; }
  .pv-ic { font-size: 11px; opacity: 0.85; line-height: 1; }

  .pv-pane { display: flex; flex-direction: column; min-height: 0; flex: 1; }
  .pv-pane-head { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid #eee; flex-wrap: wrap; }
  .pv-spacer { flex: 1; }

  .pv-params { padding: 0; }
  /* Param controls now render via the shared <ParamGrid> (the same
     .pr-card grid the /components inspector uses). This wrapper just
     handles padding + scroll. */
  .pv-params-grid { padding: 8px 12px 12px; overflow-y: auto; }
  /* Still used by the Profile tab's pane head. */
  .pv-pname { font: 12px monospace; color: #333; }

  .pv-source { padding: 0; }
  .pv-editor-wrap { flex: 1; min-height: 0; border-top: 1px solid #eee; padding: 0 0 8px 0; display: flex; flex-direction: column; overflow: hidden; }
  .pv-editor-wrap :global(.cm-editor) { flex: 1; }
  .pv-editor-wrap :global(.cm-scroller) { padding-bottom: 24px; }

  .pv-pill { font: 10px Arial; color: #555; background: #f0f0f0; padding: 2px 8px; border-radius: 10px; }
  .pv-pill.dirty { background: #fff8e6; color: #6a5500; }

  .pv-btn { padding: 4px 10px; border: 1px solid #ccc; border-radius: 4px; background: #fff; font: 11px Arial; cursor: pointer; }
  .pv-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .pv-btn.primary { background: #cc2222; color: #fff; border-color: #cc2222; }
  .pv-btn.primary:disabled { background: #888; border-color: #888; }

  /* AI tab — mirrors the /components ai-pane look (purple accent). */
  .pv-tab-ai.active { color: #7c4dff; border-bottom-color: #7c4dff; }
  .pv-tab-ai:hover { color: #7c4dff; }
  .pv-subtab { background: transparent; border: 0; padding: 4px 8px; font: 600 11px Arial; color: #888; cursor: pointer; border-radius: 4px; }
  .pv-subtab.active { color: #7c4dff; background: #f0eafe; }
  .pv-ai { padding: 0; }
  .pv-ai-body { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 14px; }
  .pv-ai-sec { display: flex; flex-direction: column; gap: 6px; }
  .pv-ai-h { font: 600 11px Arial; color: #444; }
  .pv-ai-sub { font: 10px Arial; color: #999; font-weight: 400; }
  .pv-ai-prompt { width: 100%; box-sizing: border-box; font: 12px ui-monospace, monospace; padding: 6px 8px; border: 1px solid #ccc; border-radius: 4px; resize: vertical; }
  .pv-ai-prompt:focus { outline: 1px solid #7c4dff; border-color: #7c4dff; }
  .pv-ai-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .pv-ai-err { font: 11px Arial; color: #c4392f; }
  .pv-ai-proposal { border: 1px solid #d8d4e8; border-radius: 4px; padding: 8px; background: #faf8ff; display: flex; flex-direction: column; gap: 6px; }
  .pv-ai-pre { margin: 0; max-height: 240px; overflow: auto; font: 11px ui-monospace, monospace; background: #fff; border: 1px solid #eee; border-radius: 3px; padding: 8px; white-space: pre-wrap; word-break: break-word; }
  .pv-ai-note { margin: 0; font: 10px Arial; color: #888; }
  .pv-ai-empty { font: 12px Arial; color: #888; padding: 16px 4px; }
  .pv-ai-hist { display: flex; flex-direction: column; gap: 2px; }
  .pv-ai-hrow { display: flex; align-items: flex-start; gap: 6px; text-align: left; background: transparent; border: 0; border-radius: 3px; padding: 5px 6px; cursor: pointer; font: 11px ui-monospace, monospace; color: #444; }
  .pv-ai-hrow:hover { background: #f4f4f8; }
  .pv-ai-hmark { flex-shrink: 0; color: #aaa; width: 12px; text-align: center; }
  .pv-ai-hmark.ok { color: #2e7d32; }
  .pv-ai-hmark.no { color: #c4392f; }
  .pv-ai-hprompt { flex: 1; overflow: hidden; text-overflow: ellipsis; }
</style>
