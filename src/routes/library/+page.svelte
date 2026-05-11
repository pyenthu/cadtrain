<script lang="ts">
  interface IndexEntry {
    id: string;
    name: string;
    description: string;
    tags: string[];
    created: string;
    source: 'manual' | 'claude_suggested' | 'claude_refined';
    parts_count: number;
    ops_count: number;
    has_thumbnail: boolean;
  }

  let records = $state<IndexEntry[]>([]);
  let loadError = $state<string | null>(null);
  let loading = $state(true);

  async function loadIndex() {
    loading = true;
    loadError = null;
    try {
      const r = await fetch('/api/author/list', { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const data = await r.json();
      records = data.records ?? [];
    } catch (e: any) {
      loadError = e?.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => { loadIndex(); });

  function openInEditor(id: string) {
    window.location.href = `/author?id=${encodeURIComponent(id)}`;
  }

  function prettyDate(iso: string): string {
    try { return new Date(iso).toLocaleString(); }
    catch { return iso; }
  }
</script>

<div class="library">
  <div class="header">
    <h1>Authored Library</h1>
    <p>Components you've built from primitives. Click one to open it in the author.</p>
    <div class="actions">
      <a class="btn primary" href="/author">+ New Component</a>
      <button class="btn" onclick={loadIndex}>Refresh</button>
    </div>
  </div>

  {#if loading}
    <div class="state">Loading…</div>
  {:else if loadError}
    <div class="err">Failed to load: {loadError}</div>
  {:else if records.length === 0}
    <div class="empty">
      <p>No authored components yet.</p>
      <p class="hint">Open the <a href="/author">author</a>, compose something from the 18 primitives, and click Save.</p>
    </div>
  {:else}
    <div class="grid">
      {#each records as rec}
        <button class="card" onclick={() => openInEditor(rec.id)}>
          <div class="card-head">
            <span class="card-name">{rec.name}</span>
            <span class="badge {rec.source}">{rec.source.replace('_', ' ')}</span>
          </div>
          <div class="card-id">{rec.id}</div>
          {#if rec.description}
            <div class="card-desc">{rec.description}</div>
          {/if}
          <div class="card-meta">
            <span>{rec.parts_count} parts</span>
            <span>{rec.ops_count} ops</span>
            <span>{prettyDate(rec.created)}</span>
          </div>
          {#if rec.tags.length > 0}
            <div class="card-tags">
              {#each rec.tags as tag}<span class="tag">{tag}</span>{/each}
            </div>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .library { padding: 32px; max-width: 1200px; margin: 0 auto; height: 100%; overflow-y: auto; font-family: Arial, sans-serif; background: #fafafa; }
  .header { margin-bottom: 24px; }
  .header h1 { margin: 0 0 6px; font-size: 22px; color: #333; }
  .header p { margin: 0 0 12px; color: #888; font-size: 13px; }
  .actions { display: flex; gap: 8px; }
  .btn { padding: 6px 14px; background: #eee; color: #333; border: 1px solid #ddd; border-radius: 4px; font: 12px Arial; cursor: pointer; text-decoration: none; display: inline-block; }
  .btn:hover { background: #e0e0e0; }
  .btn.primary { background: #cc2222; color: white; border-color: #cc2222; }
  .btn.primary:hover { background: #a51818; }

  .state, .empty, .err { background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 40px 20px; text-align: center; color: #888; font-size: 13px; }
  .err { background: #f8d7da; color: #721c24; border-color: #f5c6cb; }
  .empty p { margin: 0 0 6px; }
  .hint { font-size: 11px; color: #aaa; }
  .hint a { color: #cc2222; }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
  .card { text-align: left; background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; cursor: pointer; font-family: inherit; transition: border-color 0.15s, transform 0.15s; }
  .card:hover { border-color: #cc2222; transform: translateY(-1px); }
  .card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; gap: 8px; }
  .card-name { font: bold 14px Arial; color: #333; }
  .badge { font: 9px Arial; padding: 2px 8px; border-radius: 10px; background: #f0f0f0; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
  .badge.manual { background: #d1e7dd; color: #0f5132; }
  .badge.claude_suggested { background: #cff4fc; color: #055160; }
  .badge.claude_refined { background: #fff3cd; color: #664d03; }
  .card-id { font: 10px monospace; color: #999; margin-bottom: 8px; }
  .card-desc { font: 12px Arial; color: #666; line-height: 1.5; margin-bottom: 10px; }
  .card-meta { display: flex; gap: 12px; font: 10px Arial; color: #888; margin-bottom: 8px; }
  .card-tags { display: flex; gap: 4px; flex-wrap: wrap; }
  .tag { font: 10px Arial; background: #f0f0f0; color: #555; padding: 2px 8px; border-radius: 10px; }
</style>
