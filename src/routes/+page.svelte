<script lang="ts">
  /**
   * / — CAD Train landing.
   *
   * Restyled to read in the same visual language as the sibling "Meshing"
   * app (localhost:5173): a big top-left hero title + red pipeline tagline +
   * muted lede, then the app's real routes grouped into pipeline "families".
   * Each family is a colored-dot section header (name · LABEL · one-liner)
   * over a responsive grid of cards; each card has a colored left border, a
   * glyph, a title, a status badge, and a one-line description. Cards link to
   * the real routes — no invented content.
   *
   * SSR is globally off (src/+layout.ts: ssr = false). Pure markup + scoped
   * styles, no deps.
   */

  type Status = 'live' | 'wip' | null;
  type Card = {
    title: string;
    href: string;
    icon: string;
    desc: string;
    status?: Status;
    featured?: boolean;
  };
  type Family = {
    name: string;
    accent: string; // dot + left-border + label colour
    tint: string; // featured-card wash
    label: string; // small caps label, e.g. "0 · CAD EDITOR"
    blurb: string; // one-line section description
    hub?: { href: string; text: string };
    cards: Card[];
  };

  const families: Family[] = [
    {
      name: 'Editors',
      accent: '#6d5bd0',
      tint: '#f3f1fc',
      label: '0 · CAD KERNEL',
      blurb: 'Compose a part as a node graph, bake it with a real CSG kernel.',
      cards: [
        {
          title: 'Graph editor',
          href: '/graph-editor',
          icon: '◈',
          desc: 'The node-graph CAD editor, full-screen — wire moves, rotations, repeats and polygon profiles.',
          status: 'live',
          featured: true,
        },
        {
          title: 'Primitives',
          href: '/primitives',
          icon: '⬡',
          desc: 'Parts library sidebar + multi-tab editor over the typed parts on the volume.',
          status: 'live',
        },
        {
          title: 'Vocabulary',
          href: '/vocab',
          icon: '✨',
          desc: 'Generative authoring — RAG-then-translate against the parts vocabulary.',
          status: 'live',
        },
      ],
    },
    {
      name: 'Domain',
      accent: '#2b7bd6',
      tint: '#eef5fd',
      label: '1 · DOWNHOLE',
      blurb: 'Apply the parts to real downhole-tool geometry.',
      cards: [
        {
          title: 'Wells',
          href: '/wells',
          icon: '⛰',
          desc: '3D-first well schematic — WSON → interactive 3D well diagram.',
          status: 'wip',
        },
      ],
    },
    {
      name: 'Data',
      accent: '#1f9e8a',
      tint: '#ecf8f5',
      label: '2 · STORE',
      blurb: 'The persistent volume behind every part and bake.',
      cards: [
        {
          title: 'Volume',
          href: '/volume',
          icon: '⛁',
          desc: 'File manager for the persistent data volume — parts, profiles, caches.',
          status: 'live',
        },
      ],
    },
    {
      name: 'Meta',
      accent: '#64748b',
      tint: '#f3f4f6',
      label: 'MAPS & DOCS',
      blurb: 'How the app is structured and where it’s going.',
      cards: [
        {
          title: 'Plan',
          href: '/plan',
          icon: '▤',
          desc: 'Interactive Gantt roadmap — the single source of truth for the build.',
        },
        {
          title: 'Design overview',
          href: '/design',
          icon: '⬗',
          desc: 'Interactive architecture graph + the story of how CAD Train fits together.',
        },
        {
          title: 'Research',
          href: '/research',
          icon: '◰',
          desc: 'Parked notes, findings and backend evaluations.',
        },
      ],
    },
  ];
</script>

<svelte:head>
  <title>CAD Train</title>
  <meta
    name="description"
    content="CAD Train — a parametric 3D CAD pipeline for downhole-tool components, built on SvelteKit, ManifoldCAD and Threlte."
  />
</svelte:head>

<main class="home">
  <!-- ───────────── Hero ───────────── -->
  <header class="hero">
    <h1 class="title">CAD&nbsp;Train</h1>
    <p class="tagline">describe a part → wire a graph → bake the geometry</p>
    <p class="lede">
      A parametric 3D CAD pipeline for downhole-tool components — a visual
      node-graph editor over a typed parts library, baked with a real CSG kernel
      (ManifoldCAD) and rendered live in the browser. Start anywhere below.
    </p>
    <div class="badges">
      <span class="badge">SvelteKit</span>
      <span class="badge">ManifoldCAD</span>
      <span class="badge">Threlte</span>
      <span class="badge">Bun</span>
    </div>
  </header>

  <!-- ───────────── Families ───────────── -->
  {#each families as fam}
    <section class="family" style="--accent:{fam.accent}; --tint:{fam.tint};">
      <div class="fam-head">
        <span class="dot" aria-hidden="true"></span>
        <h2 class="fam-name">{fam.name}</h2>
        <span class="fam-label">{fam.label}</span>
        <span class="fam-blurb">{fam.blurb}</span>
        {#if fam.hub}
          <a class="fam-hub" href={fam.hub.href}>{fam.hub.text} →</a>
        {/if}
      </div>
      <div class="rule"></div>

      <div class="cards">
        {#each fam.cards as c}
          <a class="card" class:featured={c.featured} href={c.href}>
            <span class="card-icon" aria-hidden="true">{c.icon}</span>
            <div class="card-body">
              <div class="card-titlerow">
                <span class="card-title">{c.title}</span>
                {#if c.featured}<span class="star" aria-hidden="true">★</span>{/if}
                {#if c.status === 'live'}
                  <span class="badge-status live">✓ LIVE</span>
                {:else if c.status === 'wip'}
                  <span class="badge-status wip">WIP</span>
                {/if}
              </div>
              <p class="card-desc">{c.desc}</p>
            </div>
          </a>
        {/each}
      </div>
    </section>
  {/each}

  <!-- ───────────── Footer ───────────── -->
  <footer class="foot">
    <span class="foot-mark">CAD&nbsp;Train</span>
    <span class="foot-sub"
      >Parametric downhole-tool CAD · SvelteKit · ManifoldCAD · Threlte · Bun</span
    >
  </footer>
</main>

<style>
  .home {
    --ink: #1a1a1a;
    --ink-soft: #555;
    --ink-faint: #8a8a8a;
    --line: #e7e7e7;
    --paper: #ffffff;
    --paper-alt: #fafafa;
    --accent-red: #cc2222;

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
  .home *,
  .home *::before,
  .home *::after {
    box-sizing: border-box;
  }

  /* ───────── Hero ───────── */
  .hero {
    padding: clamp(3rem, 8vw, 6rem) clamp(1.25rem, 6vw, 7rem)
      clamp(2rem, 4vw, 3rem);
  }
  .title {
    margin: 0;
    font-size: clamp(2.6rem, 8vw, 5rem);
    font-weight: 800;
    letter-spacing: -0.04em;
    line-height: 0.98;
  }
  .tagline {
    margin: 0.7rem 0 0;
    font-size: clamp(1rem, 2.4vw, 1.45rem);
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--accent-red);
  }
  .lede {
    margin: 1rem 0 0;
    font-size: 1.02rem;
    color: var(--ink-soft);
    max-width: 44rem;
  }
  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
    margin-top: 1.6rem;
  }
  .badge {
    font-size: 0.78rem;
    font-weight: 600;
    padding: 0.32rem 0.8rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--paper-alt);
    color: var(--ink-soft);
  }

  /* ───────── Family section ───────── */
  .family {
    padding: 0 clamp(1.25rem, 6vw, 7rem);
    margin-bottom: clamp(1.6rem, 3.5vw, 2.6rem);
  }
  .fam-head {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.7rem;
  }
  .dot {
    align-self: center;
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 999px;
    background: var(--accent);
    flex: none;
  }
  .fam-name {
    margin: 0;
    font-size: 1.35rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--ink);
  }
  .fam-label {
    font-size: 0.74rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .fam-blurb {
    font-size: 0.95rem;
    color: var(--ink-faint);
  }
  .fam-hub {
    margin-left: auto;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--accent);
    text-decoration: none;
  }
  .fam-hub:hover {
    text-decoration: underline;
  }
  .rule {
    height: 1px;
    background: var(--line);
    margin: 0.7rem 0 1.1rem;
  }

  /* ───────── Cards ───────── */
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
    gap: 0.9rem;
  }
  .card {
    display: flex;
    gap: 0.85rem;
    padding: 0.95rem 1.05rem;
    background: var(--paper);
    border: 1px solid var(--line);
    border-left: 4px solid var(--accent);
    border-radius: 10px;
    text-decoration: none;
    color: inherit;
    transition: transform 0.18s ease, box-shadow 0.18s ease,
      border-color 0.18s ease;
  }
  .card:hover {
    transform: translateY(-3px);
    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.07);
  }
  .card.featured {
    background: var(--tint);
  }
  .card-icon {
    font-size: 1.35rem;
    line-height: 1.4;
    color: var(--accent);
    flex: none;
  }
  .card-body {
    min-width: 0;
  }
  .card-titlerow {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
  }
  .card-title {
    font-size: 1.02rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--ink);
  }
  .star {
    color: var(--accent-red);
    font-size: 0.8rem;
  }
  .badge-status {
    font-size: 0.64rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 0.12rem 0.42rem;
    border-radius: 999px;
  }
  .badge-status.live {
    color: #1f8a3b;
    background: #e7f6ec;
    border: 1px solid #c4e9cf;
  }
  .badge-status.wip {
    color: #b2710c;
    background: #fdf3e2;
    border: 1px solid #f3ddb3;
  }
  .card-desc {
    margin: 0.3rem 0 0;
    font-size: 0.88rem;
    color: var(--ink-soft);
    line-height: 1.5;
  }

  /* ───────── Footer ───────── */
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem 0.9rem;
    padding: clamp(2rem, 5vw, 3.5rem) clamp(1.25rem, 6vw, 7rem)
      clamp(2.5rem, 6vw, 4rem);
    border-top: 1px solid var(--line);
    margin-top: 1rem;
  }
  .foot-mark {
    font-size: 1rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--ink);
  }
  .foot-sub {
    font-size: 0.82rem;
    color: var(--ink-faint);
  }

  @media (prefers-reduced-motion: reduce) {
    .home * {
      transition: none !important;
    }
  }
</style>
