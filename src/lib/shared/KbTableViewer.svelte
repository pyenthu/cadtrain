<script lang="ts">
  // Reusable KB table viewer — filterable + sortable table of a single
  // KB's rows, driven by /kb/index.json. Ported out of the old
  // /kb/[id]/+page.svelte so it can be embedded inside /primitives' KB tab
  // (and any future host) without re-implementing the table logic.
  import { onMount } from 'svelte';

  interface Props {
    kbId: string;
    /** Optional per-row action button. When provided, an extra column is
     *  prepended showing the action's `icon` text; clicking calls
     *  `onAction(row)`. The host route uses this on the casing-tubing KB to
     *  preview a tubing component generated from the row's specs. */
    rowAction?: { icon: string; title: string; onAction: (row: Record<string, any>) => void } | null;
  }
  let { kbId, rowAction = null }: Props = $props();

  interface KbMeta {
    id: string;
    path: string;
    title: string;
    description: string;
    row_count: number;
    default_columns?: string[];
  }

  let meta = $state<KbMeta | null>(null);
  let kbHeader = $state<any>(null);
  let rows = $state<Record<string, any>[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  let search = $state('');
  let sortCol = $state<string | null>(null);
  let sortDir = $state<'asc' | 'desc'>('asc');
  let showAllCols = $state(false);

  onMount(async () => {
    try {
      const indexRes = await fetch('/kb/index.json', { cache: 'no-cache' });
      if (!indexRes.ok) throw new Error(`index: ${indexRes.status}`);
      const index = await indexRes.json();
      const m = index.kbs?.find((k: KbMeta) => k.id === kbId);
      if (!m) throw new Error(`KB not found: ${kbId}`);
      meta = m;

      const dataRes = await fetch(m.path, { cache: 'no-cache' });
      if (!dataRes.ok) throw new Error(`data: ${dataRes.status}`);
      const data = await dataRes.json();
      rows = data.rows ?? [];
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
    return meta.default_columns.filter((c) => allColumns.includes(c));
  });

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
        if (av === null || av === undefined) return 1;
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

<div class="kbv">
  {#if loading}
    <div class="empty">Loading…</div>
  {:else if error}
    <div class="err">{error}</div>
  {:else if meta}
    <div class="hdr">
      <h2>{meta.title}</h2>
      <p class="sub">{meta.description}</p>
      {#if kbHeader}
        <div class="info">
          <span>extracted {kbHeader.extracted_at}</span>
          <span>·</span>
          <span>{kbHeader.row_count?.toLocaleString() ?? rows.length} rows</span>
        </div>
      {/if}
    </div>
    <div class="toolbar">
      <input type="search" placeholder="Filter across all columns…" bind:value={search} class="search" />
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
            {#if rowAction}<th class="action-col"></th>{/if}
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
              {#if rowAction}
                <td class="action-col">
                  <button class="row-action" type="button" title={rowAction.title} onclick={() => rowAction!.onAction(r)}>{rowAction.icon}</button>
                </td>
              {/if}
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
  .kbv {
    height: 100%; display: flex; flex-direction: column;
    font-family: Arial, sans-serif;
    padding: 16px 22px;
    box-sizing: border-box;
    overflow: hidden;
  }
  .hdr h2 { margin: 0 0 4px; font-size: 18px; color: #cc2222; }
  .sub { margin: 0 0 4px; font: 11px Arial; color: #666; line-height: 1.5; }
  .info { font: 10px monospace; color: #888; display: flex; gap: 6px; margin: 4px 0 12px; }
  .toolbar {
    display: flex; gap: 12px; align-items: center;
    padding: 8px 0; flex-shrink: 0;
  }
  .search {
    flex: 1; padding: 5px 8px;
    border: 1px solid #d8d8de; border-radius: 4px;
    font: 11px Arial; min-width: 0;
  }
  .search:focus { outline: none; border-color: #cc2222; }
  .toggle { font: 11px Arial; color: #555; display: inline-flex; align-items: center; gap: 4px; }
  .toggle input { accent-color: #cc2222; }
  .rowcount { font: 10px monospace; color: #888; }
  .table-wrap {
    flex: 1; min-height: 0;
    overflow: auto;
    border: 1px solid #e2e2e8; border-radius: 4px;
    background: #fff;
  }
  table { border-collapse: collapse; width: 100%; font: 11px Arial; }
  th, td { padding: 4px 8px; border-bottom: 1px solid #f0f0f0; text-align: left; white-space: nowrap; }
  th {
    background: #f7f7f9; cursor: pointer;
    font: bold 10px Arial; color: #555;
    text-transform: uppercase; letter-spacing: 0.5px;
    position: sticky; top: 0; z-index: 1;
    user-select: none;
  }
  th:hover, th.active { color: #cc2222; }
  .arrow { margin-left: 4px; font-size: 9px; }
  td.num { text-align: right; font-family: monospace; }
  td.null { color: #bbb; }
  tbody tr:hover { background: #fafafa; }
  .action-col { width: 26px; padding: 0; text-align: center; }
  .row-action {
    background: #fff; border: 1px solid #d8d8de;
    color: #cc2222; cursor: pointer;
    width: 22px; height: 22px;
    border-radius: 4px;
    font: bold 12px Arial; line-height: 1;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .row-action:hover { background: #cc2222; color: #fff; border-color: #cc2222; }
  .empty, .err {
    flex: 1; display: flex; align-items: center; justify-content: center;
    font: 12px Arial; color: #888;
  }
  .err { color: #721c24; background: #f8d7da; padding: 12px; border-radius: 4px; }
</style>
