<script lang="ts">
  /**
   * AutoWireSuggestPanel — surfaces the generative typed-ports hook
   * (port-suggest.autoWireSuggestions). Lists the machine-found "what could wire
   * to what" pairs (a list<point> expr output → a polygon's points, …) and
   * applies them with one click. Draggable popover; opened from the ✨ rail
   * button. Plan: docs/plans/typed-ports.md ("Generative capability").
   */
  import { autoWireSuggestions } from '$lib/cad/port-suggest';
  import { addPolygonExprListRef } from '$lib/cad/composition-graph';
  import { portType } from '$lib/cad/port-types';
  import { clampDragPos } from './popover-clamp';

  let { graph, setGraph, onClose }: {
    graph: any;
    setGraph: (g: any) => void;
    onClose: () => void;
  } = $props();

  let suggestions = $derived(autoWireSuggestions(graph));

  function nodeLabel(id: string): string {
    const n = graph.nodes?.[id];
    if (!n) return id;
    if (n.type === 'expr') {
      const d = (graph.exprDefs ?? []).find((x: any) => x.id === n.defId);
      return d?.name ?? 'expr';
    }
    if (n.type === 'call') return n.fn ?? 'call';
    return n.type;
  }

  /** Apply one suggestion via the matching mutator (points slot today). */
  function applyOne(g: any, s: any): any {
    if (s.slot === 'points') return addPolygonExprListRef(g, s.targetId, s.sourceId, s.output);
    return g; // other slot kinds not wired yet
  }
  function apply(s: any) { setGraph(applyOne(graph, s)); }
  function applyAll() {
    let g = graph;
    for (const s of suggestions) g = applyOne(g, s);
    setGraph(g);
  }

  let popEl = $state<HTMLElement | null>(null);
  let pos = $state<{ x: number; y: number } | null>(null);
  let drag = $state<{ dx: number; dy: number } | null>(null);
  function onHeadDown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    const r = popEl!.getBoundingClientRect();
    pos ??= { x: r.left, y: r.top };
    drag = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onHeadMove(e: PointerEvent) { if (drag) pos = clampDragPos(popEl, e.clientX - drag.dx, e.clientY - drag.dy); }
  function onHeadUp(e: PointerEvent) { drag = null; try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* */ } }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="aw-pop" bind:this={popEl} style={pos ? `left:${pos.x}px; top:${pos.y}px;` : ''}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="aw-head" onpointerdown={onHeadDown} onpointermove={onHeadMove} onpointerup={onHeadUp}>
    <span class="aw-glyph">✨</span>
    <span class="aw-title">Suggested wirings</span>
    <span class="aw-count">{suggestions.length}</span>
    <span class="aw-sp"></span>
    {#if suggestions.length > 1}
      <button class="aw-all" type="button" onclick={applyAll}>Apply all</button>
    {/if}
    <button class="aw-close" type="button" onclick={onClose} title="Close">✕</button>
  </div>
  <div class="aw-body">
    {#if !suggestions.length}
      <p class="aw-empty">No suggestions — every typed output is wired, or none are
        type-compatible with an open slot. (Add a <code>list⟨point⟩</code> expression and a
        polygon to see one.)</p>
    {:else}
      {#each suggestions as s (s.sourceId + s.output + s.targetId + s.slot)}
        {@const pt = portType(s.typeId)}
        <div class="aw-row">
          <span class="aw-dot" style={pt ? `background:${pt.color}` : ''}></span>
          <span class="aw-src">{nodeLabel(s.sourceId)}<span class="aw-out">.{s.output}</span></span>
          <span class="aw-arrow">→</span>
          <span class="aw-tgt">{nodeLabel(s.targetId)}<span class="aw-slot">.{s.slot}</span></span>
          <span class="aw-type" title={pt?.label}>{s.typeId}</span>
          <span class="aw-sp"></span>
          <button class="aw-apply" type="button" onclick={() => apply(s)}>Wire</button>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .aw-pop {
    position: fixed; left: 84px; top: 96px; width: 460px; max-height: 60vh; z-index: 1000;
    background: #fff; border: 1px solid #cbd5e1; border-radius: 10px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, .18); display: flex; flex-direction: column;
    overflow: hidden; font: 13px/1.4 Arial, sans-serif; color: #1e293b;
  }
  .aw-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #e2e8f0; background: #fffbeb; cursor: grab; user-select: none; }
  .aw-glyph { font-size: 14px; }
  .aw-title { font-weight: 700; }
  .aw-count { font: 700 11px Arial; color: #fff; background: #f59e0b; border-radius: 9px; padding: 1px 7px; }
  .aw-sp { flex: 1 1 auto; }
  .aw-all { font: 600 11px Arial; color: #b45309; background: #fef3c7; border: 1px solid #fcd34d; border-radius: 5px; padding: 3px 9px; cursor: pointer; }
  .aw-close { font: 700 14px Arial; color: #94a3b8; background: none; border: none; cursor: pointer; }
  .aw-close:hover { color: #ef4444; }
  .aw-body { padding: 8px 10px; overflow-y: auto; }
  .aw-empty { font-size: 12px; color: #94a3b8; margin: 4px; }
  .aw-empty code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; }
  .aw-row { display: flex; align-items: center; gap: 6px; padding: 5px 4px; border-bottom: 1px solid #f1f5f9; }
  .aw-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .aw-src, .aw-tgt { font: 600 12px ui-monospace, monospace; color: #334155; }
  .aw-out, .aw-slot { color: #7c3aed; }
  .aw-arrow { color: #94a3b8; }
  .aw-type { font: 11px ui-monospace, monospace; color: #4338ca; background: #eef2ff; padding: 1px 5px; border-radius: 4px; }
  .aw-apply { font: 600 11px Arial; color: #fff; background: #7c3aed; border: none; border-radius: 5px; padding: 3px 11px; cursor: pointer; }
  .aw-apply:hover { background: #6d28d9; }
</style>
