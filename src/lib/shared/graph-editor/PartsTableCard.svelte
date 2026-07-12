<!--
  PartsTableCard.svelte — the #38b PARTS-TABLE card UI (SCAFFOLD, headless-built,
  NOT YET WIRED into the graph editor — see the note at the bottom + the agent
  hand-off). A self-contained, DECOUPLED table editor: it takes the PartsTableNode
  data + the template's param names (columns) and emits mutation-INTENT callbacks;
  the parent (NodeCard) maps each callback to the composition-graph-mutate helpers
  (setPartsTableSrc / setPartsTableColumns / addPartsTableRow / duplicatePartsTable-
  Row / removePartsTableRow / setPartsTableCell) via `setGraph(mutation(graph, …))`.
  Nothing here imports GEP internals or the graph — so it compiles + reasons about
  in isolation (the parts_map card, by contrast, is inline SVG inside NodeCard).

  Columns = the template part's params; each ROW is one instance of the SAME part;
  every row carries its OWN output socket (the ◇ in the OUT column) so it can be
  wired individually. Rows render SEPARATE — this card never composes/fuses them.
  Mirrors docs/plans/refs/parts-table-card.png (PART · OUT · columns · row tools).
-->
<script lang="ts">
  import type { PartsTableNode, ArgValue } from '$lib/graph/composition-graph-types';

  interface Props {
    /** The node being edited. */
    node: PartsTableNode;
    /** Column options = the template part's param names (from its meta.params).
     *  Empty until a `src` is chosen; drives the "add column" picker. */
    paramNames?: string[];
    /** Set the template part id (the SAME part instantiated per row). */
    onSrc?: (src: string) => void;
    /** Replace the whole column set (adding surfaces a param as a column). */
    onColumns?: (columns: string[]) => void;
    /** Append a blank row (a new instance of the template). */
    onAddRow?: () => void;
    /** Duplicate row `idx` (the "another like this" gesture). */
    onDuplicateRow?: (idx: number) => void;
    /** Delete row `idx`. */
    onRemoveRow?: (idx: number) => void;
    /** Commit ONE cell — a literal value, an `{expr}`, or null to clear it. */
    onCell?: (idx: number, col: string, value: { expr: string } | number | string | boolean | null) => void;
    /** Begin wiring FROM row `idx`'s output socket (the parent starts the wire;
     *  the socket's stable name is partsTableRowVar(node.id, idx)). */
    onRowSocketDown?: (idx: number, ev: PointerEvent) => void;
  }

  let {
    node, paramNames = [],
    onSrc, onColumns, onAddRow, onDuplicateRow, onRemoveRow, onCell, onRowSocketDown,
  }: Props = $props();

  const columns = $derived(Array.isArray(node.columns) ? node.columns : []);
  const rows = $derived(Array.isArray(node.rows) ? node.rows : []);

  /** Render a cell ArgValue for the input box: a literal shows its raw value; an
   *  expr/param shows the ƒ-style source; an empty cell shows '' (template default). */
  function cellText(v: ArgValue | undefined): string {
    if (!v) return '';
    if (v.kind === 'literal') return String(v.value);
    if (v.kind === 'expr') return v.expr;
    return `p.${v.param}${v.field ? '.' + v.field : ''}`;
  }
  /** Is this cell an expression/param (ƒ) rather than a plain literal? */
  function isFx(v: ArgValue | undefined): boolean {
    return !!v && v.kind !== 'literal';
  }

  /** Commit a typed cell value on Enter (UI convention: apply on Enter, not per
   *  keystroke). A leading `=` OR a non-numeric string is treated as an expression;
   *  a bare number is a literal; blank clears the cell. */
  function commitCell(idx: number, col: string, raw: string) {
    const t = raw.trim();
    if (t === '') { onCell?.(idx, col, null); return; }
    if (t.startsWith('=')) { onCell?.(idx, col, { expr: t.slice(1).trim() }); return; }
    const n = Number(t);
    if (Number.isFinite(n) && /^[-+]?[0-9.eE]+$/.test(t)) onCell?.(idx, col, n);
    else onCell?.(idx, col, { expr: t });   // e.g. `p.depth`, `p.od * 0.5`
  }

  const unusedParams = $derived(paramNames.filter((p) => !columns.includes(p)));
</script>

<div class="pt-card">
  <header class="pt-head">
    <span class="pt-title">▤ parts&nbsp;table</span>
    <label class="pt-src">
      <span>part</span>
      <input
        class="pt-src-in" value={node.src} placeholder="template id (e.g. g_casing)"
        onchange={(e) => onSrc?.((e.currentTarget as HTMLInputElement).value.trim())} />
    </label>
  </header>

  <div class="pt-scroll">
    <table class="pt-table">
      <thead>
        <tr>
          <th class="pt-th pt-th-out">out</th>
          <th class="pt-th pt-th-idx">#</th>
          {#each columns as col (col)}
            <th class="pt-th">
              {col}
              <button class="pt-col-del" title="remove column {col}"
                onclick={() => onColumns?.(columns.filter((c) => c !== col))}>×</button>
            </th>
          {/each}
          <th class="pt-th pt-th-add">
            {#if unusedParams.length}
              <select class="pt-col-add" title="add a column"
                onchange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; if (v) onColumns?.([...columns, v]); (e.currentTarget as HTMLSelectElement).value = ''; }}>
                <option value="">＋ col</option>
                {#each unusedParams as p (p)}<option value={p}>{p}</option>{/each}
              </select>
            {/if}
          </th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row, idx (idx)}
          <tr class="pt-row">
            <td class="pt-cell pt-cell-out">
              <!-- The row's OWN output socket — wireable individually (its stable
                   name is partsTableRowVar(node.id, idx), computed by the parent). -->
              <button class="pt-socket" title="output socket — row {idx + 1}"
                onpointerdown={(e) => onRowSocketDown?.(idx, e)} aria-label="row {idx + 1} output">◇</button>
            </td>
            <td class="pt-cell pt-cell-idx">{idx + 1}</td>
            {#each columns as col (col)}
              <td class="pt-cell" class:pt-fx={isFx(row?.[col])}>
                <input
                  class="pt-in" value={cellText(row?.[col])}
                  placeholder="·"
                  onkeydown={(e) => { if (e.key === 'Enter') commitCell(idx, col, (e.currentTarget as HTMLInputElement).value); }}
                  onblur={(e) => commitCell(idx, col, (e.currentTarget as HTMLInputElement).value)} />
              </td>
            {/each}
            <td class="pt-cell pt-cell-tools">
              <button class="pt-tool" title="duplicate row" onclick={() => onDuplicateRow?.(idx)}>⧉</button>
              <button class="pt-tool" title="delete row" onclick={() => onRemoveRow?.(idx)}>🗑</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <footer class="pt-foot">
    <button class="pt-add-row" onclick={() => onAddRow?.()}>＋ row</button>
    <span class="pt-count">{rows.length} row{rows.length === 1 ? '' : 's'} · renders separate</span>
  </footer>
</div>

<style>
  .pt-card { display: flex; flex-direction: column; gap: 4px; padding: 6px; font-size: 11px; color: #3a2a55; background: #f6f1fe; border: 1px solid #c9b6ef; border-radius: 8px; min-width: 240px; }
  .pt-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .pt-title { font-weight: 600; color: #6b3fb0; white-space: nowrap; }
  .pt-src { display: flex; align-items: center; gap: 4px; }
  .pt-src span { opacity: 0.7; }
  .pt-src-in { width: 130px; font-size: 11px; padding: 1px 4px; border: 1px solid #c9b6ef; border-radius: 4px; }
  .pt-scroll { overflow-x: auto; }
  .pt-table { border-collapse: collapse; width: 100%; }
  .pt-th { text-align: left; font-weight: 600; padding: 2px 5px; border-bottom: 1px solid #d9cbf3; white-space: nowrap; }
  .pt-th-out, .pt-th-idx { width: 1%; opacity: 0.6; }
  .pt-col-del { margin-left: 3px; border: none; background: none; cursor: pointer; opacity: 0.5; }
  .pt-col-del:hover { opacity: 1; color: #b3261e; }
  .pt-col-add { font-size: 10px; border: 1px dashed #c9b6ef; border-radius: 4px; background: transparent; }
  .pt-cell { padding: 1px 4px; border-bottom: 1px solid #efe7fb; }
  .pt-cell-idx { opacity: 0.5; text-align: right; }
  .pt-in { width: 64px; font-size: 11px; padding: 1px 4px; border: 1px solid transparent; border-radius: 4px; background: #fff; }
  .pt-in:focus { border-color: #8a5cd6; outline: none; }
  .pt-fx .pt-in { color: #6b3fb0; font-style: italic; }
  .pt-socket { border: none; background: none; cursor: crosshair; color: #b3261e; font-size: 13px; line-height: 1; padding: 0; }
  .pt-cell-tools { white-space: nowrap; }
  .pt-tool { border: none; background: none; cursor: pointer; opacity: 0.55; padding: 0 2px; }
  .pt-tool:hover { opacity: 1; }
  .pt-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .pt-add-row { font-size: 11px; padding: 1px 8px; border: 1px solid #c9b6ef; border-radius: 4px; background: #fff; cursor: pointer; }
  .pt-add-row:hover { background: #efe7fb; }
  .pt-count { opacity: 0.55; font-size: 10px; }
</style>
