<script lang="ts">
  /**
   * AppHarness.svelte — the "App Design / App Harness" architecture section for
   * the /design route. cadtrain is an ENGINE + a HARNESS; a sub-app (wells, or a
   * future user app) is a declarative `.app` file authored by AI against a tool
   * schema generated from ONE verb registry.
   *
   * Same idiom as DesignPhilosophy.svelte: a grid of cards, each with prose + a
   * deliberately-plain Mermaid boxes-and-arrows diagram. Mermaid is heavy (~MBs)
   * so it's DYNAMICALLY imported on mount — it only loads when this section is
   * opened, never in the main bundle. SSR is globally off (src/+layout.ts) so the
   * dynamic import + DOM render are safe. The studio-interface wireframe is a
   * hand-drawn inline SVG (same idiom as GepModuleGraph); the verb catalog +
   * runtime matrix are plain HTML tables.
   *
   * Source of truth: docs/architecture/app-harness.md (the approved DESIGN).
   */
  import { onMount } from 'svelte';

  type Diagram = {
    n: string;
    title: string;
    body: string;
    cites: string;
    diagram: string;
    wide?: boolean;
  };

  // Every fact + file/dir name below is traced to docs/architecture/app-harness.md.
  const diagrams: Diagram[] = [
    {
      n: '01',
      title: 'Server-render — the .app compiled by the superapp',
      body:
        'The .app (on the volume via /app/[id], or a local file parked in a session then /app/local/[token]) is compiled by the SERVER: it resolves the data for each server-mode panel through the engine in-process (SvelteKit fetch to /api/primitives/*), SSRs the first paint, then the client HYDRATES for full Svelte reactivity. The ENGINE (bake, compile, parts) never ships — only resolved data + compiled component code, never the .svelte source. Local UI is instant client-side (tabs, inputs, add/delete rows, computed); only persist, engine, and load round-trip. Two per-component knobs: dataMode (static/server/client) and computeMode (server/client bake).',
      cites: 'docs/plans/app-server-render.md · /app/[id] · /app/local/[token] · dataMode · computeMode',
      wide: true,
      diagram: `flowchart LR
  subgraph SRC[".app · pointer to the file"]
    direction TB
    V["Volume<br/>/app/[id]"]:::src
    L["Local file<br/>/app/local/[token]"]:::src
  end
  subgraph SRV["Server · the superapp (SSR)"]
    direction TB
    RD["Resolve server-mode data<br/>engine + dispatch"]:::srv
    SS["SSR first paint → HTML"]:::srv
    EN["🔒 ENGINE<br/>bake · compile · parts — never ships"]:::eng
  end
  subgraph CLI["Client · hydrated + reactive"]
    direction TB
    RX["Full Svelte reactivity"]:::cli
    LO["Local: tabs · inputs · add/del rows · computed"]:::cli
  end
  V --> RD
  L --> RD
  RD --> SS --> CLI
  CLI -. "only persist · engine · load" .-> SRV
  classDef src fill:#f6f7f9,stroke:#cbd2da,color:#334155;
  classDef srv fill:#eef4fb,stroke:#3b82c4,color:#1e3a5f;
  classDef eng fill:#fbeaea,stroke:#cc2222,color:#7a1414;
  classDef cli fill:#eef6ee,stroke:#2f7d32,color:#1c4d1f;`,
    },
    {
      n: '02',
      title: 'The five-layer stack — one SSOT, three projections',
      body:
        'A single Verb Registry is the source of truth: each op declared once ({name, group, desc, params, handler}). It PROJECTS to three surfaces that cannot drift — the AI tool schema, the HTTP execution routes, and the generated API.md authoring guide. A declarative .app manifest wires panels/controls to verbs; the Harness UI reads it through a PanelKind registry; a multi-prompt AI pipeline authors the manifest.',
      cites: 'appkit/verbs · appkit/schema · apps/<id>.app · shared/harness · appkit/ai',
      wide: true,
      diagram: `flowchart TB
  R["① Verb registry · SSOT<br/>appkit/verbs — data · mutate · gui"]:::ssot
  R -->|project| T["② Tool schema<br/>AI-SDK tool()"]:::proj
  R -->|project| H["② HTTP routes<br/>/api/app/verb/[name]"]:::proj
  R -->|project| G["② Generated API.md<br/>authoring contract"]:::proj
  T --> M["③ .app manifest<br/>panels · controls → verbs"]:::app
  H --> M
  G --> M
  M --> U["④ Harness UI<br/>PanelKind registry → dispatch()"]:::ui
  P["⑤ Multi-prompt AI pipeline<br/>intent → plan → build → verify"]:::ai -->|authors| M
  classDef ssot fill:#fbeaea,stroke:#cc2222,color:#7a1414;
  classDef proj fill:#eef4fb,stroke:#3b82c4,color:#1e3a5f;
  classDef app fill:#f3eefb,stroke:#7c4dc4,color:#3a1e5f;
  classDef ui fill:#eef6ee,stroke:#2f7d32,color:#1c4d1f;
  classDef ai fill:#fff6e6,stroke:#c47f16,color:#5f3a0e;`,
    },
    {
      n: '03',
      title: 'Two tiers — engines vs apps (D12)',
      body:
        'The boundary between the two tiers is the verb registry. ENGINES live in src/, are built by Claude at dev-time, and hold the complex, heavy functionality (Manifold / TF / BREP kernels, the primitives pipeline, any hard logic). They are exposed as VERBS. APPS are thin declarative .app GUIs, built by the runtime AI, that DRAW + WIRE engines — no complex logic of their own. In short: Claude builds engines; the AI builds apps.',
      cites: 'D12 · D13 — the registry is the complete API over the engines',
      diagram: `flowchart LR
  subgraph E["ENGINES · src/ · Claude / dev-built"]
    direction TB
    M1["Manifold · TF · BREP"]:::eng
    M2["primitives pipeline"]:::eng
    M3["any hard logic"]:::eng
  end
  E --> V["◆ VERB REGISTRY<br/>the boundary"]:::verb
  V --> A["APPS · .app<br/>runtime-AI-built · thin<br/>DRAW + WIRE engines"]:::app
  classDef eng fill:#eef4fb,stroke:#3b82c4,color:#1e3a5f;
  classDef verb fill:#fbeaea,stroke:#cc2222,color:#7a1414;
  classDef app fill:#eef6ee,stroke:#2f7d32,color:#1c4d1f;`,
    },
    {
      n: '04',
      title: 'Three authoring surfaces, one .app (D16)',
      body:
        'The same manifest is edited three ways: the AI chat (the build pipeline), a native lightweight visual editor (palette = the PanelKinds, drag-to-place, bind-control-to-verb), and the rendered harness itself. All three hands edit the ONE .app — human and AI co-author the same file.',
      cites: 'D16 · rung 4b — the native visual editor',
      diagram: `flowchart TB
  C["AI chat<br/>(build pipeline)"]:::surf --> APP[".app manifest<br/>the ONE source"]:::app
  VE["Visual editor<br/>(drag PanelKinds)"]:::surf --> APP
  RH["Rendered harness<br/>(direct edits)"]:::surf --> APP
  classDef surf fill:#eef4fb,stroke:#3b82c4,color:#1e3a5f;
  classDef app fill:#f3eefb,stroke:#7c4dc4,color:#3a1e5f;`,
    },
    {
      n: '05',
      title: 'The .app lifecycle',
      body:
        'Create → Design (AI + visual) → Save → Launch (preview) — then iterate. A .app is a self-contained file (like a .docx): panels, controls, bindings, and the verbs it composes travel together. Hand someone the file and it runs on any harness. It lives in a working dir (default ~/Desktop/SAMPLE) but is openable/saveable anywhere via the native file picker.',
      cites: 'D9 — AppStore · local backend is the v1 path',
      diagram: `flowchart LR
  C["Create"]:::step --> D["Design<br/>AI + visual"]:::step --> S["Save<br/>.app file"]:::step --> L["Launch<br/>(preview)"]:::step
  L -.->|iterate| D
  classDef step fill:#f6f7f9,stroke:#cbd2da,color:#334155;`,
    },
    {
      n: '06',
      title: 'The learning loop (rung 4a.2)',
      body:
        'Every AI build run is captured — the tuple {prompt, retrieved RAG context, the verb calls, the resulting .app} — into an app-building corpus (_builds.jsonl). Retrieval grounds FUTURE builds on that corpus, so the system learns to build apps and gets more deterministic over time. Verified non-conformances promote into RAG goldens + sharpened verb desc + eval cases. Runs LOCALLY — no data leaves (data-residency).',
      cites: 'D10 · D15 — /api/app/generate → volume ai/app-rag/ (builds.jsonl + golden/)',
      diagram: `flowchart LR
  B["AI build run"]:::step --> CAP["Capture tuple<br/>prompt · RAG · verbs · result"]:::cap
  CAP --> LOG["corpus<br/>ai/app-rag/ (volume)"]:::corpus
  LOG -->|grounds next| B
  classDef step fill:#eef6ee,stroke:#2f7d32,color:#1c4d1f;
  classDef cap fill:#fff6e6,stroke:#c47f16,color:#5f3a0e;
  classDef corpus fill:#eef4fb,stroke:#3b82c4,color:#1e3a5f;`,
    },
  ];

  // ── Verb catalog v1 (the wells slice) — grouped data · mutate · gui ──
  const verbGroups = [
    {
      group: 'data',
      color: '#3b82c4',
      verbs: [
        ['listDocs', '{docType?}', '/api/primitives/list'],
        ['loadDoc', '{id}', '/api/primitives/source'],
        ['getParams', '{id}', 'graph meta.params'],
        ['bake', '{id, params}', '/api/primitives/bake-preview'],
        ['listParts', '{category?}', '/api/primitives/list'],
      ],
    },
    {
      group: 'mutate',
      color: '#c47f16',
      verbs: [
        ['setParam', '{id, name, value}', 'graph param write'],
        ['addRow', '{id, list, row}', 'parts_map list<record>'],
        ['removeRow', '{id, list, index}', 'list<record>'],
        ['reorderRow', '{id, list, from, to}', 'list<record>'],
        ['patchDoc', '{id, op, path, value}', 'JSON push/set/remove'],
      ],
    },
    {
      group: 'gui',
      color: '#7c4dc4',
      verbs: [
        ['definePanel', '{app, panel}', '.app panels[]'],
        ['addControl', '{app, panelId, control}', '.app control'],
        ['bindAction', '{app, controlId, verb, args}', '.app binding'],
        ['patchApp', '{app, op, path, value}', 'JSON patch on .app'],
        ['listPanelKinds', '{}', 'PanelKind registry'],
      ],
    },
  ];

  // ── Runtime matrix (§8) ──
  const runtimeMatrix = [
    {
      env: 'Restricted / air-gapped',
      model: 'local — Ollama / WebLLM',
      embed: 'local — nomic-embed-text',
      harness: 'ours (declarative)',
      restricted: true,
    },
    {
      env: 'Standard',
      model: 'cloud Claude',
      embed: 'cloud or local',
      harness: 'ours (declarative)',
      restricted: false,
    },
    {
      env: 'Power codegen (opt-in, D7)',
      model: 'Cursor (cloud)',
      embed: 'cloud',
      harness: 'Cursor SDK (parallel)',
      restricted: false,
    },
  ];

  let hosts: HTMLDivElement[] = [];
  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let errMsg = $state('');

  onMount(async () => {
    try {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'neutral',
        securityLevel: 'loose', // <br/> in labels
        flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
        themeVariables: {
          fontSize: '12px',
          fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        },
      });
      for (let i = 0; i < diagrams.length; i++) {
        const { svg } = await mermaid.render(`apph-${i}`, diagrams[i].diagram);
        if (hosts[i]) hosts[i].innerHTML = svg;
      }
      status = 'ready';
    } catch (e: any) {
      errMsg = e?.message ?? String(e);
      status = 'error';
    }
  });
</script>

<p class="prose section-intro">
  cadtrain is an <strong>engine + harness</strong>. A sub-app — wells, or a future
  user app — is a declarative <code>.app</code> file. An AI authors and edits
  <code>.app</code> files and calls data verbs through a <strong>tool schema
  generated from one verb registry</strong>, driven by a multi-prompt
  orchestration pipeline. The runtime AI is <strong>local-first</strong>
  (Ollama / WebLLM) with a cloud option, and can run air-gapped. Source of truth:
  <code>docs/architecture/app-harness.md</code>.
</p>

{#if status === 'error'}
  <div class="ah-err">Diagram render failed: {errMsg}</div>
{/if}

<!-- ── Mermaid diagram cards (five-layer stack is full-width) ── -->
<div class="ah-grid">
  {#each diagrams as d, i}
    <article class="ah-card" class:wide={d.wide}>
      <header class="ah-head">
        <span class="ah-num">{d.n}</span>
        <h3>{d.title}</h3>
      </header>
      <p class="ah-body">{d.body}</p>
      <div class="ah-diagram" bind:this={hosts[i]}>
        {#if status === 'loading'}<span class="ah-loading">rendering diagram…</span>{/if}
      </div>
      <div class="ah-cite">{d.cites}</div>
    </article>
  {/each}
</div>

<!-- ── The /app_design studio interface — hand-drawn wireframe ── -->
<article class="ah-card wire-card">
  <header class="ah-head">
    <span class="ah-num">07</span>
    <h3>The studio interface — <code>/app_design</code> (target layout)</h3>
  </header>
  <p class="ah-body">
    A thin vertical <strong>left toolbar</strong> (New · Open · Save · Save As ·
    Preview · Launch) plus a full-width main area: an <strong>AI-build prompt
    row</strong> on top, then the work area — the <strong>visual editor</strong>
    or the <strong>preview</strong>. File-editor model: a native file picker (File
    System Access API), default working dir <code>~/Desktop/SAMPLE</code>.
  </p>

  <div class="wire-frame">
    <svg viewBox="0 0 960 480" role="img" aria-label="/app_design studio interface wireframe" class="wire-svg">
      <!-- window frame -->
      <rect x="8" y="8" width="944" height="464" rx="14" class="w-window" />
      <!-- title bar -->
      <line x1="8" y1="44" x2="952" y2="44" class="w-hair" />
      <circle cx="30" cy="26" r="5" class="w-dot" />
      <circle cx="48" cy="26" r="5" class="w-dot" />
      <circle cx="66" cy="26" r="5" class="w-dot" />
      <text x="92" y="30" class="w-titletext">app_design — SAMPLE / well-designer.app</text>

      <!-- ── left toolbar ── -->
      <rect x="8" y="44" width="92" height="428" class="w-toolbar" />
      {#each [ ['✚','New'], ['📂','Open'], ['💾','Save'], ['🗂','Save As'], ['▷','Preview'], ['🚀','Launch'] ] as t, i}
        <g transform="translate(30,{72 + i * 66})">
          <rect x="0" y="0" width="48" height="44" rx="9" class="w-tool" class:accent={t[1] === 'Preview' || t[1] === 'Launch'} />
          <text x="24" y="26" class="w-toolicon">{t[0]}</text>
          <text x="24" y="58" class="w-toollabel">{t[1]}</text>
        </g>
      {/each}

      <!-- ── AI-build prompt row ── -->
      <rect x="118" y="60" width="700" height="46" rx="10" class="w-prompt" />
      <text x="138" y="88" class="w-prompttext">Describe the app to build…  “a well designer: list · casings form · 3D bake”</text>
      <rect x="828" y="60" width="106" height="46" rx="10" class="w-buildbtn" />
      <text x="881" y="88" class="w-buildtext">✨ Build</text>

      <!-- ── work-area mode toggle ── -->
      <rect x="118" y="120" width="220" height="30" rx="8" class="w-toggle" />
      <rect x="122" y="124" width="108" height="22" rx="6" class="w-toggle-on" />
      <text x="176" y="139" class="w-toggletext on">Visual editor</text>
      <text x="286" y="139" class="w-toggletext">Preview</text>

      <!-- ── work area (visual editor mock: list · form · 3D) ── -->
      <rect x="118" y="160" width="816" height="300" rx="12" class="w-work" />

      <!-- panel: list -->
      <rect x="138" y="182" width="180" height="258" rx="9" class="w-panel" />
      <text x="152" y="204" class="w-paneltitle">list · Docs</text>
      <line x1="138" y1="214" x2="318" y2="214" class="w-hair" />
      {#each [0,1,2,3] as r}
        <rect x="152" y={228 + r * 34} width="152" height="22" rx="5" class="w-row" />
      {/each}

      <!-- panel: form (casings table) -->
      <rect x="330" y="182" width="290" height="258" rx="9" class="w-panel" />
      <text x="344" y="204" class="w-paneltitle">form · Params → casings table</text>
      <line x1="330" y1="214" x2="620" y2="214" class="w-hair" />
      {#each ['od','id','top','bot'] as c, ci}
        <rect x={346 + ci * 64} y="228" width="56" height="18" rx="4" class="w-cell head" />
        <text x={374 + ci * 64} y="241" class="w-cellhead">{c}</text>
      {/each}
      {#each [0,1,2,3] as r}
        {#each [0,1,2,3] as c}
          <rect x={346 + c * 64} y={254 + r * 30} width="56" height="20" rx="4" class="w-cell" />
        {/each}
      {/each}
      <rect x="346" y="404" width="86" height="24" rx="6" class="w-addrow" />
      <text x="389" y="420" class="w-addtext">＋ addRow</text>

      <!-- panel: bake3d -->
      <rect x="632" y="182" width="284" height="258" rx="9" class="w-panel" />
      <text x="646" y="204" class="w-paneltitle">bake3d · View</text>
      <line x1="632" y1="214" x2="916" y2="214" class="w-hair" />
      <rect x="648" y="226" width="252" height="200" rx="8" class="w-viewport" />
      <!-- crude well cutaway glyph -->
      <rect x="758" y="240" width="32" height="176" rx="3" class="w-well-outer" />
      <rect x="768" y="240" width="12" height="176" class="w-well-inner" />
      <line x1="774" y1="240" x2="774" y2="416" class="w-well-axis" />
    </svg>
  </div>
  <div class="ah-cite">Wireframe of the target /app_design studio — file-editor model, AppStore local backend (D9)</div>
</article>

<!-- ── Reference tables — verb catalog + runtime matrix ── -->
<div class="ah-tables">
  <section class="ah-tablecard">
    <h4 class="ah-tabletitle">Verb catalog v1 — the boundary API</h4>
    <p class="ah-tablenote">
      Each verb declared once in the registry, projected to tools + HTTP + API.md.
      The <code>mutate</code> verbs reuse the #77 <code>parts_map</code> list&lt;record&gt; machinery.
    </p>
    <div class="ah-tablescroll">
      <table class="ah-table">
        <thead>
          <tr><th>group</th><th>verb</th><th>params</th><th>backed by</th></tr>
        </thead>
        <tbody>
          {#each verbGroups as g}
            {#each g.verbs as v, vi}
              <tr>
                {#if vi === 0}
                  <td class="grp" rowspan={g.verbs.length}>
                    <span class="grp-chip" style="background:{g.color}">{g.group}</span>
                  </td>
                {/if}
                <td class="mono strong">{v[0]}</td>
                <td class="mono">{v[1]}</td>
                <td class="mono dim">{v[2]}</td>
              </tr>
            {/each}
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <section class="ah-tablecard">
    <h4 class="ah-tabletitle">Runtime matrix — local-first, cloud optional</h4>
    <p class="ah-tablenote">
      RAG is a shared, provider-agnostic grounding layer: retrieval runs upstream
      of the model, so the SAME context feeds cloud-Claude and local-WebLLM. A fix
      once improves both runtimes.
    </p>
    <div class="ah-tablescroll">
      <table class="ah-table">
        <thead>
          <tr><th>environment</th><th>model</th><th>embeddings</th><th>harness</th></tr>
        </thead>
        <tbody>
          {#each runtimeMatrix as m}
            <tr>
              <td class="strong">
                {m.env}
                {#if m.restricted}<span class="airgap">air-gapped</span>{/if}
              </td>
              <td>{m.model}</td>
              <td class="dim">{m.embed}</td>
              <td class="dim">{m.harness}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</div>

<style>
  .section-intro {
    max-width: 52rem;
    margin-bottom: 2rem;
    color: #555;
  }
  .section-intro code,
  .ah-tablenote code {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 0.82em;
    color: #cc2222;
  }

  /* ── diagram grid ── */
  .ah-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(21rem, 1fr));
    gap: 1.1rem;
  }
  .ah-card {
    display: flex;
    flex-direction: column;
    padding: 1.3rem 1.3rem 1rem;
    background: #fff;
    border: 1px solid #e7e7e7;
    border-radius: 14px;
    transition: box-shadow 0.2s ease, border-color 0.2s ease;
  }
  .ah-card:hover {
    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.06);
    border-color: #d8d8d8;
  }
  .ah-card.wide {
    grid-column: 1 / -1;
  }
  .ah-head {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin-bottom: 0.55rem;
  }
  .ah-num {
    font-size: 0.66rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    color: #cc2222;
    padding-top: 0.05rem;
  }
  .ah-head h3 {
    margin: 0;
    font-size: 1.02rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: #1a1a1a;
  }
  .ah-head h3 code {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 0.85em;
    color: #cc2222;
  }
  .ah-body {
    margin: 0 0 1rem;
    font-size: 0.88rem;
    line-height: 1.5;
    color: #555;
  }
  .ah-diagram {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 130px;
    margin-top: auto;
    padding: 0.7rem;
    background: #fbfcfe;
    border: 1px solid #eef1f5;
    border-radius: 10px;
    overflow-x: auto;
  }
  .ah-diagram :global(svg) {
    display: block;
    max-width: 100%;
    height: auto;
  }
  .ah-loading {
    font-size: 0.76rem;
    color: #94a3b8;
  }
  .ah-cite {
    margin-top: 0.7rem;
    font-size: 0.68rem;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    color: #94a3b8;
    word-break: break-word;
  }
  .ah-err {
    margin-bottom: 1rem;
    padding: 0.7rem 0.9rem;
    font-size: 0.8rem;
    color: #b91c1c;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 10px;
  }

  /* ── studio wireframe card ── */
  .wire-card {
    margin-top: 1.1rem;
  }
  .wire-frame {
    margin-top: auto;
    padding: 0.9rem;
    background: #fbfcfe;
    border: 1px solid #eef1f5;
    border-radius: 12px;
    overflow-x: auto;
  }
  .wire-svg {
    display: block;
    width: 100%;
    min-width: 640px;
    height: auto;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .w-window { fill: #ffffff; stroke: #d5dbe3; stroke-width: 1.5; }
  .w-hair { stroke: #e7ecf2; stroke-width: 1; }
  .w-dot { fill: #e2e8f0; }
  .w-titletext { font-size: 12px; fill: #94a3b8; font-family: ui-monospace, Menlo, monospace; }
  .w-toolbar { fill: #f6f8fb; stroke: #eef1f5; stroke-width: 1; }
  .w-tool { fill: #ffffff; stroke: #dbe2ea; stroke-width: 1.2; }
  .w-tool.accent { fill: #fbeaea; stroke: #cc2222; }
  .w-toolicon { font-size: 17px; text-anchor: middle; }
  .w-toollabel { font-size: 8.5px; fill: #64748b; text-anchor: middle; font-weight: 600; }
  .w-prompt { fill: #ffffff; stroke: #cbd5e1; stroke-width: 1.4; stroke-dasharray: 5 3; }
  .w-prompttext { font-size: 12px; fill: #94a3b8; }
  .w-buildbtn { fill: #cc2222; }
  .w-buildtext { font-size: 12.5px; fill: #ffffff; font-weight: 700; text-anchor: middle; }
  .w-toggle { fill: #eef1f5; stroke: #e2e8f0; stroke-width: 1; }
  .w-toggle-on { fill: #ffffff; stroke: #dbe2ea; stroke-width: 1; }
  .w-toggletext { font-size: 11px; fill: #94a3b8; text-anchor: middle; font-weight: 600; }
  .w-toggletext.on { fill: #334155; }
  .w-work { fill: #fcfdff; stroke: #e2e8f0; stroke-width: 1.3; }
  .w-panel { fill: #ffffff; stroke: #e2e8f0; stroke-width: 1.2; }
  .w-paneltitle { font-size: 11px; fill: #475569; font-weight: 700; font-family: ui-monospace, Menlo, monospace; }
  .w-row { fill: #f4f7fb; stroke: #eef1f5; stroke-width: 1; }
  .w-cell { fill: #f8fafc; stroke: #eef1f5; stroke-width: 1; }
  .w-cell.head { fill: #eef4fb; stroke: #dbe6f3; }
  .w-cellhead { font-size: 9px; fill: #3b82c4; text-anchor: middle; font-weight: 700; }
  .w-addrow { fill: #eef6ee; stroke: #cfe6cf; stroke-width: 1; }
  .w-addtext { font-size: 10px; fill: #2f7d32; text-anchor: middle; font-weight: 700; }
  .w-viewport { fill: #f1f5fa; stroke: #e2e8f0; stroke-width: 1; }
  .w-well-outer { fill: #d8e2ee; stroke: #9fb4cc; stroke-width: 1; }
  .w-well-inner { fill: #ffffff; }
  .w-well-axis { stroke: #cc2222; stroke-width: 1; stroke-dasharray: 4 3; }

  /* ── reference tables ── */
  .ah-tables {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(24rem, 1fr));
    gap: 1.1rem;
    margin-top: 1.4rem;
  }
  .ah-tablecard {
    padding: 1.3rem 1.3rem 1rem;
    background: #fff;
    border: 1px solid #e7e7e7;
    border-radius: 14px;
  }
  .ah-tabletitle {
    margin: 0 0 0.4rem;
    font-size: 0.98rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: #1a1a1a;
  }
  .ah-tablenote {
    margin: 0 0 0.9rem;
    font-size: 0.78rem;
    line-height: 1.45;
    color: #64748b;
  }
  .ah-tablescroll { overflow-x: auto; }
  .ah-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.78rem;
  }
  .ah-table th {
    text-align: left;
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #94a3b8;
    padding: 0.4rem 0.55rem;
    border-bottom: 1px solid #e7ecf2;
    white-space: nowrap;
  }
  .ah-table td {
    padding: 0.4rem 0.55rem;
    border-bottom: 1px solid #f2f5f8;
    color: #475569;
    vertical-align: top;
  }
  .ah-table td.mono {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 0.72rem;
  }
  .ah-table td.strong { color: #1a1a1a; font-weight: 700; }
  .ah-table td.dim { color: #94a3b8; }
  .ah-table td.grp {
    border-bottom: 1px solid #e7ecf2;
    vertical-align: middle;
  }
  .grp-chip {
    display: inline-block;
    font-size: 0.6rem;
    font-weight: 700;
    color: #fff;
    padding: 2px 9px;
    border-radius: 20px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .airgap {
    display: inline-block;
    margin-left: 0.4rem;
    font-size: 0.56rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #b45309;
    background: #fef3c7;
    border: 1px solid #fde68a;
    padding: 1px 6px;
    border-radius: 6px;
    vertical-align: middle;
  }
</style>
