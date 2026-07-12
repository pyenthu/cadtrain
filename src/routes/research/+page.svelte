<script lang="ts">
  import {
    docs,
    categories,
    categoryAbstracts,
    sortByRecent,
    sortByPriority,
    sortByTitle,
    type Doc,
    type SortMode,
  } from './docs';

  const ALL = '__all__';

  let activeCategory = $state(ALL);
  let sortMode = $state<SortMode>('category');

  const counts = $derived.by(() => {
    const m = new Map<string, number>();
    for (const d of docs) m.set(d.category, (m.get(d.category) ?? 0) + 1);
    return m;
  });

  // Docs in scope for the current LEFT-rail selection (all, or one category).
  const scoped = $derived(
    activeCategory === ALL ? docs : docs.filter((d) => d.category === activeCategory)
  );

  // "By category" groups the scoped set back out per-category (so "All" still
  // reads as N labelled sections, and a single category reads as one).
  const grouped = $derived(
    categories
      .filter((cat) => activeCategory === ALL || cat === activeCategory)
      .map((cat) => ({ cat, items: scoped.filter((d) => d.category === cat) }))
      .filter((g) => g.items.length)
  );

  const flat = $derived.by((): Doc[] => {
    if (sortMode === 'recent') return sortByRecent(scoped);
    if (sortMode === 'priority') return sortByPriority(scoped);
    if (sortMode === 'az') return sortByTitle(scoped);
    return scoped;
  });

  const abstract = $derived(activeCategory === ALL ? null : categoryAbstracts[activeCategory] ?? null);

  function priorityLabel(p: number): string {
    return `P${Math.min(5, Math.max(1, Math.round(p)))}`;
  }
</script>

<div class="research">
  <div class="topbar">
    <a href="/" class="back">← Home</a>
    <span class="title">Research</span>
    <span class="sub">geometry kernels · local AI · graph interface · wells · architecture</span>
  </div>

  <div class="viewbar">
    <button class="seg" class:on={sortMode === 'category'} onclick={() => (sortMode = 'category')}>By category</button>
    <button class="seg" class:on={sortMode === 'recent'} onclick={() => (sortMode = 'recent')}>Recent</button>
    <button class="seg" class:on={sortMode === 'priority'} onclick={() => (sortMode = 'priority')}>Priority</button>
    <button class="seg" class:on={sortMode === 'az'} onclick={() => (sortMode = 'az')}>A–Z</button>
  </div>

  <div class="body">
    <nav class="rail">
      <button class="rail-item" class:on={activeCategory === ALL} onclick={() => (activeCategory = ALL)}>
        <span class="rail-label">All</span>
        <span class="rail-count">{docs.length}</span>
      </button>
      {#each categories as cat (cat)}
        <button class="rail-item" class:on={activeCategory === cat} onclick={() => (activeCategory = cat)}>
          <span class="rail-label">{cat}</span>
          <span class="rail-count">{counts.get(cat) ?? 0}</span>
        </button>
      {/each}
    </nav>

    <main class="content">
      {#if sortMode === 'category'}
        {#each grouped as group (group.cat)}
          <section class="catblock">
            <h2 class="cathead">{group.cat}</h2>
            {#if categoryAbstracts[group.cat]}
              <p class="abstract">{categoryAbstracts[group.cat]}</p>
            {/if}
            <div class="cards">
              {#each group.items as doc (doc.slug)}
                <a class="card" href="/research/{doc.slug}">
                  <span class="card-title">{doc.title}</span>
                  <span class="card-excerpt">{doc.excerpt}</span>
                  <span class="card-meta">
                    <span class="badge prio-{Math.min(5, Math.max(1, doc.priority))}">{priorityLabel(doc.priority)}</span>
                    <span class="card-date">{doc.date || '—'}</span>
                  </span>
                </a>
              {/each}
            </div>
          </section>
        {/each}
      {:else}
        {#if abstract}
          <p class="abstract standalone">{abstract}</p>
        {/if}
        <div class="cards">
          {#each flat as doc (doc.slug)}
            <a class="card" href="/research/{doc.slug}">
              <span class="card-title">{doc.title}</span>
              {#if activeCategory === ALL}<span class="card-cat">{doc.category}</span>{/if}
              <span class="card-excerpt">{doc.excerpt}</span>
              <span class="card-meta">
                <span class="badge prio-{Math.min(5, Math.max(1, doc.priority))}">{priorityLabel(doc.priority)}</span>
                <span class="card-date">{doc.date || '—'}</span>
              </span>
            </a>
          {/each}
        </div>
      {/if}
      {#if docs.length === 0}
        <div class="empty">No research docs found.</div>
      {/if}
    </main>
  </div>
</div>

<style>
  .research {
    height: 100%;
    background: #1a1a2e;
    color: #eee;
    display: flex;
    flex-direction: column;
  }
  .topbar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: baseline;
    gap: 12px;
    background: #1b2845;
    border-bottom: 1px solid #2a2f4a;
    padding: 10px 16px;
    flex: none;
  }
  .back { color: #cc4444; text-decoration: none; font-size: 12px; font-weight: 700; }
  .back:hover { color: #ff6666; }
  .title { font-size: 13px; font-weight: 700; color: #cc2222; letter-spacing: 0.5px; text-transform: uppercase; }
  .sub { font-size: 11px; color: #667; }

  /* Horizontal segment control — view/sort mode. */
  .viewbar {
    display: flex;
    gap: 6px;
    align-items: center;
    background: #182039;
    border-bottom: 1px solid #2a2f4a;
    padding: 8px 16px;
    flex: none;
  }
  .seg {
    font: 700 11px/1 inherit;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    color: #aab;
    background: #1f2a52;
    border: 1px solid #2a3358;
    border-radius: 6px;
    padding: 6px 12px;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }
  .seg:hover { background: #26356a; color: #fff; }
  .seg.on { background: #cc2222; border-color: #cc2222; color: #fff; }

  .body {
    flex: 1 1 auto;
    display: flex;
    min-height: 0;
  }

  /* Vertical rail — categories. */
  .rail {
    flex: none;
    width: 190px;
    overflow-y: auto;
    border-right: 1px solid #2a2f4a;
    background: #161c34;
    padding: 10px 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .rail-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font: 600 12px/1.2 inherit;
    color: #aab;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 8px 10px;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s, color 0.1s;
  }
  .rail-item:hover { background: #1f2a52; color: #fff; }
  .rail-item.on { background: #cc2222; border-color: #cc2222; color: #fff; }
  .rail-label { flex: 1 1 auto; }
  .rail-count {
    font: 700 10px/1 inherit;
    color: inherit;
    opacity: 0.7;
    background: rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    padding: 1px 6px;
  }

  .content {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 22px 26px 60px;
  }

  .catblock { max-width: 920px; margin: 0 auto 34px; }
  .catblock:last-child { margin-bottom: 0; }
  .cathead {
    font-size: 18px;
    color: #fff;
    margin: 0 0 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid #2a2f4a;
  }

  .abstract {
    font-size: 13px;
    line-height: 1.6;
    color: #bcc3dd;
    background: #1b2340;
    border: 1px solid #2a2f4a;
    border-left: 3px solid #cc2222;
    border-radius: 6px;
    padding: 12px 14px;
    margin: 0 0 16px;
  }
  .abstract.standalone { max-width: 920px; margin: 0 auto 16px; }

  .cards {
    max-width: 920px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 10px;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: #1f2a52;
    border: 1px solid #2a3358;
    border-radius: 8px;
    padding: 12px 14px;
    text-decoration: none;
    color: inherit;
    transition: background 0.1s, border-color 0.1s;
  }
  .card:hover { background: #26356a; border-color: #3a4a8a; }
  .card-title { font: 700 13px/1.35 inherit; color: #fff; }
  .card-cat {
    align-self: flex-start;
    font: 700 9px/1 inherit;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: #8fa4d8;
  }
  .card-excerpt {
    font-size: 12px;
    line-height: 1.5;
    color: #99a2c2;
    flex: 1 1 auto;
  }
  .card-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 2px;
  }
  .card-date { font-size: 10.5px; color: #778; }

  .badge {
    font: 800 10px/1 inherit;
    letter-spacing: 0.3px;
    border-radius: 4px;
    padding: 3px 7px;
    color: #fff;
  }
  .badge.prio-1 { background: #cc2222; }
  .badge.prio-2 { background: #b3552a; }
  .badge.prio-3 { background: #8a7a1f; }
  .badge.prio-4 { background: #3a5f75; }
  .badge.prio-5 { background: #454f6e; }

  .empty { padding: 16px; font-size: 13px; color: #777; }
</style>
