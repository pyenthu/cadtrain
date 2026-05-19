<script lang="ts">
  // SVG-based 2D polygon editor. Bound to a `[[x, y], ...]` array.
  //
  // Interactions:
  //   - Drag a vertex handle to move it.
  //   - Double-click an edge to insert a new vertex at the midpoint.
  //   - Alt-click a vertex to delete it. ≥ 3 vertices enforced.
  //   - Toolbar: load a preset (rect / N-gon / L / T / + / star).
  //
  // The points live in local primitive space (e.g. radial / tangential
  // units for warp_helix). The canvas auto-fits to the bbox + a 20%
  // margin, so any unit scale renders.

  type Pt = [number, number];

  let {
    value,
    width = 360,
    height = 240,
    onChange,
    onApply,
  }: {
    value: Pt[];
    width?: number;
    height?: number;
    /** Called on every vertex move / add / delete / preset load with
     *  the new array. Parent owns the state. */
    onChange: (next: Pt[]) => void;
    /** Optional one-shot "commit" callback (e.g. fires Apply after drop). */
    onApply?: () => void;
  } = $props();

  // Track drag state in component-local refs (not $state — we don't
  // want reactivity on every mousemove tick).
  let dragIdx = $state<number | null>(null);

  // Bbox of the polygon, padded by 20%. Used for SVG viewBox.
  let bbox = $derived.by(() => {
    if (!value.length) return { x: -1, y: -1, w: 2, h: 2 };
    const xs = value.map((p) => p[0]);
    const ys = value.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const padX = Math.max(0.2, (maxX - minX) * 0.2);
    const padY = Math.max(0.2, (maxY - minY) * 0.2);
    return { x: minX - padX, y: minY - padY, w: (maxX - minX) + 2 * padX, h: (maxY - minY) + 2 * padY };
  });

  // SVG y-axis is inverted vs Cartesian; we flip y when projecting so
  // the polygon reads naturally (up is up).
  function svgY(y: number) { return bbox.y + bbox.h - (y - bbox.y); }

  let svgEl: SVGSVGElement;

  function clientToLocal(ev: PointerEvent | MouseEvent): Pt {
    const rect = svgEl.getBoundingClientRect();
    const px = (ev.clientX - rect.left) / rect.width;
    const py = (ev.clientY - rect.top) / rect.height;
    const x = bbox.x + px * bbox.w;
    const yFlipped = bbox.y + py * bbox.h;
    // Reverse the svgY flip:
    const y = (bbox.y + bbox.h) - (yFlipped - bbox.y);
    return [x, y];
  }

  function onPointerDownVert(i: number, e: PointerEvent) {
    if (e.altKey) {
      // Alt-click deletes (if ≥ 4 vertices — preserving the min-3 invariant).
      if (value.length > 3) {
        onChange(value.filter((_, j) => j !== i));
        onApply?.();
      }
      return;
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragIdx = i;
  }
  function onPointerMove(e: PointerEvent) {
    if (dragIdx === null) return;
    const [x, y] = clientToLocal(e);
    onChange(value.map((p, j) => j === dragIdx ? [x, y] as Pt : p));
  }
  function onPointerUp(e: PointerEvent) {
    if (dragIdx !== null) {
      try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch {}
      dragIdx = null;
      onApply?.();
    }
  }

  function onDblClickEdge(i: number, e: MouseEvent) {
    const a = value[i];
    const b = value[(i + 1) % value.length];
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    onChange([...value.slice(0, i + 1), mid, ...value.slice(i + 1)]);
    onApply?.();
  }

  function presetRect(): Pt[] {
    return [[-0.5, -0.3], [0.5, -0.3], [0.5, 0.3], [-0.5, 0.3]];
  }
  function presetNgon(n: number, r = 0.5): Pt[] {
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return [r * Math.cos(a), r * Math.sin(a)] as Pt;
    });
  }
  function presetL(): Pt[] {
    return [[0, 0], [0.6, 0], [0.6, 0.2], [0.2, 0.2], [0.2, 0.6], [0, 0.6]];
  }
  function presetT(): Pt[] {
    return [[-0.5, 0.3], [0.5, 0.3], [0.5, 0.1], [0.1, 0.1], [0.1, -0.5], [-0.1, -0.5], [-0.1, 0.1], [-0.5, 0.1]];
  }
  function presetPlus(): Pt[] {
    return [
      [0.5, -0.15], [0.5, 0.15], [0.15, 0.15], [0.15, 0.5],
      [-0.15, 0.5], [-0.15, 0.15], [-0.5, 0.15], [-0.5, -0.15],
      [-0.15, -0.15], [-0.15, -0.5], [0.15, -0.5], [0.15, -0.15],
    ];
  }
  function presetStar(): Pt[] {
    const out: Pt[] = [];
    const N = 5, rOuter = 0.5, rInner = 0.2;
    for (let i = 0; i < N * 2; i++) {
      const a = (i / (N * 2)) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? rOuter : rInner;
      out.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    return out;
  }
  function loadPreset(p: Pt[]) {
    onChange(p);
    onApply?.();
  }
</script>

<div class="pe-root">
  <div class="pe-toolbar">
    <span class="pe-label">Preset:</span>
    <button class="pe-preset" type="button" onclick={() => loadPreset(presetRect())}>Rect</button>
    <button class="pe-preset" type="button" onclick={() => loadPreset(presetNgon(5))}>Pent</button>
    <button class="pe-preset" type="button" onclick={() => loadPreset(presetNgon(6))}>Hex</button>
    <button class="pe-preset" type="button" onclick={() => loadPreset(presetNgon(24, 0.5))}>Circ</button>
    <button class="pe-preset" type="button" onclick={() => loadPreset(presetL())}>L</button>
    <button class="pe-preset" type="button" onclick={() => loadPreset(presetT())}>T</button>
    <button class="pe-preset" type="button" onclick={() => loadPreset(presetPlus())}>+</button>
    <button class="pe-preset" type="button" onclick={() => loadPreset(presetStar())}>★</button>
  </div>
  <svg
    bind:this={svgEl}
    class="pe-svg"
    viewBox="{bbox.x} {bbox.y} {bbox.w} {bbox.h}"
    preserveAspectRatio="xMidYMid meet"
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    role="application"
    aria-label="Polygon profile editor"
  >
    <!-- axes -->
    <line class="pe-axis" x1={bbox.x} y1={svgY(0)} x2={bbox.x + bbox.w} y2={svgY(0)} />
    <line class="pe-axis" x1={0} y1={bbox.y} x2={0} y2={bbox.y + bbox.h} />
    <!-- filled polygon -->
    <polygon
      class="pe-poly"
      points={value.map((p) => `${p[0]},${svgY(p[1])}`).join(' ')}
    />
    <!-- edge hit targets (transparent thick lines for dbl-click hit area) -->
    {#each value as p, i}
      {@const next = value[(i + 1) % value.length]}
      <line
        class="pe-edge"
        x1={p[0]} y1={svgY(p[1])} x2={next[0]} y2={svgY(next[1])}
        ondblclick={(e) => onDblClickEdge(i, e)}
      />
    {/each}
    <!-- vertex handles -->
    {#each value as p, i}
      <circle
        class="pe-vert"
        class:active={dragIdx === i}
        cx={p[0]} cy={svgY(p[1])}
        r={Math.max(bbox.w, bbox.h) * 0.018}
        onpointerdown={(e) => onPointerDownVert(i, e)}
      />
    {/each}
  </svg>
  <div class="pe-hint">
    Drag vertex to move • double-click edge to add • Alt-click vertex to delete (min 3)
  </div>
</div>

<style>
  .pe-root { display: flex; flex-direction: column; min-height: 0; flex: 1; padding: 8px 12px; gap: 6px; }
  .pe-toolbar { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .pe-label { font: 10px Arial; color: #555; }
  .pe-preset { background: #f5f5f5; border: 1px solid #ddd; border-radius: 3px; padding: 3px 8px; font: 11px Arial; cursor: pointer; }
  .pe-preset:hover { background: #fef0f0; border-color: #cc2222; color: #cc2222; }

  .pe-svg { flex: 1; min-height: 180px; background: #fafafa; border: 1px solid #ddd; border-radius: 4px; cursor: crosshair; }
  .pe-axis { stroke: #ddd; stroke-width: 0.005; vector-effect: non-scaling-stroke; }
  .pe-poly { fill: rgba(204, 34, 34, 0.18); stroke: #cc2222; stroke-width: 0.01; vector-effect: non-scaling-stroke; }
  .pe-edge { stroke: transparent; stroke-width: 0.03; vector-effect: non-scaling-stroke; cursor: copy; }
  .pe-edge:hover { stroke: rgba(204, 34, 34, 0.25); }
  .pe-vert { fill: #fff; stroke: #cc2222; stroke-width: 0.012; vector-effect: non-scaling-stroke; cursor: grab; }
  .pe-vert:hover { fill: #fef0f0; }
  .pe-vert.active { fill: #cc2222; cursor: grabbing; }

  .pe-hint { font: 10px Arial; color: #888; padding: 2px 0; }
</style>
