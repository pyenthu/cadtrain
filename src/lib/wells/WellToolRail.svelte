<script lang="ts">
  /**
   * WellToolRail — the SVTC-style vertical LEFT tool rail for /wells (#42, W-E).
   *
   * Modeled on SVTC's `WsonToolbar.svelte` (icon-button rail + active highlight +
   * hover tooltip to the right), re-skinned for cadtrain's dark /wells chrome and
   * extended for cadtrain's 3D-first, component-library stance. Grouped top→bottom:
   *
   *   FILE     new · open · save · export           → onAction(action)
   *   TOOLS    select · measure                      → onTool(name)   (activeTool ✓)
   *   BODY     open-hole · casing · cement · tubing  → onAddElement(type)  [bw_* parts]
   *   COMPLETE packer · nipple · valve · …           → onAddElement(type)  [g_*  parts]
   *   PERF     perforation                           → onAddElement('perforation')
   *   VIEW     2D | 3D · camera presets · fit         → onViewMode / onCamera / onFit
   *
   * SELF-CONTAINED: this component owns NO app state — it reads its highlight
   * state from props (`activeTool`, `viewMode`, `cameraPreset`) and EMITS every
   * action through optional callback props, so the /wells shell wires it to the
   * shared `WellViewSettings` + the (future) placement/mutation layer at will.
   * The add-element buttons are DERIVED from the wells registry (well-tool-rail.ts
   * → registry.ts) so they cover the real `bw_*` / `g_*` parts.
   *
   * Z-down convention applies downstream: a placed element's `top` is the LOWER z.
   */
  import {
    ADD_ITEMS,
    STRUCTURAL_ITEMS,
    COMPLETION_ITEMS,
    PERFORATION_ITEM,
    TOOL_ITEMS,
    CAMERA_ITEMS,
    FILE_ITEMS,
    type WellElementType,
    type WellToolName,
    type WellViewMode,
    type WellCameraPreset,
    type WellFileAction,
  } from './well-tool-rail';

  interface Props {
    /** Highlighted placement/selection tool id (sets the pressed pointer button). */
    activeTool?: WellToolName | string;
    /** Current rendered surface — highlights the 2D | 3D segment. */
    viewMode?: WellViewMode;
    /** Optional highlighted camera preset. */
    cameraPreset?: WellCameraPreset | null;
    /** Grey out the add-element groups (e.g. no well open). */
    disableAdd?: boolean;

    /** Add a well element (structural `bw_*`, completion `g_*`, or a perforation). */
    onAddElement?: (type: WellElementType) => void;
    /** Select a placement/selection tool (caller updates `activeTool`). */
    onTool?: (name: WellToolName) => void;
    /** Switch the 2D | 3D surface (caller updates `viewMode`). */
    onViewMode?: (mode: WellViewMode) => void;
    /** Apply a camera framing preset (3D only). */
    onCamera?: (preset: WellCameraPreset) => void;
    /** Fit / frame the whole well in view. */
    onFit?: () => void;
    /** File / export action. */
    onAction?: (action: WellFileAction) => void;
  }

  let {
    activeTool = 'select',
    viewMode = '3d',
    cameraPreset = null,
    disableAdd = false,
    onAddElement,
    onTool,
    onViewMode,
    onCamera,
    onFit,
    onAction,
  }: Props = $props();

  // Re-export the grouped descriptors for the template (keeps markup readable).
  const structural = STRUCTURAL_ITEMS;
  const completions = COMPLETION_ITEMS;
  const perf = PERFORATION_ITEM;
</script>

<div
  class="wtr"
  role="toolbar"
  aria-orientation="vertical"
  aria-label="Well tools"
>
  <!-- ── FILE / export ──────────────────────────────────────────────────── -->
  <div class="wtr-grp" role="group" aria-label="File">
    {#each FILE_ITEMS as f (f.id)}
      <div class="wtr-item">
        <button class="wtr-btn" type="button" aria-label={f.label}
          onclick={() => onAction?.(f.id)}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d={f.icon} /></svg>
        </button>
        <span class="wtr-tip">{f.tip}</span>
      </div>
    {/each}
  </div>

  <div class="wtr-sep"></div>

  <!-- ── Pointer / measure tools (set activeTool) ───────────────────────── -->
  <div class="wtr-grp" role="group" aria-label="Tools">
    {#each TOOL_ITEMS as t (t.id)}
      <div class="wtr-item">
        <button class="wtr-btn" class:on={activeTool === t.id} type="button"
          aria-pressed={activeTool === t.id} aria-label={t.label}
          onclick={() => onTool?.(t.id)}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d={t.icon} /></svg>
        </button>
        <span class="wtr-tip">{t.tip}</span>
      </div>
    {/each}
  </div>

  <div class="wtr-sep"></div>

  <!-- ── Add well BODY (bw_* structural parts) ──────────────────────────── -->
  <div class="wtr-grp" role="group" aria-label="Add well body" class:dim={disableAdd}>
    {#each structural as el (el.type)}
      <div class="wtr-item">
        <button class="wtr-btn wtr-add" type="button" disabled={disableAdd}
          aria-label={`Add ${el.label}`}
          onclick={() => onAddElement?.(el.type)}>
          <span class="wtr-dot" style="background:{el.color}; border-color:{el.color}"></span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d={el.icon} /></svg>
          <span class="wtr-plus">+</span>
        </button>
        <span class="wtr-tip">Add {el.tip}</span>
      </div>
    {/each}
  </div>

  <div class="wtr-sep"></div>

  <!-- ── Add COMPLETION jewelry (g_* catalogue) ─────────────────────────── -->
  <div class="wtr-grp" role="group" aria-label="Add completion" class:dim={disableAdd}>
    {#each completions as el (el.type)}
      <div class="wtr-item">
        <button class="wtr-btn wtr-add" type="button" disabled={disableAdd}
          aria-label={`Add ${el.label}`}
          onclick={() => onAddElement?.(el.type)}>
          <span class="wtr-dot" style="background:{el.color}; border-color:{el.color}"></span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d={el.icon} /></svg>
          <span class="wtr-plus">+</span>
        </button>
        <span class="wtr-tip">Add {el.tip}</span>
      </div>
    {/each}

    <!-- Perforation sits with the subsurface add group. -->
    <div class="wtr-item">
      <button class="wtr-btn wtr-add" type="button" disabled={disableAdd}
        aria-label={`Add ${perf.label}`}
        onclick={() => onAddElement?.(perf.type)}>
        <span class="wtr-dot" style="background:{perf.color}; border-color:{perf.color}"></span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
          stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d={perf.icon} /></svg>
        <span class="wtr-plus">+</span>
      </button>
      <span class="wtr-tip">Add {perf.tip}</span>
    </div>
  </div>

  <!-- Spacer pushes the VIEW group to the bottom of the rail. -->
  <div class="wtr-spring"></div>

  <div class="wtr-sep"></div>

  <!-- ── VIEW: 2D | 3D · camera presets · fit ───────────────────────────── -->
  <div class="wtr-grp wtr-view" role="group" aria-label="View">
    <!-- 2D | 3D segmented toggle. -->
    <div class="wtr-seg" role="group" aria-label="View mode">
      <button type="button" class="wtr-seg-btn" class:on={viewMode === '2d'}
        aria-pressed={viewMode === '2d'} title="2D SVG track (fast)"
        onclick={() => onViewMode?.('2d')}>2D</button>
      <button type="button" class="wtr-seg-btn" class:on={viewMode === '3d'}
        aria-pressed={viewMode === '3d'} title="3D Manifold cutaway"
        onclick={() => onViewMode?.('3d')}>3D</button>
    </div>

    <!-- Camera presets — meaningful in 3D. -->
    {#each CAMERA_ITEMS as c (c.id)}
      <div class="wtr-item">
        <button class="wtr-btn" class:on={cameraPreset === c.id} type="button"
          disabled={viewMode !== '3d'} aria-pressed={cameraPreset === c.id}
          aria-label={c.tip} onclick={() => onCamera?.(c.id)}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d={c.icon} /></svg>
        </button>
        <span class="wtr-tip">{c.tip}</span>
      </div>
    {/each}

    <!-- Fit / frame the whole well. -->
    <div class="wtr-item">
      <button class="wtr-btn" type="button" aria-label="Fit to view" onclick={() => onFit?.()}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
          stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3" />
        </svg>
      </button>
      <span class="wtr-tip">Fit to view</span>
    </div>
  </div>
</div>

<style>
  .wtr {
    width: 40px;
    flex: none;
    height: 100%;
    box-sizing: border-box;
    background: #16161f;
    border-right: 1px solid #2a2a3e;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 8px 2px;
    overflow-y: auto;
    overflow-x: visible;
    scrollbar-width: thin;
    scrollbar-color: #2a2a3e transparent;
  }
  .wtr::-webkit-scrollbar { width: 5px; }
  .wtr::-webkit-scrollbar-thumb { background: #2a2a3e; border-radius: 3px; }

  .wtr-grp {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    width: 100%;
  }
  /* Push the VIEW group to the bottom when the rail is taller than its buttons. */
  .wtr-spring { flex: 1 1 auto; min-height: 4px; }

  .wtr-item { position: relative; display: flex; }

  .wtr-btn {
    position: relative;
    background: none;
    border: 1px solid transparent;
    color: #8a8aa0;
    width: 30px;
    height: 30px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }
  .wtr-btn:hover { background: #24243a; color: #d8d8ef; }
  .wtr-btn.on {
    background: #2a2a48;
    border-color: #cc2222;
    color: #ff6a6a;
  }
  .wtr-btn:disabled { opacity: 0.38; cursor: not-allowed; }
  .wtr-btn:disabled:hover { background: none; color: #8a8aa0; }

  /* Add buttons carry a category colour dot + a small "+" affordance. */
  .wtr-add:hover { border-color: #44446a; }
  .wtr-dot {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    border: 1px solid;
    box-sizing: border-box;
  }
  .wtr-plus {
    position: absolute;
    bottom: 0;
    right: 2px;
    font: 700 10px ui-monospace, monospace;
    line-height: 1;
    color: #6a6a86;
  }
  .wtr-add:hover .wtr-plus { color: #cfcfe6; }
  .wtr-grp.dim { opacity: 0.9; }

  .wtr-sep { width: 22px; height: 1px; background: #2a2a3e; margin: 2px 0; flex: none; }

  /* 2D | 3D segmented control (SVTC WsonDisplayMenu-style, stacked-compatible). */
  .wtr-view { gap: 4px; }
  .wtr-seg {
    display: inline-flex;
    border: 1px solid #34345a;
    border-radius: 9999px;
    overflow: hidden;
  }
  .wtr-seg-btn {
    background: #1a1a2a;
    border: none;
    color: #889;
    cursor: pointer;
    padding: 2px 6px;
    font: 700 10px Arial, sans-serif;
  }
  .wtr-seg-btn:hover { color: #fff; }
  .wtr-seg-btn.on { background: #cc3333; color: #fff; }

  /* Tooltip — to the right on hover (SVTC WsonToolbar style). */
  .wtr-tip {
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
  .wtr-item:hover .wtr-tip {
    opacity: 1;
    visibility: visible;
    transform: translate(0, -50%);
  }
</style>
