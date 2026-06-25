<script lang="ts">
  /**
   * C4View.svelte — a faithful C4-model diagram for /design.
   *
   * A level switcher (Context · Container · Component) drives which C4 diagram
   * renders. Each diagram is an SVG (responsive via viewBox): boxes are HTML in
   * <foreignObject> (so we get rich C4 notation — bold name, [type: tech],
   * description — with normal CSS), and relationships are directed, labelled
   * SVG arrows between box borders.
   *
   * Data: Context externals are local to c4.ts; Container + Component levels
   * reuse architecture.ts (ARCH_TREE_NODES + ARCH_EDGES). SSR is globally off.
   */
  import {
    C4_CONTEXT,
    buildContainerDiagram,
    buildComponentDiagram,
    C4_CONTAINER_OPTIONS,
    type C4Level,
    type C4Box,
    type C4Diagram,
  } from './c4';

  const LS_LEVEL = 'design-c4-level';
  const LS_COMP = 'design-c4-component-container';

  let level = $state<C4Level>('context');
  let componentContainer = $state<string>('c-webapp');

  // restore persisted choices (client-only; SSR is off)
  if (typeof localStorage !== 'undefined') {
    const l = localStorage.getItem(LS_LEVEL);
    if (l === 'context' || l === 'container' || l === 'component') level = l;
    const c = localStorage.getItem(LS_COMP);
    if (c && C4_CONTAINER_OPTIONS.some((o) => o.id === c)) componentContainer = c;
  }

  function setLevel(l: C4Level) {
    level = l;
    if (typeof localStorage !== 'undefined') localStorage.setItem(LS_LEVEL, l);
  }
  function setContainer(id: string) {
    componentContainer = id;
    if (typeof localStorage !== 'undefined') localStorage.setItem(LS_COMP, id);
  }

  const diagram = $derived<C4Diagram>(
    level === 'context'
      ? C4_CONTEXT
      : level === 'container'
        ? buildContainerDiagram()
        : buildComponentDiagram(componentContainer),
  );

  const boxById = $derived(new Map(diagram.boxes.map((b) => [b.id, b])));

  // ── arrow geometry: ray from a box centre toward a point, clamped to border ──
  function edgePoint(b: C4Box, tx: number, ty: number) {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const dx = tx - cx;
    const dy = ty - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const sx = dx !== 0 ? b.w / 2 / Math.abs(dx) : Infinity;
    const sy = dy !== 0 ? b.h / 2 / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
  }

  interface Drawn {
    id: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    mx: number;
    my: number;
    label: string;
  }

  const arrows = $derived<Drawn[]>(
    diagram.rels
      .map((r, i): Drawn | null => {
        const a = boxById.get(r.from);
        const b = boxById.get(r.to);
        if (!a || !b) return null;
        const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
        const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
        const p1 = edgePoint(a, bc.x, bc.y);
        const p2 = edgePoint(b, ac.x, ac.y);
        return {
          id: `${r.from}-${r.to}-${i}`,
          x1: p1.x,
          y1: p1.y,
          x2: p2.x,
          y2: p2.y,
          mx: (p1.x + p2.x) / 2,
          my: (p1.y + p2.y) / 2,
          label: r.label,
        };
      })
      .filter((d): d is Drawn => d !== null),
  );

  const levels: { id: C4Level; label: string; sub: string }[] = [
    { id: 'context', label: 'Context', sub: 'System + externals' },
    { id: 'container', label: 'Container', sub: 'Inside CAD Train' },
    { id: 'component', label: 'Component', sub: 'Inside a container' },
  ];
</script>

<div class="c4">
  <!-- ── level switcher + container picker ── -->
  <div class="c4-bar">
    <div class="c4-levels" role="tablist" aria-label="C4 level">
      {#each levels as lv}
        <button
          class="c4-level"
          class:active={level === lv.id}
          role="tab"
          aria-selected={level === lv.id}
          onclick={() => setLevel(lv.id)}
        >
          <span class="c4-level-name">{lv.label}</span>
          <span class="c4-level-sub">{lv.sub}</span>
        </button>
      {/each}
    </div>

    {#if level === 'component'}
      <div class="c4-picker">
        <span class="c4-picker-label">Container:</span>
        {#each C4_CONTAINER_OPTIONS as opt}
          <button
            class="c4-chip"
            class:active={componentContainer === opt.id}
            style={componentContainer === opt.id && opt.accent
              ? `border-color:${opt.accent};color:${opt.accent};`
              : ''}
            onclick={() => setContainer(opt.id)}
          >
            {opt.label}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- ── diagram ── -->
  <div class="c4-canvas">
    <svg
      viewBox={`0 0 ${diagram.width} ${diagram.height}`}
      width="100%"
      style={`aspect-ratio:${diagram.width} / ${diagram.height};`}
      role="img"
      aria-label={`C4 ${level} diagram`}
    >
      <defs>
        <marker
          id="c4-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="#8a8a8a" />
        </marker>
      </defs>

      <!-- relationships (drawn first, behind boxes) -->
      {#each arrows as a (a.id)}
        <line
          x1={a.x1}
          y1={a.y1}
          x2={a.x2}
          y2={a.y2}
          class="c4-edge"
          marker-end="url(#c4-arrow)"
        />
        {#if a.label}
          <text x={a.mx} y={a.my} class="c4-edge-label" text-anchor="middle">{a.label}</text>
        {/if}
      {/each}

      <!-- boxes -->
      {#each diagram.boxes as b (b.id)}
        <foreignObject x={b.x} y={b.y} width={b.w} height={b.h}>
          <div class={`c4box c4-${b.variant}`} style={b.accent ? `--box-accent:${b.accent};` : ''}>
            <div class="c4-box-name">
              {#if b.href}
                <a href={b.href}>{b.name}</a>
              {:else}
                {b.name}
              {/if}
            </div>
            <div class="c4-box-type">[{b.kind}{b.tech ? `: ${b.tech}` : ''}]</div>
            <div class="c4-box-desc">{b.desc}</div>
          </div>
        </foreignObject>
      {/each}
    </svg>
  </div>

  <!-- ── legend ── -->
  <div class="c4-legend">
    <span class="lg lg-person">Person</span>
    <span class="lg lg-system">Software system (focus)</span>
    <span class="lg lg-external">External system</span>
    <span class="lg lg-container">Container</span>
    <span class="lg lg-store">Datastore</span>
    <span class="lg lg-component">Component</span>
  </div>
</div>

<style>
  .c4 {
    --line: #e7e7e7;
    --ink: #1a1a1a;
    --ink-soft: #555;
    --ink-faint: #8a8a8a;
    width: 100%;
  }

  /* ── level switcher ── */
  .c4-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem 1.5rem;
    margin-bottom: 1.6rem;
  }
  .c4-levels {
    display: inline-flex;
    border: 1px solid var(--line);
    border-radius: 12px;
    overflow: hidden;
    background: #fff;
  }
  .c4-level {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    padding: 0.6rem 1.1rem;
    border: none;
    border-right: 1px solid var(--line);
    background: #fff;
    cursor: pointer;
    text-align: left;
    transition: background 0.18s ease, color 0.18s ease;
  }
  .c4-level:last-child {
    border-right: none;
  }
  .c4-level:hover {
    background: #fafafa;
  }
  .c4-level.active {
    background: #cc2222;
    color: #fff;
  }
  .c4-level-name {
    font-size: 0.95rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .c4-level-sub {
    font-size: 0.7rem;
    opacity: 0.7;
    font-weight: 500;
  }

  /* ── container picker (component level) ── */
  .c4-picker {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
  }
  .c4-picker-label {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--ink-faint);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .c4-chip {
    font-size: 0.82rem;
    font-weight: 600;
    padding: 0.35rem 0.8rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: #fff;
    color: var(--ink-soft);
    cursor: pointer;
    transition: border-color 0.18s ease, color 0.18s ease;
  }
  .c4-chip:hover {
    border-color: #c8c8c8;
  }
  .c4-chip.active {
    font-weight: 700;
  }

  /* ── canvas ── */
  .c4-canvas {
    border: 1px solid var(--line);
    border-radius: 14px;
    background: #fbfbfc;
    background-image: radial-gradient(#ececec 1px, transparent 1px);
    background-size: 22px 22px;
    padding: 0.5rem;
    overflow-x: auto;
  }
  .c4-canvas svg {
    display: block;
    min-width: 640px;
  }

  /* ── edges ── */
  .c4-edge {
    stroke: #b4b4b4;
    stroke-width: 1.6;
  }
  .c4-edge-label {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 11px;
    font-weight: 600;
    fill: #555;
    paint-order: stroke;
    stroke: #fbfbfc;
    stroke-width: 4px;
    stroke-linejoin: round;
  }

  /* ── boxes (HTML inside foreignObject) ── */
  :global(.c4box) {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    padding: 0.7rem 0.8rem;
    border-radius: 10px;
    border: 1.5px solid #cfcfcf;
    background: #fff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  :global(.c4-box-name) {
    font-size: 0.95rem;
    font-weight: 800;
    letter-spacing: -0.01em;
    color: #1a1a1a;
    line-height: 1.15;
  }
  :global(.c4-box-name a) {
    color: #2563eb;
    text-decoration: none;
  }
  :global(.c4-box-name a:hover) {
    text-decoration: underline;
  }
  :global(.c4-box-type) {
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.66rem;
    font-weight: 600;
    color: #8a8a8a;
    letter-spacing: -0.01em;
    line-height: 1.2;
  }
  :global(.c4-box-desc) {
    font-size: 0.72rem;
    line-height: 1.3;
    color: #555;
    overflow: hidden;
  }

  /* person — muted grey, square-ish */
  :global(.c4-person) {
    background: #6b7280;
    border-color: #4b5563;
  }
  :global(.c4-person .c4-box-name),
  :global(.c4-person .c4-box-type),
  :global(.c4-person .c4-box-desc) {
    color: #f8fafc;
  }
  :global(.c4-person .c4-box-type) {
    color: #d1d5db;
  }

  /* external system — muted slate */
  :global(.c4-external) {
    background: #8a94a6;
    border-color: #6b7280;
  }
  :global(.c4-external .c4-box-name),
  :global(.c4-external .c4-box-desc) {
    color: #ffffff;
  }
  :global(.c4-external .c4-box-type) {
    color: #e5e7eb;
  }

  /* the focus system — accented */
  :global(.c4-system) {
    background: var(--box-accent, #cc2222);
    border-color: var(--box-accent, #cc2222);
  }
  :global(.c4-system .c4-box-name),
  :global(.c4-system .c4-box-desc) {
    color: #ffffff;
  }
  :global(.c4-system .c4-box-type) {
    color: rgba(255, 255, 255, 0.85);
  }

  /* container — white box, coloured top accent + left bar */
  :global(.c4-container) {
    border-color: var(--box-accent, #cfcfcf);
    border-top: 4px solid var(--box-accent, #cfcfcf);
  }
  /* datastore container — tinted */
  :global(.c4-store) {
    border-color: var(--box-accent, #cfcfcf);
    border-top: 4px solid var(--box-accent, #cfcfcf);
    background: #fcfaff;
  }
  /* component — white box, coloured left rule */
  :global(.c4-component) {
    border-left: 4px solid var(--box-accent, #cfcfcf);
  }

  /* ── legend ── */
  .c4-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.9rem;
    margin-top: 1.1rem;
  }
  .lg {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.76rem;
    color: var(--ink-soft);
  }
  .lg::before {
    content: '';
    width: 0.85rem;
    height: 0.85rem;
    border-radius: 3px;
    border: 1.5px solid #cfcfcf;
    background: #fff;
  }
  .lg-person::before {
    background: #6b7280;
    border-color: #4b5563;
  }
  .lg-external::before {
    background: #8a94a6;
    border-color: #6b7280;
  }
  .lg-system::before {
    background: #cc2222;
    border-color: #cc2222;
  }
  .lg-container::before {
    border-top: 3px solid #3b82f6;
  }
  .lg-store::before {
    background: #fcfaff;
    border-top: 3px solid #a855f7;
  }
  .lg-component::before {
    border-left: 3px solid #f97316;
  }
</style>
