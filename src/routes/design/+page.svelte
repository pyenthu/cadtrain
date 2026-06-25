<script lang="ts">
  /**
   * /design — interactive architecture graph + descriptive prose for CAD Train.
   *
   * The three static diagram sections (Architecture, Bake flow, Routes table)
   * are replaced by one interactive @xyflow/svelte canvas (ArchGraph.svelte).
   * Hero + "What it is" prose + Capabilities + Tech stack are kept.
   *
   * SSR is globally off (src/+layout.ts: ssr = false) so top-level imports of
   * browser-only libs are safe. ArchGraph.svelte is imported normally; it in
   * turn imports @xyflow/svelte at module scope which is fine for client-only.
   */
  import ArchGraph from './ArchGraph.svelte';

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

  <!-- ───────────────────────── Architecture graph ───────────────────────── -->
  <section class="section section-alt" aria-labelledby="arch-h">
    <div class="section-head">
      <span class="num">02</span>
      <h2 id="arch-h">Architecture</h2>
    </div>
    <p class="prose section-intro">
      A collapsible map of the app — one <strong>system</strong> holding four
      <strong>containers</strong> (Web App · API · CAD kernel · Volume store),
      each with its component nodes. The layout is computed from the hierarchy,
      so it reflows whenever you collapse a container. Click a container caret to
      fold its subtree, a <strong>route</strong> node to jump to the live page;
      the bake-pipeline edges animate to show data-flow direction.
    </p>

    <ArchGraph />
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
    <p class="prose">
      All active routes are shown as <strong>blue nodes</strong> in the
      architecture graph above — click any to navigate directly.
      Key routes: <code><a href="/graph-editor">/graph-editor</a></code> (the CAD
      editor), <code><a href="/primitives">/primitives</a></code> (sidebar +
      multi-tab editor), <code><a href="/vocab">/vocab</a></code> (vocabulary),
      <code><a href="/volume">/volume</a></code> (file manager),
      <code><a href="/plan">/plan</a></code> (Gantt roadmap).
    </p>
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
    height: 100%;
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

  /* ───────── Route links in prose ───────── */
  .prose code {
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.86rem;
    font-weight: 600;
    color: var(--accent);
    white-space: nowrap;
  }
  .prose code a {
    color: inherit;
    text-decoration: none;
  }
  .prose code a:hover {
    text-decoration: underline;
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
