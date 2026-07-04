<!--
  SplineEditorPopup.svelte — the ✎ 3D editor for a `spline` PATH node (TODO #15).

  Chrome mirrors AiMenu.svelte: a fixed, draggable (header handle), resizable
  (persisted width, localStorage `ge-spline-popup-w`), scrollable popover. The
  body is a Threlte <Canvas> (SplineScene) where the node's 3D control points are
  dragged with the mouse; below it, add/remove-point buttons + an N (samples)
  input. Every edit calls back to GEP which writes the graph (setSplinePoints /
  setSplineSamples), so the node + downstream r_sweep.path stay in sync.

  GEP OWNS the open/anchor (`splineEditId` + `splinePopPos`) — this component is
  presentational + self-contained (its own drag/resize, like AiMenu).
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Canvas } from '@threlte/core';
  import SplineScene from './SplineScene.svelte';
  import { clampDragPos } from './popover-clamp';
  import type { Vec3 } from '$lib/cad/spline-resample';

  let {
    pos,
    points,
    samples,
    closed = false,
    wired = false,
    plot = false,
    title = 'spline path',
    onPointsChange,
    onSamplesChange,
    onClosedChange,
    onPlotChange,
    onUnwire,
    onClose,
  }: {
    /** Viewport position anchored to the ✎ trigger (GEP's splinePopPos). */
    pos: { left: number; top: number };
    points: Vec3[];
    samples: number;
    /** Loop the curve (last→first). A sweep fed by this spline auto-follows it. */
    closed?: boolean;
    /** Control points are driven by a WIRED expression (#26) — the manual editor
     *  is disabled until unwired. */
    wired?: boolean;
    /** PLOT this spline in the main 3D bake (#24) — diagnostic overlay so several
     *  splines read relative to each other + the swept mesh. VIEW-ONLY. */
    plot?: boolean;
    title?: string;
    onPointsChange: (pts: Vec3[]) => void;
    onSamplesChange: (n: number) => void;
    onClosedChange: (v: boolean) => void;
    /** Toggle the main-bake plot overlay (#24). */
    onPlotChange?: (v: boolean) => void;
    /** Drop the wired source → back to manual points (#26). */
    onUnwire?: () => void;
    onClose: () => void;
  } = $props();

  let selectedIdx = $state(-1);
  /** Pinned = non-modal: drop the click-catching backdrop so the user can edit
   *  the spline AND interact with the bake canvas behind it without the popup
   *  closing. Toggled by the 📌 header button; close only via ×. */
  let pinned = $state(false);

  /** Append a control point — offset from the last one so it's grabbable. */
  function addPoint() {
    const n = points.length;
    const last = n > 0 ? points[n - 1]! : ([0, 0, 0] as Vec3);
    const prev = n > 1 ? points[n - 2]! : ([0, 0, 0] as Vec3);
    // Continue in the direction of the last segment (fallback: +x).
    let dx = last[0] - prev[0], dy = last[1] - prev[1], dz = last[2] - prev[2];
    if (Math.hypot(dx, dy, dz) < 1e-6) { dx = 3; dy = 0; dz = 0; }
    const next: Vec3 = [last[0] + dx, last[1] + dy, last[2] + dz];
    onPointsChange([...points, next]);
    selectedIdx = points.length; // the new last index
  }

  /** Remove the selected (or last) control point — keep ≥ 2 for a curve. */
  function removePoint() {
    if (points.length <= 2) return;
    const idx = selectedIdx >= 0 && selectedIdx < points.length ? selectedIdx : points.length - 1;
    onPointsChange(points.filter((_, k) => k !== idx));
    selectedIdx = -1;
  }

  function onSamplesInput(ev: Event) {
    const v = Math.max(2, Math.min(512, Math.round(Number((ev.target as HTMLInputElement).value) || 2)));
    onSamplesChange(v);
  }

  /** Hand-edit a single coordinate from the XYZ table. */
  let showTable = $state(false);
  const r3 = (v: number) => Math.round((Number(v) || 0) * 1000) / 1000; // display ≤3 dp
  function setCoord(i: number, axis: 0 | 1 | 2, raw: string) {
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    const next = points.map((p, k): Vec3 =>
      k !== i ? p : (axis === 0 ? [v, p[1], p[2]] : axis === 1 ? [p[0], v, p[2]] : [p[0], p[1], v]));
    onPointsChange(next);
  }

  // ─── drag (header handle) — mirrors AiMenu ────────────────────────────────
  let panelEl = $state<HTMLDivElement | null>(null);
  let dragPos = $state<{ x: number; y: number } | null>(null);
  let dragging = false;
  let dragOff = { x: 0, y: 0 };
  function onHeadPointerDown(ev: PointerEvent) {
    if ((ev.target as HTMLElement).closest('button, input')) return;
    const r = panelEl?.getBoundingClientRect();
    if (!r) return;
    dragOff = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    dragging = true;
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
  }
  function onHeadPointerMove(ev: PointerEvent) {
    if (!dragging) return;
    dragPos = clampDragPos(panelEl, ev.clientX - dragOff.x, ev.clientY - dragOff.y);
  }
  function onHeadPointerUp() { dragging = false; }

  /** Persisted width (native CSS resize grip). */
  let panelW = $state<number>(420);
  try { const w = Number(localStorage.getItem('ge-spline-popup-w')); if (w >= 320) panelW = Math.min(880, w); } catch { /* SSR/off */ }
  function persistW() {
    if (!panelEl) return;
    const w = panelEl.offsetWidth;
    if (w >= 320) { panelW = w; try { localStorage.setItem('ge-spline-popup-w', String(w)); } catch { /* ignore */ } }
  }

  // Clamp the top so the (tall) panel stays on-screen.
  let topPx = $state(pos.top);
  onMount(async () => {
    await tick();
    if (panelEl) {
      const h = panelEl.offsetHeight;
      const margin = 12;
      const maxTop = window.innerHeight - h - margin;
      topPx = Math.max(margin, Math.min(pos.top, maxTop));
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
{#if !pinned}<div class="ge-canvas-menu-shade" onclick={onClose}></div>{/if}
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="ge-canvas-menu ge-spline-popup"
  bind:this={panelEl}
  onpointerup={persistW}
  style="left: {dragPos ? dragPos.x : pos.left}px; top: {dragPos ? dragPos.y : topPx}px; width: {panelW}px">
  <div class="ge-sp-head" onpointerdown={onHeadPointerDown}
    onpointermove={onHeadPointerMove} onpointerup={onHeadPointerUp} onpointercancel={onHeadPointerUp}>
    <span class="ge-sp-headlabel">⌇ {title}</span>
    <button class="ge-sp-pin" class:on={pinned} type="button" onclick={() => (pinned = !pinned)}
      title={pinned ? 'Unpin — clicking outside closes again' : 'Pin — keep open while you use the bake canvas'}>📌</button>
    <button class="ge-sp-headx" type="button" onclick={onClose} title="Close">×</button>
  </div>

  <div class="ge-sp-hint">
    {#if wired}
      <b>violet</b> handles = the expression’s control points (read-only) · <b>green</b> dots are the N spaced samples (the baked path). Orbit = drag anywhere.
    {:else}
      Drag a <b>violet</b> handle to move a control point · <b>click the curve</b> to insert a point mid-run · <b>green</b> dots are the N spaced samples (the baked path). Orbit = drag empty space.
    {/if}
  </div>

  {#if wired}
    <div class="ge-sp-wired">
      <span>⚡ <b>points: from a wired expression</b> — {points.length > 0
        ? `showing the ${points.length} resolved point${points.length === 1 ? '' : 's'} from the expression (read-only).`
        : 'the expression has no points yet — fix the expression to see the curve.'}</span>
      {#if onUnwire}<button class="ge-sp-btn" type="button" onclick={onUnwire} title="Detach the expression and edit points by hand again">use manual points</button>{/if}
    </div>
  {/if}

  <div class="ge-sp-canvas">
    <Canvas>
      <SplineScene {points} {samples} {closed} interactive={!wired} bind:selectedIdx {onPointsChange} />
    </Canvas>
  </div>

  <div class="ge-sp-controls">
    <button class="ge-sp-btn" type="button" onclick={addPoint} disabled={wired} title={wired ? 'Points come from a wired expression' : 'Append a control point'}>+ point</button>
    <button class="ge-sp-btn" type="button" onclick={removePoint} disabled={wired || points.length <= 2}
      title="Remove the selected (or last) control point">− point</button>
    <button class="ge-sp-btn" class:on={showTable} type="button" onclick={() => (showTable = !showTable)}
      title="Edit point X/Y/Z values by hand">{showTable ? '▾' : '▸'} xyz</button>
    <button class="ge-sp-btn" class:on={closed} type="button" onclick={() => onClosedChange(!closed)}
      title="Closed loop — the path wraps last→first. A sweep fed by this spline auto-follows: closed ⇒ watertight ring (no end caps); open ⇒ capped tube.">{closed ? '◯ loop' : '⌇ open'}</button>
    {#if onPlotChange}
      <button class="ge-sp-btn" class:on={plot} type="button" onclick={() => onPlotChange?.(!plot)}
        title="Plot this spline in the main 3D bake — a coloured overlay curve + control points, so multiple splines (e.g. an r_sweep path + section) can be seen relative to each other and the swept geometry. View-only.">📈 plot</button>
    {/if}
    <label class="ge-sp-n" title="Number of equally-spaced output samples (r_sweep.path resolution)">
      N <input type="number" min="2" max="512" step="1" value={samples} onchange={onSamplesInput} />
    </label>
  </div>

  {#if showTable}
    <!-- hand-edit X/Y/Z — tightly spaced, internally scrollable -->
    <div class="ge-sp-table">
      <div class="ge-sp-trow head"><span>#</span><span>x</span><span>y</span><span>z</span></div>
      {#each points as p, i (i)}
        <div class="ge-sp-trow" class:sel={i === selectedIdx}>
          <span class="ge-sp-tidx" role="button" tabindex="-1" onclick={() => (selectedIdx = i)}>{i}</span>
          <input type="number" step="0.1" value={r3(p[0])} disabled={wired} onchange={(e) => setCoord(i, 0, (e.target as HTMLInputElement).value)} />
          <input type="number" step="0.1" value={r3(p[1])} disabled={wired} onchange={(e) => setCoord(i, 1, (e.target as HTMLInputElement).value)} />
          <input type="number" step="0.1" value={r3(p[2])} disabled={wired} onchange={(e) => setCoord(i, 2, (e.target as HTMLInputElement).value)} />
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .ge-canvas-menu-shade { position: fixed; inset: 0; z-index: 99; }
  .ge-canvas-menu {
    position: fixed; background: #fff; border: 1px solid #d6d3d1; border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.06);
    z-index: 100; display: flex; flex-direction: column;
  }
  .ge-spline-popup {
    padding: 8px; gap: 6px;
    resize: horizontal; overflow-x: hidden; overflow-y: auto;
    min-width: 320px; max-width: 880px; max-height: calc(100vh - 24px);
  }
  .ge-sp-head { display: flex; align-items: center; gap: 6px; margin: -2px 0 2px; cursor: move; user-select: none; touch-action: none; }
  .ge-sp-headlabel { font: 700 12px Arial; color: #5b21b6; }
  .ge-sp-pin { margin-left: auto; border: none; background: none; cursor: pointer; font: 12px Arial; line-height: 1; padding: 0 2px; opacity: 0.45; filter: grayscale(1); }
  .ge-sp-pin:hover { opacity: 0.8; }
  .ge-sp-pin.on { opacity: 1; filter: none; }
  .ge-sp-headx { border: none; background: none; cursor: pointer; font: 700 14px Arial; color: #9ca3af; line-height: 1; padding: 0 2px; }
  .ge-sp-headx:hover { color: #5b21b6; }
  .ge-sp-hint { font: 11px Arial; color: #6b7280; line-height: 1.4; }
  .ge-sp-hint b { color: #5b21b6; font-weight: 700; }
  .ge-sp-wired { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 8px; border: 1px solid #c4b5fd; background: #f5f3ff; border-radius: 4px; font: 11px Arial; color: #4c1d95; }
  .ge-sp-wired b { color: #5b21b6; }
  .ge-sp-canvas { width: 100%; height: 320px; min-height: 240px; border: 1px solid #e5e7eb; border-radius: 4px; background: #fafafa; overflow: hidden; }
  .ge-sp-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .ge-sp-btn { padding: 4px 10px; font: 600 12px Arial; cursor: pointer; background: #ede9fe; color: #4c1d95; border: 1px solid #c4b5fd; border-radius: 4px; }
  .ge-sp-btn:hover:not(:disabled) { background: #ddd6fe; }
  .ge-sp-btn:disabled { opacity: 0.5; cursor: default; }
  .ge-sp-count { font: 11px ui-monospace, monospace; color: #6b7280; }
  .ge-sp-n { margin-left: auto; font: 600 12px Arial; color: #374151; display: flex; align-items: center; gap: 4px; }
  .ge-sp-n input { width: 60px; padding: 3px 6px; font: 12px ui-monospace, monospace; border: 1px solid #c4b5fd; border-radius: 4px; }
  .ge-sp-btn.on { background: #ddd6fe; }
  .ge-sp-table { max-height: 132px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 4px; }
  .ge-sp-trow { display: grid; grid-template-columns: 22px 1fr 1fr 1fr; gap: 3px; align-items: center; padding: 1px 3px; }
  .ge-sp-trow.head { position: sticky; top: 0; background: #f5f3ff; font: 700 10px Arial; color: #6d28d9; text-align: center; }
  .ge-sp-trow.sel { background: #fef3c7; }
  .ge-sp-tidx { font: 11px ui-monospace, monospace; color: #6b7280; text-align: center; cursor: pointer; }
  .ge-sp-table input { width: 100%; box-sizing: border-box; padding: 1px 4px; font: 11px ui-monospace, monospace; border: 1px solid #ddd; border-radius: 3px; }
</style>
