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
  import { SvelteFlowProvider } from '@xyflow/svelte';
  import { dev } from '$app/environment';
  import ArchGraph from './ArchGraph.svelte';
  import C4View from './C4View.svelte';
  import GepModuleGraph from './GepModuleGraph.svelte';
  import FolderHierarchy from './FolderHierarchy.svelte';
  import UmlClassDiagram from './UmlClassDiagram.svelte';
  import CodeGraph, { type GraphJson } from './CodeGraph.svelte';

  // ── Architecture view tabs: Tree | C4 | GEP module | Folder tree | Class model | Code graph ──
  const LS_ARCH_TAB = 'design-arch-tab';
  type ArchTab = 'tree' | 'c4' | 'gep' | 'folder' | 'uml' | 'code';
  const ARCH_TABS: ArchTab[] = ['tree', 'c4', 'gep', 'folder', 'uml', 'code'];
  let archTab = $state<ArchTab>('tree');
  if (typeof localStorage !== 'undefined') {
    const t = localStorage.getItem(LS_ARCH_TAB);
    if (t && (ARCH_TABS as string[]).includes(t)) archTab = t as ArchTab;
  }
  function setArchTab(t: ArchTab) {
    archTab = t;
    if (typeof localStorage !== 'undefined') localStorage.setItem(LS_ARCH_TAB, t);
  }

  // ── DEV-ONLY diagram/graphify pipelines (terminal child_process, ZERO
  // Anthropic tokens). Buttons are hidden unless `dev`. Each POSTs a fixed
  // command; graphify's tree-sitter AST pass is deterministic and offline. ──
  let codeGraph = $state<GraphJson | null>(null);
  let busy = $state<'' | 'diagrams' | 'graphify' | 'tree'>('');
  let devMsg = $state('');

  async function rebuildDiagrams() {
    if (busy) return;
    busy = 'diagrams'; devMsg = '';
    try {
      const r = await fetch('/api/design/rebuild-diagrams', { method: 'POST' });
      const j = await r.json();
      devMsg = j.ok
        ? `↻ diagrams regenerated · ${j.ms}ms`
        : `diagrams failed: ${j.reason ?? 'unknown'}`;
    } catch (e) {
      devMsg = `diagrams error: ${(e as Error).message}`;
    } finally { busy = ''; }
  }

  async function runGraphify() {
    if (busy) return;
    busy = 'graphify'; devMsg = '';
    try {
      const r = await fetch('/api/design/graphify', { method: 'POST' });
      const j = await r.json();
      if (j.ok) {
        devMsg = `graph: ${j.nodes.toLocaleString()} nodes · ${j.edges.toLocaleString()} edges · ${j.communities} communities · ${j.ms}ms`;
        await loadCodeGraph();          // refresh the rendered graph
        setArchTab('code');
      } else {
        devMsg = `graphify failed: ${j.reason ?? 'unknown'}`;
      }
    } catch (e) {
      devMsg = `graphify error: ${(e as Error).message}`;
    } finally { busy = ''; }
  }

  async function loadCodeGraph() {
    const r = await fetch('/api/design/graphify-graph');
    const j = await r.json();
    codeGraph = j.ok ? (j.graph as GraphJson) : null;
    return j;
  }

  async function buildTree() {
    if (busy) return;
    busy = 'tree'; devMsg = '';
    try {
      const j = await loadCodeGraph();
      setArchTab('code');
      devMsg = j.ok
        ? `tree: ${(codeGraph?.nodes.length ?? 0).toLocaleString()} nodes`
        : `no graph yet — run graphify first`;
    } catch (e) {
      devMsg = `tree error: ${(e as Error).message}`;
    } finally { busy = ''; }
  }

  // Lazily fetch any existing graph the first time the Code-graph tab opens.
  $effect(() => {
    if (archTab === 'code' && codeGraph === null && !busy) void loadCodeGraph();
  });

  // ── Top-level page sections as VERTICAL TABS (left rail) — show one at a
  // time instead of one long scroll (more compact + easier to navigate). ──
  const PAGE_SECTIONS = [
    { id: 'what',   num: '01', label: 'What it is' },
    { id: 'arch',   num: '02', label: 'Architecture' },
    { id: 'cap',    num: '03', label: 'Capabilities' },
    { id: 'stack',  num: '04', label: 'Tech stack' },
    { id: 'routes', num: '05', label: 'Routes' },
  ] as const;
  type PageSection = (typeof PAGE_SECTIONS)[number]['id'];
  const LS_PAGE_SECTION = 'design-page-section';
  let pageSection = $state<PageSection>('what');
  if (typeof localStorage !== 'undefined') {
    const s = localStorage.getItem(LS_PAGE_SECTION);
    if (s && PAGE_SECTIONS.some((x) => x.id === s)) pageSection = s as PageSection;
  }
  function setPageSection(s: PageSection) {
    pageSection = s;
    if (typeof localStorage !== 'undefined') localStorage.setItem(LS_PAGE_SECTION, s);
  }

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
  <!-- ───────────────────────── Compact hero ───────────────────────── -->
  <header class="hero">
    <div class="hero-inner">
      <div class="hero-lead">
        <div class="kicker">Parametric CAD pipeline</div>
        <h1 class="title">CAD&nbsp;Train</h1>
      </div>
      <div class="hero-meta">
        <p class="tagline">
          A parametric 3D CAD pipeline for downhole-tool components — describe a
          part, wire a graph, bake the geometry.
        </p>
        <div class="badges">
          <span class="badge">SvelteKit</span>
          <span class="badge">ManifoldCAD</span>
          <span class="badge">Threlte</span>
          <span class="badge">Bun</span>
        </div>
      </div>
    </div>
    <div class="hero-glow" aria-hidden="true"></div>
  </header>

  <!-- ─────────────────── Vertical section tabs ─────────────────── -->
  <div class="design-shell">
    <div class="page-rail" role="tablist" aria-label="Sections">
      {#each PAGE_SECTIONS as s}
        <button
          class="rail-tab"
          class:active={pageSection === s.id}
          role="tab"
          aria-selected={pageSection === s.id}
          onclick={() => setPageSection(s.id)}
        >
          <span class="rail-num">{s.num}</span>
          <span class="rail-label">{s.label}</span>
        </button>
      {/each}
    </div>

    <div class="page-body">
  {#if pageSection === 'what'}
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
  {:else if pageSection === 'arch'}
  <!-- ───────────────────────── Architecture graph ───────────────────────── -->
  <section class="section" aria-labelledby="arch-h">
    <div class="section-head">
      <span class="num">02</span>
      <h2 id="arch-h">Architecture</h2>
    </div>
    <p class="prose section-intro">
      Two views of the same app. <strong>Tree</strong> is a collapsible map — one
      <strong>system</strong> holding four <strong>containers</strong> (Web App ·
      API · CAD kernel · Volume store), each with its component nodes; the layout
      reflows whenever you fold a container, and route nodes jump to the live page.
      <strong>C4 model</strong> renders the same data as a formal
      <a href="https://c4model.com" target="_blank" rel="noopener">C4 diagram</a>
      you can zoom through — Context → Container → Component.
    </p>

    <!-- ── view tabs ── -->
    <div class="arch-tabs" role="tablist" aria-label="Architecture view">
      <button
        class="arch-tab"
        class:active={archTab === 'tree'}
        role="tab"
        aria-selected={archTab === 'tree'}
        onclick={() => setArchTab('tree')}
      >
        Tree
      </button>
      <button
        class="arch-tab"
        class:active={archTab === 'c4'}
        role="tab"
        aria-selected={archTab === 'c4'}
        onclick={() => setArchTab('c4')}
      >
        C4&nbsp;model
      </button>
      <button
        class="arch-tab"
        class:active={archTab === 'gep'}
        role="tab"
        aria-selected={archTab === 'gep'}
        onclick={() => setArchTab('gep')}
      >
        GEP&nbsp;module
      </button>
      <button
        class="arch-tab"
        class:active={archTab === 'folder'}
        role="tab"
        aria-selected={archTab === 'folder'}
        onclick={() => setArchTab('folder')}
      >
        Folder&nbsp;tree
      </button>
      <button
        class="arch-tab"
        class:active={archTab === 'uml'}
        role="tab"
        aria-selected={archTab === 'uml'}
        onclick={() => setArchTab('uml')}
      >
        Class&nbsp;model
      </button>
      {#if dev}
        <button
          class="arch-tab"
          class:active={archTab === 'code'}
          role="tab"
          aria-selected={archTab === 'code'}
          onclick={() => setArchTab('code')}
          title="Deterministic code knowledge-graph (dev only)"
        >
          Code&nbsp;graph
        </button>
      {/if}
    </div>

    {#if dev}
      <!-- ── DEV-ONLY pipeline toolbar — runs in the terminal, ZERO Claude tokens ── -->
      <div class="dev-toolbar" aria-label="Dev pipelines">
        <span class="dev-badge">dev</span>
        <button class="dev-btn" onclick={rebuildDiagrams} disabled={!!busy}>
          {#if busy === 'diagrams'}<span class="spin"></span>{:else}↻{/if} Rebuild diagrams
        </button>
        <button class="dev-btn" onclick={runGraphify} disabled={!!busy}>
          {#if busy === 'graphify'}<span class="spin"></span>{/if} Run graphify
        </button>
        <button class="dev-btn" onclick={buildTree} disabled={!!busy}>
          {#if busy === 'tree'}<span class="spin"></span>{/if} Build tree
        </button>
        {#if devMsg}<span class="dev-msg">{devMsg}</span>{/if}
      </div>
    {/if}

    {#if archTab === 'tree'}
      <SvelteFlowProvider>
        <ArchGraph />
      </SvelteFlowProvider>
    {:else if archTab === 'c4'}
      <C4View />
    {:else if archTab === 'gep'}
      <GepModuleGraph />
    {:else if archTab === 'folder'}
      <FolderHierarchy />
    {:else if archTab === 'uml'}
      <UmlClassDiagram />
    {:else}
      <CodeGraph graph={codeGraph} />
    {/if}
  </section>

  {:else if pageSection === 'cap'}
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

  {:else if pageSection === 'stack'}
  <!-- ───────────────────────── Tech stack ───────────────────────── -->
  <section class="section" aria-labelledby="stack-h">
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

  {:else if pageSection === 'routes'}
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
  {/if}
    </div>
  </div>

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

  /* ───────── Hero (compact) ───────── */
  .hero {
    position: relative;
    overflow: hidden;
    padding: clamp(1.1rem, 2.4vw, 1.5rem) clamp(1.25rem, 5vw, 3.5rem);
    border-bottom: 1px solid var(--line);
  }
  .hero-inner {
    position: relative;
    z-index: 1;
    max-width: 72rem;
    display: flex;
    align-items: center;
    gap: clamp(1rem, 3vw, 2.6rem);
    flex-wrap: wrap;
  }
  .hero-lead { flex: 0 0 auto; }
  .hero-meta {
    flex: 1 1 20rem;
    min-width: 16rem;
    display: flex;
    align-items: center;
    gap: 1.2rem;
    flex-wrap: wrap;
    /* left divider to separate title from the meta */
    padding-left: clamp(1rem, 3vw, 2.6rem);
    border-left: 1px solid var(--line);
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
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 0.5rem;
  }
  .title {
    margin: 0;
    font-size: clamp(1.9rem, 5vw, 3rem);
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  .tagline {
    margin: 0;
    flex: 1 1 18rem;
    font-size: clamp(0.9rem, 1.5vw, 1.02rem);
    font-weight: 500;
    color: var(--ink-soft);
    max-width: 34rem;
    line-height: 1.4;
  }
  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin: 0;
    flex: 0 0 auto;
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

  /* ───────── Vertical section tabs (left rail + body) ───────── */
  .design-shell {
    display: flex;
    align-items: flex-start;
    gap: 0;
  }
  .page-rail {
    position: sticky;
    top: 0;
    flex: 0 0 auto;
    width: 12rem;
    display: flex;
    flex-direction: column;
    padding: 1.25rem 0.6rem;
    gap: 0.2rem;
    border-right: 1px solid var(--line);
    background: var(--paper-alt);
    min-height: 60vh;
  }
  .rail-tab {
    display: flex;
    align-items: baseline;
    gap: 0.55rem;
    width: 100%;
    text-align: left;
    padding: 0.5rem 0.75rem;
    border: none;
    border-radius: 9px;
    background: none;
    color: var(--ink-soft);
    font: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .rail-tab:hover { background: #fff; color: var(--ink); }
  .rail-tab.active {
    background: #fff;
    color: var(--ink);
    box-shadow: inset 3px 0 0 var(--accent), 0 1px 3px rgba(0, 0, 0, 0.05);
  }
  .rail-num {
    font-size: 0.66rem;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 0.04em;
  }
  .rail-tab.active .rail-num { color: var(--accent); }
  .page-body {
    flex: 1 1 auto;
    min-width: 0;
  }

  /* ───────── Sections ───────── */
  .section {
    padding: clamp(1.5rem, 3vw, 2.5rem) clamp(1.25rem, 4vw, 3rem);
    border-bottom: none;
  }
  .section-head {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    margin-bottom: 1.4rem;
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

  /* ───────── Architecture view tabs ───────── */
  .arch-tabs {
    display: inline-flex;
    gap: 0.3rem;
    margin-bottom: 1.4rem;
    padding: 0.25rem;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--paper-alt);
  }
  .arch-tab {
    font-size: 0.92rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    padding: 0.5rem 1.3rem;
    border: none;
    border-radius: 9px;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
    transition: background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
  }
  .arch-tab:hover {
    color: var(--ink);
  }
  .arch-tab.active {
    background: var(--paper);
    color: var(--accent);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  }

  /* ───────── Dev-only pipeline toolbar ───────── */
  .dev-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0 0 1.2rem;
    padding: 0.55rem 0.7rem;
    border: 1px dashed var(--line);
    border-radius: 12px;
    background: var(--paper-alt);
  }
  .dev-badge {
    font-size: 0.6rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: #b45309;
    background: #fef3c7;
    border: 1px solid #fde68a;
    padding: 2px 7px;
    border-radius: 6px;
  }
  .dev-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.82rem;
    font-weight: 700;
    padding: 0.42rem 0.85rem;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--paper);
    color: var(--ink-soft);
    cursor: pointer;
    transition: background 0.16s ease, color 0.16s ease, border-color 0.16s ease;
  }
  .dev-btn:hover:not(:disabled) {
    color: var(--accent);
    border-color: var(--accent);
  }
  .dev-btn:disabled { opacity: 0.55; cursor: default; }
  .dev-msg {
    font-size: 0.76rem;
    color: var(--ink-soft);
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
  }
  .spin {
    width: 11px;
    height: 11px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    display: inline-block;
    animation: dev-spin 0.7s linear infinite;
  }
  @keyframes dev-spin { to { transform: rotate(360deg); } }

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
