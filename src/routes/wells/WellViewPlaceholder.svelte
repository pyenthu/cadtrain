<script lang="ts">
  /**
   * WellViewPlaceholder — the CENTRAL view of the /wells app shell, one per
   * open `.wson` tab. Renders TWO surfaces sharing one `WellViewSettings`:
   *
   *   • 2D (DEFAULT, `WellSchematic2D`) — a pure SVG track schematic. Cheap,
   *     synchronous, NO Manifold CSG. This is the #1 perf lever: opening a tab
   *     no longer triggers the full 3D boolean build (ewells parity — see
   *     `docs/research/wells-perf-ewells-vs-cadtrain.md`).
   *   • 3D + GRAPH (`GraphEditorPane`) — ONE lazily-mounted embedded editor over
   *     the well's generated composition graph (`wsonToGraph`). The `3d` mode is
   *     a chrome-free Manifold render (`embed.graphCanvas=false` → only the bake,
   *     no node canvas); the `graph` mode is the full node editor. Same mounted
   *     pane, embed reconfigured by mode — no double-bake. A well renders ONLY
   *     through the CAD graph + engine (wells skill); this replaced the old
   *     bespoke `WellSchematic3D`/`manifoldCut` THREE path, whose main-thread
   *     Manifold init was COEP-blocked (memory `wells_empty_3d_wiring_gap`).
   *
   * The control bar (`WellViewControls`) + element rail (`WellElementRail`)
   * mutate the shared settings, so their layer/scale toggles drive the views.
   * The 2D view carries its own depth ruler column (`remap2d` == the 3D bake's
   * own metre-depth placement, so 2D and 3D agree on depth).
   */
  import WellSchematic2D from './WellSchematic2D.svelte';
  import WellViewControls from './WellViewControls.svelte';
  import WellElementRail from './WellElementRail.svelte';
  import { buildRemap, type Wson2DInput } from '$lib/wells/wson-2d';
  import { summarise, type WsonDoc } from './wson-summary';
  import { defaultViewSettings, type WellViewSettings } from './view-settings';
  import GraphEditorPane from '$lib/shared/graph-editor/GraphEditorPane.svelte';
  import type { EmbedConfig } from '$lib/shared/graph-editor/embed-config';
  import { wsonToGraph } from '$lib/wells/wson-to-graph';
  import type { Wson } from '$lib/wells/wson';

  import type { CompletionPatch } from '$lib/wells/wson-mutate';

  let {
    wson = null,
    error = null,
    fileName = '',
    // The shell passes a shared settings object; fall back to a per-view
    // default so the component still works standalone.
    view = defaultViewSettings(),
    paneActive = true,
    onUpdateCompletion,
    onDeleteCompletion,
  }: {
    wson?: WsonDoc | null;
    error?: string | null;
    fileName?: string;
    view?: WellViewSettings;
    /** Is THIS well's pane the visible one? Every open `.wson` tab stays mounted
     *  and they all share one `view`, so without this each pane would mount its
     *  own graph editor and bake — and the panes share one TF worker, whose
     *  latest-wins supersede blanks all but the last (the /primitives lesson,
     *  2026-07-06). Mirrors `<GraphEditorPane active={activeKey === t.key}>`. */
    paneActive?: boolean;
    /** Edit-the-diagram hooks — forwarded to the 2D view's double-click editor.
     *  Pure prop forwarding: does NOT touch the 3D scene / its reactivity. */
    onUpdateCompletion?: (srcIndex: number, patch: CompletionPatch) => void;
    onDeleteCompletion?: (srcIndex: number) => void;
  } = $props();

  const summary = $derived(summarise(wson));

  // ONE lazy-mount latch for the embedded graph editor — it serves BOTH the 3D
  // view (a chrome-free bake of the well graph via embed.graphCanvas=false) AND
  // the full-editor GRAPH view. Sticky, so switching modes is instant and the
  // baked geometry + graph state persist. A well that only ever shows 2D pays
  // for zero Manifold work. (Replaces the old WellSchematic3D THREE path, whose
  // main-thread manifoldCut was COEP-blocked — memory wells_empty_3d_wiring_gap.)
  let mountedEditor = $state(false);
  $effect(() => {
    if ((view.viewMode === '3d' || view.viewMode === 'graph') && paneActive) mountedEditor = true;
  });

  // The embed config the editor mounts with, per view mode: 3D = a clean
  // Manifold render (no node canvas, no toolbar/sidebar, only the bake tab);
  // GRAPH = the full node editor. $derived so switching mode reconfigures the
  // SAME mounted pane (no remount, no double-bake — only the active mode bakes).
  // Open the full node editor as a LARGE popover from the clean 3D view — pop it
  // open big, edit the graph, close back to the render. Reset on leaving 3D. When
  // open, the SAME mounted pane reconfigures to the full editor (edits persist →
  // the 3D reflects them on close; no second pane, no double-bake).
  let graphPopover = $state(false);
  $effect(() => {
    if (view.viewMode !== '3d') graphPopover = false;
  });

  const editorEmbed: boolean | Partial<EmbedConfig> = $derived(
    view.viewMode === '3d' && !graphPopover
      ? { graphCanvas: false, toolbar: false, sidebar: false, tabs: ['bake'], engines: ['manifold'] }
      : true,
  );

  /** The generated assembly's id — deterministic from the well name, so re-opening
   *  the same well targets the same part and GraphEditorPane's first Save lands on
   *  a stable name under `wells/` (Rule 16: location IS category). */
  const wellPartId = $derived.by(() => {
    const raw = (wson?.meta?.wellName ?? fileName ?? 'well').toLowerCase();
    const slug = raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'well';
    return `w_${slug}`.slice(0, 48);
  });

  /** WSON → composition graph. NO FALLBACK (wells skill): a well we cannot express
   *  as a graph surfaces its error here rather than rendering a stand-in. */
  const wellGraph = $derived.by((): { graph: unknown | null; error: string | null } => {
    if (!mountedEditor || !wson) return { graph: null, error: null };
    try {
      return { graph: wsonToGraph(wson as unknown as Wson), error: null };
    } catch (e) {
      return { graph: null, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // Shared depth remap for the 2D view (raw MD → display depth) — IDENTICAL to
  // the 3D scene's own `remap`, so both surfaces agree on depth. The 2D view's
  // internal ruler reads this too.
  const remap2d = $derived(
    wson ? buildRemap(wson as unknown as Wson2DInput, { dtx: view.dtx, zScale: view.zScale }) : (md: number) => md,
  );

</script>

<div class="wv">
  {#if error}
    <div class="wv-error">
      <div class="wv-error-ic">⚠</div>
      <div>
        <div class="wv-error-title">Failed to parse {fileName}</div>
        <code class="wv-error-msg">{error}</code>
      </div>
    </div>
  {:else if summary}
    <!-- Stage: 2D SVG surface (default) + lazy 3D scene + shared overlays. -->
    <section class="wv-stage" class:white={view.viewMode !== 'graph' && (view.viewMode === '2d' || view.whiteBg)}>
      <!-- 2D track schematic — always mounted (cheap). Hidden when in 3D. -->
      <div class="wv-surface" class:hidden={view.viewMode !== '2d'}>
        <WellSchematic2D {wson} {view} remap={remap2d} {onUpdateCompletion} {onDeleteCompletion} />
      </div>

      <!-- CAD graph editor — the well's generated graph, baked through the SAME
           pipeline that bakes every bw_* part (wells skill: a well renders ONLY
           through the CAD graph + engine). ONE mounted pane serves both views:
           3D = a chrome-free Manifold render (embed.graphCanvas=false → no node
           canvas); GRAPH = the full node editor. Shown for either mode, hidden in
           2D. `seedGraph` hydrates the in-memory graph (opening writes NOTHING to
           the volume; the pane's own Save creates `wellPartId` under wells/).
           Remounts only when the well changes. NO FALLBACK — a well we cannot
           express as a graph surfaces its error (wells skill). -->
      {#if mountedEditor}
        {@const inPopover = view.viewMode === '3d' && graphPopover}
        {#if inPopover}
          <!-- Dim backdrop behind the large editor popover — click to close. -->
          <div class="wv-graph-backdrop" role="presentation" onclick={() => (graphPopover = false)}></div>
        {/if}
        <div class="wv-surface" class:editor-offset={!inPopover}
          class:graph-popover={inPopover}
          class:hidden={view.viewMode !== '3d' && view.viewMode !== 'graph'}>
          {#if inPopover}
            <button class="wv-graph-close" type="button" title="Close the editor" onclick={() => (graphPopover = false)}>×</button>
          {/if}
          {#if wellGraph.error}
            <div class="wv-error">
              <div class="wv-error-ic">⚠</div>
              <div>
                <div class="wv-error-title">Cannot render this well</div>
                <code class="wv-error-msg">{wellGraph.error}</code>
              </div>
            </div>
          {:else if wellGraph.graph}
            {#key wellPartId}
              <GraphEditorPane
                id={wellPartId}
                embed={editorEmbed}
                active={(view.viewMode === '3d' || view.viewMode === 'graph') && paneActive}
                autoTf={false}
                seedGraph={wellGraph.graph}
                createDir="wells"
              />
            {/key}
          {/if}
        </div>
      {/if}

      <!-- Top view/scale bar + left element rail (both mutate `view`). The rail is
           a schematic-layer switch; it has no meaning over the graph canvas. -->
      <WellViewControls settings={view} />
      <!-- Pop the full node editor open LARGE over the clean 3D render. -->
      {#if view.viewMode === '3d' && !graphPopover}
        <button class="wv-graph-open" type="button"
          title="Open the node-graph editor (large popover)"
          onclick={() => (graphPopover = true)}>✎ edit graph</button>
      {/if}
      {#if view.viewMode !== 'graph' && !(view.viewMode === '3d' && graphPopover)}
        <WellElementRail settings={view} {wson} />
      {/if}
    </section>
  {:else}
    <div class="wv-empty">No WSON loaded.</div>
  {/if}
</div>

<style>
  .wv {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--w-bg);
    color: var(--w-text);
    overflow: hidden;
  }

  /* Stage fills the pane (W-G b — trimmed the big 14px inset + dashed frame so
     the 3D view uses the space). Overlays position against this. */
  .wv-stage {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    background: radial-gradient(circle at 50% 35%, var(--w-surface-2) 0%, var(--w-surface) 80%);
  }
  /* Each render surface (2D SVG / 3D Canvas) fills the stage; the inactive one
     is hidden but kept mounted so switching modes is instant + preserves state
     (the /primitives always-mounted-panes pattern). */
  .wv-surface {
    position: absolute;
    inset: 0;
  }
  .wv-surface.hidden {
    visibility: hidden;
    pointer-events: none;
  }
  /* The floating view/scale bar + the editor's bake-header chrome both overlay
     the stage's top-left. Drop the embedded editor surface (3D + GRAPH) below the
     bar so the two don't stack. */
  .wv-surface.editor-offset {
    top: 46px;
  }
  /* Large node-editor popover (opened from the 3D view via ✎): the SAME editor
     surface floats as a big centered panel over a dim backdrop; × or the backdrop
     closes it (graphPopover). */
  .wv-graph-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(15, 23, 42, 0.4);
    z-index: 20;
  }
  .wv-surface.graph-popover {
    inset: 3%;
    z-index: 21;
    border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.42);
    overflow: hidden;
    background: #fff;
  }
  .wv-graph-close {
    position: absolute;
    top: 6px;
    right: 10px;
    z-index: 22;
    width: 26px;
    height: 26px;
    border: 1px solid #d6d3d1;
    border-radius: 6px;
    background: #fff;
    color: #6b7280;
    font: 700 16px Arial;
    line-height: 1;
    cursor: pointer;
  }
  .wv-graph-close:hover { color: #5b21b6; border-color: #c4b5fd; }
  .wv-graph-open {
    position: absolute;
    top: 8px;
    right: 12px;
    z-index: 15;
    padding: 5px 10px;
    border: 1px solid #c4b5fd;
    border-radius: 6px;
    background: #fff;
    color: #5b21b6;
    font: 600 12px Arial;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
  }
  .wv-graph-open:hover { background: #f5f3ff; }
  /* W-G c — schematics read best on white. Flag today tints the 3D backdrop;
     W-D's 2D/SVG track view will render on this same white surface. */
  .wv-stage.white {
    background: var(--w-text);
  }
  .wv-error {
    margin: 24px;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    background: #2a1620;
    border: 1px solid #cc3333;
    border-radius: 8px;
    padding: 14px 16px;
  }
  .wv-error-ic {
    font-size: 20px;
    color: var(--w-accent);
  }
  .wv-error-title {
    font: 600 13px Arial;
    color: #ff8a8a;
  }
  .wv-error-msg {
    display: block;
    margin-top: 4px;
    font: 11px ui-monospace, monospace;
    color: #d99;
  }
  .wv-empty {
    margin: auto;
    color: var(--w-text-faint);
    font: 12px ui-monospace, monospace;
  }
</style>
