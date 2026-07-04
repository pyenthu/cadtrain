<!--
  AiMenu.svelte — the ✨ in-canvas AI ASSIST popover, extracted from
  GraphEditorPane (modularize K.65).

  EDIT-ONLY: in the canvas we are always inside a part, so this is purely the
  multi-shot assist loop that tool-calls the OPEN part (`session.run` →
  /api/rag/assist). There is NO Generate-a-new-part mode here — that lives in
  the sidebar. The panel is DRAGGABLE (header handle) + resizable (CSS grip,
  width persisted to localStorage `ge-ai-menu-w`) + scrollable (max-height).

  GEP OWNS the open/anchor (`aiMenuOpen` + `aiBtnEl` + `aiMenuPos` +
  `openAiMenu`). The button is at the BOTTOM of the rail, so the panel can spill
  below the viewport — this component clamps its own top on mount (until the user
  drags it). CSS (.ge-canvas-menu* shell + .ge-ai-*) is duplicated here from GEP
  so Svelte's scoped CSS applies.
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';

  import { clampDragPos } from './popover-clamp';
  import type { AssistSession } from './ge-assist.svelte';

  let {
    pos,
    onClose,
    session,
  }: {
    /** Viewport position anchored to the ✨ button (GEP's aiMenuPos). */
    pos: { left: number; top: number };
    onClose: () => void;
    /** The pane's "edit this part" assist session (multi-shot tool loop) —
     *  the ONLY mode here: in the canvas we're always editing the open part.
     *  (Generate-a-new-part lives in the sidebar.) */
    session?: AssistSession;
  } = $props();

  let editPrompt = $state('');

  async function runEdit() {
    const p = editPrompt.trim();
    if (!p || !session || session.running) return;
    await session.run(p);
    editPrompt = '';
  }
  /** Compact one-line summary of a tool's input for the transcript. */
  const summ = (v: unknown) => {
    try { const s = JSON.stringify(v); return s.length > 64 ? s.slice(0, 64) + '…' : s; }
    catch { return ''; }
  };

  let aiPanelEl = $state<HTMLDivElement | null>(null);

  // ─── drag (header handle) — mirrors the expr popover ──────────────────────
  let dragPos = $state<{ x: number; y: number } | null>(null);
  let dragging = false;
  let dragOff = { x: 0, y: 0 };
  function onHeadPointerDown(ev: PointerEvent) {
    if ((ev.target as HTMLElement).closest('button, textarea, input')) return;
    const r = aiPanelEl?.getBoundingClientRect();
    if (!r) return;
    dragOff = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    dragging = true;
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
  }
  function onHeadPointerMove(ev: PointerEvent) {
    if (!dragging) return;
    dragPos = clampDragPos(aiPanelEl, ev.clientX - dragOff.x, ev.clientY - dragOff.y);
  }
  function onHeadPointerUp() { dragging = false; }

  /** Popover width — user-resizable via the native CSS resize grip
   *  (bottom-right corner); persisted so the chosen width sticks. */
  let aiMenuW = $state<number>(360);
  try { const w = Number(localStorage.getItem('ge-ai-menu-w')); if (w >= 264) aiMenuW = Math.min(720, w); } catch { /* SSR/off */ }

  /** The ✨ button lives at the BOTTOM of the rail, so anchoring the popover's
   *  top to the button can spill it below the viewport. After it renders,
   *  measure + clamp so the whole panel stays on-screen (shift UP if needed,
   *  never above a 12px top margin). */
  let topPx = $state(pos.top);
  onMount(async () => {
    await tick();
    if (aiPanelEl) {
      const h = aiPanelEl.offsetHeight;
      const margin = 12;
      const maxTop = window.innerHeight - h - margin;
      topPx = Math.max(margin, Math.min(pos.top, maxTop));
    }
  });

  function persistAiMenuW() {
    if (!aiPanelEl) return;
    const w = aiPanelEl.offsetWidth;
    if (w >= 264) {
      aiMenuW = w;
      try { localStorage.setItem('ge-ai-menu-w', String(w)); } catch { /* ignore */ }
    }
  }

</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="ge-canvas-menu-shade" onclick={onClose}></div>
<!-- ✨ generate popover — same anchored-dropdown chrome as the ⚙ menu.
     Describe → BM25-retrieve similar parts → Claude proposes a graph → opens
     in the current tab; nothing is saved until the user hits Save. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="ge-canvas-menu ge-ai-menu"
  bind:this={aiPanelEl}
  onpointerup={persistAiMenuW}
  style="left: {dragPos ? dragPos.x : pos.left}px; top: {dragPos ? dragPos.y : topPx}px; width: {aiMenuW}px">
  <!-- drag handle — the whole header bar moves the window -->
  <div class="ge-ai-head" onpointerdown={onHeadPointerDown}
    onpointermove={onHeadPointerMove} onpointerup={onHeadPointerUp} onpointercancel={onHeadPointerUp}>
    <span class="ge-ai-headlabel">✎ AI assist</span>
    <button class="ge-ai-headx" type="button" onclick={onClose} title="Close">×</button>
  </div>
  {#if session}
    <!-- ✎ AI assist — the multi-shot loop tool-calls the OPEN part. We're already
         in a part, so there's no Generate mode here (that lives in the sidebar). -->
    <div class="ge-ai-hint">What to change? e.g. <em>add a point at r=2, z=0</em>. Saved on 💾.</div>
    <!-- svelte-ignore a11y_autofocus -->
    <textarea class="ge-ai-input" rows="2" autofocus
      placeholder="add a point at r=2, z=0…"
      bind:value={editPrompt}
      disabled={session.running}
      onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runEdit(); } }}></textarea>
    <div class="ge-ai-actions">
      {#if session.running}
        <button class="ge-ai-stop" type="button" onclick={() => session.stop()}>{session.stopping ? 'stopping…' : '◼ Stop'}</button>
      {:else}
        <button class="ge-ai-go" type="button" disabled={!editPrompt.trim()} onclick={runEdit}>Run</button>
      {/if}
      {#if session.steps.length}
        <button class="ge-ai-clear" type="button" onclick={() => session.reset()}>clear</button>
      {/if}
      {#if session.error}<span class="ge-ai-err" title={session.error}>error — hover</span>{/if}
    </div>
    {#if session.steps.length}
      <div class="ge-ai-transcript">
        {#each session.steps as s}
          <div class="ge-ai-step k-{s.kind}">
            {#if s.kind === 'user'}<span class="ge-ai-glyph">▸</span>{s.text}
            {:else if s.kind === 'assistant_text'}{s.text}
            {:else if s.kind === 'tool' && s.ok}<span class="ge-ai-glyph ok">✓</span><b>{s.tool}</b> <code>{summ(s.input)}</code>
            {:else if s.kind === 'tool'}<span class="ge-ai-glyph bad">✗</span><b>{s.tool}</b> — {s.error}
            {:else if s.kind === 'note'}<span class="ge-ai-glyph">·</span>{s.text}
            {:else if s.kind === 'error'}<span class="ge-ai-glyph bad">⚠</span>{s.text}{/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  /* Backdrop covers the viewport so an outside click closes the menu.
     `position: fixed` matches the menu's own fixed positioning. */
  .ge-canvas-menu-shade {
    position: fixed; inset: 0;
    z-index: 99;
  }
  .ge-canvas-menu {
    position: fixed;
    background: #fff; border: 1px solid #d6d3d1; border-radius: 6px;
    padding: 4px; width: 200px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.06);
    z-index: 100; display: flex; flex-direction: column;
  }
  /* ✨ generate popover — shares the .ge-canvas-menu shell; violet accents
     match the rest of the AI/parametric family. */
  .ge-ai-menu {
    padding: 8px; gap: 6px;
    /* User-resizable via the native bottom-right grip; width persisted
       to localStorage (ge-ai-menu-w). A non-visible overflow is required for
       CSS resize to engage — overflow-x:hidden keeps the grip working while
       overflow-y:auto + max-height makes the panel SCROLL when its content
       (esp. the assistant transcript) is taller than the viewport. */
    resize: horizontal; overflow-x: hidden; overflow-y: auto;
    min-width: 264px; max-width: 720px; max-height: calc(100vh - 24px);
  }
  /* draggable header bar (the whole strip is the handle). */
  .ge-ai-head {
    display: flex; align-items: center; gap: 6px; margin: -2px 0 2px;
    cursor: move; user-select: none; touch-action: none;
  }
  .ge-ai-headlabel { font: 700 12px Arial; color: #4c1d95; }
  .ge-ai-headx {
    margin-left: auto; border: none; background: none; cursor: pointer;
    font: 700 14px Arial; color: #9ca3af; line-height: 1; padding: 0 2px;
  }
  .ge-ai-headx:hover { color: #4c1d95; }
  .ge-ai-title { font: 700 12px Arial; color: #4c1d95; }
  .ge-ai-hint { font: 11px Arial; color: #6b7280; line-height: 1.45; }
  .ge-ai-hint em { color: #5b21b6; font-style: normal; }
  .ge-ai-input {
    width: 100%; box-sizing: border-box; resize: vertical;
    padding: 5px 8px; font: 12px ui-monospace, monospace;
    border: 1px solid #c4b5fd; border-radius: 4px; background: #faf5ff;
  }
  .ge-ai-input:focus { outline: 1px solid #6d28d9; background: #fff; }
  .ge-ai-input:disabled { opacity: 0.6; }
  .ge-ai-actions { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .ge-ai-go {
    padding: 4px 12px; font: 600 12px Arial; cursor: pointer;
    background: #6d28d9; color: #fff; border: 1px solid #5b21b6; border-radius: 4px;
  }
  .ge-ai-go:hover:not(:disabled) { background: #5b21b6; }
  .ge-ai-go:disabled { opacity: 0.5; cursor: default; }
  .ge-ai-err { font: 10px Arial; color: #b91c1c; }
  .ge-ai-from { font: 10px Arial; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Generate|Edit toggle + the edit-mode transcript. */
  .ge-ai-tabs { display: flex; gap: 4px; border-bottom: 1px solid #ede9fe; padding-bottom: 5px; }
  .ge-ai-tabs button { flex: 1; font: 600 11px Arial; color: #6b7280; background: #f5f3ff; border: 1px solid transparent; border-radius: 5px; padding: 4px 8px; cursor: pointer; }
  .ge-ai-tabs button:hover { background: #ede9fe; }
  .ge-ai-tabs button.on { color: #4c1d95; background: #ede9fe; border-color: #c4b5fd; }
  .ge-ai-stop { padding: 4px 12px; font: 600 12px Arial; cursor: pointer; background: #b91c1c; color: #fff; border: 1px solid #991b1b; border-radius: 4px; }
  .ge-ai-stop:hover { background: #991b1b; }
  .ge-ai-clear { font: 11px Arial; color: #6b7280; background: none; border: none; cursor: pointer; text-decoration: underline; }
  .ge-ai-transcript { display: flex; flex-direction: column; gap: 2px; max-height: 240px; overflow-y: auto; padding: 6px 8px; background: #faf5ff; border: 1px solid #ede9fe; border-radius: 5px; }
  .ge-ai-step { font: 11px ui-monospace, monospace; color: #374151; line-height: 1.45; word-break: break-word; }
  .ge-ai-step b { color: #4338ca; }
  .ge-ai-step code { color: #6b7280; font-size: 10px; }
  .ge-ai-step.k-assistant_text { color: #166534; font-family: Arial; }
  .ge-ai-step.k-error { color: #b91c1c; }
  .ge-ai-glyph { display: inline-block; width: 13px; color: #a78bfa; }
  .ge-ai-glyph.ok { color: #16a34a; }
  .ge-ai-glyph.bad { color: #b91c1c; }
</style>
