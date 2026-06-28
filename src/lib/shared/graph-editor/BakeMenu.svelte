<!--
  BakeMenu.svelte — the 🔨 bake-controls popover, modelled on CanvasMenu.svelte.

  Consolidates the three former rail buttons (🔨 bake-now · ⚡ auto-bake toggle ·
  💻/☁ local-vs-server backend toggle) behind ONE "Bake" rail button. A compact
  Flowbite-style dropdown anchored (position: fixed) to that button's bounding
  rect, which GEP computes and passes in as `pos`.

  GEP OWNS the open/anchor (`bakeMenuOpen` + `bakeMenuPos` + `openBakeMenu`) and
  the bake STATE + handlers (`runBake`, `setAutoBake`, `scene.clientBake` + its
  localStorage persistence). This component is presentational: it reflects the
  current state and calls back. CSS (.ge-bake-menu* / .ge-cm-*) mirrors CanvasMenu
  so Svelte's scoped CSS applies.
-->
<script lang="ts">
  let {
    pos,
    bakeStale,
    autoBake,
    clientBake,
    onBakeNow,
    onSetAutoBake,
    onToggleClientBake,
    onClose,
  }: {
    /** Viewport position anchored to the Bake button (GEP's bakeMenuPos). */
    pos: { left: number; top: number };
    /** Source changed since the last bake — surfaces the ● dot on "Bake now". */
    bakeStale: boolean;
    /** Auto-bake on/off (700 ms debounced rebake on every change). */
    autoBake: boolean;
    /** Bake backend: true = LOCAL (client Web Worker), false = REMOTE (server). */
    clientBake: boolean;
    onBakeNow: () => void;
    onSetAutoBake: (v: boolean) => void;
    onToggleClientBake: () => void;
    onClose: () => void;
  } = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="ge-bake-menu-shade" onclick={onClose}></div>
<div class="ge-bake-menu" style="left: {pos.left}px; top: {pos.top}px">
  <!-- Bake now — manual rebake; closes the menu after firing. -->
  <button class="ge-cm-row action" type="button"
    onclick={() => { onBakeNow(); onClose(); }}
    title="Bake now (Enter in any input also bakes)">
    <span class="ge-cm-icon">🔨</span>
    <span class="ge-cm-label">Bake now</span>
    {#if bakeStale}<span class="ge-cm-state stale">● stale</span>{/if}
  </button>
  <div class="ge-cm-sep"></div>
  <!-- Auto-bake toggle — stays open so you can flip + watch. -->
  <label class="ge-cm-row check"
    title="Auto-bake — rebake on every change (700 ms debounce). Off = bake only on demand.">
    <input type="checkbox"
      checked={autoBake}
      onchange={(ev) => onSetAutoBake((ev.currentTarget as HTMLInputElement).checked)} />
    <span class="ge-cm-icon">⚡</span>
    <span class="ge-cm-label">Auto-bake</span>
    <span class="ge-cm-state">{autoBake ? 'on' : 'off'}</span>
  </label>
  <!-- Local ⇄ Server backend toggle — stays open so you can flip + watch the
       bake-pane badge. LOCAL = client Web Worker, SERVER = /api/primitives/preview. -->
  <button class="ge-cm-row action" type="button"
    onclick={() => onToggleClientBake()}
    title={clientBake
      ? 'Backend = LOCAL (client Web Worker). Click → switch to SERVER.'
      : 'Backend = SERVER (/api/primitives/preview). Click → switch to LOCAL (client Web Worker).'}>
    <span class="ge-cm-icon">{clientBake ? '💻' : '☁'}</span>
    <span class="ge-cm-label">Local ⇄ Server</span>
    <span class="ge-cm-state">{clientBake ? 'local' : 'server'}</span>
  </button>
</div>

<style>
  /* ─── Bake-controls popover (mirrors CanvasMenu's Flowbite dropdown) ─── */
  .ge-bake-menu-shade {
    position: fixed; inset: 0;
    z-index: 99;
  }
  .ge-bake-menu {
    position: fixed;
    background: #fff; border: 1px solid #d6d3d1; border-radius: 6px;
    padding: 4px; width: 200px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.06);
    z-index: 100; display: flex; flex-direction: column;
  }
  .ge-cm-row {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 6px 10px; box-sizing: border-box;
    background: transparent; border: 0; border-radius: 4px; cursor: pointer;
    font: 500 12px Arial; color: #1f2937;
    text-align: left;
  }
  .ge-cm-row:hover { background: #f3f4f6; color: #0c4a6e; }
  .ge-cm-row.check { cursor: pointer; user-select: none; }
  .ge-cm-row.check input { margin: 0; cursor: pointer; accent-color: #cc2222; }
  .ge-cm-icon { width: 16px; text-align: center; font-size: 13px; line-height: 1; }
  .ge-cm-label { flex: 1 1 auto; }
  .ge-cm-state { flex: 0 0 auto; font: 10px ui-monospace, monospace; color: #a8a29e; }
  .ge-cm-state.stale { color: #b91c1c; }
  .ge-cm-sep { height: 1px; background: #f1f5f9; margin: 4px 6px; }
</style>
