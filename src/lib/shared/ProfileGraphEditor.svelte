<script lang="ts">
  /**
   * ProfileGraphEditor — 2D-mode sister of GraphEditorPane (Phase 2 v1).
   *
   * Same structural shell as the part editor — vertical rail with action
   * buttons + canvas pane with cards/wires + right pane with three tabs
   * (2D PREVIEW / SRC / MD). The graph itself is minimal in v1: an
   * Output card receives a polygon from a Polygon card (literal [r,z]
   * array, inline-editable). Future slices add Mirror / Array / drag-
   * point editing — see PROFILE_TODO comments below.
   *
   * Why a separate component instead of GraphEditorPane(mode='profile'):
   * the data model (node types, output socket kind, save endpoint) and
   * the right-pane preview (2D SVG vs 3D Threlte) are different enough
   * that overloading GraphEditorPane would balloon its branching past
   * the point of usefully sharing. We DO mirror its visual chrome 1-to-1
   * (same trapezoidal rail, same `.ge-*` class names where pixel-
   * identical, same Flowbite-style popovers).
   */
  import { onMount } from 'svelte';

  let { id }: { id: string } = $props();

  type Meta = {
    id: string; label?: string; description?: string;
    set: 'revolve' | 'cartesian';
    tags?: string[];
    params?: Record<string, { default?: number; min?: number; max?: number; step?: number }>;
  };

  let meta = $state<Meta | null>(null);
  let source = $state<string>('');
  let loadErr = $state<string | null>(null);
  let loading = $state(true);

  // Resolved polygon points — what build() returns with current params.
  let points = $state<[number, number][]>([]);
  let resolveErr = $state<string | null>(null);
  // Editable JSON literal mirror of `points` — the Polygon node body.
  // Saved-back through composeBody() → `/api/primitives/profiles/save`.
  // PROFILE_TODO Phase 2.1: replace the textarea with point dragging
  // on the canvas + visual point handles in the polygon card.
  let polygonText = $state<string>('');
  let polygonErr = $state<string | null>(null);

  // Right-pane tab strip — same three tabs as the part editor, with
  // "3D BAKE" renamed to "2D PREVIEW".
  type RightTab = 'preview' | 'source' | 'md';
  let rightTab = $state<RightTab>('preview');

  // Split between canvas (left) and right pane — same drag-divider as
  // GraphEditorPane's `splitA`. Persisted to localStorage per-profile.
  let splitA = $state(60);
  let dragging = $state(false);
  let dragRect: DOMRect | null = null;
  function onDividerDown(ev: PointerEvent) {
    dragging = true;
    const grid = (ev.currentTarget as HTMLElement).parentElement!;
    dragRect = grid.getBoundingClientRect();
    window.addEventListener('pointermove', onDividerMove);
    window.addEventListener('pointerup', onDividerUp);
  }
  function onDividerMove(ev: PointerEvent) {
    if (!dragging || !dragRect) return;
    const pct = ((ev.clientX - dragRect.left) / dragRect.width) * 100;
    splitA = Math.max(20, Math.min(80, pct));
  }
  function onDividerUp() {
    dragging = false; dragRect = null;
    window.removeEventListener('pointermove', onDividerMove);
    window.removeEventListener('pointerup', onDividerUp);
    try { localStorage.setItem(`pge-split-${id}`, String(Math.round(splitA))); } catch { /* ignore */ }
  }

  async function load() {
    loading = true; loadErr = null;
    try {
      const r = await fetch(`/api/primitives/profiles/source?id=${encodeURIComponent(id)}`);
      if (!r.ok) { loadErr = `Source ${r.status}: ${(await r.text()).slice(0, 200)}`; return; }
      const d = await r.json();
      meta = d as Meta;
      source = d.source ?? '';
      await resolvePoints();
      polygonText = JSON.stringify(points, (k, v) => typeof v === 'number' ? Number(v.toFixed(4)) : v, 2);
      try {
        const s = localStorage.getItem(`pge-split-${id}`);
        if (s) splitA = Math.max(20, Math.min(80, Number(s)));
      } catch { /* ignore */ }
    } catch (e: any) {
      loadErr = e?.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  function defaultsOf(params: Meta['params']): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(params ?? {})) out[k] = Number(v?.default ?? 0);
    return out;
  }

  async function resolvePoints(srcOverride?: string) {
    if (!meta) return;
    resolveErr = null;
    try {
      const r = await fetch('/api/primitives/profiles/resolve', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: srcOverride ?? source, params: defaultsOf(meta.params) }),
      });
      if (!r.ok) { resolveErr = `Resolve ${r.status}: ${(await r.text()).slice(0, 200)}`; return; }
      const d = await r.json();
      points = Array.isArray(d.points) ? d.points : [];
    } catch (e: any) { resolveErr = e?.message ?? String(e); }
  }

  /** Apply the textarea edits — parse the JSON, store as `points`, then
   *  regenerate a build() body that returns the parsed array literally. */
  function applyPolygon() {
    try {
      const parsed = JSON.parse(polygonText);
      if (!Array.isArray(parsed) || parsed.some((p) => !Array.isArray(p) || p.length !== 2)) {
        polygonErr = 'Expected [[r,z], …] (or [[x,y], …] for cartesian)';
        return;
      }
      points = parsed.map((p) => [Number(p[0]), Number(p[1])]);
      polygonErr = null;
      // Mirror back into the editable source so SRC tab shows the new body.
      source = `export function build(p) {\n  return ${JSON.stringify(points)};\n}\n`;
    } catch (e: any) {
      polygonErr = e?.message ?? String(e);
    }
  }

  let saveBusy = $state(false);
  let saveOk = $state<string | null>(null);
  let saveErr = $state<string | null>(null);
  async function save() {
    if (!meta) return;
    saveBusy = true; saveOk = null; saveErr = null;
    try {
      const r = await fetch('/api/primitives/profiles/save', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id, label: meta.label ?? id, description: meta.description ?? '',
          set: meta.set, tags: meta.tags ?? [], params: meta.params ?? {},
          source,
        }),
      });
      if (!r.ok) { saveErr = `Save ${r.status}: ${(await r.text()).slice(0, 200)}`; return; }
      saveOk = `saved · ${new Date().toLocaleTimeString()}`;
      setTimeout(() => { saveOk = null; }, 2500);
    } catch (e: any) { saveErr = e?.message ?? String(e); }
    finally { saveBusy = false; }
  }

  async function rebake() {
    await resolvePoints();
  }

  onMount(() => { void load(); });

  // 2D preview SVG (axis + polygon + vertex handles). Same logic as
  // ProfilePane — shared by the right-pane tab AND a small thumbnail
  // inside the Polygon card itself.
  function buildView(pts: [number, number][], set: 'revolve' | 'cartesian' | undefined) {
    if (pts.length === 0) return null;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const w = Math.max(0.001, xMax - xMin), h = Math.max(0.001, yMax - yMin);
    const pad = Math.max(w, h) * 0.08;
    return {
      vb: `${xMin - pad} ${yMin - pad} ${w + 2 * pad} ${h + 2 * pad}`,
      d: pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z',
      yFlip: set === 'cartesian',
      axis: set === 'revolve',
      xMin, yMin, w, h, pad,
    };
  }
  const view = $derived(buildView(points, meta?.set));
</script>

<div class="pge-root">
  <!-- Vertical rail — same trapezoidal column as GraphEditorPane. Only
       the actions that make sense for 2D polygon authoring; ghost
       overlay + the 3D push-apart settings menu are dropped. -->
  <aside class="pge-vrail">
    <button class="pge-vrail-btn" type="button"
      onclick={applyPolygon} title="Apply Polygon edits + refresh 2D preview">
      <span class="pge-glyph">＋</span>
    </button>
    <button class="pge-vrail-btn save" type="button"
      disabled={saveBusy} onclick={save}
      title={saveBusy ? 'Saving…' : `Save profile ${id} to the volume`}>
      <span class="pge-glyph">💾</span>
    </button>
    <button class="pge-vrail-btn bake" type="button"
      onclick={rebake} title="Re-resolve build() with current params">
      <span class="pge-glyph">🔨</span>
    </button>
    <div class="pge-vrail-sep"></div>
    <button class="pge-vrail-btn" type="button"
      onclick={() => { polygonText = JSON.stringify(points, (k, v) => typeof v === 'number' ? Number(v.toFixed(4)) : v, 2); }}
      title="Restore polygon textarea from the resolved points">
      <span class="pge-glyph">⟲</span>
    </button>
  </aside>

  <main class="pge-grid" style="grid-template-columns: {splitA}% 6px 1fr">
    <!-- LEFT — canvas with the (currently minimal) graph: Output ←─ Polygon. -->
    <section class="pge-canvas-pane">
      {#if loading}
        <div class="pge-empty">loading profile…</div>
      {:else if loadErr}
        <div class="pge-err">{loadErr}</div>
      {:else}
        <!-- Output card — fixed top-right. Same green chrome as part editor. -->
        <div class="pge-card output">
          <header>
            <span class="pge-glyph">▶</span>
            <span class="pge-card-title">Output</span>
            <span class="pge-card-tag">polygon</span>
          </header>
          <div class="pge-card-body">
            <div class="pge-arg-row">
              <span class="pge-socket polygon-in"></span>
              <span class="pge-arg-name">profile</span>
              <span class="pge-arg-val">← Polygon</span>
            </div>
          </div>
        </div>

        <!-- Polygon card — the only producer in v1. Inline JSON textarea
             for now; PROFILE_TODO Phase 2.1 swaps in vertex drag handles
             on the 2D thumbnail below. -->
        <div class="pge-card polygon">
          <header>
            <span class="pge-glyph">◊</span>
            <span class="pge-card-title">Polygon</span>
            <span class="pge-card-tag">{meta?.set === 'cartesian' ? '(x, y)' : '(r, z)'}</span>
            <span class="pge-card-socket-out polygon-out"></span>
          </header>
          <div class="pge-card-body">
            <label class="pge-arg-row col">
              <span class="pge-arg-name">points</span>
              <textarea class="pge-points-edit" rows="6"
                bind:value={polygonText}
                onkeydown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) applyPolygon(); }}
                placeholder="[[r0, z0], [r1, z1], …]"></textarea>
              {#if polygonErr}<span class="pge-arg-err">{polygonErr}</span>{/if}
              <button type="button" class="pge-apply-btn" onclick={applyPolygon}>
                Apply (⌘↩)
              </button>
            </label>
            <!-- Inline thumbnail of the current points -->
            {#if view}
              <svg class="pge-card-thumb" viewBox={view.vb} preserveAspectRatio="xMidYMid meet">
                <g transform={view.yFlip ? `scale(1, -1) translate(0, ${-(2 * view.yMin + view.h)})` : ''}>
                  {#if view.axis}
                    <line x1="0" y1={view.yMin - view.pad} x2="0" y2={view.yMin + view.h + view.pad}
                      stroke="#cbd5e1" stroke-width={Math.max(view.w, view.h) * 0.006}
                      stroke-dasharray={`${Math.max(view.w, view.h) * 0.02} ${Math.max(view.w, view.h) * 0.02}`}/>
                  {/if}
                  <path d={view.d} fill="rgba(204, 34, 34, 0.18)" stroke="#991b1b"
                    stroke-width={Math.max(view.w, view.h) * 0.01} stroke-linejoin="round"/>
                  {#each points as p}
                    <circle cx={p[0]} cy={p[1]} r={Math.max(view.w, view.h) * 0.012} fill="#991b1b"/>
                  {/each}
                </g>
              </svg>
            {/if}
          </div>
        </div>

        <!-- Wire from Polygon.out → Output.in. Drawn as a static SVG path
             since the Polygon card sits below Output for a clean L-shape
             route. Will become interactive when we add real wires. -->
        <svg class="pge-wires" aria-hidden="true">
          <path d="M 360 232 C 420 232, 460 132, 520 132" stroke="#cc2222" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        </svg>

        <!-- Status strip pinned bottom-left — mirrors GraphEditorPane. -->
        <div class="pge-status">
          {#if saveOk}<span class="ok">{saveOk}</span>{/if}
          {#if saveErr}<span class="err">{saveErr}</span>{/if}
          <span class="stat">{points.length} pts · 1 polygon node</span>
        </div>
      {/if}
    </section>

    <!-- DIVIDER -->
    <div class="pge-divider" role="separator" aria-orientation="vertical" tabindex="-1"
      onpointerdown={onDividerDown}></div>

    <!-- RIGHT — three tabs (2D PREVIEW / SRC / MD) matching the part editor. -->
    <section class="pge-right-pane">
      <div class="pge-pane-tabs">
        <button class:on={rightTab === 'preview'} type="button"
          onclick={() => (rightTab = 'preview')}>2D PREVIEW</button>
        <button class:on={rightTab === 'source'} type="button"
          onclick={() => (rightTab = 'source')}>SRC</button>
        <button class:on={rightTab === 'md'} type="button"
          onclick={() => (rightTab = 'md')}>MD</button>
      </div>
      <div class="pge-pane-body">
        {#if rightTab === 'preview'}
          <div class="pge-preview">
            <div class="pge-preview-head">{meta?.label || id} · {points.length} points</div>
            {#if view}
              <svg class="pge-preview-svg" viewBox={view.vb} preserveAspectRatio="xMidYMid meet">
                <g transform={view.yFlip ? `scale(1, -1) translate(0, ${-(2 * view.yMin + view.h)})` : ''}>
                  {#if view.axis}
                    <line x1="0" y1={view.yMin - view.pad} x2="0" y2={view.yMin + view.h + view.pad}
                      stroke="#94a3b8" stroke-width={Math.max(view.w, view.h) * 0.005}
                      stroke-dasharray={`${Math.max(view.w, view.h) * 0.02} ${Math.max(view.w, view.h) * 0.02}`}/>
                  {/if}
                  <path d={view.d} fill="rgba(204, 34, 34, 0.22)" stroke="#991b1b"
                    stroke-width={Math.max(view.w, view.h) * 0.008} stroke-linejoin="round"/>
                  {#each points as p, i}
                    <circle cx={p[0]} cy={p[1]} r={Math.max(view.w, view.h) * 0.012} fill="#991b1b">
                      <title>[{p[0].toFixed(3)}, {p[1].toFixed(3)}] · #{i}</title>
                    </circle>
                  {/each}
                </g>
              </svg>
            {:else if resolveErr}
              <div class="pge-err inline">{resolveErr}</div>
            {:else}
              <div class="pge-empty">no points</div>
            {/if}
          </div>
        {:else if rightTab === 'source'}
          <pre class="pge-source">{source}</pre>
        {:else}
          <div class="pge-md-empty">
            <p><strong>{meta?.label || id}</strong></p>
            {#if meta?.description}<p>{meta.description}</p>{/if}
            <p class="hint">Drawing markdown for profiles is a Phase 2.2 follow-up.</p>
          </div>
        {/if}
      </div>
    </section>
  </main>
</div>

<style>
  /* Same outer shell as GraphEditorPane — 48 px rail + 1fr body. Visual
     parity with the part editor is deliberate: a user fluent in one is
     fluent in the other. Class names are `.pge-*` instead of `.ge-*`
     so the two don't fight if both ever co-mount (impossible today
     but cheap insurance). */
  .pge-root {
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    grid-template-columns: 48px 1fr;
    height: 100%; min-height: 0;
    font-family: Arial; color: #1f2937;
    position: relative;
    background: #fff;
  }
  .pge-vrail {
    display: flex; flex-direction: column;
    align-items: center; gap: 6px;
    padding: 10px 4px; background: #f8fafc;
    border-right: 1px solid #e5e7eb;
    overflow-y: auto;
  }
  .pge-vrail-btn {
    display: flex; align-items: center; justify-content: center;
    width: 36px; height: 36px;
    background: #fff; color: #44403c;
    border: 1px solid #e5e7eb; border-radius: 8px;
    font-size: 16px; line-height: 1; cursor: pointer;
    transition: background 120ms, border-color 120ms;
  }
  .pge-vrail-btn:hover { background: #f3f4f6; border-color: #cbd5e1; }
  .pge-vrail-btn.save:hover { background: #d1fae5; color: #14532d; border-color: #6ee7b7; }
  .pge-vrail-btn.bake { color: #ea580c; }
  .pge-vrail-btn.bake:hover { background: #ffedd5; color: #9a3412; border-color: #fdba74; }
  .pge-vrail-btn:disabled { opacity: 0.5; cursor: wait; }
  .pge-vrail-sep { width: 24px; height: 1px; background: #e5e7eb; margin: 4px 0; }
  .pge-glyph { display: inline-flex; }

  .pge-grid {
    display: grid; min-height: 0; overflow: hidden;
  }
  .pge-canvas-pane {
    position: relative; overflow: hidden;
    background: #fafaf9;
    background-image:
      linear-gradient(to right, #e5e7eb 1px, transparent 1px),
      linear-gradient(to bottom, #e5e7eb 1px, transparent 1px);
    background-size: 32px 32px;
  }

  /* ─── Cards (Output / Polygon) ─────────────────────────────────────── */
  .pge-card {
    position: absolute;
    border: 1.5px solid #94a3b8; border-radius: 8px;
    background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.08);
    min-width: 240px;
  }
  .pge-card.output {
    top: 90px; left: 460px;
    border-color: #15803d; background: linear-gradient(to bottom, #f0fdf4, #fff);
  }
  .pge-card.polygon {
    top: 210px; left: 120px;
    border-color: #c2410c; background: linear-gradient(to bottom, #fff7ed, #fff);
  }
  .pge-card header {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px;
    background: rgba(255,255,255,0.7);
    border-bottom: 1px solid #e5e7eb;
    border-radius: 6px 6px 0 0;
    position: relative;
  }
  .pge-card-title { font: 700 13px Arial; color: #1f2937; }
  .pge-card-tag { font: 10px ui-monospace, monospace; color: #78716c; padding: 1px 6px; background: #f5f5f4; border-radius: 3px; }
  .pge-card-body { padding: 8px 10px; }
  .pge-arg-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
  .pge-arg-row.col { flex-direction: column; align-items: stretch; gap: 4px; }
  .pge-arg-name { font: 12px ui-monospace, monospace; color: #57534e; min-width: 60px; }
  .pge-arg-val { font: 11px Arial; color: #78716c; font-style: italic; }
  .pge-arg-err { font: 11px Arial; color: #991b1b; background: #fee2e2; border-radius: 3px; padding: 2px 6px; }
  .pge-points-edit {
    font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
    padding: 6px 8px; border: 1px solid #e5e7eb; border-radius: 4px;
    resize: vertical; min-height: 90px; outline: none;
  }
  .pge-points-edit:focus { border-color: #c2410c; box-shadow: 0 0 0 2px rgba(194,65,12,0.15); }
  .pge-apply-btn {
    font: 600 11px Arial; padding: 4px 10px;
    background: #c2410c; color: #fff; border: 0; border-radius: 4px; cursor: pointer;
    align-self: flex-start;
  }
  .pge-apply-btn:hover { background: #9a3412; }

  /* Sockets — small filled discs flush with the card edge. */
  .pge-socket { display: inline-block; width: 10px; height: 10px; border-radius: 50%; }
  .pge-socket.polygon-in { background: #15803d; border: 2px solid #fff; box-shadow: 0 0 0 1px #15803d; }
  .pge-card-socket-out { position: absolute; right: -7px; top: 50%; transform: translateY(-50%); width: 12px; height: 12px; border-radius: 50%; }
  .pge-card-socket-out.polygon-out { background: #c2410c; border: 2px solid #fff; box-shadow: 0 0 0 1px #c2410c; }

  .pge-card-thumb {
    margin-top: 8px; width: 100%; height: 90px;
    background: #fafaf9; border: 1px dashed #e5e7eb; border-radius: 4px;
  }

  /* Static wire SVG covers the canvas. */
  .pge-wires {
    position: absolute; inset: 0; pointer-events: none;
    width: 100%; height: 100%;
  }

  /* Status strip — bottom-left of the canvas pane. */
  .pge-status {
    position: absolute; left: 12px; bottom: 10px;
    display: flex; align-items: center; gap: 10px;
    z-index: 4;
  }
  .pge-status .stat {
    background: rgba(248, 250, 252, 0.92);
    color: #475569; border: 1px solid #e2e8f0;
    padding: 3px 9px; border-radius: 4px;
    font: 11px ui-monospace, monospace;
  }
  .pge-status .ok {
    background: rgba(220, 252, 231, 0.92);
    color: #15803d; border: 1px solid #86efac;
    padding: 3px 9px; border-radius: 4px;
    font: 11px ui-monospace, monospace;
  }
  .pge-status .err {
    background: rgba(254, 226, 226, 0.92);
    color: #991b1b; border: 1px solid #fca5a5;
    padding: 3px 9px; border-radius: 4px;
    font: 11px ui-monospace, monospace;
  }

  /* ─── Divider ─────────────────────────────────────────────────────── */
  .pge-divider {
    background: #e5e7eb; cursor: col-resize;
  }
  .pge-divider:hover { background: #94a3b8; }

  /* ─── Right pane ───────────────────────────────────────────────────── */
  .pge-right-pane { display: flex; flex-direction: column; min-height: 0; background: #fff; border-left: 1px solid #e5e7eb; }
  .pge-pane-tabs { display: flex; border-bottom: 1px solid #e5e7eb; background: #f8fafc; flex: 0 0 auto; }
  .pge-pane-tabs button {
    flex: 1 1 auto; padding: 8px 12px;
    background: transparent; border: 0; border-bottom: 2px solid transparent;
    font: 600 11px Arial; color: #78716c; letter-spacing: 0.5px; cursor: pointer;
  }
  .pge-pane-tabs button:hover { background: #f3f4f6; color: #1f2937; }
  .pge-pane-tabs button.on { color: #0c4a6e; border-bottom-color: #0369a1; background: #fff; }
  .pge-pane-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 14px; }
  .pge-preview { display: flex; flex-direction: column; height: 100%; min-height: 280px; }
  .pge-preview-head { font: 600 11px Arial; color: #57534e; margin-bottom: 8px; }
  .pge-preview-svg { flex: 1 1 auto; min-height: 0; width: 100%; background: #fafaf9; border: 1px solid #e5e7eb; border-radius: 4px; }
  .pge-source {
    margin: 0; padding: 12px;
    background: #1e293b; color: #e2e8f0;
    border-radius: 4px;
    font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap; line-height: 1.45;
  }
  .pge-md-empty { padding: 12px; color: #57534e; font: 12px Arial; line-height: 1.5; }
  .pge-md-empty .hint { color: #a8a29e; font-style: italic; margin-top: 12px; }

  .pge-empty { padding: 40px; text-align: center; color: #a8a29e; font: 12px Arial; }
  .pge-err { padding: 12px; background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; border-radius: 4px; font: 12px Arial; margin: 12px; }
  .pge-err.inline { margin: 12px; }
</style>
