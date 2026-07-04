<script lang="ts">
  /**
   * WellSchematic2D — the FAST default /wells view: a pure 2D SVG track
   * schematic (ewells parity). Renders `wson-2d.ts`'s primitive specs as inline
   * `<rect>`/`<path>`/`<text>` on WHITE — O(#components), synchronous, NO WASM /
   * Manifold CSG / GPU. This is the #1 perf lever (see
   * `docs/research/wells-perf-ewells-vs-cadtrain.md`): opening a tab no longer
   * triggers a Manifold build.
   *
   * DEPTH SHARE: takes the SAME `remap` (raw MD → display depth) the 3D view
   * uses, so 2D and 3D place depth identically (`wson-2d.buildRemap` ==
   * `WellSchematic3D`'s `remap`). LAYER TOGGLES + scale dials come from the
   * shared `WellViewSettings` (view.layers / diaScale / dtx / directional /
   * zScale), so the control bar + element rail drive this view too.
   *
   * SVG id namespacing: patterns get a per-instance `svgNs` prefix
   * (memory `svg_gradient_id_collision`) — /primitives mounts N panes on a page.
   */
  import { computeWson2D, type Wson2DInput, type Pt, type LabelAnchor, type CompSeg } from '$lib/wells/wson-2d';
  import { spreadLabels } from './label-layout';
  import type { WsonDoc } from './wson-summary';
  import { defaultViewSettings, type WellViewSettings } from './view-settings';
  import type { CompletionPatch } from '$lib/wells/wson-mutate';
  import WellCompPopup from './WellCompPopup.svelte';

  let {
    wson = null,
    view = defaultViewSettings(),
    remap,
    onUpdateCompletion,
    onDeleteCompletion,
  }: {
    wson?: WsonDoc | null;
    view?: WellViewSettings;
    /** SHARED raw MD → display depth. When omitted, wson-2d rebuilds it from
     *  view.dtx / view.zScale (identical formula). */
    remap?: (md: number) => number;
    /** Edit-the-diagram hooks (the page's mutation layer). When absent, the
     *  double-click editor is inert — the view stays read-only. */
    onUpdateCompletion?: (srcIndex: number, patch: CompletionPatch) => void;
    onDeleteCompletion?: (srcIndex: number) => void;
  } = $props();

  // ── Double-click completion editor (SVTC CanvasCompPopup parity) ─────────────
  // Which completion is being edited + the trigger rect the popover anchors to.
  let editing = $state<{ comp: CompSeg; anchor: DOMRect } | null>(null);
  const editable = $derived(!!onUpdateCompletion);

  function openEditor(comp: CompSeg, ev: MouseEvent) {
    if (!editable) return;
    ev.stopPropagation();
    const el = ev.currentTarget as SVGGraphicsElement;
    editing = { comp, anchor: el.getBoundingClientRect() };
  }

  // Per-instance id prefix so cement/icd patterns never collide across panes.
  const svgNs = `w2d-${Math.random().toString(36).slice(2, 8)}`;

  const scene = $derived(
    wson
      ? computeWson2D(wson as Wson2DInput, {
          diaScale: view.diaScale,
          zScale: view.zScale,
          dtx: view.dtx,
          directional: view.directional,
          remap,
        })
      : null,
  );

  const L = $derived(view.layers);

  // Turn a point list into a CLOSED SVG path string (filled shapes).
  function path(pts: Pt[]): string {
    if (!pts.length) return '';
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ' Z';
  }
  // Open polyline (the centreline).
  function polyline(pts: Pt[]): string {
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  }

  // ── Label de-overlap (labella parity via the pure spreadLabels) ───────────────
  type Placed = LabelAnchor & { ly: number };
  interface PlacedBanks { left: Placed[]; right: Placed[]; rightRail: number; leftRail: number; }
  const placed = $derived.by<PlacedBanks>(() => {
    if (!scene) return { left: [], right: [], rightRail: 0, leftRail: 0 };
    const height = scene.height;
    const labels: LabelAnchor[] = scene.labels;
    const left = labels.filter((l: LabelAnchor) => l.side === 'left');
    const right = labels.filter((l: LabelAnchor) => l.side === 'right');
    const spread = (arr: LabelAnchor[]): Placed[] => {
      const ys = spreadLabels(arr.map((l: LabelAnchor) => l.ay), { gap: 15, min: 6, max: Math.max(6, height - 6) });
      return arr.map((l: LabelAnchor, i: number) => ({ ...l, ly: ys[i] ?? l.ay }));
    };
    // Rails just outside the widest anchor on each bank.
    const rightAx = right.length ? Math.max(...right.map((l: LabelAnchor) => l.ax)) : scene.centerX;
    const leftAx = left.length ? Math.min(...left.map((l: LabelAnchor) => l.ax)) : scene.centerX;
    return { left: spread(left), right: spread(right), rightRail: rightAx + 14, leftRail: leftAx - 14 };
  });
</script>

{#if scene}
  <div class="w2d">
    <svg
      width={scene.width}
      height={scene.height}
      viewBox="0 0 {scene.width} {scene.height}"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="{svgNs}-cement" width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill="#e8e8e8" />
          <circle cx="3" cy="3" r="1.2" fill="#8a7a55" />
        </pattern>
        <pattern id="{svgNs}-icd" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="#dbeafe" />
          <circle cx="4" cy="4" r="1" fill="#2563eb" />
        </pattern>
      </defs>

      <!-- Depth ruler column (gated by the shared Ruler toggle). -->
      {#if view.showRuler}
        <rect x="0" y={0} width={46} height={scene.height} fill="#f4f4f6" stroke="#d4d4d8" stroke-width="0.5" />
        <text x="4" y="12" font-size="8" fill="#556" font-family="ui-monospace, monospace"
          letter-spacing="0.5">MD·m</text>
        {#each scene.ruler as t}
          <line x1={40} y1={t.y} x2={46} y2={t.y} stroke="#999" stroke-width="0.8" />
          <text x={38} y={t.y + 3} text-anchor="end" font-size="8.5" fill="#556"
            font-family="ui-monospace, monospace">{t.md}</text>
        {/each}
      {/if}

      <!-- Wellbore axis / centreline. -->
      <path d={polyline(scene.centerline)}
        stroke="#c0392b" stroke-width="0.8" stroke-dasharray="4 4" fill="none" opacity="0.6" />

      <!-- Open hole. -->
      {#if L.showOpenHole}
        {#each scene.openHole as s}
          {#if scene.deviated}
            <path d={path(s.poly)} fill="#f3e8ff" stroke="#9333ea" stroke-width="1" stroke-dasharray="5 3" />
          {:else}
            <rect x={s.rect.x} y={s.rect.y} width={s.rect.w} height={s.rect.h}
              fill="#f3e8ff" stroke="#9333ea" stroke-width="1" stroke-dasharray="5 3" />
          {/if}
        {/each}
      {/if}

      <!-- Cement (annulus). -->
      {#if L.showCement}
        {#each scene.cement as c}
          {#if scene.deviated}
            <path d={path(c.leftPoly)} fill="url(#{svgNs}-cement)" />
            <path d={path(c.rightPoly)} fill="url(#{svgNs}-cement)" />
          {:else}
            <rect x={c.leftRect.x} y={c.leftRect.y} width={c.leftRect.w} height={c.leftRect.h} fill="url(#{svgNs}-cement)" />
            <rect x={c.rightRect.x} y={c.rightRect.y} width={c.rightRect.w} height={c.rightRect.h} fill="url(#{svgNs}-cement)" />
          {/if}
        {/each}
      {/if}

      <!-- Casing. -->
      {#if L.showCasing}
        {#each scene.casing as c}
          {#if scene.deviated}
            <path d={path(c.poly)} fill="azure" stroke="#111" stroke-width="1.4" />
          {:else}
            <rect x={c.rect.x} y={c.rect.y} width={c.rect.w} height={c.rect.h}
              fill="azure" stroke="#111" stroke-width="1.4" />
          {/if}
        {/each}
      {/if}

      <!-- Tubing string. -->
      {#if (L.showTubing ?? true) && scene.tubing}
        {#if scene.deviated}
          <path d={path(scene.tubing.poly)} fill="#fde68a" stroke="#b45309" stroke-width="1" />
        {:else}
          <rect x={scene.tubing.rect.x} y={scene.tubing.rect.y} width={scene.tubing.rect.w} height={scene.tubing.rect.h}
            fill="#fde68a" stroke="#b45309" stroke-width="1" />
        {/if}
      {/if}

      <!-- Completions. -->
      {#if L.showCompletions}
        {#each scene.completions as comp}
          {@const fill = comp.type === 'packer' ? '#f59e0b'
            : comp.type === 'icd' ? `url(#${svgNs}-icd)`
            : comp.type === 'liner' ? '#f0fdf4'
            : comp.type === 'hanger' ? '#94a3b8'
            : '#334155'}
          {@const stroke = comp.type === 'packer' ? '#b45309'
            : comp.type === 'icd' ? '#2563eb'
            : comp.type === 'liner' ? '#16a34a'
            : comp.type === 'hanger' ? '#475569'
            : '#334155'}
          {#if scene.deviated}
            <path d={path(comp.poly)} {fill} {stroke} stroke-width="1" opacity="0.92"
              class:editable ondblclick={(e) => openEditor(comp, e)}
              role={editable ? 'button' : undefined}
              tabindex={editable ? 0 : undefined}
              aria-label={editable ? `Edit ${comp.label}` : undefined} />
          {:else}
            <rect x={comp.rect.x} y={comp.rect.y} width={Math.max(2, comp.rect.w)} height={Math.max(1.5, comp.rect.h)}
              {fill} {stroke} stroke-width="1" opacity="0.92"
              class:editable ondblclick={(e) => openEditor(comp, e)}
              role={editable ? 'button' : undefined}
              tabindex={editable ? 0 : undefined}
              aria-label={editable ? `Edit ${comp.label}` : undefined} />
          {/if}
        {/each}
      {/if}

      <!-- Perforation arrows. -->
      {#if L.showPerforations}
        {#each scene.perfs as pf}
          {#each pf.arrows as a}
            <path d={path(a)} fill={pf.color} stroke="none" opacity="0.85" />
          {/each}
        {/each}
      {/if}

      <!-- TD marker. -->
      {#if scene.td}
        <line x1={scene.td.xL} y1={scene.td.y} x2={scene.td.xR} y2={scene.td.y} stroke="#dc2626" stroke-width="2" />
        <text x={scene.td.xR + 4} y={scene.td.y + 4} font-size="9" fill="#dc2626" font-family="sans-serif">TD {scene.td.md}m</text>
      {/if}

      <!-- Component leader labels (labella-parity de-overlap, two banks). -->
      {#if placed.right.length || placed.left.length}
        <g font-size="8" font-family="sans-serif">
          {#each placed.right as n}
            <line x1={n.ax} y1={n.ay} x2={placed.rightRail} y2={n.ly} stroke="#6b7280" stroke-width="0.8" stroke-dasharray="3,2" />
            <circle cx={n.ax} cy={n.ay} r="2" fill={n.color} opacity="0.8" />
            <text x={placed.rightRail + 5} y={n.ly + 2} text-anchor="start" fill="#374151">{n.text}</text>
          {/each}
          {#each placed.left as n}
            <line x1={n.ax} y1={n.ay} x2={placed.leftRail} y2={n.ly} stroke="#4f86c6" stroke-width="0.8" stroke-dasharray="4,2" />
            <circle cx={n.ax} cy={n.ay} r="2" fill={n.color} opacity="0.8" />
            <text x={placed.leftRail - 5} y={n.ly + 2} text-anchor="end" fill="#1e40af">{n.text}</text>
          {/each}
        </g>
      {/if}
    </svg>
  </div>

  <!-- Double-click completion editor (body-fixed, anchored beside the seg). -->
  {#if editing && editable}
    <WellCompPopup
      anchor={editing.anchor}
      comp={{
        description: editing.comp.label,
        od: editing.comp.od,
        top: editing.comp.top,
        bot: editing.comp.bot,
      }}
      onSave={(patch) => onUpdateCompletion?.(editing!.comp.srcIndex, patch)}
      onDelete={() => onDeleteCompletion?.(editing!.comp.srcIndex)}
      onClose={() => (editing = null)}
    />
  {/if}
{:else}
  <div class="w2d-empty">No WSON loaded.</div>
{/if}

<style>
  /* White schematic surface — schematics read best on paper (W-G c). Scrolls
     when the well is taller/wider than the pane. */
  .w2d {
    height: 100%;
    width: 100%;
    overflow: auto;
    background: #ffffff;
    display: flex;
    justify-content: center;
  }
  .w2d svg {
    display: block;
    margin: 8px auto;
    font-family: ui-monospace, monospace;
  }
  /* A completion is double-click editable — hint it, and lift its opacity on
     hover so the interactive target reads (edit-the-diagram differentiator). */
  .editable {
    cursor: pointer;
  }
  .editable:hover {
    opacity: 1;
    stroke-width: 1.6;
  }
  .w2d-empty {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #99a;
    font: 12px ui-monospace, monospace;
    background: #fff;
  }
</style>
