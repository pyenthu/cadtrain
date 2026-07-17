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
  import { splineArcLength, type Vec3 } from '$lib/graph/spline-resample';
  import { parsePointsInput, pointsBbox, gridFor, snapVec3, type SplineView } from '$lib/graph/spline-view';

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

  /** Total arc length of the curve through the current control points (the SAME
   *  centripetal Catmull-Rom the bake samples) — a live readout in the help bar. */
  const arcLen = $derived.by(() => {
    try { return splineArcLength(points, closed); } catch { return 0; }
  });

  /** Remove the selected control point (keyboard Del/Backspace) — keeps ≥ 2 for a
   *  curve; no-op when wired (points come from an expression). Mirrors the
   *  in-canvas －pt button but keyed off the current selection. */
  function removeSelected() {
    if (wired) return;
    if (selectedIdx < 0 || selectedIdx >= points.length || points.length <= 2) return;
    onPointsChange(points.filter((_, k) => k !== selectedIdx));
    selectedIdx = -1;
  }
  function onKeyDown(ev: KeyboardEvent) {
    const t = ev.target as HTMLElement | null;
    // Never hijack typing in the XYZ table / paste inputs.
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      if (wired || selectedIdx < 0 || selectedIdx >= points.length || points.length <= 2) return;
      ev.preventDefault();
      removeSelected();
    }
  }
  // Registered once — the handler reads live prop/state at event time (no deps).
  $effect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // ─── bulk import / paste points (in the XYZ table popover) ─────────────────
  let pasteOpen = $state(false);
  let pasteText = $state('');
  let pasteErr = $state('');
  function applyPaste() {
    const parsed = parsePointsInput(pasteText);
    if (parsed.length < 2) { pasteErr = 'Need ≥ 2 valid points ([x,y,z] per row or JSON).'; return; }
    onPointsChange(parsed);
    selectedIdx = -1;
    pasteOpen = false;
    pasteText = '';
    pasteErr = '';
  }
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

  // ─── editor toolbar (DOM overlay OVER the canvas — screen-fixed, unlike a
  //     Threlte <HTML> overlay which drifts with the orbit) ───────────────────
  const VIEWS: { k: SplineView; label: string; tip: string }[] = [
    { k: 'free', label: '3D', tip: 'Free 3D orbit' },
    { k: 'xy', label: 'XY', tip: 'Flat XY plane — Z locked while dragging' },
    { k: 'yz', label: 'YZ', tip: 'Flat YZ plane — X locked while dragging' },
    { k: 'xz', label: 'XZ', tip: 'Flat XZ plane — Y locked while dragging' },
  ];
  /** Snap-to-grid drag aid (⊞) — bound into SplineScene (read there during drag). */
  let snap = $state(false);
  /** Vertical z-pan of the FLAT plane views — bound into SplineScene, driven by
   *  the z-scroller slider (shown only in yz/xz). SplineScene resets it to 0 on
   *  every view switch. */
  let zPan = $state(0);
  /** Point-cloud Z extent → the z-scroller travel (±zExtent, centred at 0). */
  const zExtent = $derived.by(() => {
    const vs = points.filter((p) => Array.isArray(p) && p.length >= 3);
    const bb = pointsBbox(vs);
    return Math.max(bb.max[2] - bb.min[2], 1);
  });
  /** Visible grid cell size (bbox → gridFor) — the round step for snapped adds. */
  const snapStep = $derived.by(() => {
    const vs = points.filter((p) => Array.isArray(p) && p.length >= 3);
    const bb = pointsBbox(vs);
    const g = gridFor(Math.max(bb.max[0] - bb.min[0], bb.max[2] - bb.min[2]));
    return g.size / Math.max(1, g.divisions);
  });
  /** Append a control point — offset from the last so it's grabbable. */
  function addPoint() {
    if (wired) return;
    const n = points.length;
    const last = n > 0 ? points[n - 1]! : ([0, 0, 0] as Vec3);
    const prev = n > 1 ? points[n - 2]! : ([0, 0, 0] as Vec3);
    let dx = last[0] - prev[0], dy = last[1] - prev[1], dz = last[2] - prev[2];
    if (Math.hypot(dx, dy, dz) < 1e-6) { dx = 3; dy = 0; dz = 0; }
    let np: Vec3 = [last[0] + dx, last[1] + dy, last[2] + dz];
    if (snap) np = snapVec3(np, snapStep);
    onPointsChange([...points, np]);
    selectedIdx = points.length; // the new last index
  }
  /** Remove the selected (or last) control point — keep ≥ 2 for a curve. */
  function removePoint() {
    if (wired || points.length <= 2) return;
    const idx = selectedIdx >= 0 && selectedIdx < points.length ? selectedIdx : points.length - 1;
    onPointsChange(points.filter((_, k) => k !== idx));
    selectedIdx = -1;
  }
  function onSamplesInput(ev: Event) {
    const v = Math.max(2, Math.min(512, Math.round(Number((ev.target as HTMLInputElement).value) || 2)));
    onSamplesChange(v);
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

  <!-- 3D scene + DOM-overlay controls. SplineScene draws only the 3D (handles,
       curve, grid, axes); the toolbar + XYZ table are screen-fixed DOM overlays
       ABOVE the canvas (a Threlte <HTML> overlay drifts as the camera orbits). -->
  <div class="ge-sp-canvas">
    <Canvas>
      <SplineScene
        {points} {samples} {closed}
        interactive={!wired}
        bind:selectedIdx bind:view bind:snap bind:zPan
        {onPointsChange} />
    </Canvas>

    <!-- view switch — top-left, screen-fixed -->
    <div class="ge-sp-views">
      {#each VIEWS as v (v.k)}
        <button class="ge-sp-obtn" class:on={view === v.k} type="button" title={v.tip} onclick={() => (view = v.k)}>{v.label}</button>
      {/each}
    </div>

    <!-- z-scroller — vertical slider on the RIGHT edge, only in the flat YZ/XZ
         plane views (where Z is the vertical screen axis). Pans the camera
         up/down along Z. Sign: drag the thumb UP → view pans UP (larger zPan =
         target moves toward +Z). Fine-tune the direction in the browser if it
         feels inverted. -->
    {#if view === 'yz' || view === 'xz'}
      <div class="ge-sp-zscroll" title="Pan the view up / down (Z)">
        <input class="ge-sp-zslider" type="range"
          min={-zExtent} max={zExtent} step={zExtent / 100}
          bind:value={zPan} aria-label="Pan the view up / down (Z)" />
      </div>
    {/if}
    <!-- point / sample controls — bottom bar, screen-fixed -->
    <div class="ge-sp-bar">
      <button class="ge-sp-obtn" type="button" onclick={addPoint} disabled={wired} title={wired ? 'Points come from a wired expression' : 'Append a control point'}>＋ pt</button>
      <button class="ge-sp-obtn" type="button" onclick={removePoint} disabled={wired || points.length <= 2} title="Remove the selected (or last) control point">－ pt</button>
      <button class="ge-sp-obtn" class:on={showTable} type="button" onclick={() => (showTable = !showTable)} title="Edit X/Y/Z values in a table">⌗ xyz</button>
      <button class="ge-sp-obtn" class:on={snap} type="button" onclick={() => (snap = !snap)} disabled={wired}
        title={`Snap dragged points to the grid (${snapStep.toFixed(2)} units)`}>⊞ snap</button>
      <button class="ge-sp-obtn" class:on={closed} type="button" onclick={() => onClosedChange(!closed)} title="Closed loop — the path wraps last→first (a sweep fed by it auto-follows: closed ⇒ watertight ring, open ⇒ capped tube).">{closed ? '◯ loop' : '⌇ open'}</button>
      {#if onPlotChange}
        <button class="ge-sp-obtn" class:on={plot} type="button" onclick={() => onPlotChange?.(!plot)} title="Plot this spline in the main 3D bake (view-only overlay).">📈 plot</button>
      {/if}
      {#if wired && onUnwire}
        <button class="ge-sp-obtn" type="button" onclick={() => onUnwire?.()} title="Detach the wired expression and edit points by hand again">use manual</button>
      {/if}
      <label class="ge-sp-n" title="Number of equally-spaced output samples (r_sweep.path resolution)">
        N <input type="number" min="2" max="512" step="1" value={samples} onchange={onSamplesInput} />
      </label>
    </div>

    {#if showTable}
      <!-- popover above the canvas — scrollable X/Y/Z table (item e) -->
      <div class="ge-sp-table">
        <div class="ge-sp-thead">
          <span class="ge-sp-ttitle">control points</span>
          {#if !wired}
            <button class="ge-sp-tpaste" class:on={pasteOpen} type="button"
              onclick={() => { pasteOpen = !pasteOpen; pasteErr = ''; }}
              title="Paste / import points — replace all">⎘ paste</button>
          {/if}
          <button class="ge-sp-tx" type="button" onclick={() => (showTable = false)} title="Close table">×</button>
        </div>
        {#if pasteOpen && !wired}
          <div class="ge-sp-paste">
            <textarea class="ge-sp-pastebox" rows="4" spellcheck="false"
              placeholder={'[[0,0,0],[3,1,0], …]  — or one point per line:\n0 0 0\n3 1 0'}
              bind:value={pasteText}></textarea>
            {#if pasteErr}<div class="ge-sp-pasteerr">{pasteErr}</div>{/if}
            <div class="ge-sp-pasterow">
              <button class="ge-sp-pbtn apply" type="button" onclick={applyPaste}>Replace points</button>
              <button class="ge-sp-pbtn" type="button" onclick={() => { pasteOpen = false; pasteText = ''; pasteErr = ''; }}>Cancel</button>
            </div>
          </div>
        {/if}
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
      Drag a handle · click the curve to insert · <b>Del</b> removes the selected point · <b>XY/YZ/XZ</b> lock the 3rd axis · green = N baked samples
    {/if}
    <div class="ge-sp-stat">{points.length} pts · length <b>{arcLen.toFixed(3)}</b>{closed ? ' · loop' : ''}</div>
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
  /* position:relative so the XYZ table popover + toolbar overlays anchor to it. */
  .ge-sp-canvas { position: relative; width: 100%; height: 340px; min-height: 240px; border: 1px solid #e5e7eb; border-radius: 4px; background: #fafafa; overflow: hidden; }
  /* Screen-fixed toolbar overlays (NOT Threlte <HTML> — those drift with orbit). */
  .ge-sp-views { position: absolute; top: 6px; left: 6px; display: flex; gap: 3px; z-index: 4; }
  .ge-sp-bar { position: absolute; bottom: 6px; left: 6px; right: 6px; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; z-index: 4; }
  .ge-sp-obtn {
    padding: 3px 8px; font: 600 11px Arial; cursor: pointer; border-radius: 4px;
    background: rgba(237, 233, 254, 0.92); color: #4c1d95; border: 1px solid #c4b5fd;
    backdrop-filter: blur(2px);
  }
  .ge-sp-obtn:hover:not(:disabled) { background: #ddd6fe; }
  .ge-sp-obtn:disabled { opacity: 0.5; cursor: default; }
  .ge-sp-obtn.on { background: #a78bfa; color: #fff; border-color: #7c3aed; }
  /* z-scroller — compact vertical slider pinned to the right edge, centred. */
  .ge-sp-zscroll {
    position: absolute; top: 50%; right: 6px; transform: translateY(-50%);
    z-index: 4; display: flex; align-items: center; justify-content: center;
    padding: 6px 3px; border-radius: 6px;
    background: rgba(237, 233, 254, 0.92); border: 1px solid #c4b5fd;
    backdrop-filter: blur(2px);
  }
  /* vertical-lr + direction:rtl → thumb travels UP for a larger value. */
  .ge-sp-zslider {
    writing-mode: vertical-lr; direction: rtl;
    width: 16px; height: 150px; margin: 0; cursor: ns-resize;
    accent-color: #7c3aed;
  }
  .ge-sp-n input { width: 54px; padding: 2px 5px; font: 11px ui-monospace, monospace; border: 1px solid #c4b5fd; border-radius: 4px; }
  .ge-sp-help { font: 11px Arial; color: #6b7280; line-height: 1.4; }
  .ge-sp-help b { color: #5b21b6; font-weight: 700; }
  .ge-sp-stat { margin-top: 2px; font: 700 11px ui-monospace, monospace; color: #4c1d95; }
  .ge-sp-stat b { color: #4c1d95; }

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
  .ge-sp-tpaste { margin-left: auto; border: 1px solid #c4b5fd; background: #f5f3ff; cursor: pointer; font: 700 9px Arial; color: #6d28d9; line-height: 1; padding: 2px 5px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.02em; }
  .ge-sp-tpaste:hover { background: #ede9fe; }
  .ge-sp-tpaste.on { background: #a78bfa; color: #fff; border-color: #7c3aed; }
  .ge-sp-tx { margin-left: 4px; border: none; background: none; cursor: pointer; font: 700 13px Arial; color: #9ca3af; line-height: 1; padding: 0 2px; }
  .ge-sp-tx:hover { color: #5b21b6; }
  /* Paste / import sub-panel inside the XYZ table popover. */
  .ge-sp-paste { display: flex; flex-direction: column; gap: 4px; padding: 5px 6px; border-bottom: 1px solid #ede9fe; background: #faf5ff; }
  .ge-sp-pastebox { width: 100%; box-sizing: border-box; resize: vertical; font: 11px ui-monospace, monospace; border: 1px solid #c4b5fd; border-radius: 4px; padding: 3px 5px; }
  .ge-sp-pasteerr { font: 10px Arial; color: #b91c1c; }
  .ge-sp-pasterow { display: flex; gap: 5px; }
  .ge-sp-pbtn { flex: 1; padding: 3px 6px; font: 600 10px Arial; cursor: pointer; border: 1px solid #d6d3d1; background: #fff; border-radius: 4px; color: #374151; }
  .ge-sp-pbtn:hover { background: #f5f3ff; }
  .ge-sp-pbtn.apply { background: #7c3aed; color: #fff; border-color: #6d28d9; }
  .ge-sp-pbtn.apply:hover { background: #6d28d9; }
  .ge-sp-tscroll { overflow-y: auto; padding: 2px; }
  .ge-sp-trow { display: grid; grid-template-columns: 22px 1fr 1fr 1fr; gap: 3px; align-items: center; padding: 1px 3px; }
  .ge-sp-trow.head { position: sticky; top: 0; background: #f5f3ff; font: 700 10px Arial; color: #6d28d9; text-align: center; }
  .ge-sp-trow.sel { background: #fef3c7; }
  .ge-sp-tidx { font: 11px ui-monospace, monospace; color: #6b7280; text-align: center; cursor: pointer; }
  .ge-sp-table input { width: 100%; box-sizing: border-box; padding: 1px 4px; font: 11px ui-monospace, monospace; border: 1px solid #ddd; border-radius: 3px; }
</style>
