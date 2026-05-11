<script lang="ts">
  // KB table viewer: filterable + sortable table of a single KB's rows.
  //
  //   - Search box filters across every column (substring match).
  //   - Click a column header to sort asc → desc → unsorted.
  //   - "Show all columns" toggle expands from the curated default set
  //     (declared per-KB in index.json) to every column in the data.
  //   - Row count footer reflects post-filter / post-sort.
  //
  // Generic — works for any KB whose JSON has a top-level `rows` array of
  // homogeneous objects. The "next KB" we add doesn't need a new viewer.
  import { onMount } from 'svelte';
  import { page } from '$app/state';

  interface KbMeta {
    id: string;
    path: string;
    title: string;
    description: string;
    row_count: number;
    default_columns?: string[];
  }

  let meta = $state<KbMeta | null>(null);
  let kbHeader = $state<any>(null); // schema_version, source_*, extracted_at, ...
  let rows = $state<Record<string, any>[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  let search = $state('');
  let sortCol = $state<string | null>(null);
  let sortDir = $state<'asc' | 'desc'>('asc');
  let showAllCols = $state(false);

  const id = $derived(page.params.id);

  onMount(async () => {
    try {
      const indexRes = await fetch('/kb/index.json', { cache: 'no-cache' });
      if (!indexRes.ok) throw new Error(`index: ${indexRes.status}`);
      const index = await indexRes.json();
      const m = index.kbs?.find((k: KbMeta) => k.id === id);
      if (!m) throw new Error(`KB not found: ${id}`);
      meta = m;

      const dataRes = await fetch(m.path, { cache: 'no-cache' });
      if (!dataRes.ok) throw new Error(`data: ${dataRes.status}`);
      const data = await dataRes.json();
      rows = data.rows ?? [];
      // Strip 'rows' from the header copy so the small info bar can show
      // schema_version / extraction date / source file etc.
      const { rows: _rows, ...header } = data;
      kbHeader = header;
    } catch (e: any) {
      error = e?.message ?? String(e);
    } finally {
      loading = false;
    }
  });

  let allColumns = $derived(rows.length > 0 ? Object.keys(rows[0]) : []);
  let displayCols = $derived.by(() => {
    if (showAllCols || !meta?.default_columns?.length) return allColumns;
    // Default cols from index.json, filtered to those actually present.
    return meta.default_columns.filter((c) => allColumns.includes(c));
  });

  // Filter + sort. Recomputed when search / sort / rows change.
  let processedRows = $derived.by(() => {
    let out = rows;
    const q = search.toLowerCase().trim();
    if (q) {
      out = out.filter((r) =>
        Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q)),
      );
    }
    if (sortCol) {
      const col = sortCol;
      const dir = sortDir;
      out = [...out].sort((a, b) => {
        const av = a[col], bv = b[col];
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1;  // nulls last
        if (bv === null || bv === undefined) return -1;
        const cmp = (typeof av === 'number' && typeof bv === 'number')
          ? av - bv
          : String(av).localeCompare(String(bv));
        return dir === 'asc' ? cmp : -cmp;
      });
    }
    return out;
  });

  function toggleSort(c: string) {
    if (sortCol !== c) { sortCol = c; sortDir = 'asc'; return; }
    if (sortDir === 'asc') sortDir = 'desc';
    else { sortCol = null; sortDir = 'asc'; }
  }

  // Format cells: numbers get comma thousands separators for readability;
  // nulls render as a faint dash.
  function fmt(v: any): string {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'number') {
      if (Number.isInteger(v) || Math.abs(v) >= 100) return v.toLocaleString();
      return String(v);
    }
    return String(v);
  }

  function colLabel(c: string): string {
    return c
      .replace(/_/g, ' ')
      .replace(/\bin\b/g, '(in)')
      .replace(/\bpsi\b/g, '(psi)')
      .replace(/\bklbf\b/g, '(klbf)')
      .replace(/\blbft\b/g, '(lb/ft)')
      .replace(/\bftlb\b/g, '(ft·lb)');
  }
</script>

<div class="page">
  <a class="back" href="/kb">← All KBs</a>

  {#if loading}
    <div class="empty">Loading…</div>
  {:else if error}
    <div class="err">{error}</div>
  {:else if meta}
    <div class="hdr">
      <h1>{meta.title}</h1>
      <p class="sub">{meta.description}</p>
      {#if kbHeader}
        <div class="info">
          <span>extracted {kbHeader.extracted_at}</span>
          <span>·</span>
          <span>{kbHeader.row_count?.toLocaleString() ?? rows.length} rows</span>
          {#if kbHeader.source_file}
            <span>·</span>
            <span>source: <code>{kbHeader.source_file}</code></span>
          {/if}
        </div>
      {/if}
    </div>

    <div class="toolbar">
      <input
        type="search"
        placeholder="Filter across all columns…"
        bind:value={search}
        class="search"
      />
      <label class="toggle">
        <input type="checkbox" bind:checked={showAllCols} />
        Show all columns ({allColumns.length})
      </label>
      <div class="rowcount">
        {processedRows.length.toLocaleString()} / {rows.length.toLocaleString()}
        {processedRows.length !== rows.length ? 'matches' : 'rows'}
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            {#each displayCols as c (c)}
              <th onclick={() => toggleSort(c)} class:active={sortCol === c}>
                {colLabel(c)}
                {#if sortCol === c}<span class="arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>{/if}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each processedRows as r, i (i)}
            <tr>
              {#each displayCols as c (c)}
                <td class:num={typeof r[c] === 'number'} class:null={r[c] === null || r[c] === undefined}>
                  {fmt(r[c])}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .page {
    padding: 16px 24px;
    height: 100%;
    overflow-y: auto;
    box-sizing: border-box;
    font-family: Arial, sans-serif;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .back { font: 11px Arial; color: #cc2222; text-decoration: none; }
  .back:hover { text-decoration: underline; }
  .hdr h1 { margin: 0; font-size: 18px; color: #222; }
  .sub { margin: 4px 0 4px; font: 11px Arial; color: #666; line-height: 1.5; max-width: 900px; }
  .info { font: 10px Arial; color: #888; display: flex; gap: 6px; align-items: center; }
  .info code { font: 10px monospace; color: #555; background: #f0f0f0; padding: 1px 5px; border-radius: 3px; }
  .toolbar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .search {
    flex: 0 0 280px; max-width: 100%;
    padding: 5px 8px; font: 12px Arial;
    border: 1px solid #ccc; border-radius: 4px;
  }
  .search:focus { outline: 2px solid #cc2222; outline-offset: -1px; border-color: #cc2222; }
  .toggle { font: 11px Arial; color: #555; display: flex; gap: 4px; align-items: center; cursor: pointer; }
  .rowcount { font: 11px monospace; color: #888; margin-left: auto; }
  .table-wrap { flex: 1; overflow: auto; border: 1px solid #ddd; border-radius: 4px; background: #fff; min-height: 0; }
  table { width: 100%; border-collapse: collapse; font: 11px Arial; }
  thead { position: sticky; top: 0; background: #f4f4f4; z-index: 1; }
  th {
    text-align: left; padding: 6px 10px; cursor: pointer; user-select: none;
    border-bottom: 2px solid #ddd; white-space: nowrap;
    font-weight: 600; color: #444;
  }
  th:hover { background: #e8e8e8; }
  th.active { background: #fdf0f0; color: #cc2222; }
  .arrow { font-size: 9px; margin-left: 4px; opacity: 0.7; }
  td { padding: 4px 10px; border-bottom: 1px solid #f0f0f0; white-space: nowrap; }
  td.num { font-family: monospace; font-variant-numeric: tabular-nums; text-align: right; }
  td.null { color: #bbb; text-align: center; }
  tbody tr:hover { background: #fafafa; }
  .empty { font: 12px Arial; color: #888; padding: 40px; text-align: center; }
  .err { font: 11px monospace; color: #721c24; background: #f8d7da; padding: 12px; border-radius: 4px; }
</style>
