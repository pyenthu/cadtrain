<script lang="ts">
  // KB index — landing page that lists every KB advertised in
  // /kb/index.json. Click a card → opens the table viewer at /kb/[id].
  // Adding a new KB JSON to static/kb/api/ + an entry in index.json makes
  // it appear here automatically; no code change needed.
  import { onMount } from 'svelte';

  interface KbEntry {
    id: string;
    path: string;
    title: string;
    description: string;
    categories: string[];
    row_count: number;
    source_kind: string;
    default_columns?: string[];
  }

  let kbs = $state<KbEntry[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      const r = await fetch('/kb/index.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const data = await r.json();
      kbs = data.kbs ?? [];
    } catch (e: any) {
      error = e?.message ?? String(e);
    } finally {
      loading = false;
    }
  });
</script>

<div class="page">
  <div class="hdr">
    <h1>Knowledge Base</h1>
    <p class="sub">Reference data for constrained parametrization. Each KB lists vendor / operator specs that downstream design code (Bundle H — /author Variables tab) can wire into derived parameters by column.</p>
  </div>

  {#if loading}
    <div class="empty">Loading…</div>
  {:else if error}
    <div class="err">{error}</div>
  {:else if kbs.length === 0}
    <div class="empty">No KBs yet. Drop a JSON in <code>static/kb/</code> and register it in <code>static/kb/index.json</code>.</div>
  {:else}
    <div class="grid">
      {#each kbs as kb (kb.id)}
        <a class="card" href="/kb/{kb.id}">
          <div class="card-title">{kb.title}</div>
          <div class="card-desc">{kb.description}</div>
          <div class="card-meta">
            <span class="rows">{kb.row_count.toLocaleString()} rows</span>
            <span class="kind">{kb.source_kind.replace(/_/g, ' ')}</span>
          </div>
          {#if kb.categories?.length}
            <div class="tags">
              {#each kb.categories.slice(0, 6) as t}<span class="tag">{t}</span>{/each}
            </div>
          {/if}
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .page { padding: 24px 32px; font-family: Arial, sans-serif; height: 100%; overflow-y: auto; box-sizing: border-box; }
  .hdr h1 { margin: 0 0 4px; font-size: 22px; color: #cc2222; }
  .sub { margin: 0 0 24px; font-size: 13px; color: #666; max-width: 680px; line-height: 1.5; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
  .card {
    display: block; text-decoration: none; color: inherit;
    background: #fff; border: 1px solid #e0e0e0; border-radius: 6px;
    padding: 14px 16px; transition: border-color 100ms, background 100ms;
  }
  .card:hover { background: #fafafa; border-color: #cc2222; }
  .card-title { font: bold 14px Arial; color: #222; margin-bottom: 4px; }
  .card-desc { font: 11px Arial; color: #555; line-height: 1.5; margin-bottom: 8px; }
  .card-meta { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
  .rows { font: bold 11px monospace; color: #cc2222; }
  .kind { font: 10px Arial; color: #888; }
  .tags { display: flex; gap: 4px; flex-wrap: wrap; }
  .tag { font: 9px Arial; color: #555; background: #f0f0f0; padding: 2px 6px; border-radius: 9px; }
  .empty { font: 12px Arial; color: #888; padding: 40px; text-align: center; }
  .err { font: 11px monospace; color: #721c24; background: #f8d7da; padding: 12px; border-radius: 4px; }
</style>
