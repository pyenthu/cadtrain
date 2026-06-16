<script lang="ts">
  /**
   * /design — a descriptive "what is this project + how it's designed" page
   * for CAD Train. Self-contained: no shared components, no new deps, scoped
   * CSS only. SSR is already off via the global +layout.ts; nothing here
   * touches window/document at module scope, so it is SSR-safe regardless.
   *
   * Content is drawn from the root CLAUDE.md (architecture snapshot + route
   * table + tech stack), docs/COMPOSITION.md, docs/CAD_AUTHORING.md, and the
   * /plan bundle descriptions (A/G/K/M/N…). Kept accurate to the codebase.
   */

  const ACCENT = '#cc2222';

  // Layer stack — raw helpers → engine primitives → volume parts → graph → bake → viewer.
  const layers = [
    {
      tag: 'L0',
      name: 'Raw helpers',
      note: 'manifold-helpers.ts — cyl · tube · revolve · place · datums. Unstable toolkit, used ONLY inside engines.',
    },
    {
      tag: 'L1',
      name: 'Engine primitives',
      note: 'stdlib/ (active: r_cuboid) + stdstale/ (r_revolve · r_extrude · r_weld_extrude). Canonical in src/, read-only.',
    },
    {
      tag: 'L2',
      name: 'Volume parts',
      note: 'Typed source files on a persistent volume — .prim.ts composites & .asm.ts assemblies. Compose engines via .add/.subtract.',
    },
    {
      tag: 'L3',
      name: 'Composition graph',
      note: 'Call · Container · Method · Mv · Rot · Repeat · Polygon · PolyRepeat. Each part carries meta.graph.',
    },
    {
      tag: 'L4',
      name: 'Bake — Manifold (WASM)',
      note: 'graph → emit → Manifold CSG → mesh. Server bake cache de-dupes by param hash.',
    },
    {
      tag: 'L5',
      name: 'Viewer — Threlte',
      note: 'Mesh / GLB / SVG out. Instancing, cutaway, per-part colour, Z-down convention.',
    },
  ];

  // Bake pipeline flow — graph → emit → Manifold → outputs.
  const flow = [
    { k: 'Graph', d: 'typed nodes' },
    { k: 'Emit', d: 'source body' },
    { k: 'Manifold', d: 'WASM CSG' },
    { k: 'Mesh · GLB · SVG', d: 'cached output' },
  ];

  const capabilities = [
    {
      icon: '◈',
      title: 'Node-graph CAD editor',
      body: 'GraphEditorPane is THE editor — a visual graph of Call / Method / Mv / Rot / Repeat / Polygon nodes. Wire sockets, scrub params, and the geometry re-bakes live. Mounts full-screen at /graph-editor or multi-tab at /primitives.',
    },
    {
      icon: '✨',
      title: 'Generative vocabulary authoring',
      body: 'Describe a part in plain language. A BM25 retrieval pass against the parts vocabulary plus one Claude call proposes a composition graph — RAG-then-translate, deterministic where it can be, hand-authored only when nothing fits.',
    },
    {
      icon: '⟳',
      title: 'Instancing & performance',
      body: 'One shared WebGL context per active tab, fetch caching, profiles/resolve de-duplication, and stable-reference props that avoid re-mount loops. Heavy assemblies bake server-side to GLB so the browser never touches WASM.',
    },
    {
      icon: '⧉',
      title: 'Bake cache',
      body: 'Every bake is keyed by part + param hash. Repeat previews are instant; the server cache survives redeploys on the persistent volume alongside the parts themselves.',
    },
    {
      icon: '⇄',
      title: 'External / embeddable API',
      body: 'Planned (bundle N): expose parts, geometry (mesh-JSON / GLB / SVG), and the authoring mechanism as an importable SDK — hashed bearer keys, per-app namespaces, OpenAPI docs and an LLM-friendly capability manifest.',
      planned: true,
    },
  ];

  const stack = [
    { name: 'SvelteKit', why: 'Svelte 5 runes, adapter-node. API routes need SSR — never adapter-static.' },
    { name: 'ManifoldCAD', why: 'WASM constructive-solid-geometry kernel. The bake engine behind every part.' },
    { name: 'Threlte', why: 'Declarative Three.js for Svelte. The interactive 3D viewer and cutaway.' },
    { name: 'Bun', why: 'Dev runtime + lockfile. Node 22 (adapter-node) in the production container.' },
    { name: 'Manifold mesh + GLB', why: 'Server-side bake writes GLB; the client just loads it — no WASM in the browser.' },
    { name: 'Docker → Railway', why: 'Dockerfile build, persistent volume at /app_data for parts, RAG corpus, and the bake cache.' },
  ];

  const routes = [
    { path: '/graph-editor', purpose: 'The CAD editor — a single primitive, full-screen.' },
    { path: '/primitives', purpose: 'Sidebar of volume parts + a multi-tab graph editor.' },
    { path: '/vocab', purpose: 'Vocabulary editor — browse · infer · bake · promote.' },
    { path: '/volume', purpose: 'File manager for the persistent data volume.' },
    { path: '/plan', purpose: 'Gantt roadmap — the single source of truth for scope.' },
    { path: '/design', purpose: 'This page — what the project is and how it is designed.' },
  ];
</script>

<svelte:head>
  <title>CAD Train — Design Overview</title>
  <meta
    name="description"
    content="CAD Train — a parametric 3D CAD pipeline for downhole-tool components, built on SvelteKit, ManifoldCAD and Threlte."
  />
</svelte:head>

<main class="page">
  <!-- ───────────────────────── Hero ───────────────────────── -->
  <header class="hero">
    <div class="hero-inner">
      <div class="kicker">Parametric CAD pipeline</div>
      <h1 class="title">CAD&nbsp;Train</h1>
      <p class="tagline">
        A parametric 3D CAD pipeline for downhole-tool components — describe a
        part, wire a graph, bake the geometry.
      </p>
      <p class="lede">
        Downhole tools are families of revolved, extruded and threaded bodies
        with shared parametric DNA. CAD Train turns that DNA into a visual
        node-graph editor over a typed parts library, bakes it with a real CSG
        kernel, and renders it live in the browser.
      </p>
      <div class="badges">
        <span class="badge">SvelteKit</span>
        <span class="badge">ManifoldCAD</span>
        <span class="badge">Threlte</span>
        <span class="badge">Bun</span>
      </div>
    </div>
    <div class="hero-glow" aria-hidden="true"></div>
  </header>

  <!-- ───────────────────────── What it is ───────────────────────── -->
  <section class="section" aria-labelledby="what-h">
    <div class="section-head">
      <span class="num">01</span>
      <h2 id="what-h">What it is</h2>
    </div>
    <div class="prose two-col">
      <p>
        CAD Train is a focused environment for authoring the parametric solids
        that make up downhole completion tools — collars, joints, spirals,
        sleeves, tool joints. Rather than drawing each part by hand, you compose
        it: a part is a graph of operations over reusable engine primitives.
      </p>
      <p>
        The active surface is a <strong>node-graph parametric CAD editor</strong>.
        Drop a primitive, wire moves and rotations, add repeats and polygon
        profiles, and scrub the parameters. The graph round-trips to a typed
        source file on a persistent volume, so every part is both a visual
        object and readable code.
      </p>
      <p>
        Underneath, the graph emits a body that a WASM CSG kernel
        (<strong>ManifoldCAD</strong>) bakes into a mesh — cached by parameter
        hash and rendered with <strong>Threlte</strong>. Heavy assemblies bake
        server-side to GLB so the browser never has to run the kernel itself.
      </p>
    </div>
  </section>

  <!-- ───────────────────────── Architecture ───────────────────────── -->
  <section class="section section-alt" aria-labelledby="arch-h">
    <div class="section-head">
      <span class="num">02</span>
      <h2 id="arch-h">Architecture</h2>
    </div>
    <p class="prose section-intro">
      Three authoring layers feed one bake pipeline. Raw helpers harden into
      engine primitives; primitives compose into volume parts; parts are a
      composition graph that emits, bakes, and renders.
    </p>

    <div class="layers" role="list">
      {#each layers as l, i}
        <div class="layer" role="listitem">
          <div class="layer-tag" style="--depth:{i}">{l.tag}</div>
          <div class="layer-body">
            <h3>{l.name}</h3>
            <p>{l.note}</p>
          </div>
          {#if i < layers.length - 1}
            <div class="layer-arrow" aria-hidden="true">↓</div>
          {/if}
        </div>
      {/each}
    </div>

    <div class="flow" aria-label="Bake pipeline">
      {#each flow as f, i}
        <div class="flow-node">
          <span class="flow-k">{f.k}</span>
          <span class="flow-d">{f.d}</span>
        </div>
        {#if i < flow.length - 1}
          <span class="flow-arrow" aria-hidden="true">→</span>
        {/if}
      {/each}
    </div>
  </section>

  <!-- ───────────────────────── Capabilities ───────────────────────── -->
  <section class="section" aria-labelledby="cap-h">
    <div class="section-head">
      <span class="num">03</span>
      <h2 id="cap-h">Capabilities</h2>
    </div>
    <div class="cards">
      {#each capabilities as c}
        <article class="card">
          <div class="card-icon" aria-hidden="true">{c.icon}</div>
          <h3>
            {c.title}
            {#if c.planned}<span class="pill">planned</span>{/if}
          </h3>
          <p>{c.body}</p>
        </article>
      {/each}
    </div>
  </section>

  <!-- ───────────────────────── Tech stack ───────────────────────── -->
  <section class="section section-alt" aria-labelledby="stack-h">
    <div class="section-head">
      <span class="num">04</span>
      <h2 id="stack-h">Tech stack</h2>
    </div>
    <ul class="stack-list">
      {#each stack as s}
        <li class="stack-item">
          <span class="stack-name">{s.name}</span>
          <span class="stack-why">{s.why}</span>
        </li>
      {/each}
    </ul>
  </section>

  <!-- ───────────────────────── Routes ───────────────────────── -->
  <section class="section" aria-labelledby="routes-h">
    <div class="section-head">
      <span class="num">05</span>
      <h2 id="routes-h">The routes</h2>
    </div>
    <div class="table-wrap">
      <table class="routes">
        <thead>
          <tr><th scope="col">Route</th><th scope="col">Purpose</th></tr>
        </thead>
        <tbody>
          {#each routes as r}
            <tr>
              <td><code>{r.path}</code></td>
              <td>{r.purpose}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <!-- ───────────────────────── Footer ───────────────────────── -->
  <footer class="foot">
    <div class="foot-mark">CAD&nbsp;Train</div>
    <p>Parametric downhole-tool CAD · SvelteKit · ManifoldCAD · Threlte · Bun</p>
  </footer>
</main>

<style>
  :global(:root) {
    --accent: #cc2222;
  }

  .page {
    --ink: #1a1a1a;
    --ink-soft: #555;
    --ink-faint: #8a8a8a;
    --line: #e7e7e7;
    --paper: #ffffff;
    --paper-alt: #fafafa;
    --accent: #cc2222;
    --accent-soft: #fbeaea;

    box-sizing: border-box;
    width: 100%;
    min-height: 100%;
    margin: 0;
    color: var(--ink);
    background: var(--paper);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
      Helvetica, Arial, sans-serif;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
    overflow-y: auto;
  }
  .page *,
  .page *::before,
  .page *::after {
    box-sizing: border-box;
  }

  /* ───────── Hero ───────── */
  .hero {
    position: relative;
    overflow: hidden;
    padding: clamp(4rem, 11vw, 9rem) clamp(1.25rem, 6vw, 7rem)
      clamp(3rem, 7vw, 5.5rem);
    border-bottom: 1px solid var(--line);
  }
  .hero-inner {
    position: relative;
    z-index: 1;
    max-width: 60rem;
  }
  .hero-glow {
    position: absolute;
    top: -30%;
    right: -10%;
    width: 46rem;
    height: 46rem;
    background: radial-gradient(
      circle,
      rgba(204, 34, 34, 0.1) 0%,
      rgba(204, 34, 34, 0) 68%
    );
    pointer-events: none;
  }
  .kicker {
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 1.1rem;
  }
  .title {
    margin: 0;
    font-size: clamp(3rem, 11vw, 6.5rem);
    font-weight: 800;
    letter-spacing: -0.04em;
    line-height: 0.98;
  }
  .tagline {
    margin: 1.4rem 0 0;
    font-size: clamp(1.15rem, 2.6vw, 1.6rem);
    font-weight: 500;
    color: var(--ink);
    max-width: 42rem;
  }
  .lede {
    margin: 1.1rem 0 0;
    font-size: 1.05rem;
    color: var(--ink-soft);
    max-width: 40rem;
  }
  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 2.2rem;
  }
  .badge {
    font-size: 0.82rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    padding: 0.4rem 0.85rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--paper-alt);
    color: var(--ink);
    transition: border-color 0.2s ease, color 0.2s ease,
      transform 0.2s ease;
  }
  .badge:hover {
    border-color: var(--accent);
    color: var(--accent);
    transform: translateY(-2px);
  }

  /* ───────── Sections ───────── */
  .section {
    padding: clamp(3rem, 7vw, 6rem) clamp(1.25rem, 6vw, 7rem);
    border-bottom: 1px solid var(--line);
  }
  .section-alt {
    background: var(--paper-alt);
  }
  .section-head {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    margin-bottom: 2rem;
  }
  .num {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 0.05em;
    padding-top: 0.2rem;
  }
  .section-head h2 {
    margin: 0;
    font-size: clamp(1.6rem, 4vw, 2.4rem);
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .section-intro {
    max-width: 46rem;
    margin-bottom: 2.6rem;
    color: var(--ink-soft);
  }

  .prose {
    max-width: 64rem;
    color: var(--ink-soft);
  }
  .prose p {
    margin: 0 0 1.1rem;
  }
  .prose strong {
    color: var(--ink);
    font-weight: 600;
  }
  .two-col {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
    gap: 1.4rem 2.4rem;
    max-width: 64rem;
  }
  .two-col p {
    margin: 0;
  }

  /* ───────── Architecture layers ───────── */
  .layers {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    max-width: 54rem;
  }
  .layer {
    position: relative;
    display: grid;
    grid-template-columns: 3.4rem 1fr;
    align-items: start;
    gap: 1.1rem;
    padding: 1.1rem 1.2rem;
    background: var(--paper);
    border: 1px solid var(--line);
    border-left: 3px solid var(--accent);
    border-radius: 10px;
    transition: transform 0.18s ease, box-shadow 0.18s ease;
  }
  .section-alt .layer {
    background: #fff;
  }
  .layer:hover {
    transform: translateX(4px);
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.06);
  }
  .layer-tag {
    font-size: 0.8rem;
    font-weight: 800;
    letter-spacing: 0.03em;
    color: #fff;
    background: var(--accent);
    opacity: calc(0.55 + var(--depth) * 0.08);
    border-radius: 6px;
    text-align: center;
    padding: 0.3rem 0;
  }
  .layer-body h3 {
    margin: 0 0 0.25rem;
    font-size: 1.02rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .layer-body p {
    margin: 0;
    font-size: 0.9rem;
    color: var(--ink-soft);
  }
  .layer-arrow {
    position: absolute;
    left: 1.5rem;
    bottom: -0.55rem;
    z-index: 1;
    color: var(--ink-faint);
    font-size: 0.85rem;
    line-height: 1;
  }

  /* ───────── Bake flow ───────── */
  .flow {
    display: flex;
    flex-wrap: wrap;
    align-items: stretch;
    gap: 0.65rem;
    margin-top: 3rem;
    max-width: 54rem;
  }
  .flow-node {
    flex: 1 1 8rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 1rem 1.1rem;
    background: var(--accent-soft);
    border: 1px solid rgba(204, 34, 34, 0.18);
    border-radius: 10px;
  }
  .flow-k {
    font-weight: 700;
    font-size: 0.98rem;
    color: var(--accent);
    letter-spacing: -0.01em;
  }
  .flow-d {
    font-size: 0.8rem;
    color: var(--ink-soft);
  }
  .flow-arrow {
    align-self: center;
    color: var(--accent);
    font-size: 1.3rem;
    font-weight: 700;
  }

  /* ───────── Capability cards ───────── */
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
    gap: 1.1rem;
  }
  .card {
    padding: 1.5rem 1.4rem;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 14px;
    transition: transform 0.2s ease, box-shadow 0.2s ease,
      border-color 0.2s ease;
  }
  .card:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.07);
    border-color: #d8d8d8;
  }
  .card-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 10px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 1.3rem;
    margin-bottom: 1rem;
  }
  .card h3 {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    flex-wrap: wrap;
    margin: 0 0 0.5rem;
    font-size: 1.08rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .card p {
    margin: 0;
    font-size: 0.92rem;
    color: var(--ink-soft);
  }
  .pill {
    font-size: 0.66rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
    background: var(--accent-soft);
    border: 1px solid rgba(204, 34, 34, 0.25);
    border-radius: 999px;
    padding: 0.12rem 0.5rem;
  }

  /* ───────── Stack list ───────── */
  .stack-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-width: 58rem;
    border-top: 1px solid var(--line);
  }
  .stack-item {
    display: grid;
    grid-template-columns: 12rem 1fr;
    gap: 1rem;
    padding: 1.1rem 0.2rem;
    border-bottom: 1px solid var(--line);
  }
  .stack-name {
    font-weight: 700;
    color: var(--ink);
  }
  .stack-why {
    color: var(--ink-soft);
    font-size: 0.95rem;
  }

  /* ───────── Routes table ───────── */
  .table-wrap {
    max-width: 58rem;
    overflow-x: auto;
  }
  .routes {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem;
  }
  .routes th {
    text-align: left;
    font-weight: 700;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-faint);
    padding: 0 0.8rem 0.7rem;
    border-bottom: 2px solid var(--line);
  }
  .routes td {
    padding: 0.85rem 0.8rem;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
    color: var(--ink-soft);
  }
  .routes tr:hover td {
    background: var(--paper-alt);
  }
  .routes code {
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.86rem;
    font-weight: 600;
    color: var(--accent);
    white-space: nowrap;
  }

  /* ───────── Footer ───────── */
  .foot {
    padding: clamp(2.5rem, 5vw, 4rem) clamp(1.25rem, 6vw, 7rem);
    color: var(--ink-faint);
  }
  .foot-mark {
    font-size: 1.05rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--ink);
  }
  .foot p {
    margin: 0.4rem 0 0;
    font-size: 0.85rem;
  }

  @media (max-width: 640px) {
    .stack-item {
      grid-template-columns: 1fr;
      gap: 0.2rem;
    }
    .section-head {
      gap: 0.7rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .page * {
      transition: none !important;
    }
  }
</style>
