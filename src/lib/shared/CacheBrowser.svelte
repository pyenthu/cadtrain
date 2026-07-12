<script lang="ts">
  /**
   * CacheBrowser — bake-cache inspector for the /primitives ⛁ Cache tab.
   *
   * Three columns of state:
   *   - header  : total size + Refresh + "Prune (20 small / 10 large)"
   *   - left    : parts (▸/▾ accordions) → hash rows
   *   - right   : DETAIL pane for the selected hash — params, options,
   *               stats, size, timestamp + a lazy 3D preview (PrimitiveSvgView
   *               fed the cached mesh-JSON from /api/cache/entry?...&mesh=1).
   *
   * Backed by:
   *   GET  /api/cache/list                       → parts + hashes + meta
   *   GET  /api/cache/entry?id=&hash=&mesh=1      → one entry's meta + mesh
   *   POST /api/cache/delete  {id,hash}|{id,prune}→ delete / size-prune
   *   POST /api/cache/clear?id=<part>            → wipe a whole part
   *
   * The bake cache is LOCAL (not proxied), so this reflects the machine the
   * dev server runs on. Chrome mirrors the /primitives vertical-rail palette.
   */
  import { onMount } from 'svelte';

  let { active = true }: { active?: boolean } = $props();

  interface HashEntry {
    hash: string;
    bytes: number;
    mtime: number;
    meta: any;
  }
  interface PartEntry {
    id: string;
    count: number;
    bytes: number;
    hashes: HashEntry[];
  }

  let loading = $state(false);
  let error = $state<string | null>(null);
  let parts = $state<PartEntry[]>([]);
  let totalBytes = $state(0);

  let openParts = $state<Record<string, boolean>>({});
  let pruning = $state(false);

  // ─── Detail (selected hash) ──────────────────────────────────────────────
  let selId = $state<string | null>(null);
  let selHash = $state<string | null>(null);
  let detailLoading = $state(false);
  let detailError = $state<string | null>(null);
  let detailMeta = $state<any>(null);
  let detailMesh = $state<any>(null);
  let detailBytes = $state(0);
  let detailMtime = $state(0);
  /** Two-step in-UI delete confirm (NOT window.confirm). */
  let confirmDelete = $state(false);

  // Lazy PrimitiveSvgView — kept off this tab's initial cost; loaded once a
  // detail mesh is first shown.
  let SvgView = $state<any>(null);
  async function ensureSvgView() {
    if (!SvgView) {
      try {
        SvgView = (await import('$lib/shared/svg/PrimitiveSvgView.svelte')).default;
      } catch (e) {
        /* leave null — preview just won't show */
      }
    }
  }

  function fmtBytes(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
  }
  function fmtTime(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    try { return new Date(ms).toLocaleString(); } catch { return '—'; }
  }
  function shortHash(h: string): string {
    return h.length > 10 ? h.slice(0, 10) : h;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const r = await fetch('/api/cache/list', { cache: 'no-store' });
      if (!r.ok) { error = `list failed (${r.status})`; return; }
      const j = await r.json();
      parts = Array.isArray(j.parts) ? j.parts : [];
      totalBytes = typeof j.totalBytes === 'number' ? j.totalBytes : 0;
      // Drop any selection that no longer exists.
      if (selId && !parts.some((p) => p.id === selId && p.hashes.some((h) => h.hash === selHash))) {
        clearDetail();
      }
    } catch (e: any) {
      error = e?.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  function clearDetail() {
    selId = null;
    selHash = null;
    detailMeta = null;
    detailMesh = null;
    detailBytes = 0;
    detailMtime = 0;
    detailError = null;
    confirmDelete = false;
  }

  function togglePart(id: string) {
    openParts = { ...openParts, [id]: !openParts[id] };
  }

  async function selectHash(id: string, hash: string) {
    selId = id;
    selHash = hash;
    confirmDelete = false;
    detailLoading = true;
    detailError = null;
    detailMeta = null;
    detailMesh = null;
    void ensureSvgView();
    try {
      const r = await fetch(
        `/api/cache/entry?id=${encodeURIComponent(id)}&hash=${encodeURIComponent(hash)}&mesh=1`,
        { cache: 'no-store' },
      );
      if (!r.ok) { detailError = `entry failed (${r.status})`; return; }
      const j = await r.json();
      // Stale-guard: the user may have clicked another row mid-flight.
      if (selId !== id || selHash !== hash) return;
      detailMeta = j.meta ?? null;
      detailMesh = j.mesh ?? null;
      detailBytes = typeof j.bytes === 'number' ? j.bytes : 0;
      detailMtime = typeof j.mtime === 'number' ? j.mtime : 0;
    } catch (e: any) {
      detailError = e?.message ?? String(e);
    } finally {
      detailLoading = false;
    }
  }

  // ─── Derived detail facts ────────────────────────────────────────────────
  let opts = $derived((detailMeta?.options ?? {}) as Record<string, any>);
  function meshVerts(m: any): number {
    const full = m?.full;
    const p = full?.positions;
    return Array.isArray(p) ? Math.floor(p.length / 3) : 0;
  }
  function meshTris(m: any): number {
    const full = m?.full;
    if (Array.isArray(full?.index)) return Math.floor(full.index.length / 3);
    return Math.floor(meshVerts(m) / 3);
  }
  let bakeMs = $derived.by(() => {
    const t = detailMeta?._t ?? detailMeta?.timing ?? null;
    if (t && typeof t === 'object') {
      const sum = Object.values(t).reduce((a: number, b: any) => a + (Number(b) || 0), 0);
      return sum > 0 ? sum : null;
    }
    return null;
  });

  // ─── Actions ─────────────────────────────────────────────────────────────
  async function doPrune() {
    if (pruning) return;
    pruning = true;
    try {
      // Per-part prune (the endpoint keys on id). Apply the 20-small/10-large
      // retention rule to EVERY part, then refresh.
      const ids = parts.map((p) => p.id);
      for (const id of ids) {
        await fetch('/api/cache/delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, prune: { small: 20, large: 10, thresholdMB: 5 } }),
        }).catch(() => { /* keep going */ });
      }
      await load();
    } finally {
      pruning = false;
    }
  }

  let deleteBusy = $state(false);
  async function deleteEntry() {
    if (!selId || !selHash || deleteBusy) return;
    deleteBusy = true;
    try {
      const r = await fetch('/api/cache/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: selId, hash: selHash }),
      });
      if (!r.ok) { detailError = `delete failed (${r.status})`; return; }
      clearDetail();
      await load();
    } catch (e: any) {
      detailError = e?.message ?? String(e);
    } finally {
      deleteBusy = false;
    }
  }

  let clearBusy = $state(false);
  async function clearPart() {
    if (!selId || clearBusy) return;
    const id = selId;
    clearBusy = true;
    try {
      const r = await fetch(`/api/cache/clear?id=${encodeURIComponent(id)}`, { method: 'POST' });
      if (!r.ok) { detailError = `clear failed (${r.status})`; return; }
      clearDetail();
      await load();
    } catch (e: any) {
      detailError = e?.message ?? String(e);
    } finally {
      clearBusy = false;
    }
  }

  onMount(() => { void load(); });
</script>

<div class="cb-root">
  <header class="cb-head">
    <div class="cb-total">
      {#if loading && parts.length === 0}
        loading cache…
      {:else}
        <strong>{fmtBytes(totalBytes)}</strong> across {parts.length} part{parts.length === 1 ? '' : 's'}
      {/if}
    </div>
    <button class="cb-btn" type="button" onclick={load} disabled={loading}>
      {loading ? '…' : '↻ Refresh'}
    </button>
    <button class="cb-btn prune" type="button" onclick={doPrune}
      disabled={pruning || loading || parts.length === 0}
      title="Keep the newest 20 entries under 5 MB + newest 10 at/above 5 MB, per part; delete the rest">
      {pruning ? 'Pruning…' : 'Prune (20 small / 10 large)'}
    </button>
  </header>

  {#if error}
    <div class="cb-error">cache list failed: {error}</div>
  {/if}

  <div class="cb-body">
    <!-- Left: parts → hashes -->
    <div class="cb-list">
      {#if !loading && parts.length === 0 && !error}
        <div class="cb-empty">cache is empty — nothing baked yet</div>
      {/if}
      {#each parts as p (p.id)}
        <div class="cb-part">
          <button class="cb-part-head" type="button" onclick={() => togglePart(p.id)}>
            <span class="cb-caret">{openParts[p.id] ? '▾' : '▸'}</span>
            <span class="cb-part-id">{p.id}</span>
            <span class="cb-part-meta">{p.count} · {fmtBytes(p.bytes)}</span>
          </button>
          {#if openParts[p.id]}
            {#each p.hashes as h (h.hash)}
              {@const o = h.meta?.options ?? {}}
              <button class="cb-hash" type="button"
                class:sel={selId === p.id && selHash === h.hash}
                onclick={() => selectHash(p.id, h.hash)}>
                <code class="cb-hash-id">{shortHash(h.hash)}</code>
                <span class="cb-hash-sum">
                  {o.segments ?? '?'}seg{o.cutaway ? ' · cut' : ''} · {fmtBytes(h.bytes)}
                </span>
              </button>
            {/each}
          {/if}
        </div>
      {/each}
    </div>

    <!-- Right: detail -->
    <div class="cb-detail">
      {#if !selHash}
        <div class="cb-detail-empty">Select a cache entry to inspect it.</div>
      {:else if detailLoading}
        <div class="cb-detail-empty">loading entry…</div>
      {:else}
        <div class="cb-detail-head">
          <div class="cb-detail-title">{selId}</div>
          <code class="cb-detail-hash">{selHash}</code>
        </div>

        {#if detailError}
          <div class="cb-error">{detailError}</div>
        {/if}

        <!-- 3D preview — lazy PrimitiveSvgView fed the cached mesh-JSON. -->
        <div class="cb-preview">
          {#if SvgView && detailMesh}
            <SvgView meshJson={detailMesh} name={selId} active={active} />
          {:else if detailMesh === null}
            <div class="cb-detail-empty small">no mesh payload</div>
          {:else}
            <div class="cb-detail-empty small">loading preview…</div>
          {/if}
        </div>

        <dl class="cb-facts">
          <dt>size</dt><dd>{fmtBytes(detailBytes)}</dd>
          <dt>cached</dt><dd>{fmtTime(detailMtime || detailMeta?.cachedAt || 0)}</dd>
          <dt>verts / tris</dt>
          <dd>{detailMesh ? `${meshVerts(detailMesh).toLocaleString()} / ${meshTris(detailMesh).toLocaleString()}` : '—'}</dd>
          <dt>bake time</dt><dd>{bakeMs != null ? `${bakeMs.toFixed(1)} ms` : '—'}</dd>
          <dt>segments</dt><dd>{opts.segments ?? '—'}</dd>
          <dt>cutaway</dt><dd>{opts.cutaway ? 'yes' : 'no'}</dd>
          <dt>zScale</dt><dd>{opts.zScale ?? '—'}</dd>
          <dt>mode</dt><dd>{opts.mode ?? '—'}</dd>
          <dt>colors</dt>
          <dd>
            {#if opts.colorOuter || opts.colorInner}
              <span class="cb-swatch" style="background:{opts.colorOuter ?? '#cc2222'}"></span>{opts.colorOuter ?? 'default'}
              <span class="cb-swatch" style="background:{opts.colorInner ?? '#888'}"></span>{opts.colorInner ?? 'default'}
            {:else}default{/if}
          </dd>
          <dt>params</dt>
          <dd><code class="cb-params">{Array.isArray(detailMeta?.params) ? JSON.stringify(detailMeta.params) : '—'}</code></dd>
        </dl>

        <div class="cb-actions">
          {#if confirmDelete}
            <span class="cb-confirm-q">Delete this entry?</span>
            <button class="cb-btn danger" type="button" onclick={deleteEntry} disabled={deleteBusy}>
              {deleteBusy ? '…' : 'Yes, delete'}
            </button>
            <button class="cb-btn" type="button" onclick={() => (confirmDelete = false)} disabled={deleteBusy}>Cancel</button>
          {:else}
            <button class="cb-btn danger" type="button" onclick={() => (confirmDelete = true)}>Delete this entry</button>
            <button class="cb-btn" type="button" onclick={clearPart} disabled={clearBusy}
              title="Wipe the whole {selId} cache directory">
              {clearBusy ? '…' : `Clear all of ${selId}`}
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .cb-root {
    display: flex; flex-direction: column;
    height: 100%; min-height: 0; min-width: 0;
    background: #fafaf9; color: #1f2937; font-family: Arial;
  }
  .cb-head {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 14px; border-bottom: 1px solid #e5e7eb; background: #f3f4f6;
    flex: 0 0 auto;
  }
  .cb-total { font: 13px Arial; color: #44403c; }
  .cb-total strong { color: #0c4a6e; }
  .cb-btn {
    padding: 4px 10px; font: 12px Arial; cursor: pointer;
    background: #fff; border: 1px solid #d6d3d1; border-radius: 4px; color: #44403c;
    transition: background 100ms, border-color 100ms, color 100ms;
  }
  .cb-btn:hover:not(:disabled) { background: #e0f2fe; border-color: #7dd3fc; color: #0369a1; }
  .cb-btn:disabled { cursor: wait; opacity: 0.55; }
  .cb-btn.prune { margin-left: auto; }
  .cb-btn.prune:hover:not(:disabled) { background: #fef3c7; border-color: #fcd34d; color: #92400e; }
  .cb-btn.danger { color: #b91c1c; border-color: #fca5a5; }
  .cb-btn.danger:hover:not(:disabled) { background: #fee2e2; border-color: #f87171; color: #991b1b; }

  .cb-error { padding: 8px 14px; font: 11px Arial; color: #b91c1c; background: #fef2f2; }

  .cb-body {
    display: grid; grid-template-columns: minmax(220px, 320px) minmax(0, 1fr);
    flex: 1 1 0; min-height: 0;
  }

  /* Left list */
  .cb-list {
    grid-column: 1; overflow-y: auto; min-height: 0;
    border-right: 1px solid #e5e7eb; background: #fff;
    scrollbar-width: thin; scrollbar-color: #cbd5e1 #f3f4f6;
  }
  .cb-empty, .cb-detail-empty { padding: 16px; font: 12px Arial; color: #78716c; }
  .cb-detail-empty.small { padding: 8px; font-size: 11px; }
  .cb-part { border-bottom: 1px solid #f3f4f6; }
  .cb-part-head {
    display: flex; align-items: center; gap: 6px; width: 100%;
    padding: 6px 10px; background: transparent; border: 0; cursor: pointer;
    text-align: left; font: 600 12px ui-monospace, monospace; color: #1f2937;
  }
  .cb-part-head:hover { background: #f3f4f6; }
  .cb-caret { color: #78716c; font-size: 10px; width: 12px; flex: 0 0 auto; }
  .cb-part-id { flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cb-part-meta { color: #a8a29e; font: 10px Arial; flex: 0 0 auto; }
  .cb-hash {
    display: flex; align-items: center; gap: 8px; width: 100%;
    padding: 4px 10px 4px 28px; background: transparent; border: 0; cursor: pointer;
    text-align: left;
  }
  .cb-hash:hover { background: #f1f5f9; }
  .cb-hash.sel { background: #dbeafe; }
  .cb-hash-id { font: 11px ui-monospace, monospace; color: #0369a1; flex: 0 0 auto; }
  .cb-hash-sum { font: 10px Arial; color: #78716c; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Detail */
  .cb-detail {
    grid-column: 2; overflow-y: auto; min-height: 0;
    display: flex; flex-direction: column; gap: 10px; padding: 12px 14px;
    scrollbar-width: thin; scrollbar-color: #cbd5e1 #f3f4f6;
  }
  .cb-detail-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .cb-detail-title { font: 700 14px Arial; color: #0c4a6e; }
  .cb-detail-hash { font: 11px ui-monospace, monospace; color: #78716c; }
  .cb-preview {
    flex: 0 0 auto; height: 280px; min-height: 200px;
    border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; background: #fff;
  }
  .cb-facts {
    display: grid; grid-template-columns: max-content 1fr; gap: 3px 12px;
    margin: 0; font: 12px Arial;
  }
  .cb-facts dt { color: #78716c; font-weight: 600; }
  .cb-facts dd { margin: 0; color: #1f2937; }
  .cb-params { font: 11px ui-monospace, monospace; color: #44403c; word-break: break-all; }
  .cb-swatch {
    display: inline-block; width: 10px; height: 10px; border-radius: 2px;
    border: 1px solid #d1d5db; vertical-align: middle; margin: 0 3px 0 0;
  }
  .cb-actions {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding-top: 4px; border-top: 1px solid #f3f4f6;
  }
  .cb-confirm-q { font: 12px Arial; color: #991b1b; }
</style>
