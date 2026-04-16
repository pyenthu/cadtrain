<script lang="ts">
  interface TestEntry {
    id: string;
    title: string;
    description: string;
    source: string;
    video: string;
    poster: string | null;
    recorded: string | null;
    status: 'pass' | 'fail' | 'never_run';
    cases: number;
  }

  let tests = $state<TestEntry[]>([]);
  let selectedId = $state<string | null>(null);
  let cacheStats = $state<any>(null);
  let loadError = $state<string | null>(null);

  async function loadManifest() {
    try {
      const r = await fetch('/tests/manifest.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(`manifest.json ${r.status}`);
      const data = await r.json();
      tests = data.tests ?? [];
      if (tests.length > 0 && !selectedId) selectedId = tests[0].id;
    } catch (e: any) {
      loadError = e?.message ?? String(e);
    }
  }

  async function loadStats() {
    try {
      const r = await fetch('/api/cache/stats');
      cacheStats = await r.json();
    } catch (e) {}
  }

  $effect(() => {
    loadManifest();
    loadStats();
  });

  let current = $derived(tests.find(t => t.id === selectedId) ?? null);

  function statusLabel(s: TestEntry['status']): string {
    return s === 'pass' ? '✓ pass' : s === 'fail' ? '✗ fail' : '— never run';
  }

  function statusClass(s: TestEntry['status']): string {
    return s === 'pass' ? 'pass' : s === 'fail' ? 'fail' : 'never';
  }

  function prettyDate(iso: string | null): string {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch { return iso; }
  }
</script>

<div class="layout">
  <main class="content">
    <div class="header">
      <h1>Tests & Recordings</h1>
      <p>Playwright test runs recorded to WEBM. Select a test from the navigator on the right.</p>
    </div>

    {#if loadError}
      <div class="err">Failed to load manifest: {loadError}</div>
    {/if}

    {#if current}
      <section class="test-section">
        <div class="test-head">
          <h2>{current.title}</h2>
          <span class="status {statusClass(current.status)}">{statusLabel(current.status)}</span>
        </div>
        <p class="test-desc">{current.description}</p>
        <div class="meta-row">
          <span><strong>Source:</strong> <code>{current.source}</code></span>
          <span><strong>Cases:</strong> {current.cases}</span>
          <span><strong>Recorded:</strong> {prettyDate(current.recorded)}</span>
        </div>
        <div class="video-wrap">
          {#if current.recorded}
            <video
              controls
              preload="metadata"
              poster={current.poster ?? undefined}
              src={current.video}
            >
              Your browser doesn't support the video tag.
            </video>
          {:else}
            <div class="no-recording">
              <p>No recording yet for this test.</p>
              <p class="hint">Run <code>python {current.source} --record-video</code> to produce <code>{current.video}</code>.</p>
            </div>
          {/if}
        </div>
      </section>
    {:else if !loadError}
      <div class="empty">No tests in manifest. Add an entry to <code>static/tests/manifest.json</code>.</div>
    {/if}

    <section class="stats-section">
      <h2>Cache Stats</h2>
      {#if cacheStats}
        <div class="stats-grid">
          <div class="stat"><strong>{cacheStats.total}</strong><span>Total records</span></div>
          <div class="stat"><strong>{cacheStats.bySource?.seed || 0}</strong><span>Seed</span></div>
          <div class="stat"><strong>{cacheStats.bySource?.refined || 0}</strong><span>Refined</span></div>
          <div class="stat"><strong>{cacheStats.bySource?.manual || 0}</strong><span>Manual</span></div>
          <div class="stat"><strong>{cacheStats.bySource?.catalog || 0}</strong><span>Catalog</span></div>
          <div class="stat"><strong>{cacheStats.totalUses}</strong><span>Total uses</span></div>
        </div>
        <button class="refresh-btn" onclick={loadStats}>Refresh</button>
      {:else}
        <div class="empty-stats">Loading…</div>
      {/if}
    </section>
  </main>

  <aside class="navigator">
    <div class="nav-head">
      <span>Tests</span>
      <span class="count">{tests.length}</span>
    </div>
    {#each tests as t}
      <button
        class="nav-item"
        class:active={t.id === selectedId}
        onclick={() => selectedId = t.id}
      >
        <span class="nav-title">{t.title}</span>
        <span class="nav-sub">
          <span class="status-dot {statusClass(t.status)}"></span>
          {t.cases} cases
        </span>
      </button>
    {/each}
    {#if tests.length === 0}
      <div class="nav-empty">No tests registered.</div>
    {/if}
  </aside>
</div>

<style>
  .layout { display: flex; height: 100%; font-family: Arial, sans-serif; background: #fafafa; }
  .content { flex: 1; overflow-y: auto; padding: 32px; min-width: 0; }
  .header { margin-bottom: 24px; }
  .header h1 { margin: 0 0 6px; font-size: 22px; color: #333; }
  .header p { margin: 0; color: #888; font-size: 13px; }

  .test-section, .stats-section { background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
  .test-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .test-head h2 { margin: 0; font-size: 16px; color: #333; }
  .status { font: bold 11px Arial; padding: 3px 10px; border-radius: 12px; }
  .status.pass { background: #d4edda; color: #155724; }
  .status.fail { background: #f8d7da; color: #721c24; }
  .status.never { background: #e9ecef; color: #6c757d; }
  .test-desc { color: #555; font-size: 12px; line-height: 1.6; margin: 0 0 10px; }
  .meta-row { display: flex; gap: 16px; font-size: 11px; color: #666; margin-bottom: 12px; flex-wrap: wrap; }
  .meta-row code { background: #f0f0f0; padding: 1px 6px; border-radius: 3px; font: 10px monospace; }
  .video-wrap { background: #000; border-radius: 4px; overflow: hidden; display: flex; justify-content: center; align-items: center; min-height: 300px; }
  .video-wrap video { width: 100%; max-height: 600px; display: block; }
  .no-recording { color: #888; text-align: center; padding: 40px 20px; }
  .no-recording p { margin: 0 0 6px; font-size: 13px; color: #ccc; }
  .no-recording .hint { font-size: 11px; color: #999; }
  .no-recording code { background: #222; color: #ddd; padding: 2px 6px; border-radius: 3px; font: 10px monospace; }

  .stats-section h2 { margin: 0 0 12px; font-size: 16px; color: #333; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; margin-bottom: 12px; }
  .stat { background: #f5f5f5; padding: 12px; border-radius: 6px; text-align: center; }
  .stat strong { display: block; font-size: 20px; color: #cc2222; font-weight: bold; }
  .stat span { font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
  .refresh-btn { padding: 5px 14px; background: #16213e; color: white; border: none; border-radius: 4px; font-size: 11px; cursor: pointer; }
  .refresh-btn:hover { background: #1e3556; }

  .err { background: #f8d7da; color: #721c24; padding: 10px 14px; border-radius: 6px; font-size: 12px; margin-bottom: 16px; }
  .empty, .empty-stats { color: #888; font-size: 13px; text-align: center; padding: 20px; }
  .empty code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font: 11px monospace; }

  .navigator {
    width: 260px;
    min-width: 260px;
    background: white;
    border-left: 1px solid #e0e0e0;
    padding: 16px 10px;
    overflow-y: auto;
  }
  .nav-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 0 8px 10px;
    border-bottom: 1px solid #eee;
    margin-bottom: 8px;
    font: bold 11px Arial;
    color: #16213e;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .nav-head .count { font-size: 10px; color: #999; font-weight: normal; }
  .nav-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    width: 100%;
    text-align: left;
    padding: 10px 12px;
    margin-bottom: 2px;
    border: none;
    background: none;
    border-radius: 4px;
    cursor: pointer;
  }
  .nav-item:hover { background: #f5f5f5; }
  .nav-item.active { background: #16213e; }
  .nav-item.active .nav-title { color: white; }
  .nav-item.active .nav-sub { color: #aec0d9; }
  .nav-title { font: bold 13px Arial; color: #333; line-height: 1.3; }
  .nav-sub { font: 10px Arial; color: #888; display: flex; align-items: center; gap: 6px; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .status-dot.pass { background: #28a745; }
  .status-dot.fail { background: #dc3545; }
  .status-dot.never { background: #adb5bd; }
  .nav-empty { padding: 20px; text-align: center; font-size: 11px; color: #aaa; }
</style>
