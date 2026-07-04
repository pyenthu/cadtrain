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
   * Display settings (Dia× / Depth× / Cut-az + the render toggles) live in the
   * top bar's single display-menu popover now (WellViewControls, mirroring
   * SVTC's WsonDisplayMenu). This rail is therefore a PURE element switch — its
   * own display popover was removed to keep one display-menu entry point.
   */
  import type { WellViewSettings } from './view-settings';
  import type { WsonDoc } from './wson-summary';

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
</div>

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
</style>
