<script lang="ts">
  /**
   * WellElementRail — the LEFT vertical element toolbar (SVTC schematic
   * element-bar parity, `docs/plans/wells-interface.md` §A/§E). A rail of the
   * well ELEMENTS (open-hole · casing · cement · tubing · completions · perfs);
   * each button TOGGLES that layer's visibility — this is the PRIMARY element
   * switch, so the top control bar no longer carries layer chips.
   *
   * It mutates the SAME shared `WellViewSettings.layers` the 3D view + ruler
   * read — one source of truth, no forked state (view-settings.ts).
   *
   * A ⚙ "Display" button at the foot opens an anchored popover (WellPopover)
   * with the editable display params (Dia × / Depth × as slider + numeric
   * entry, Cut az) + view toggles + a per-element row list — the SVTC
   * click-to-edit interaction, cadtrain popovers-over-inline convention.
   */
  import type { WellViewSettings } from './view-settings';
  import type { WsonDoc } from './wson-summary';
  import WellPopover from './WellPopover.svelte';

  let {
    settings,
    wson = null,
  }: { settings: WellViewSettings; wson?: WsonDoc | null } = $props();

  type LKey = keyof WellViewSettings['layers'];
  interface El { key: LKey; label: string; dot: string; icon: string; count: () => number }

  const w = $derived((wson ?? {}) as Record<string, unknown[]>);
  const len = (k: string) => (Array.isArray(w[k]) ? (w[k] as unknown[]).length : 0);
  const tubingCount = $derived(
    ((wson?.completions ?? []) as Array<{ description?: string }>).filter((c) =>
      /tubing/i.test(c.description ?? '') && /joints/i.test(c.description ?? ''),
    ).length,
  );

  // Icons are inline 16×16 stroke paths (SVTC WsonToolbar style).
  const ELEMENTS: El[] = [
    { key: 'showOpenHole', label: 'Open hole', dot: '#c084fc', count: () => len('oh'),
      icon: 'M5 2v12M11 2v12' },
    { key: 'showCasing', label: 'Casing', dot: '#94a3b8', count: () => len('ch'),
      icon: 'M5 2v12M11 2v12M5 2h6M5 14h6' },
    { key: 'showCement', label: 'Cement', dot: '#d6c7a1', count: () => len('cementing'),
      icon: 'M4 3h8v10H4zM4 6h8M4 9h8' },
    { key: 'showTubing', label: 'Tubing', dot: '#eab308', count: () => tubingCount,
      icon: 'M6.5 2v12M9.5 2v12' },
    { key: 'showCompletions', label: 'Completions', dot: '#f59e0b', count: () => len('completions'),
      icon: 'M6 2v12M10 2v12M3 6.5h3M3 9.5h3M10 6.5h3M10 9.5h3' },
    { key: 'showPerforations', label: 'Perforations', dot: '#ef4444', count: () => len('perforations'),
      icon: 'M6 2v12M10 2v12M3 5h3M3 8h3M3 11h3M10 5h3M10 8h3M10 11h3' },
  ];

  function toggle(key: LKey) {
    settings.layers[key] = !settings.layers[key];
  }

  // ── Display popover ─────────────────────────────────────────────────────────
  let dispAnchor = $state<DOMRect | null>(null);
  function openDisplay(e: MouseEvent) {
    dispAnchor = (e.currentTarget as HTMLElement).getBoundingClientRect();
  }
  // Numeric-entry helpers (slider + typed value; clamp on commit).
  function clampNum(v: number, min: number, max: number, fallback: number) {
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  }
</script>

<div class="wer" role="toolbar" tabindex="-1" aria-orientation="vertical" aria-label="Well elements"
  onpointerdown={(e) => e.stopPropagation()} onwheel={(e) => e.stopPropagation()}>
  {#each ELEMENTS as el (el.key)}
    {@const on = settings.layers[el.key]}
    {@const n = el.count()}
    <div class="wer-item">
      <button
        class="wer-btn"
        class:on
        type="button"
        aria-pressed={on}
        aria-label="Toggle {el.label}"
        onclick={() => toggle(el.key)}
      >
        <span class="wer-dot" style="background:{on ? el.dot : 'transparent'}; border-color:{el.dot}"></span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
          stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d={el.icon} /></svg>
        {#if n > 0}<span class="wer-count">{n}</span>{/if}
      </button>
      <span class="wer-tip">{el.label}{n ? ` · ${n}` : ''}{on ? '' : ' · hidden'}</span>
    </div>
  {/each}

  <div class="wer-sep"></div>

  <div class="wer-item">
    <button class="wer-btn wer-gear" class:on={!!dispAnchor} type="button"
      aria-label="Display settings" aria-haspopup="dialog" aria-expanded={!!dispAnchor}
      onclick={openDisplay}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
        stroke-width="1.4"><circle cx="8" cy="8" r="2.4" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" /></svg>
    </button>
    <span class="wer-tip">Display &amp; scale</span>
  </div>
</div>

{#if dispAnchor}
  <WellPopover anchor={dispAnchor} title="Display & scale" width={252} onClose={() => (dispAnchor = null)}>
    <!-- Editable display params — slider + numeric entry (SVTC-style). -->
    <div class="wp-dial">
      <label for="wer-dia">Dia ×</label>
      <input id="wer-dia" type="range" min="1" max="20" step="0.5" bind:value={settings.diaScale} />
      <input class="wp-num" type="number" min="1" max="20" step="0.5" value={settings.diaScale}
        onchange={(e) => (settings.diaScale = clampNum(+e.currentTarget.value, 1, 20, settings.diaScale))} />
    </div>
    <div class="wp-dial">
      <label for="wer-depth">Depth ×</label>
      <input id="wer-depth" type="range" min="0.25" max="4" step="0.25" bind:value={settings.zScale} />
      <input class="wp-num" type="number" min="0.25" max="4" step="0.25" value={settings.zScale}
        onchange={(e) => (settings.zScale = clampNum(+e.currentTarget.value, 0.25, 4, settings.zScale))} />
    </div>
    <div class="wp-dial" class:dim={!settings.cutaway}>
      <label for="wer-cutaz">Cut az</label>
      <input id="wer-cutaz" type="range" min="0" max="360" step="5" bind:value={settings.cutAzimuth} disabled={!settings.cutaway} />
      <input class="wp-num" type="number" min="0" max="360" step="5" value={settings.cutAzimuth} disabled={!settings.cutaway}
        onchange={(e) => (settings.cutAzimuth = clampNum(+e.currentTarget.value, 0, 360, settings.cutAzimuth))} />
    </div>

    <div class="wp-divider"></div>

    <!-- View toggles. -->
    <div class="wp-toggles">
      <button type="button" class="wp-tog" class:on={settings.cutaway} onclick={() => (settings.cutaway = !settings.cutaway)}>◑ Cutaway</button>
      <button type="button" class="wp-tog" class:on={settings.directional} onclick={() => (settings.directional = !settings.directional)}>⟋ Directional</button>
      <button type="button" class="wp-tog" class:on={settings.dtx} onclick={() => (settings.dtx = !settings.dtx)}>↕ DTX</button>
      <button type="button" class="wp-tog" class:on={settings.showRuler} onclick={() => (settings.showRuler = !settings.showRuler)}>▏ Ruler</button>
      <button type="button" class="wp-tog" class:on={settings.whiteBg} onclick={() => (settings.whiteBg = !settings.whiteBg)}>◻ White</button>
    </div>

    <div class="wp-divider"></div>

    <!-- Per-element rows (toggle + count) — the "edit its rows" surface. -->
    <div class="wp-rows">
      {#each ELEMENTS as el (el.key)}
        {@const on = settings.layers[el.key]}
        <button type="button" class="wp-row" class:on onclick={() => toggle(el.key)}>
          <span class="wer-dot" style="background:{on ? el.dot : 'transparent'}; border-color:{el.dot}"></span>
          <span class="wp-row-lbl">{el.label}</span>
          <span class="wp-row-n">{el.count()}</span>
          <span class="wp-row-eye">{on ? '👁' : '—'}</span>
        </button>
      {/each}
    </div>
  </WellPopover>
{/if}

<style>
  .wer {
    position: absolute;
    left: 8px;
    top: 56px;            /* clear the top control bar */
    bottom: 12px;
    width: 44px;
    z-index: 18;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px 2px;
    background: rgba(16, 16, 26, 0.86);
    border: 1px solid #2a2a3e;
    border-radius: 8px;
    backdrop-filter: blur(3px);
    overflow: visible;
    user-select: none;
  }
  .wer-item { position: relative; display: flex; width: 100%; justify-content: center; }
  .wer-btn {
    position: relative;
    width: 36px;
    height: 34px;
    background: #1a1a2a;
    border: 1px solid #2f2f46;
    border-radius: 7px;
    color: #6a6a86;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }
  .wer-btn:hover { color: #d8d8ef; border-color: #44446a; }
  .wer-btn.on { background: #232340; border-color: #cc3333; color: #fff; }
  .wer-dot {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    border: 1.5px solid;
    box-sizing: border-box;
  }
  .wer-count {
    position: absolute;
    bottom: 1px;
    right: 3px;
    font: 700 8px ui-monospace, monospace;
    color: #99a;
  }
  .wer-btn.on .wer-count { color: #ffd; }
  .wer-gear { color: #aab; }
  .wer-sep { width: 24px; height: 1px; background: #2a2a3e; margin: 2px 0; }

  /* Tooltip → right of the rail (SVTC style). */
  .wer-tip {
    position: absolute;
    left: calc(100% + 8px);
    top: 50%;
    transform: translate(-4px, -50%);
    padding: 5px 9px;
    background: rgba(10, 10, 18, 0.96);
    border: 1px solid #2a2a3e;
    color: #e8e8ef;
    border-radius: 5px;
    white-space: nowrap;
    font: 11px Arial, sans-serif;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: opacity 0.12s ease, transform 0.12s ease;
    z-index: 100;
  }
  .wer-item:hover .wer-tip { opacity: 1; visibility: visible; transform: translate(0, -50%); }

  /* Popover contents. */
  .wp-dial {
    display: grid;
    grid-template-columns: 46px 1fr 52px;
    align-items: center;
    gap: 8px;
  }
  .wp-dial.dim { opacity: 0.45; }
  .wp-dial label { color: #99a; font: 11px Arial; }
  .wp-dial input[type='range'] { width: 100%; accent-color: #cc3333; cursor: pointer; }
  .wp-num {
    width: 52px;
    background: #12121e;
    border: 1px solid #34345a;
    border-radius: 5px;
    color: #fff;
    font: 11px ui-monospace, monospace;
    padding: 3px 5px;
    text-align: right;
  }
  .wp-divider { height: 1px; background: #2a2a3e; margin: 1px 0; }
  .wp-toggles { display: flex; flex-wrap: wrap; gap: 4px; }
  .wp-tog {
    background: #1a1a2a;
    border: 1px solid #2f2f46;
    border-radius: 9999px;
    color: #889;
    cursor: pointer;
    padding: 3px 8px;
    font: 600 10px Arial;
    white-space: nowrap;
  }
  .wp-tog:hover { color: #fff; border-color: #44446a; }
  .wp-tog.on { background: #232340; border-color: #cc3333; color: #fff; }
  .wp-rows { display: flex; flex-direction: column; gap: 3px; }
  .wp-row {
    position: relative;
    display: grid;
    grid-template-columns: 14px 1fr auto 18px;
    align-items: center;
    gap: 8px;
    background: none;
    border: 1px solid transparent;
    border-radius: 5px;
    color: #778;
    cursor: pointer;
    padding: 3px 6px;
    font: 11px Arial;
    text-align: left;
  }
  .wp-row .wer-dot { position: static; }
  .wp-row:hover { background: #1c1c30; border-color: #2f2f46; }
  .wp-row.on { color: #dde; }
  .wp-row-n { color: #667; font: 10px ui-monospace, monospace; }
  .wp-row-eye { text-align: right; font-size: 10px; opacity: 0.8; }
</style>
