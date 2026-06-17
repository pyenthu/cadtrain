<!--
  PropertiesCard.svelte — the PROPERTIES tab body of the graph editor's
  viewport-glued top-left overlay card (modularize K.65, Phase D).

  PER-PART table (#13/#14): a part-level z-offset row, then a compact table of
  OUT · IN · Matl with one row per output part (A/B/C…) plus a "Default" row
  that edits the part-level colour fallback. Per-part edits route through
  onPartAppearance(id, patch); the Default row through the part-level
  onColorOuter/Inner/Material. NOTE: the per-part colours are stored +
  round-tripped now; the actual 3D VIEWER tint is the deferred #86.

  Rendered inside a <foreignObject> so it lives in the canvas <svg> but stays
  screen-fixed. Positioning (x/y/w/h) comes from GEP's layout constants.
-->
<script lang="ts">
  import { hasStackRef, type Graph } from '$lib/cad/composition-graph';

  let {
    x, y, w, h,
    graph,
    zOffsetVal,
    parts,
    onZOffset,
    onColorOuter,
    onColorInner,
    onMaterial,
    onPartAppearance,
  }: {
    x: number; y: number; w: number; h: number;
    graph: Graph;
    zOffsetVal: number;
    /** Output parts (A/B/C…) — {id, label, appearance:{colorOuter?,colorInner?,material?}}. */
    parts: { id: string; label: string; appearance: { colorOuter?: string; colorInner?: string; material?: string } }[];
    onZOffset: (value: number) => void;
    onColorOuter: (hex: string | null) => void;
    onColorInner: (hex: string | null) => void;
    onMaterial: (mat: string | null) => void;
    onPartAppearance: (id: string, patch: { colorOuter?: string | null; colorInner?: string | null; material?: string | null }) => void;
  } = $props();

  const DEFAULT_OUTER = '#cc2222';
  const DEFAULT_INNER = '#888888';
  const MATERIALS = ['none', 'steel', 'aluminum', 'titanium', 'brass'];

  // Effective values for a part row: per-part override ?? part-level ?? default.
  const outerOf = (a: any) => a.colorOuter ?? graph.colorOuter ?? DEFAULT_OUTER;
  const innerOf = (a: any) => a.colorInner ?? graph.colorInner ?? DEFAULT_INNER;
  const matOf = (a: any) => a.material ?? graph.material ?? 'none';
  // Show only ONE part row if there's a single part (the table still reads well).
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
      <span class="zoff-hint">per-part colours · viewer tint = #86</span>
    </div>

    <!-- Per-part appearance table: PART · OUT · IN · Matl. -->
    <div class="ge-props-table">
      <div class="row head">
        <span class="c-part">PART</span><span class="c-sw">OUT</span><span class="c-sw">IN</span><span class="c-mat">Matl</span>
      </div>
      <!-- Default (part-level) row — fallback for parts without an override. -->
      <div class="row">
        <span class="c-part def" title="Default for parts with no override">Default</span>
        <input class="c-sw sw" type="color" value={graph.colorOuter ?? DEFAULT_OUTER}
          title="Default OUTSIDE colour" oninput={(e) => onColorOuter((e.currentTarget as HTMLInputElement).value)}/>
        <input class="c-sw sw" type="color" value={graph.colorInner ?? DEFAULT_INNER}
          title="Default INSIDE (bore) colour" oninput={(e) => onColorInner((e.currentTarget as HTMLInputElement).value)}/>
        <select class="c-mat mat" value={graph.material ?? 'none'} title="Default material"
          onchange={(e) => onMaterial((e.currentTarget as HTMLSelectElement).value)}>
          {#each MATERIALS as m}<option value={m}>{m}</option>{/each}
        </select>
      </div>
      {#each parts as p (p.id)}
        <div class="row">
          <span class="c-part" title={p.label}>{p.label}</span>
          <input class="c-sw sw" type="color" value={outerOf(p.appearance)}
            class:override={p.appearance.colorOuter}
            title={`${p.label} OUTSIDE colour${p.appearance.colorOuter ? '' : ' (inherits Default)'}`}
            oninput={(e) => onPartAppearance(p.id, { colorOuter: (e.currentTarget as HTMLInputElement).value })}/>
          <input class="c-sw sw" type="color" value={innerOf(p.appearance)}
            class:override={p.appearance.colorInner}
            title={`${p.label} INSIDE colour${p.appearance.colorInner ? '' : ' (inherits Default)'}`}
            oninput={(e) => onPartAppearance(p.id, { colorInner: (e.currentTarget as HTMLInputElement).value })}/>
          <select class="c-mat mat" value={matOf(p.appearance)} title={`${p.label} material`}
            onchange={(e) => onPartAppearance(p.id, { material: (e.currentTarget as HTMLSelectElement).value })}>
            {#each MATERIALS as m}<option value={m}>{m}</option>{/each}
          </select>
        </div>
      {/each}
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
  .ge-props-zoff { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .ge-props-zoff .lbl { font-size: 10px; color: #92400e; text-transform: uppercase; letter-spacing: 0.3px; }
  .ge-props-zoff .num {
    width: 56px; padding: 0 4px; height: 20px;
    font: 10px ui-monospace, monospace; color: #92400e; text-align: center;
    background: rgba(255,255,255,0.9); border: 1px solid #fbbf24; border-radius: 3px; box-sizing: border-box;
  }
  .ge-props-zoff .num.unset { color: #b45309; opacity: 0.65; font-style: italic; }
  .ge-props-zoff .num:focus { outline: 1px solid #d97706; background: #fff; }
  .ge-props-zoff .zoff-hint { font: 400 9px ui-monospace, monospace; color: #b45309; opacity: 0.7; margin-left: auto; }

  /* Table: PART (flex) · OUT (28px) · IN (28px) · Matl (flex). */
  .ge-props-table { display: flex; flex-direction: column; gap: 3px; }
  .ge-props-table .row {
    display: grid; grid-template-columns: 1fr 30px 30px 1.3fr;
    gap: 5px; align-items: center;
  }
  .ge-props-table .row.head span {
    font-size: 9px; color: #92400e; text-transform: uppercase; letter-spacing: 0.3px; text-align: center;
  }
  .ge-props-table .row.head .c-part { text-align: left; }
  .c-part {
    font: 700 10px ui-monospace, monospace; color: #78350f;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .c-part.def { color: #b45309; font-style: italic; }
  .sw {
    width: 30px; height: 18px; padding: 0; border: 1px solid #fbbf24; border-radius: 3px;
    background: #fff; cursor: pointer; box-sizing: border-box;
  }
  .sw.override { border-color: #d97706; border-width: 2px; }
  .mat {
    width: 100%; min-width: 0; height: 18px; padding: 0 2px;
    font: 10px ui-monospace, monospace; color: #92400e;
    background: rgba(255,255,255,0.9); border: 1px solid #fbbf24; border-radius: 3px;
    cursor: pointer; box-sizing: border-box;
  }
</style>
