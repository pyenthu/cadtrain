<script lang="ts">
  /**
   * WellDiagramRail — the SINGLE in-stage vertical toolbar for a well diagram.
   *
   * Replaces the two separate rails (the far-left placement `WellToolbar` + the
   * in-stage layer-visibility `WellElementRail`) with ONE rail INSIDE the diagram
   * stage, carrying two top-level icons, each opening a flyout submenu to the
   * right:
   *   • 👁 Visibility  → toggle each schematic layer on/off (mutates the shared
   *                      `WellViewSettings.layers` — one source of truth).
   *   • ✎ Components   → the add/edit placement tools (scaffold: sets the active
   *                      tool id; real placement is future work — see WellToolbar
   *                      history + docs/plans/well-schematic.md).
   *
   * One submenu open at a time; click-outside or Escape closes. Element + tool
   * definitions are carried over from the two rails this consolidates.
   */
  import type { WellViewSettings } from './view-settings';
  import type { WsonDoc } from './wson-summary';

  let {
    settings,
    wson = null,
    activeTool = $bindable('select'),
  }: {
    settings: WellViewSettings;
    wson?: WsonDoc | null;
    activeTool?: string;
  } = $props();

  // ── Visibility layers (from WellElementRail) ────────────────────────────────
  type LKey = keyof WellViewSettings['layers'];
  interface El { key: LKey; label: string; dot: string; icon: string; count: () => number }

  const w = $derived((wson ?? {}) as Record<string, unknown[]>);
  const len = (k: string) => (Array.isArray(w[k]) ? (w[k] as unknown[]).length : 0);
  const tubingCount = $derived(
    ((wson?.completions ?? []) as Array<{ description?: string }>).filter((c) =>
      /tubing/i.test(c.description ?? '') && /joints/i.test(c.description ?? ''),
    ).length,
  );
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
  function toggleLayer(key: LKey) { settings.layers[key] = !settings.layers[key]; }

  // ── Placement / edit tools (from WellToolbar) ───────────────────────────────
  type Tool = { id: string; label: string; tip: string; icon: string };
  const TOOL_GROUPS: { name: string; tools: Tool[] }[] = [
    { name: 'Select', tools: [
      { id: 'select', label: 'Select', tip: 'Select / move (V)', icon: 'M3 2l10 5-4 1.6L7.7 13z' },
    ] },
    { name: 'Tubulars', tools: [
      { id: 'casing', label: 'Casing', tip: 'Casing string', icon: 'M5 2v12M11 2v12' },
      { id: 'liner', label: 'Liner', tip: 'Liner (hung string)', icon: 'M5 6v8M11 6v8M4 6h3M9 6h3' },
      { id: 'tubing', label: 'Tubing', tip: 'Production tubing', icon: 'M6.5 2v12M9.5 2v12' },
    ] },
    { name: 'Components', tools: [
      { id: 'packer', label: 'Packer', tip: 'Packer (sets/isolates)', icon: 'M6 2v12M10 2v12M3 6.5h3M3 9.5h3M10 6.5h3M10 9.5h3' },
      { id: 'nipple', label: 'Nipple / SSD', tip: 'Landing nipple / sliding sleeve', icon: 'M6 2v12M10 2v12M6 6h4M6 10h4' },
      { id: 'plug', label: 'Plug', tip: 'Plug / bridge plug', icon: 'M4 6h8v4H4zM6 6V4M10 6V4' },
    ] },
    { name: 'Subsurface', tools: [
      { id: 'perforation', label: 'Perforation', tip: 'Perforation interval', icon: 'M6 2v12M10 2v12M3 5h3M3 8h3M3 11h3M10 5h3M10 8h3M10 11h3' },
      { id: 'survey', label: 'Survey', tip: 'Survey / deviation station', icon: 'M8 1.5v3M8 11.5v3 M2.5 8h3M10.5 8h3 M8 8L4 4' },
      { id: 'measure', label: 'Measure', tip: 'Measure depth (MD)', icon: 'M3 3v10h2M3 5h2M3 7h3M3 9h2M3 11h2' },
    ] },
  ];
  function pickTool(id: string) { activeTool = id; /* scaffold — placement is future work */ }

  // ── Submenu open/close state ────────────────────────────────────────────────
  type Menu = 'visibility' | 'components' | null;
  let open = $state<Menu>(null);
  let railEl = $state<HTMLDivElement | null>(null);

  function toggleMenu(m: Exclude<Menu, null>) { open = open === m ? null : m; }
  function onDocPointerDown(e: PointerEvent) {
    if (!open) return;
    if (railEl && railEl.contains(e.target as Node)) return;
    open = null;
  }
  function onKeydown(e: KeyboardEvent) { if (e.key === 'Escape') open = null; }
</script>

<svelte:window onpointerdown={onDocPointerDown} onkeydown={onKeydown} />

<div
  class="wdr"
  bind:this={railEl}
  role="toolbar"
  tabindex="-1"
  aria-orientation="vertical"
  aria-label="Diagram tools"
  onpointerdown={(e) => e.stopPropagation()}
  onwheel={(e) => e.stopPropagation()}
>
  <!-- Icon 1 — Visibility (layer on/off) -->
  <div class="wdr-slot">
    <button
      class="wdr-btn"
      class:active={open === 'visibility'}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open === 'visibility'}
      aria-label="Show / hide layers"
      onclick={() => toggleMenu('visibility')}
    >
      <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor"
        stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 8s2.6-4.6 7-4.6S15 8 15 8s-2.6 4.6-7 4.6S1 8 1 8z" />
        <circle cx="8" cy="8" r="2.1" />
      </svg>
    </button>

    {#if open === 'visibility'}
      <div class="wdr-menu" role="menu" aria-label="Layers">
        <div class="wdr-menu-head">Show / hide</div>
        {#each ELEMENTS as el (el.key)}
          {@const on = settings.layers[el.key]}
          {@const n = el.count()}
          <button class="wdr-row" class:on type="button" role="menuitemcheckbox"
            aria-checked={on} onclick={() => toggleLayer(el.key)}>
            <span class="wdr-check" class:on>
              {#if on}<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3.2L13 4.5" /></svg>{/if}
            </span>
            <span class="wdr-dot" style="background:{on ? el.dot : 'transparent'}; border-color:{el.dot}"></span>
            <svg class="wdr-ico" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d={el.icon} /></svg>
            <span class="wdr-label">{el.label}</span>
            {#if n > 0}<span class="wdr-count">{n}</span>{/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="wdr-sep"></div>

  <!-- Icon 2 — Add / edit components -->
  <div class="wdr-slot">
    <button
      class="wdr-btn"
      class:active={open === 'components'}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open === 'components'}
      aria-label="Add / edit components"
      onclick={() => toggleMenu('components')}
    >
      <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor"
        stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.6 2.4l3 3M2.6 13.4l.9-3.1 7.1-7.1 3 3-7.1 7.1-3.1.9z" />
      </svg>
    </button>

    {#if open === 'components'}
      <div class="wdr-menu" role="menu" aria-label="Add / edit components">
        <div class="wdr-menu-head">Add / edit</div>
        {#each TOOL_GROUPS as grp, gi (grp.name)}
          {#if gi > 0}<div class="wdr-grp-sep"></div>{/if}
          <div class="wdr-grp-label">{grp.name}</div>
          {#each grp.tools as t (t.id)}
            <button class="wdr-row" class:on={activeTool === t.id} type="button" role="menuitemradio"
              aria-checked={activeTool === t.id} onclick={() => pickTool(t.id)}>
              <span class="wdr-check-sp"></span>
              <svg class="wdr-ico" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d={t.icon} /></svg>
              <span class="wdr-label">{t.label}</span>
            </button>
          {/each}
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .wdr {
    position: absolute;
    left: 8px;
    top: 56px;            /* clear the top control bar */
    z-index: 18;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px 3px;
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid var(--w-border);
    border-radius: 8px;
    backdrop-filter: blur(3px);
    user-select: none;
  }
  .wdr-slot { position: relative; display: flex; width: 100%; justify-content: center; }
  .wdr-btn {
    width: 36px;
    height: 34px;
    background: var(--w-surface-2);
    border: 1px solid var(--w-border);
    border-radius: 7px;
    color: var(--w-text-dim);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }
  .wdr-btn:hover { color: var(--w-text); border-color: var(--w-border-2); }
  .wdr-btn.active { border-color: var(--w-accent); color: var(--w-accent); background: var(--w-surface); }
  .wdr-sep { width: 24px; height: 1px; background: var(--w-border); margin: 2px 0; }

  /* Flyout submenu — to the right of the rail. */
  .wdr-menu {
    position: absolute;
    left: calc(100% + 8px);
    top: -6px;
    min-width: 172px;
    background: rgba(20, 22, 30, 0.97);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
    padding: 5px;
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .wdr-menu-head {
    font: 700 9px ui-monospace, monospace;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #9aa0b0;
    padding: 3px 8px 5px;
  }
  .wdr-grp-label {
    font: 700 8.5px ui-monospace, monospace;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #7d8494;
    padding: 4px 8px 2px;
  }
  .wdr-grp-sep { height: 1px; background: rgba(255, 255, 255, 0.08); margin: 3px 4px; }

  .wdr-row {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 5px 8px;
    background: none;
    border: none;
    border-radius: 5px;
    color: #d9dce6;
    cursor: pointer;
    text-align: left;
    font: 12px Arial, sans-serif;
    transition: background 0.1s ease, color 0.1s ease;
  }
  .wdr-row:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
  .wdr-row.on { color: #fff; }

  .wdr-check, .wdr-check-sp {
    flex: none;
    width: 15px;
    height: 15px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .wdr-check {
    border-radius: 4px;
    border: 1.5px solid rgba(255, 255, 255, 0.3);
    color: #0d0f16;
    background: transparent;
    box-sizing: border-box;
  }
  .wdr-check.on { background: var(--w-accent, #cc3333); border-color: var(--w-accent, #cc3333); color: #fff; }

  .wdr-dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1.5px solid;
    box-sizing: border-box;
  }
  .wdr-ico { flex: none; color: currentColor; }
  .wdr-label { flex: 1 1 auto; white-space: nowrap; }
  .wdr-count {
    flex: none;
    font: 700 10px ui-monospace, monospace;
    color: #9aa0b0;
    padding-left: 4px;
  }
  .wdr-row.on .wdr-count { color: #ffd; }
</style>
