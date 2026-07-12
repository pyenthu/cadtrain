<!--
  PropertiesCard.svelte — the PROPERTIES tab body of the graph editor's
  viewport-glued top-left overlay card.

  Now JUST the part-level z-offset (how this part mates in a parent Stack).
  Per-part MATERIAL (colour / finish / opacity) moved ONTO the node cards
  (#66/#982): each Call card carries a material swatch chip → an anchored
  popover, plus the ◑ wire hookup for a shared material node. So the PROPERTIES
  card no longer holds the per-part appearance table — on w_multi_string_dev
  that was ~10 rows covering half the canvas.

  Rendered inside a <foreignObject> so it lives in the canvas <svg> but stays
  screen-fixed. Positioning (x/y/w/h) comes from GEP's layout constants.
-->
<script lang="ts">
  import { hasStackRef, type Graph } from '$lib/graph/composition-graph';

  let {
    x, y, w, h,
    graph,
    zOffsetVal,
    onZOffset,
  }: {
    x: number; y: number; w: number; h: number;
    graph: Graph;
    zOffsetVal: number;
    onZOffset: (value: number) => void;
  } = $props();
</script>

<foreignObject {x} {y} width={w} height={h}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ge-props-card" xmlns="http://www.w3.org/1999/xhtml"
       onpointerdown={(e) => e.stopPropagation()}>
    <!-- Part-level z-offset (the reserved stack_ref default). -->
    <div class="ge-props-zoff">
      <span class="lbl" title="0 = end-to-end flush · + = leave a gap · − = overlap into the next">z-off</span>
      <input class="num" type="number" step="0.05"
        value={zOffsetVal}
        class:unset={!hasStackRef(graph)}
        title="Part z-offset (how this part mates in a parent Stack)"
        onkeydown={(e) => { if (e.key === 'Enter') { onZOffset(Number((e.currentTarget as HTMLInputElement).value)); (e.currentTarget as HTMLInputElement).blur(); } }}
        onblur={(e) => onZOffset(Number((e.currentTarget as HTMLInputElement).value))}/>
      <span class="zoff-hint" title="Per-part colour · finish · opacity is now the material swatch chip on each node card">material → card</span>
    </div>
  </div>
</foreignObject>

<style>
  .ge-props-card {
    box-sizing: border-box; width: 100%;
    background: #fffbeb; border: 1.5px solid #d97706; border-radius: 8px;
    filter: drop-shadow(0 2px 3px rgba(0,0,0,0.06));
    overflow: hidden; font: 700 10px ui-monospace, monospace; color: #78350f;
    padding: 6px;
  }
  .ge-props-zoff { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .ge-props-zoff .lbl { font-size: 10px; color: #92400e; text-transform: uppercase; letter-spacing: 0.3px; white-space: nowrap; flex: none; }
  .ge-props-zoff .num {
    width: 56px; padding: 0 4px; height: 20px;
    font: 10px ui-monospace, monospace; color: #92400e; text-align: center;
    background: rgba(255,255,255,0.9); border: 1px solid #fbbf24; border-radius: 3px; box-sizing: border-box;
  }
  .ge-props-zoff .num.unset { color: #b45309; opacity: 0.65; font-style: italic; }
  .ge-props-zoff .num:focus { outline: 1px solid #d97706; background: #fff; }
  .ge-props-zoff .zoff-hint { font: 400 9px ui-monospace, monospace; color: #b45309; opacity: 0.7; margin-left: auto; }
</style>
