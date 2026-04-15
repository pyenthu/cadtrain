<script lang="ts">
  let cacheStats = $state<any>(null);

  async function loadStats() {
    try {
      const r = await fetch('/api/cache/stats');
      cacheStats = await r.json();
    } catch (e) {}
  }

  $effect(() => { loadStats(); });
</script>

<div class="tests-page">
  <div class="header">
    <h1>Tests & Demos</h1>
    <p>Visual recordings and cache inspection.</p>
  </div>

  <div class="section">
    <h2>RAG Identification Pipeline</h2>
    <p>This recording shows the full identify → save flow with three test cases (Hollow Cylinder, Slip Assembly, Setting Cone). Each test uploads a variation, triggers retrieval-augmented identification, and saves the result to the persistent training cache.</p>
    <div class="gif-wrap">
      <img src="/tmp/rag.gif" alt="RAG test recording" />
    </div>
    <div class="caption">
      Source: <code>tests/test_rag_with_gif.py</code> • Rerun to refresh
    </div>
  </div>

  <div class="section">
    <h2>Cache Stats</h2>
    {#if cacheStats}
      <div class="stats-grid">
        <div class="stat"><strong>{cacheStats.total}</strong><span>Total records</span></div>
        <div class="stat"><strong>{cacheStats.bySource?.seed || 0}</strong><span>Seed</span></div>
        <div class="stat"><strong>{cacheStats.bySource?.refined || 0}</strong><span>Refined</span></div>
        <div class="stat"><strong>{cacheStats.bySource?.manual || 0}</strong><span>Manual</span></div>
        <div class="stat"><strong>{cacheStats.totalUses}</strong><span>Total uses</span></div>
        <div class="stat"><strong>{cacheStats.avgUses?.toFixed(2) || 0}</strong><span>Avg uses</span></div>
      </div>
      <button class="refresh-btn" onclick={loadStats}>Refresh</button>
    {:else}
      <div class="empty">Loading...</div>
    {/if}
  </div>
</div>

<style>
  .tests-page { padding: 32px; max-width: 1000px; margin: 0 auto; overflow-y: auto; height: 100%; background: #fafafa; }
  .header { margin-bottom: 32px; }
  .header h1 { margin: 0 0 8px; font-size: 24px; color: #333; }
  .header p { margin: 0; color: #888; font-size: 14px; }
  .section { background: white; border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin-bottom: 24px; }
  .section h2 { margin: 0 0 8px; font-size: 16px; color: #333; }
  .section p { color: #666; font-size: 12px; line-height: 1.6; margin: 0 0 16px; }
  .gif-wrap { display: flex; justify-content: center; background: #fff; border: 1px solid #eee; border-radius: 4px; padding: 8px; }
  .gif-wrap img { max-width: 100%; height: auto; }
  .caption { margin-top: 12px; font-size: 11px; color: #888; text-align: center; }
  .caption code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 12px; }
  .stat { background: #f5f5f5; padding: 12px; border-radius: 6px; text-align: center; }
  .stat strong { display: block; font-size: 22px; color: #cc2222; font-weight: bold; }
  .stat span { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
  .refresh-btn { padding: 6px 16px; background: #16213e; color: white; border: none; border-radius: 4px; font-size: 11px; cursor: pointer; }
  .refresh-btn:hover { background: #1e3556; }
  .empty { color: #888; font-size: 12px; padding: 20px; text-align: center; }
</style>
