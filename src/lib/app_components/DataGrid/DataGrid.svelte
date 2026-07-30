<script lang="ts">
  // Table — renders a data source (an array of row objects) as columns. Columns from
  // props.columns (["od","id","top"]) or inferred from the first row's keys. Read-only
  // display (the editable list<record> table stays in FormPanel); this is a data grid.
  // BUNDLE component (app_components/DataGrid/) — render + meta.ts co-located. See src/lib/app_components/CLAUDE.md.
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

  let fetched = $state<any[]>([]);
  let note = $state('');
  // Server-resolved rows (SSR) win; a single object becomes one row.
  const rows = $derived(
    preloaded !== undefined
      ? (Array.isArray(preloaded) ? (preloaded as any[]) : preloaded ? [preloaded] : [])
      : fetched,
  );

  const colProp = $derived(panel.props?.columns);
  const columns = $derived(
    (typeof colProp === 'string'
      ? colProp.split(',').map((s) => s.trim()).filter(Boolean)
      : (colProp as string[]) ?? (rows[0] ? Object.keys(rows[0]) : [])) as string[],
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

  const cell = (row: any, col: string) => {
    const v = col.split('.').reduce((o: any, k) => (o == null ? undefined : o[k]), row);
    return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  };
</script>

{#if rows.length}
  <div class="tbl-wrap">
    <table class="tbl">
      <thead><tr>{#each columns as c}<th>{c}</th>{/each}</tr></thead>
      <tbody>
        {#each rows as row, i (row.id ?? i)}
          <tr>{#each columns as c}<td>{cell(row, c)}</td>{/each}</tr>
        {/each}
      </tbody>
    </table>
  </div>
{:else}
  <div class="note">{note || 'no rows'}</div>
{/if}

<style>
  .tbl-wrap { overflow: auto; max-width: 100%; }
  .tbl { border-collapse: collapse; font-size: 12px; width: 100%; }
  .tbl th, .tbl td { border: 1px solid var(--h-border, #e5e7eb); padding: 4px 8px; text-align: left; white-space: nowrap; }
  .tbl th { background: var(--h-head, #f8fafc); font: 600 11px system-ui; color: var(--h-muted, #64748b); text-transform: uppercase; letter-spacing: .3px; }
  .note { color: var(--h-muted, #94a3b8); font-size: 12px; font-style: italic; }
</style>
