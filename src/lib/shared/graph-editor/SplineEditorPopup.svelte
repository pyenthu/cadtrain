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
  import type { SplineView } from '$lib/cad/spline-view';

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
  /** Active editor view — free 3D orbit or a flat orthographic plane (item a).
   *  Bound to SplineScene; VIEW-only (never touches the points data). */
  let view = $state<SplineView>('free');
  /** Pinned = non-modal: drop the click-catching backdrop so the user can edit
   *  the spline AND interact with the bake canvas behind it without the popup
   *  closing. Toggled by the 📌 header button; close only via ×. */
  let pinned = $state(false);

  /** Hand-edit a single coordinate from the XYZ table popover (item e). The
   *  ＋point / −point / N / toggle controls now live IN-CANVAS (SplineScene). */
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

  <!-- 3D scene + IN-CANVAS controls (SplineScene owns the ＋pt/−pt/N/toggles).
       The XYZ table is a popover ABOVE the canvas (item e). -->
  <div class="ge-sp-canvas">
    <Canvas>
      <SplineScene
        {points} {samples} {closed} {plot} {wired} {showTable}
        interactive={!wired}
        bind:selectedIdx bind:view
        {onPointsChange} {onSamplesChange} {onClosedChange} {onPlotChange} {onUnwire}
        onToggleTable={() => (showTable = !showTable)} />
    </Canvas>

    {#if showTable}
      <!-- popover above the canvas — scrollable X/Y/Z table (item e) -->
      <div class="ge-sp-table">
        <div class="ge-sp-thead">
          <span class="ge-sp-ttitle">control points</span>
          <button class="ge-sp-tx" type="button" onclick={() => (showTable = false)} title="Close table">×</button>
        </div>
        <div class="ge-sp-tscroll">
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
      </div>
    {/if}
  </div>

  <!-- concise help, moved to the BOTTOM (item f) -->
  <div class="ge-sp-help">
    {#if wired}
      ⚡ points from a wired expression (read-only){points.length ? ` — ${points.length} resolved` : ' — none yet'} · green = N baked samples
    {:else}
      Drag a handle · click the curve to insert · <b>XY/YZ/XZ</b> lock the 3rd axis · green = N baked samples
    {/if}
  </div>
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
  /* position:relative so the XYZ table popover + in-canvas HTML anchor to it. */
  .ge-sp-canvas { position: relative; width: 100%; height: 340px; min-height: 240px; border: 1px solid #e5e7eb; border-radius: 4px; background: #fafafa; overflow: hidden; }
  .ge-sp-help { font: 11px Arial; color: #6b7280; line-height: 1.4; }
  .ge-sp-help b { color: #5b21b6; font-weight: 700; }

  /* XYZ table popover — floats over the TOP of the canvas (item e). */
  .ge-sp-table {
    position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
    width: min(240px, calc(100% - 16px)); max-height: calc(100% - 52px);
    display: flex; flex-direction: column;
    background: #fff; border: 1px solid #c4b5fd; border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 5;
  }
  .ge-sp-thead { display: flex; align-items: center; padding: 3px 4px 3px 8px; border-bottom: 1px solid #ede9fe; }
  .ge-sp-ttitle { font: 700 10px Arial; color: #6d28d9; text-transform: uppercase; letter-spacing: 0.03em; }
  .ge-sp-tx { margin-left: auto; border: none; background: none; cursor: pointer; font: 700 13px Arial; color: #9ca3af; line-height: 1; padding: 0 2px; }
  .ge-sp-tx:hover { color: #5b21b6; }
  .ge-sp-tscroll { overflow-y: auto; padding: 2px; }
  .ge-sp-trow { display: grid; grid-template-columns: 22px 1fr 1fr 1fr; gap: 3px; align-items: center; padding: 1px 3px; }
  .ge-sp-trow.head { position: sticky; top: 0; background: #f5f3ff; font: 700 10px Arial; color: #6d28d9; text-align: center; }
  .ge-sp-trow.sel { background: #fef3c7; }
  .ge-sp-tidx { font: 11px ui-monospace, monospace; color: #6b7280; text-align: center; cursor: pointer; }
  .ge-sp-table input { width: 100%; box-sizing: border-box; padding: 1px 4px; font: 11px ui-monospace, monospace; border: 1px solid #ddd; border-radius: 3px; }
</style>
