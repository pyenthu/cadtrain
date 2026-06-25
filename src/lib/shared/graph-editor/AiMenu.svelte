<!--
  AiMenu.svelte — the ✨ AI-generate popover (RAG Phase 2), extracted from
  GraphEditorPane (modularize K.65, mirrors the RepeatEditorPane / Popovers /
  CanvasMenu carves).

  Owns the CURRENT generate flow: the prompt textarea + busy/error/candidate
  state, the POST to /api/rag/prompt, and the resizable width (persisted to
  localStorage `ge-ai-menu-w`). On success it calls `onGenerated(id, rawGraph,
  candidates)` — GEP's handler hydrates the proposed graph into the open tab and
  relabels it; if hydration throws, this component surfaces it as an in-panel
  error and stays open.

  GEP OWNS the open/anchor (`aiMenuOpen` + `aiBtnEl` + `aiMenuPos` +
  `openAiMenu`). The button is at the BOTTOM of the rail, so the panel can spill
  below the viewport — this component clamps its own top on mount (it measures
  its own height). CSS (.ge-canvas-menu* shell + .ge-ai-*) is duplicated here
  from GEP so Svelte's scoped CSS applies.

  NOTE: this is the CURRENT generate flow; the planned RAG assist panel
  (ge-assist.*) is separate and not touched here.
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';

  let {
    pos,
    onGenerated,
    onClose,
  }: {
    /** Viewport position anchored to the ✨ button (GEP's aiMenuPos). */
    pos: { left: number; top: number };
    /** Called on a successful generate. May throw if the graph can't hydrate —
     *  this component catches it and shows the in-panel error. */
    onGenerated: (id: string, graph: any, candidates: string[]) => void;
    onClose: () => void;
  } = $props();

  let aiPrompt = $state('');
  let aiBusy = $state(false);
  let aiError = $state<string | null>(null);
  let aiCandidates = $state<string[]>([]);
  let aiPanelEl = $state<HTMLDivElement | null>(null);

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

  async function generateFromPrompt() {
    const prompt = aiPrompt.trim();
    if (!prompt || aiBusy) return;
    aiBusy = true;
    aiError = null;
    aiCandidates = [];
    try {
      const r = await fetch('/api/rag/prompt', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!r.ok) { aiError = `generate ${r.status}: ${(await r.text()).slice(0, 200)}`; return; }
      const j = await r.json();
      if (!j?.graph) { aiError = 'no graph in response'; return; }
      aiCandidates = Array.isArray(j.candidates) ? j.candidates : [];
      // Hand the proposed graph to GEP, which hydrates it INTO the current tab
      // (in place) + relabels. If hydration fails it throws → show the error
      // and keep the panel open.
      try {
        onGenerated(String(j.id || ''), j.graph, aiCandidates);
      } catch (e) {
        console.warn('[graph-editor] generated graph failed to hydrate', e);
        aiError = 'the generated graph could not be loaded';
        return;
      }
      aiPrompt = '';
      onClose();
    } catch (e: any) {
      aiError = e?.message ?? String(e);
    } finally {
      aiBusy = false;
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
  style="left: {pos.left}px; top: {topPx}px; width: {aiMenuW}px">
  <div class="ge-ai-title">✨ Generate a part</div>
  <div class="ge-ai-hint">Describe the part in plain words — e.g.
    <em>flat coil disc, 2 turns, 60 segments</em>. Similar parts are
    retrieved from the RAG corpus and Claude proposes a parametric
    graph, opened in a new tab for review. Nothing touches the volume
    until you Save.</div>
  <!-- svelte-ignore a11y_autofocus -->
  <textarea class="ge-ai-input" rows="3" autofocus
    placeholder="hexagonal prism with a central round bore…"
    bind:value={aiPrompt}
    disabled={aiBusy}
    onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generateFromPrompt(); } }}></textarea>
  <div class="ge-ai-actions">
    <button class="ge-ai-go" type="button"
      disabled={aiBusy || !aiPrompt.trim()}
      onclick={generateFromPrompt}>{aiBusy ? 'generating…' : 'Generate'}</button>
    {#if aiError}
      <span class="ge-ai-err" title={aiError}>failed — hover for detail</span>
    {:else if aiCandidates.length > 0}
      <span class="ge-ai-from">from: {aiCandidates.join(' · ')}</span>
    {/if}
  </div>
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
       to localStorage (ge-ai-menu-w). overflow:hidden is required for
       CSS resize to engage. */
    resize: horizontal; overflow: hidden;
    min-width: 264px; max-width: 720px;
  }
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
</style>
