<script lang="ts">
  /**
   * DesignPhilosophy.svelte — the architecture PRINCIPLES of the codebase, each
   * with one small Mermaid diagram (boxes + arrows, deliberately simple).
   *
   * Mermaid is heavy (~MBs) so it's DYNAMICALLY imported on mount — it only loads
   * when this section is opened, never in the main bundle (same pattern as
   * UmlClassDiagram.svelte). SSR is globally off, so the dynamic import + DOM
   * render are safe. Each principle renders into its own host element.
   */
  import { onMount } from 'svelte';

  type Principle = {
    n: string;
    title: string;
    body: string;
    cites: string;
    diagram: string;
  };

  // Every fact + file/dir name below is verified against the tree.
  const principles: Principle[] = [
    {
      n: '01',
      title: 'One model, a registry of descriptors',
      body:
        'The composition-graph node model is a NodeKind registry — kindOf(node) returns a descriptor that owns emit / validate / size / sockets — instead of a switch(node.type) scattered across the codebase. Adding a node type is one file, not fifteen edits.',
      cites: 'src/lib/cad/nodes/  ·  registry.ts · kinds/*.ts',
      diagram: `flowchart LR
  A["switch(node.type)<br/>…15 arms…"]:::old -->|refactor| B["kindOf(node)<br/>= descriptor"]:::new
  B --> C[".emit()"]:::leaf
  B --> D[".validate()"]:::leaf
  B --> E[".sockets()"]:::leaf
  classDef old fill:#fbeaea,stroke:#cc2222,color:#7a1414;
  classDef new fill:#eef6ee,stroke:#2f7d32,color:#1c4d1f;
  classDef leaf fill:#f6f7f9,stroke:#cbd2da,color:#334155;`,
    },
    {
      n: '02',
      title: 'Layered geometry',
      body:
        'Raw helpers (cyl / tube / revolve) are an unstable toolkit used ONLY inside engine primitives. Engine primitives in stdlib/ are read-only and canonical. Volume parts compose those primitives via .add / .subtract / .intersect — a part never reaches down to a raw helper.',
      cites: 'manifold-helpers.ts → stdlib/ → volume parts',
      diagram: `flowchart TB
  A["volume parts<br/>compose via .add / .subtract"]:::top --> B["engine primitives<br/>stdlib/ (read-only)"]:::mid
  B --> C["raw helpers<br/>manifold-helpers.ts"]:::bot
  classDef top fill:#eef4fb,stroke:#3b82c4,color:#1e3a5f;
  classDef mid fill:#f3eefb,stroke:#7c4dc4,color:#3a1e5f;
  classDef bot fill:#fbeaea,stroke:#cc2222,color:#7a1414;`,
    },
    {
      n: '03',
      title: 'A decomposed editor: shell → trunk → leaves',
      body:
        'GraphEditorPane is the shell. Per pane it owns a GraphEditorController (the trunk that holds graph + history) plus per-pane state CLASSES — WireState / SketchState / GraphHistory, never module singletons, because /primitives mounts every tab pane at once. The leaves are descriptor-driven NodeCards.',
      cites: 'graph-editor/controller · wire-state · sketch-state',
      diagram: `flowchart TB
  subgraph S["GraphEditorPane · shell"]
    direction TB
    subgraph T["GraphEditorController · trunk (per pane)"]
      direction LR
      W["WireState"]:::leaf
      K["SketchState"]:::leaf
      H["GraphHistory"]:::leaf
      N["NodeCards"]:::leaf
    end
  end
  classDef leaf fill:#f6f7f9,stroke:#cbd2da,color:#334155;`,
    },
    {
      n: '04',
      title: 'Golden-emit as the safety net',
      body:
        'emit-golden.test.ts freezes ~20 parts’ emitted source byte-for-byte (fixtures under tests/golden/). Re-emit the graph, compare to the frozen bytes — diff = 0 means a refactor is provably behaviour-preserving. This is what makes big rewrites and parallel subagents safe.',
      cites: 'src/lib/cad/nodes/emit-golden.test.ts · tests/golden/',
      diagram: `flowchart LR
  G["graph"]:::leaf --> E["emit()"]:::leaf --> C{"byte-compare"}:::cmp
  F["frozen .js<br/>(~20 parts)"]:::frozen --> C
  C -->|"diff = 0"| OK["✓ safe"]:::ok
  classDef leaf fill:#f6f7f9,stroke:#cbd2da,color:#334155;
  classDef frozen fill:#eef4fb,stroke:#3b82c4,color:#1e3a5f;
  classDef cmp fill:#fff6e6,stroke:#c47f16,color:#5f3a0e;
  classDef ok fill:#eef6ee,stroke:#2f7d32,color:#1c4d1f;`,
    },
    {
      n: '05',
      title: 'Client-first bake',
      body:
        'The server is the COMPILER — a graph becomes a dep-inlined Manifold script plus a hash. The browser Web Worker is the EXECUTOR — it runs that script and bakes the mesh. Splitting compile from execute kills the stale-bake (deja-vu) bug structurally.',
      cites: 'compile endpoint → bake-worker.ts / bake-client.ts',
      diagram: `flowchart LR
  G["graph"]:::leaf --> S["server: compile<br/>→ script + hash"]:::srv --> W["browser worker:<br/>bake mesh"]:::cli --> V["viewer"]:::leaf
  classDef leaf fill:#f6f7f9,stroke:#cbd2da,color:#334155;
  classDef srv fill:#eef4fb,stroke:#3b82c4,color:#1e3a5f;
  classDef cli fill:#eef6ee,stroke:#2f7d32,color:#1c4d1f;`,
    },
    {
      n: '06',
      title: 'Data-driven parametrics',
      body:
        'A param is not just a number: ParamSchema is a union of number | record | list<record>. A parts_map node maps a list<record> to N part instances — one node, driven by data, instead of N hand-wired cards.',
      cites: 'composition-graph-types.ts · nodes/kinds/parts-map.ts',
      diagram: `flowchart LR
  A["list&lt;record&gt;<br/>[{od,len} × N]"]:::data --> M["parts_map"]:::node --> S["N solids"]:::leaf
  classDef data fill:#fff6e6,stroke:#c47f16,color:#5f3a0e;
  classDef node fill:#f3eefb,stroke:#7c4dc4,color:#3a1e5f;
  classDef leaf fill:#f6f7f9,stroke:#cbd2da,color:#334155;`,
    },
    {
      n: '07',
      title: 'Z-down, everywhere',
      body:
        'The drilling convention runs through every helper: the top of a tool is the LOWER z, and mv(part,[0,0,+N]) moves the part DOWN-HOLE. One sign convention, encoded once, so nothing has to second-guess which way is deeper.',
      cites: 'src/lib/cad/CLAUDE.md · every helper',
      diagram: `flowchart TB
  T["surface · z = 0"]:::top --> D["mv(part, [0,0,+N])<br/>down-hole · z increases"]:::bot
  classDef top fill:#eef4fb,stroke:#3b82c4,color:#1e3a5f;
  classDef bot fill:#fbeaea,stroke:#cc2222,color:#7a1414;`,
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
          fontFamily:
            'ui-monospace, "SF Mono", Menlo, monospace',
        },
      });
      for (let i = 0; i < principles.length; i++) {
        const { svg } = await mermaid.render(`philo-${i}`, principles[i].diagram);
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
  The principles the codebase actually holds itself to — each is a real,
  load-bearing choice you can trace to a file, not an aspiration. Diagrams are
  deliberately plain: boxes and arrows.
</p>

{#if status === 'error'}
  <div class="philo-err">Diagram render failed: {errMsg}</div>
{/if}

<div class="philo-grid">
  {#each principles as p, i}
    <article class="philo-card">
      <header class="philo-head">
        <span class="philo-num">{p.n}</span>
        <h3>{p.title}</h3>
      </header>
      <p class="philo-body">{p.body}</p>
      <div class="philo-diagram" bind:this={hosts[i]}>
        {#if status === 'loading'}<span class="philo-loading">rendering diagram…</span>{/if}
      </div>
      <div class="philo-cite">{p.cites}</div>
    </article>
  {/each}
</div>

<style>
  .section-intro {
    max-width: 46rem;
    margin-bottom: 2rem;
    color: #555;
  }
  .philo-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
    gap: 1.1rem;
  }
  .philo-card {
    display: flex;
    flex-direction: column;
    padding: 1.3rem 1.3rem 1rem;
    background: #fff;
    border: 1px solid #e7e7e7;
    border-radius: 14px;
    transition: box-shadow 0.2s ease, border-color 0.2s ease;
  }
  .philo-card:hover {
    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.06);
    border-color: #d8d8d8;
  }
  .philo-head {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin-bottom: 0.55rem;
  }
  .philo-num {
    font-size: 0.66rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    color: #cc2222;
    padding-top: 0.05rem;
  }
  .philo-head h3 {
    margin: 0;
    font-size: 1.02rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: #1a1a1a;
  }
  .philo-body {
    margin: 0 0 1rem;
    font-size: 0.88rem;
    line-height: 1.5;
    color: #555;
  }
  .philo-diagram {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 120px;
    margin-top: auto;
    padding: 0.6rem;
    background: #fbfcfe;
    border: 1px solid #eef1f5;
    border-radius: 10px;
    overflow-x: auto;
  }
  .philo-diagram :global(svg) {
    display: block;
    max-width: 100%;
    height: auto;
  }
  .philo-loading {
    font-size: 0.76rem;
    color: #94a3b8;
  }
  .philo-cite {
    margin-top: 0.7rem;
    font-size: 0.68rem;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    color: #94a3b8;
    word-break: break-word;
  }
  .philo-err {
    margin-bottom: 1rem;
    padding: 0.7rem 0.9rem;
    font-size: 0.8rem;
    color: #b91c1c;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 10px;
  }
</style>
