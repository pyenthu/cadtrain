<script lang="ts">
  // EditableTable — the two-tier interactivity demo (app-server-render.md Phase 3). Rows are
  // LOCAL client $state: add / edit / delete happen instantly in the browser with NO server
  // round-trip (Svelte reactivity). Only "💾 Save" fires a wired on.save action (the SERVER
  // round-trip — persist), and a Bake button (on.click → bake) is the engine round-trip.
  //
  // Seeded SYNCHRONOUSLY from server-resolved `preloaded` so the initial rows are in the SSR
  // first paint (an $effect would not run during svelte/server render).
  //
  // BUNDLE component (app_components/EditableTable/) — render + meta.ts co-located. See
  // src/lib/app_components/CLAUDE.md.
  import type { Panel, EventMap, SlotValue, SlotApi } from '$lib/appkit/manifest/types';
  let {
    panel,
    fire,
    preloaded,
    slots,
    slotApi,
  }: {
    panel: Panel;
    fire?: (n: { on?: EventMap } | undefined, event: string, item?: unknown) => Promise<void>;
    preloaded?: unknown;
    slots?: Record<string, SlotValue>;
    slotApi?: SlotApi;
  } = $props();

  // Optional DATA-FILE slot (§0.5): when set, rows come from the opened file and Save writes
  // them back to that file. Otherwise rows seed from server-resolved data (SSR, rung 1).
  const slot = $derived(panel.props?.slot as string | undefined);
  const slotData = $derived(slot ? slots?.[slot]?.data : undefined);

  // Client-owned rows (the working state). Seeded synchronously from preloaded (SSR path).
  let rows = $state<Record<string, any>[]>(
    Array.isArray(preloaded) ? (preloaded as any[]).map((r) => ({ ...r })) : [],
  );
  let dirty = $state(false);

  // Slot mode: re-seed rows when the slot's underlying file changes (a new file opened).
  // Content-key guard so local edits aren't clobbered + Save (which sets slot=rows) is a no-op.
  let seedKey = $state('');
  $effect(() => {
    if (!slot) return;
    const arr = Array.isArray(slotData) ? (slotData as any[]) : [];
    const key = JSON.stringify(arr);
    if (key !== seedKey) {
      seedKey = key;
      rows = arr.map((r) => ({ ...r }));
      dirty = false;
    }
  });

  function colsOf(prop: unknown, first: any): string[] {
    if (typeof prop === 'string') return prop.split(',').map((s) => s.trim()).filter(Boolean);
    if (Array.isArray(prop)) return prop as string[];
    return first ? Object.keys(first) : [];
  }
  const columns = $derived(colsOf(panel.props?.columns, rows[0]));
  const addLabel = $derived((panel.props?.addLabel as string) ?? '+ Add row');

  // ── all LOCAL — instant, no server ──
  function addRow() {
    const r: Record<string, any> = {};
    for (const c of columns) r[c] = '';
    rows = [...rows, r];
    dirty = true;
  }
  function delRow(i: number) {
    rows = rows.filter((_, j) => j !== i);
    dirty = true;
  }
  function editCell(i: number, c: string, v: string) {
    rows[i][c] = v; // deep-reactive $state
    dirty = true;
  }
  // ── the ONLY persist — explicit, on click ──
  // Slot mode → write rows back to the data FILE (§0.5). Else → fire the on.save hook.
  async function save() {
    const snap = $state.snapshot(rows);
    if (slot && slotApi) {
      slotApi.setData(slot, snap);
      seedKey = JSON.stringify(snap); // keep the re-seed guard in sync (no clobber)
      await slotApi.save(slot); // persist to the data file
    } else {
      await fire?.(panel, 'save', snap); // deferred server hook
    }
    dirty = false;
  }
  const canSave = $derived(!!(slot && slotApi) || !!panel.on?.save);
</script>

<div class="et">
  <div class="et-bar">
    <button class="add" onclick={addRow}>{addLabel}</button>
    <span class="count">{rows.length} row{rows.length === 1 ? '' : 's'}{dirty ? ' · unsaved' : ''}</span>
    {#if canSave}<button class="save" class:dirty onclick={save}>💾 Save{slot ? ` → ${slot}` : ''}</button>{/if}
  </div>
  <div class="et-wrap">
    <table>
      <thead><tr>{#each columns as c}<th>{c}</th>{/each}<th aria-label="row actions"></th></tr></thead>
      <tbody>
        {#each rows as row, i (i)}
          <tr>
            {#each columns as c}
              <td><input value={row[c] ?? ''} oninput={(e) => editCell(i, c, (e.currentTarget as HTMLInputElement).value)} /></td>
            {/each}
            <td><button class="del" title="delete row" onclick={() => delRow(i)}>✕</button></td>
          </tr>
        {/each}
        {#if !rows.length}<tr><td class="empty" colspan={columns.length + 1}>no rows — “{addLabel}”</td></tr>{/if}
      </tbody>
    </table>
  </div>
</div>

<style>
  .et { display: flex; flex-direction: column; gap: 8px; height: 100%; }
  .et-bar { display: flex; align-items: center; gap: 10px; }
  .et-bar .add { padding: 4px 10px; border: 1px solid var(--h-accent, #0369a1); border-radius: 6px; background: var(--h-accent, #0369a1); color: #fff; font: 600 12px system-ui; cursor: pointer; }
  .et-bar .count { color: var(--h-muted, #64748b); font-size: 12px; }
  .et-bar .save { margin-left: auto; padding: 4px 10px; border: 1px solid var(--h-border, #cbd5e1); border-radius: 6px; background: var(--h-surface, #fff); color: var(--h-text, #0f172a); font: 600 12px system-ui; cursor: pointer; opacity: .55; }
  .et-bar .save.dirty { opacity: 1; border-color: var(--h-accent, #0369a1); color: var(--h-accent, #0369a1); }
  .et-wrap { overflow: auto; max-width: 100%; flex: 1; min-height: 0; }
  table { border-collapse: collapse; font-size: 12px; width: 100%; }
  th, td { border: 1px solid var(--h-border, #e5e7eb); padding: 2px 4px; text-align: left; }
  th { background: var(--h-head, #f8fafc); font: 600 11px system-ui; color: var(--h-muted, #64748b); text-transform: uppercase; letter-spacing: .3px; padding: 4px 8px; }
  td input { width: 100%; min-width: 70px; border: 0; background: transparent; font: 12px system-ui; color: var(--h-text, #0f172a); padding: 3px 5px; }
  td input:focus { outline: 2px solid var(--h-accent, #0369a1); outline-offset: -2px; border-radius: 3px; }
  .del { border: 0; background: transparent; color: #b91c1c; cursor: pointer; font-size: 12px; padding: 2px 6px; }
  .empty { color: var(--h-muted, #94a3b8); font-style: italic; text-align: center; padding: 10px; }
</style>
