<script lang="ts">
  import { marked } from 'marked';
  import { docs, categories } from './docs';

  marked.setOptions({ gfm: true, breaks: false });

  // Docs grouped by category, in the category order from docs.ts.
  const byCategory = categories.map((cat) => ({
    cat,
    items: docs.filter((d) => d.category === cat),
  }));

  // Default-select the first doc of the first category (Node editors first).
  const firstCat = categories[0];
  let activeSlug = $state((docs.find((d) => d.category === firstCat) ?? docs[0])?.slug ?? '');
  const active = $derived(docs.find((d) => d.slug === activeSlug) ?? docs[0]);
  const html = $derived(active ? marked.parse(active.body) : '');
</script>

<div class="research">
  <div class="topbar">
    <a href="/" class="back">← Home</a>
    <span class="title">Research</span>
    <span class="sub">node-editor study · parked notes · findings</span>
  </div>

  <!-- Tab rail: one tab per research topic, clustered by category. -->
  <div class="tabrail">
    {#each byCategory as group (group.cat)}
      {#if group.items.length}
        <div class="tabcluster">
          <span class="cluster-label">{group.cat}</span>
          {#each group.items as doc (doc.slug)}
            <button
              class="tab"
              class:on={doc.slug === activeSlug}
              title={doc.excerpt}
              onclick={() => (activeSlug = doc.slug)}>{doc.title.replace(/ —.*$/, '')}</button>
          {/each}
        </div>
      {/if}
    {/each}
  </div>

  {#if active}
    <article class="prose">{@html html}</article>
  {:else}
    <div class="empty">No research docs found.</div>
  {/if}
</div>

<style>
  .research {
    height: 100%;
    background: #1a1a2e;
    color: #eee;
    overflow-y: auto;
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
  }
  .back { color: #cc4444; text-decoration: none; font-size: 12px; font-weight: 700; }
  .back:hover { color: #ff6666; }
  .title { font-size: 13px; font-weight: 700; color: #cc2222; letter-spacing: 0.5px; text-transform: uppercase; }
  .sub { font-size: 11px; color: #667; }

  .tabrail {
    position: sticky;
    top: 39px;
    z-index: 9;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    align-items: center;
    background: #182039;
    border-bottom: 1px solid #2a2f4a;
    padding: 8px 14px;
  }
  .tabcluster { display: flex; align-items: center; gap: 6px; }
  .cluster-label {
    font-size: 9px; font-weight: 700; color: #6677aa;
    letter-spacing: 0.5px; text-transform: uppercase; margin-right: 2px;
  }
  .tab {
    font: 600 12px/1 inherit;
    color: #aab;
    background: #1f2a52;
    border: 1px solid #2a3358;
    border-radius: 6px;
    padding: 6px 10px;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }
  .tab:hover { background: #26356a; color: #fff; }
  .tab.on { background: #cc2222; border-color: #cc2222; color: #fff; }

  .prose {
    max-width: 860px;
    margin: 0 auto;
    padding: 28px 24px 80px;
    line-height: 1.6;
    font-size: 14px;
  }
  .empty { padding: 16px; font-size: 13px; color: #777; }

  /* Markdown styling — dark, consistent with the [slug] viewer + landing. */
  .prose :global(h1),
  .prose :global(h2),
  .prose :global(h3),
  .prose :global(h4) { color: #fff; line-height: 1.3; margin: 1.4em 0 0.5em; }
  .prose :global(h1) { font-size: 24px; color: #cc4444; border-bottom: 1px solid #2a2f4a; padding-bottom: 8px; }
  .prose :global(h2) { font-size: 19px; }
  .prose :global(h3) { font-size: 16px; }
  .prose :global(h4) { font-size: 14px; color: #ddd; }
  .prose :global(p) { margin: 0.7em 0; }
  .prose :global(a) { color: #6aa3ff; text-decoration: none; }
  .prose :global(a:hover) { text-decoration: underline; }
  .prose :global(ul), .prose :global(ol) { padding-left: 1.4em; margin: 0.6em 0; }
  .prose :global(li) { margin: 0.25em 0; }
  .prose :global(blockquote) { border-left: 3px solid #2a3f6a; margin: 0.8em 0; padding: 0.1em 0 0.1em 14px; color: #aab; }
  .prose :global(code) { background: #16213e; border: 1px solid #2a2f4a; border-radius: 4px; padding: 1px 5px; font-size: 12.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .prose :global(pre) { background: #16213e; border: 1px solid #2a2f4a; border-radius: 6px; padding: 12px 14px; overflow-x: auto; margin: 0.9em 0; }
  .prose :global(pre code) { background: none; border: none; padding: 0; font-size: 12.5px; }
  .prose :global(table) { border-collapse: collapse; margin: 0.9em 0; width: 100%; font-size: 13px; }
  .prose :global(th), .prose :global(td) { border: 1px solid #2a2f4a; padding: 6px 10px; text-align: left; }
  .prose :global(th) { background: #1b2845; color: #fff; }
  .prose :global(hr) { border: none; border-top: 1px solid #2a2f4a; margin: 1.6em 0; }
  .prose :global(img) { max-width: 100%; }
</style>
