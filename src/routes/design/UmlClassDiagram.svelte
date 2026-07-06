<script lang="ts">
  /**
   * UmlClassDiagram.svelte — renders the composition-graph DOMAIN MODEL as a UML
   * class diagram (Mermaid classDiagram) for the /design "Class model" tab.
   *
   * Mermaid is heavy (~MBs) so it's DYNAMICALLY imported on mount — it only loads
   * when this tab is opened, never in the main bundle. SSR is globally off, so the
   * dynamic import + DOM render are safe. Pan by dragging, zoom with the buttons.
   */
  import { onMount } from 'svelte';
  import { DOMAIN_CLASS_DIAGRAM } from './domain-classes';

  let host: HTMLDivElement;
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let errMsg = $state('');

  // pan / zoom
  let scale = $state(1);
  let tx = $state(0);
  let ty = $state(0);

  onMount(async () => {
    try {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'neutral',
        securityLevel: 'strict',
        class: { useMaxWidth: false } as any,
        themeVariables: { fontSize: '13px', fontFamily: 'ui-monospace, Menlo, monospace' },
      });
      const { svg } = await mermaid.render('uml-domain-svg', DOMAIN_CLASS_DIAGRAM);
      host.innerHTML = svg;
      const el = host.querySelector('svg') as SVGSVGElement | null;
      if (el) {
        // useMaxWidth:false gives an explicit px size; but pin it from the
        // viewBox anyway so stripping maxWidth can't collapse the SVG to 0×0.
        const vb = el.viewBox?.baseVal;
        if (vb && vb.width) {
          el.setAttribute('width', String(vb.width));
          el.setAttribute('height', String(vb.height));
          // Fit the (often large) diagram into the viewport on first render, then
          // centre it — the user zooms in from there.
          const view = host.closest('.uml-view') as HTMLElement | null;
          const vw = view?.clientWidth ?? 1180;
          const vh = view?.clientHeight ?? 720;
          const fit = Math.min((vw - 48) / vb.width, (vh - 48) / vb.height);
          scale = Math.max(0.28, Math.min(1, fit));
          tx = Math.max(0, (vw - vb.width * scale) / 2);
          ty = 24;
        }
        el.style.maxWidth = 'none';
      }
      status = 'ready';
    } catch (e: any) {
      errMsg = e?.message ?? String(e);
      status = 'error';
    }
  });

  let panning = false;
  let start = { x: 0, y: 0, tx: 0, ty: 0 };
  function down(e: PointerEvent) {
    panning = true;
    start = { x: e.clientX, y: e.clientY, tx, ty };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!panning) return;
    tx = start.tx + (e.clientX - start.x);
    ty = start.ty + (e.clientY - start.y);
  }
  function up() { panning = false; }
  function zoom(f: number) { scale = Math.max(0.3, Math.min(3, scale * f)); }
  function reset() { scale = 1; tx = 0; ty = 0; }
</script>

<div class="uml-wrap">
  <div
    class="uml-view"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    role="application"
    aria-label="Composition-graph UML class diagram"
  >
    <div class="uml-stage" style="transform: translate({tx}px,{ty}px) scale({scale}); transform-origin: 0 0;">
      <div bind:this={host} class="uml-host"></div>
    </div>
  </div>

  {#if status === 'loading'}
    <div class="uml-msg">rendering class diagram…</div>
  {:else if status === 'error'}
    <div class="uml-msg err">Mermaid render failed: {errMsg}</div>
  {/if}

  <div class="toolbar">
    <button type="button" onclick={() => zoom(1.15)} title="Zoom in">＋</button>
    <button type="button" onclick={() => zoom(1 / 1.15)} title="Zoom out">－</button>
    <button type="button" onclick={reset} title="Reset">⤢ reset</button>
  </div>

  <div class="legend">
    <div class="legend-title">Composition-graph domain model</div>
    <div class="legend-note">
      <b>Graph</b> is the aggregate root — a bag of <b>GraphNode</b>s (the 15-way
      union every card is one of) + params + edges. <b>ArgValue</b> = the
      literal / expr / param value every parametric slot holds. △ inherit · ◇ compose.
    </div>
  </div>
</div>

<p class="uml-caption">
  Source of truth: <code>src/lib/cad/composition-graph-types.ts</code> · drag to pan · zoom with the buttons
</p>

<style>
  .uml-wrap {
    position: relative; width: 100%; height: 720px;
    border: 1px solid #e7ecf2; border-radius: 16px; overflow: hidden;
    background: #fbfcfe; box-shadow: inset 0 1px 0 #fff, 0 1px 3px rgba(15,23,42,0.04);
  }
  .uml-view { width: 100%; height: 100%; overflow: hidden; cursor: grab; touch-action: none; }
  .uml-view:active { cursor: grabbing; }
  .uml-stage { padding: 24px; width: max-content; }
  .uml-host :global(svg) { display: block; }

  .uml-msg {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    font-size: 0.82rem; color: #64748b;
  }
  .uml-msg.err { color: #b91c1c; max-width: 70%; text-align: center; }

  .toolbar { position: absolute; top: 12px; left: 12px; display: flex; gap: 6px; }
  .toolbar button {
    font-size: 0.78rem; font-weight: 700; color: #334155; min-width: 30px;
    background: rgba(255,255,255,0.95); border: 1px solid #e2e8f0;
    border-radius: 8px; padding: 4px 9px; cursor: pointer;
    box-shadow: 0 1px 3px rgba(15,23,42,0.06);
  }
  .toolbar button:hover { border-color: #cbd5e1; color: #0f172a; }

  .legend {
    position: absolute; bottom: 12px; right: 12px; max-width: 260px;
    padding: 11px 13px; background: rgba(255,255,255,0.94);
    border: 1px solid #e7ecf2; border-radius: 11px; backdrop-filter: blur(6px);
    box-shadow: 0 6px 20px rgba(15,23,42,0.08); font-size: 0.72rem; color: #475569;
  }
  .legend-title {
    font-size: 0.6rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.08em; color: #94a3b8; margin-bottom: 5px;
  }
  .legend-note { font-size: 0.68rem; color: #64748b; line-height: 1.45; }
  .legend-note b { color: #334155; }

  .uml-caption { margin: 9px 2px 0; font-size: 0.72rem; color: #94a3b8; text-align: center; }
  .uml-caption code { color: #64748b; }
</style>
