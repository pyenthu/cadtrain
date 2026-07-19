<script lang="ts">
  /**
   * WellViewControls — the top-of-stage view bar (W-A, `docs/plans/
   * wells-interface.md` §A). Modeled on SVTC's `WsonDisplayMenu` button+popover
   * hierarchy: the always-visible bar carries only the PRIMARY control (the
   * 2D | 3D surface toggle); a single adjustments gear opens a compact
   * DISPLAY-MENU popover holding everything else — the Cutaway group (which
   * reveals the Cut-az dial when on), the Scale group (Dia× / Depth×), and the
   * Directional / DTX / Ruler / White render toggles.
   *
   * Drives `WellSchematic3D`'s props by MUTATING the shared `WellViewSettings`
   * object (deep-reactive — the 3D view + depth ruler read the same object, so
   * there is ONE source of truth; see view-settings.ts). The popover's open
   * state (`dispAnchor`) is LOCAL UI only — it is never threaded into the 3D
   * view, so it adds no new reactive dependency that could re-trigger a rebuild.
   *
   * Layer/element toggles live on the LEFT element rail (WellElementRail —
   * SVTC's element switch). Display settings live ONLY here now (they used to be
   * duplicated in the element rail's own popover; that duplicate was removed so
   * there is a single display-menu entry point, matching WsonDisplayMenu).
   *
   * The popover is the shared `WellPopover` (body-fixed, closes on outside-click
   * / Escape) — cadtrain's popovers-over-inline convention.
   */
  import type { WellViewSettings } from './view-settings';
  import WellPopover from './WellPopover.svelte';

  let { settings }: { settings: WellViewSettings } = $props();

  // Display-menu popover — anchored to the gear button. Local UI state; toggling
  // it never touches `settings`, so it introduces no reactive dep into the 3D
  // view (the earlier /wells rebuild-loop lesson).
  let dispAnchor = $state<DOMRect | null>(null);
  function toggleDisplay(e: MouseEvent) {
    if (dispAnchor) {
      dispAnchor = null;
      return;
    }
    dispAnchor = (e.currentTarget as HTMLElement).getBoundingClientRect();
  }

  // Clamp a typed numeric-entry value on commit.
  function clampNum(v: number, min: number, max: number, fallback: number) {
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  }
</script>

<div
  class="wvc"
  role="toolbar"
  tabindex="-1"
  aria-label="Well view controls"
  onpointerdown={(e) => e.stopPropagation()}
  onwheel={(e) => e.stopPropagation()}
>
  <!-- 2D | 3D surface toggle — the one PRIMARY control kept top-level.
       2D = fast pure-SVG track (default); 3D lazy-mounts the Manifold cutaway
       (which embeds the full node-graph editor via the ✎ "edit graph" popover). -->
  <div class="wvc-seg" role="group" aria-label="View mode">
    <button type="button" class="wvc-seg-btn" class:on={settings.viewMode === '2d'}
      title="2D SVG track schematic (fast)" aria-pressed={settings.viewMode === '2d'}
      onclick={() => (settings.viewMode = '2d')}>2D</button>
    <button type="button" class="wvc-seg-btn" class:on={settings.viewMode === '3d'}
      title="3D Manifold cutaway" aria-pressed={settings.viewMode === '3d'}
      onclick={() => (settings.viewMode = '3d')}>3D</button>
  </div>

  <!-- Single adjustments gear → the display-menu popover (SVTC WsonDisplayMenu). -->
  <button
    type="button"
    class="wvc-gear"
    class:on={!!dispAnchor}
    aria-label="Display settings"
    aria-haspopup="dialog"
    aria-expanded={!!dispAnchor}
    title="Display settings"
    onclick={toggleDisplay}
  >
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      stroke-width="1.4" stroke-linecap="round">
      <path d="M2 4h7M2 8h4M2 12h9" />
      <circle cx="11.5" cy="4" r="1.7" />
      <circle cx="8.5" cy="8" r="1.7" />
      <circle cx="12.5" cy="12" r="1.7" />
    </svg>
  </button>
</div>

{#if dispAnchor}
  <WellPopover anchor={dispAnchor} title="Display settings" width={244} onClose={() => (dispAnchor = null)}>
    <!-- Cutaway group — 3D-only (mirrors WsonDisplayMenu's show3DCutaway). The
         Cut-az dial is revealed only when Cutaway is on. -->
    {#if settings.viewMode === '3d'}
      <div class="dm-group">
        <button type="button" class="dm-pill" class:on={settings.cutaway}
          aria-pressed={settings.cutaway}
          onclick={() => (settings.cutaway = !settings.cutaway)}>◑ Cutaway</button>
        {#if settings.cutaway}
          <label class="dm-dial" title="Cutaway plane rotation around the wellbore axis">
            <span class="dm-lbl">Cut az</span>
            <input type="range" min="0" max="360" step="5" bind:value={settings.cutAzimuth} />
            <input class="dm-num" type="number" min="0" max="360" step="5" value={settings.cutAzimuth}
              onchange={(e) => (settings.cutAzimuth = clampNum(+e.currentTarget.value, 0, 360, settings.cutAzimuth))} />
            <span class="dm-unit">°</span>
          </label>
        {/if}
      </div>
      <div class="dm-divider"></div>
    {/if}

    <!-- Scale group — Dia× (radial exaggeration) + Depth× (depth stretch). -->
    <div class="dm-group">
      <label class="dm-dial" title="Radial exaggeration (inches → scene units)">
        <span class="dm-lbl">Dia ×</span>
        <input type="range" min="1" max="20" step="0.5" bind:value={settings.diaScale} />
        <input class="dm-num" type="number" min="1" max="20" step="0.5" value={settings.diaScale}
          onchange={(e) => (settings.diaScale = clampNum(+e.currentTarget.value, 1, 20, settings.diaScale))} />
        <span class="dm-unit"></span>
      </label>
      <label class="dm-dial" title="Depth stretch (applied after DTX)">
        <span class="dm-lbl">Depth ×</span>
        <input type="range" min="0.25" max="4" step="0.25" bind:value={settings.zScale} />
        <input class="dm-num" type="number" min="0.25" max="4" step="0.25" value={settings.zScale}
          onchange={(e) => (settings.zScale = clampNum(+e.currentTarget.value, 0.25, 4, settings.zScale))} />
        <span class="dm-unit"></span>
      </label>
    </div>

    <div class="dm-divider"></div>

    <!-- Render toggles — the secondary pills moved out of the always-visible bar. -->
    <div class="dm-toggles">
      <button type="button" class="dm-pill" class:on={settings.directional}
        aria-pressed={settings.directional}
        onclick={() => (settings.directional = !settings.directional)}>⟋ Directional</button>
      <button type="button" class="dm-pill" class:on={settings.dtx}
        aria-pressed={settings.dtx}
        onclick={() => (settings.dtx = !settings.dtx)}>↕ DTX</button>
      <button type="button" class="dm-pill" class:on={settings.showRuler}
        aria-pressed={settings.showRuler}
        onclick={() => (settings.showRuler = !settings.showRuler)}>▏ Ruler</button>
      <button type="button" class="dm-pill" class:on={settings.whiteBg}
        aria-pressed={settings.whiteBg}
        onclick={() => (settings.whiteBg = !settings.whiteBg)}>◻ White</button>
    </div>
  </WellPopover>
{/if}

<style>
  .wvc {
    position: absolute;
    top: 8px;
    /* Clear the embedded editor's scene gear (SceneControls, ~top-right of the
       render) so the 2D|3D + settings cluster sits NEXT TO it, not on top. */
    right: 48px;
    z-index: 20;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid var(--w-border);
    border-radius: 8px;
    backdrop-filter: blur(3px);
    font: 11px Arial, sans-serif;
    color: #ccd;
    user-select: none;
  }

  /* 2D | 3D segmented control. */
  .wvc-seg {
    display: inline-flex;
    border: 1px solid var(--w-border-2);
    border-radius: 9999px;
    overflow: hidden;
  }
  .wvc-seg-btn {
    background: var(--w-surface-2);
    border: none;
    color: var(--w-text-dim);
    cursor: pointer;
    padding: 3px 12px;
    font: 700 11px Arial;
  }
  .wvc-seg-btn:hover { color: var(--w-text); }
  .wvc-seg-btn.on {
    background: #cc3333;
    color: var(--w-text);
  }

  /* Adjustments gear — opens the display-menu popover. */
  .wvc-gear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 24px;
    background: var(--w-surface-2);
    border: 1px solid var(--w-border);
    border-radius: 7px;
    color: var(--w-text-dim);
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }
  .wvc-gear:hover { color: var(--w-text); border-color: #44446a; }
  .wvc-gear.on { background: var(--w-surface-2); border-color: #cc3333; color: var(--w-text); }

  /* ── Display-menu popover contents (SVTC WsonDisplayMenu pill styling) ─────── */
  .dm-group { display: flex; flex-direction: column; gap: 8px; }
  .dm-divider { height: 1px; background: var(--w-border); margin: 1px 0; }

  .dm-dial {
    display: grid;
    grid-template-columns: 46px 1fr 52px 10px;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  .dm-lbl { color: var(--w-text-dim); font: 11px Arial; white-space: nowrap; }
  .dm-dial input[type='range'] { width: 100%; accent-color: #cc3333; cursor: pointer; }
  .dm-num {
    width: 52px;
    background: var(--w-surface);
    border: 1px solid var(--w-border-2);
    border-radius: 5px;
    color: var(--w-text);
    font: 11px ui-monospace, monospace;
    padding: 3px 5px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .dm-unit { color: var(--w-text-faint); font: 10px ui-monospace, monospace; }

  .dm-toggles { display: flex; flex-wrap: wrap; gap: 4px; }
  .dm-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--w-surface-2);
    border: 1px solid var(--w-border);
    border-radius: 9999px;
    color: var(--w-text-dim);
    cursor: pointer;
    padding: 3px 9px;
    font: 600 10px Arial;
    white-space: nowrap;
    transition: background 0.08s, color 0.08s, border-color 0.08s;
  }
  .dm-pill:hover { color: var(--w-text); border-color: #44446a; }
  .dm-pill.on {
    background: var(--w-surface-2);
    border-color: #cc3333;
    color: var(--w-text);
  }
</style>
