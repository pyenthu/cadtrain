<!--
  PropertiesCard.svelte — the PROPERTIES tab body of the graph editor's
  viewport-glued top-left overlay card (modularize K.65, Phase D).

  A 4-column HTML grid (rendered inside a <foreignObject> so it lives in the
  canvas <svg> but stays screen-fixed, OUTSIDE the pan/zoom group): part-level
  z-offset (the reserved stack_ref default) · outer colour · inner (bore) colour
  · material. Pure display + callbacks — every edit routes through the parent's
  graph mutators (onZOffset / onColorOuter / onColorInner / onMaterial), so this
  component holds no graph state of its own.

  Positioning (x/y/w/h) is passed in from GEP's layout constants (PROPS_X0,
  PROPS_Y0 + TAB_HEADER_H, PROPS_W, propsBodyH) — the obstacle/auto-layout math
  in GEP references the same constants, so they stay there.
-->
<script lang="ts">
  import { hasStackRef, type Graph } from '$lib/cad/composition-graph';

  let {
    x, y, w, h,
    graph,
    zOffsetVal,
    onZOffset,
    onColorOuter,
    onColorInner,
    onMaterial,
  }: {
    x: number; y: number; w: number; h: number;
    graph: Graph;
    /** Live z-offset value (the reserved stack_ref default, or 0 when unset). */
    zOffsetVal: number;
    onZOffset: (value: number) => void;
    onColorOuter: (hex: string | null) => void;
    onColorInner: (hex: string | null) => void;
    onMaterial: (mat: string | null) => void;
  } = $props();

  // Default swatch colours shown when the part has no colour set yet — the
  // classic red-outer / grey-inner hues (match builder.ts DEFAULT_*_HEX).
  const DEFAULT_OUTER = '#cc2222';
  const DEFAULT_INNER = '#888888';
  const MATERIALS = ['none', 'steel', 'aluminum', 'titanium', 'brass'];
</script>

<!-- PROPERTIES body — directly below the tab header. -->
<foreignObject {x} {y} width={w} height={h}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ge-props-card" xmlns="http://www.w3.org/1999/xhtml"
       onpointerdown={(e) => e.stopPropagation()}>
    <!-- 4-column grid: label on TOP of each control.
         z-offset · outer · inner · material -->
    <div class="ge-props-body">
      <!-- z-offset — surfaces the reserved stack_ref default -->
      <div class="ge-props-col">
        <span class="lbl" title="0 = end-to-end flush · + = leave a gap · − = overlap into the next">z-offset</span>
        <input class="num" type="number" step="0.05"
          value={zOffsetVal}
          class:unset={!hasStackRef(graph)}
          title="0 = end-to-end flush · + = leave a gap · − = overlap into the next"
          onkeydown={(e) => { if (e.key === 'Enter') { onZOffset(Number((e.currentTarget as HTMLInputElement).value)); (e.currentTarget as HTMLInputElement).blur(); } }}
          onblur={(e) => onZOffset(Number((e.currentTarget as HTMLInputElement).value))}/>
      </div>
      <!-- OUTER colour — outer body faces. single native picker IS the swatch -->
      <div class="ge-props-col">
        <span class="lbl">outer</span>
        <input class="color" type="color"
          value={graph.colorOuter ?? DEFAULT_OUTER}
          title={graph.colorOuter ? `Outside colour ${graph.colorOuter}` : 'Set OUTSIDE colour (unset → default red)'}
          oninput={(e) => onColorOuter((e.currentTarget as HTMLInputElement).value)}/>
      </div>
      <!-- INNER colour — bore / cut faces shown in the cutaway -->
      <div class="ge-props-col">
        <span class="lbl">inner</span>
        <input class="color" type="color"
          value={graph.colorInner ?? DEFAULT_INNER}
          title={graph.colorInner ? `Inside (bore) colour ${graph.colorInner}` : 'Set INSIDE bore colour (unset → default grey)'}
          oninput={(e) => onColorInner((e.currentTarget as HTMLInputElement).value)}/>
      </div>
      <!-- material -->
      <div class="ge-props-col">
        <span class="lbl">material</span>
        <select class="mat"
          value={graph.material ?? 'none'}
          title="Part material tag"
          onchange={(e) => onMaterial((e.currentTarget as HTMLSelectElement).value)}>
          {#each MATERIALS as m}
            <option value={m}>{m}</option>
          {/each}
        </select>
      </div>
    </div>
  </div>
</foreignObject>

<style>
  .ge-props-card {
    box-sizing: border-box; width: 100%;
    background: #fffbeb; border: 1.5px solid #d97706; border-radius: 8px;
    filter: drop-shadow(0 2px 3px rgba(0,0,0,0.06));
    overflow: hidden; font: 700 10px ui-monospace, monospace; color: #78350f;
  }
  /* 4-column grid — each column is a top label + one control below. */
  .ge-props-body {
    padding: 8px; display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 6px; align-items: end;
  }
  .ge-props-col { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .ge-props-col .lbl {
    font-size: 10px; line-height: 1; color: #92400e; text-transform: uppercase;
    letter-spacing: 0.3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .ge-props-col .num {
    width: 100%; padding: 0 4px; height: 22px;
    font: 10px ui-monospace, monospace; color: #92400e; text-align: center;
    background: rgba(255,255,255,0.9); border: 1px solid #fbbf24; border-radius: 3px;
    box-sizing: border-box;
  }
  .ge-props-col .num.unset { color: #b45309; opacity: 0.65; font-style: italic; }
  .ge-props-col .num:focus { outline: 1px solid #d97706; background: #fff; }
  /* The colour picker IS the swatch — one element, full-width of its column. */
  .ge-props-col .color {
    width: 100%; height: 22px; padding: 0;
    border: 1px solid #fbbf24; border-radius: 3px; background: #fff; cursor: pointer;
    box-sizing: border-box;
  }
  .ge-props-col .mat {
    width: 100%; min-width: 0; height: 22px; padding: 0 2px;
    font: 10px ui-monospace, monospace; color: #92400e;
    background: rgba(255,255,255,0.9); border: 1px solid #fbbf24; border-radius: 3px;
    cursor: pointer; box-sizing: border-box;
  }
</style>
