<script lang="ts">
  // BUNDLE component (app_components/Form/) — render + meta.ts co-located. See src/lib/app_components/CLAUDE.md.
  import type { Panel, Binding, Control } from '$lib/appkit/manifest/types';
  let {
    panel,
    run,
    params,
    active,
  }: {
    panel: Panel;
    run: (b?: Binding, item?: unknown) => Promise<unknown>;
    params?: Record<string, unknown>;
    active?: string;
  } = $props();

  // Rows for a table control come from the selected doc's params[bind] (set centrally
  // when a list item is selected — loadDoc → params). list<record> params (e.g. a
  // well's casings) render as real rows.
  function rowsOf(ctl: Control): any[] {
    if (!active) return [];
    const v = params?.[ctl.bind ?? ''];
    return Array.isArray(v) ? v : [];
  }
</script>

<div class="form">
  {#if !active}<div class="note">select a document</div>{/if}
  {#each panel.controls ?? [] as ctl (ctl.id ?? ctl.kind)}
    <div class="control">
      <div class="ctl-head">{ctl.id ?? ctl.kind}<span class="ck">{ctl.kind}</span></div>
      {#if ctl.kind === 'table'}
        {@const rows = rowsOf(ctl)}
        <table class="tbl">
          <thead><tr>{#each ctl.cols ?? [] as c}<th>{c}</th>{/each}</tr></thead>
          <tbody>
            {#if rows.length}
              {#each rows as row}
                <tr>{#each ctl.cols ?? [] as c}<td>{row?.[c] ?? ''}</td>{/each}</tr>
              {/each}
            {:else}
              <td colspan={(ctl.cols ?? []).length || 1} class="empty">{active ? `no ${ctl.bind} rows` : '—'}</td>
            {/if}
          </tbody>
        </table>
        {#if ctl.add}<button class="add" onclick={() => run(ctl.add).catch(() => {})}>＋ add row</button>{/if}
      {:else}
        <div class="note">control: {ctl.kind}{ctl.bind ? ` · ${ctl.bind}` : ''}</div>
      {/if}
    </div>
  {/each}
  {#if !(panel.controls?.length)}<div class="note">no controls</div>{/if}
</div>

<style>
  .form { display: flex; flex-direction: column; gap: 10px; }
  .control { border: 1px solid #eef2f6; border-radius: 6px; padding: 8px; }
  .ctl-head { display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 6px; }
  .ck { font: 600 10px system-ui; text-transform: uppercase; color: #94a3b8; }
  .tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
  .tbl th { text-align: left; border-bottom: 1px solid #e5e7eb; padding: 3px 5px; color: #475569; }
  .tbl td { padding: 3px 5px; border-bottom: 1px solid #f1f5f9; }
  .empty { color: #94a3b8; font-style: italic; padding: 6px 5px; }
  .add { margin-top: 6px; font: 600 11px system-ui; padding: 4px 9px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; cursor: pointer; }
  .note { color: #94a3b8; font-size: 12px; font-style: italic; }
</style>
