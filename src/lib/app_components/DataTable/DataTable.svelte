<script lang="ts">
  // DataTable — the read-only DataGrid levelled up. Data comes in EXACTLY as DataGrid gets it:
  // server-resolved rows arrive via `preloaded` (SSR — used synchronously, no client fetch); when
  // absent the client runs `run(panel.source)`. On top of that, LOCAL client $state drives a
  // richer UI: click a header to SORT (three-state asc → desc → none), a SEARCH box filtering all
  // columns, optional client PAGING, and a numeric TOTALS footer. Sort / filter / page are PURE
  // transforms over the already-resolved rows — they NEVER refetch.
  //
  // SSR: dataMode:'server', so the rows are baked into the first paint. The initial server render
  // uses the default $state (no sort, no filter, page 0) → a valid full table; $effect + event
  // handlers don't run on the server, they just enhance once hydrated. No browser APIs at first paint.
  //
  // BUNDLE component (app_components/DataTable/) — render + meta.ts co-located. See
  // src/lib/app_components/CLAUDE.md.
  import type { Panel, Binding } from '$lib/appkit/manifest/types';
  let {
    panel,
    run,
    dataRev,
    preloaded,
  }: {
    panel: Panel;
    run: (b?: Binding, item?: unknown) => Promise<unknown>;
    /** Bumps on slot changes → re-fetch. */
    dataRev?: number;
    /** Server-resolved rows (SSR). When present, used synchronously — no client fetch. */
    preloaded?: unknown;
  } = $props();

  // ── data-in (identical to DataGrid) ─────────────────────────────────────────
  let fetched = $state<any[]>([]);
  let note = $state('');
  // Server-resolved rows (SSR) win; a single object becomes one row.
  const rows = $derived(
    preloaded !== undefined
      ? (Array.isArray(preloaded) ? (preloaded as any[]) : preloaded ? [preloaded] : [])
      : fetched,
  );

  $effect(() => {
    if (preloaded !== undefined) return; // server already resolved it
    void dataRev; // re-fetch when a slot changes
    note = '';
    fetched = [];
    run(panel.source)
      .then((r) => {
        if (Array.isArray(r)) fetched = r;
        else if (r && typeof r === 'object') fetched = [r];
      })
      .catch((e) => {
        const m = String(e);
        note = m.includes('not wired') || m.includes('needs an engine') ? `awaiting data — ${panel.source?.verb}() pending` : m;
      });
  });

  // ── columns (props.columns "a,b" or "a:Label,b:Label" key:Label pairs; else infer) ──
  const p = $derived((panel.props ?? {}) as Record<string, unknown>);
  const colProp = $derived(p.columns);
  const parseCol = (s: string) => {
    const [key, ...rest] = String(s).split(':');
    const k = key.trim();
    const label = rest.join(':').trim() || k;
    return { key: k, label };
  };
  const cols = $derived.by(() => {
    if (typeof colProp === 'string' && colProp.trim())
      return colProp.split(',').map((s) => s.trim()).filter(Boolean).map(parseCol);
    if (Array.isArray(colProp)) return (colProp as unknown[]).map((s) => parseCol(String(s)));
    return rows[0] ? Object.keys(rows[0]).map((k) => ({ key: k, label: k })) : [];
  });

  // ── option props ────────────────────────────────────────────────────────────
  const asBool = (v: unknown, d: boolean) => (v === undefined || v === null ? d : v === true || v === 'true');
  const search = $derived(asBool(p.search, true));
  const sortable = $derived(asBool(p.sortable, true));
  const showTotals = $derived(asBool(p.showTotals, false));
  const numberAlign = $derived(asBool(p.numberAlign, true));
  const zebra = $derived(asBool(p.zebra, true));
  const pageSize = $derived(Math.max(0, Math.floor(Number(p.pageSize ?? 0)) || 0));

  // ── cell readers (dotted paths — identical to DataGrid) ──────────────────────
  const cellRaw = (row: any, key: string) => key.split('.').reduce((o: any, k) => (o == null ? undefined : o[k]), row);
  const cellStr = (row: any, key: string) => {
    const v = cellRaw(row, key);
    return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  };

  // A column is numeric when every non-empty value coerces to a finite number (≥1 value present).
  const numericCols = $derived.by(() => {
    const set = new Set<string>();
    for (const c of cols) {
      let seen = false;
      let ok = true;
      for (const r of rows) {
        const v = cellRaw(r, c.key);
        if (v === '' || v == null) continue;
        seen = true;
        if (typeof v === 'boolean' || !Number.isFinite(Number(v))) { ok = false; break; }
      }
      if (seen && ok) set.add(c.key);
    }
    return set;
  });

  // ── local UI state (enhance-only; inert during SSR) ──────────────────────────
  let sortKey = $state('');
  let sortDir = $state<'asc' | 'desc'>('asc');
  let searchText = $state('');
  let page = $state(0);

  function toggleSort(key: string) {
    if (!sortable) return;
    if (sortKey !== key) {
      sortKey = key;
      sortDir = 'asc';
    } else if (sortDir === 'asc') {
      sortDir = 'desc';
    } else {
      sortKey = ''; // three-state: back to unsorted
      sortDir = 'asc';
    }
  }

  // filter → sort → page (pure transforms over the resolved rows)
  const filtered = $derived.by(() => {
    const q = searchText.trim().toLowerCase();
    if (!search || !q) return rows;
    return rows.filter((r) => cols.some((c) => cellStr(r, c.key).toLowerCase().includes(q)));
  });

  const sorted = $derived.by(() => {
    if (!sortKey) return filtered;
    const numeric = numericCols.has(sortKey);
    const arr = [...filtered];
    arr.sort((a, b) => {
      if (numeric) return (Number(cellRaw(a, sortKey)) || 0) - (Number(cellRaw(b, sortKey)) || 0);
      return String(cellRaw(a, sortKey) ?? '').localeCompare(String(cellRaw(b, sortKey) ?? ''));
    });
    if (sortDir === 'desc') arr.reverse();
    return arr;
  });

  const pageCount = $derived(pageSize > 0 ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1);
  const safePage = $derived(Math.max(0, Math.min(page, pageCount - 1)));
  const pageRows = $derived(
    pageSize > 0 ? sorted.slice(safePage * pageSize, safePage * pageSize + pageSize) : sorted,
  );

  // Back to page 1 whenever the search changes (client-only; no-op on the server).
  $effect(() => {
    void searchText;
    page = 0;
  });

  // Totals over the FILTERED set (all matches, not just the visible page).
  const totals = $derived.by(() => {
    const t: Record<string, number> = {};
    for (const c of cols) {
      if (!numericCols.has(c.key)) continue;
      let s = 0;
      for (const r of filtered) {
        const n = Number(cellRaw(r, c.key));
        if (Number.isFinite(n)) s += n;
      }
      t[c.key] = s;
    }
    return t;
  });
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
</script>

{#if cols.length}
  <div class="dt">
    {#if search}
      <div class="dt-bar">
        <input class="dt-search" type="search" placeholder="Search…" bind:value={searchText} />
        <span class="dt-count">{filtered.length} row{filtered.length === 1 ? '' : 's'}{filtered.length !== rows.length ? ` of ${rows.length}` : ''}</span>
      </div>
    {/if}

    <div class="dt-wrap">
      <table class="dt-tbl" class:zebra>
        <thead>
          <tr>
            {#each cols as c (c.key)}
              <th
                class:num={numberAlign && numericCols.has(c.key)}
                class:sortable
                class:active={sortKey === c.key}
                onclick={() => toggleSort(c.key)}
                title={sortable ? `Sort by ${c.label}` : undefined}
              >
                <span class="th-label">{c.label}</span>
                {#if sortable && sortKey === c.key}<span class="arr">{sortDir === 'asc' ? '▲' : '▼'}</span>{/if}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each pageRows as row, i (row.id ?? i)}
            <tr>
              {#each cols as c (c.key)}
                <td class:num={numberAlign && numericCols.has(c.key)}>{cellStr(row, c.key)}</td>
              {/each}
            </tr>
          {/each}
          {#if !pageRows.length}
            <tr><td class="empty" colspan={cols.length}>{note || (searchText.trim() ? 'no matches' : 'no rows')}</td></tr>
          {/if}
        </tbody>
        {#if showTotals && numericCols.size}
          <tfoot>
            <tr class="totals">
              {#each cols as c, idx (c.key)}
                <td class:num={numberAlign && numericCols.has(c.key)}>
                  {#if numericCols.has(c.key)}{fmt(totals[c.key])}{:else if idx === 0}Total{/if}
                </td>
              {/each}
            </tr>
          </tfoot>
        {/if}
      </table>
    </div>

    {#if pageSize > 0 && pageCount > 1}
      <div class="dt-pager">
        <button class="pg-btn" disabled={safePage <= 0} onclick={() => (page = Math.max(0, safePage - 1))}>‹ Prev</button>
        <span class="pg-info">Page {safePage + 1} / {pageCount}</span>
        <button class="pg-btn" disabled={safePage >= pageCount - 1} onclick={() => (page = Math.min(pageCount - 1, safePage + 1))}>Next ›</button>
      </div>
    {/if}
  </div>
{:else}
  <div class="note">{note || 'no rows'}</div>
{/if}

<style>
  .dt { display: flex; flex-direction: column; gap: 8px; max-width: 100%; min-height: 0; }
  .dt-bar { display: flex; align-items: center; gap: 10px; }
  .dt-search {
    padding: 4px 9px; border: 1px solid var(--h-border, #cbd5e1); border-radius: 6px;
    background: var(--h-surface, #fff); color: var(--h-text, #0f172a); font: 12px system-ui;
    min-width: 160px;
  }
  .dt-search:focus { outline: 2px solid var(--h-accent, #0369a1); outline-offset: -1px; border-color: var(--h-accent, #0369a1); }
  .dt-count { color: var(--h-muted, #64748b); font-size: 12px; }

  .dt-wrap { overflow: auto; max-width: 100%; }
  .dt-tbl { border-collapse: collapse; font-size: 12px; width: 100%; }
  .dt-tbl th, .dt-tbl td {
    border: 1px solid var(--h-border, #e5e7eb); padding: 4px 8px; text-align: left; white-space: nowrap;
  }
  .dt-tbl th {
    position: sticky; top: 0; z-index: 1;
    background: var(--h-head, #f8fafc); font: 600 11px system-ui; color: var(--h-muted, #64748b);
    text-transform: uppercase; letter-spacing: .3px; user-select: none;
  }
  .dt-tbl th.sortable { cursor: pointer; }
  .dt-tbl th.sortable:hover { color: var(--h-text, #0f172a); }
  .dt-tbl th.active { color: var(--h-accent, #0369a1); }
  .dt-tbl th .arr { margin-left: 4px; font-size: 9px; }
  .dt-tbl th.num, .dt-tbl td.num { text-align: right; font-variant-numeric: tabular-nums; }

  .dt-tbl tbody tr:hover td { background: var(--h-hover, #f1f5f9); }
  .dt-tbl.zebra tbody tr:nth-child(even) td { background: var(--h-zebra, #fafafa); }
  .dt-tbl.zebra tbody tr:nth-child(even):hover td { background: var(--h-hover, #f1f5f9); }

  .dt-tbl tfoot .totals td {
    background: var(--h-head, #f8fafc); font: 600 12px system-ui; color: var(--h-muted, #475569);
  }

  .empty { color: var(--h-muted, #94a3b8); font-style: italic; text-align: center; padding: 10px; }

  .dt-pager { display: flex; align-items: center; gap: 10px; }
  .pg-btn {
    padding: 3px 10px; border: 1px solid var(--h-border, #cbd5e1); border-radius: 6px;
    background: var(--h-surface, #fff); color: var(--h-text, #0f172a); font: 600 12px system-ui; cursor: pointer;
  }
  .pg-btn:disabled { opacity: .45; cursor: default; }
  .pg-info { color: var(--h-muted, #64748b); font-size: 12px; }

  .note { color: var(--h-muted, #94a3b8); font-size: 12px; font-style: italic; }
</style>
