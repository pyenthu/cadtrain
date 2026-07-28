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
  import type { PartsTableNode, ArgValue, RowMaterial } from '$lib/graph/composition/composition-graph-types';
  import RowMaterialPopover from './RowMaterialPopover.svelte';

  interface Props {
    /** The node being edited. */
    node: PartsTableNode;
    /** Column options = the template part's param names (from its meta.params).
     *  Empty until a `src` is chosen; drives the "add column" picker. */
    paramNames?: string[];
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
    /** Set / clear row `idx`'s per-row MATERIAL override (#38d) — null clears it. */
    onRowMaterial?: (idx: number, material: RowMaterial | null) => void;
    /** Set / clear the CARD-LEVEL material override (#38d) — the master ● in the
     *  title row; applies to EVERY row as a base (null clears it). */
    onTableMaterial?: (material: RowMaterial | null) => void;
    /** Begin wiring FROM row `idx`'s output socket (the parent starts the wire;
     *  the socket's stable name is partsTableRowVar(node.id, idx)). */
    onRowSocketDown?: (idx: number, ev: PointerEvent) => void;
  }

  let {
    node, paramNames = [],
    onColumns, onAddRow, onDuplicateRow, onRemoveRow, onCell, onRowMaterial, onTableMaterial, onRowSocketDown,
  }: Props = $props();

  const columns = $derived(Array.isArray(node.columns) ? node.columns : []);
  const rows = $derived(Array.isArray(node.rows) ? node.rows : []);
  const rowMaterials = $derived(Array.isArray(node.rowMaterials) ? node.rowMaterials : []);
  /** The CARD-LEVEL override (the master ● in the title row); null when unset. */
  const tableMaterial = $derived((node.tableMaterial ?? null) as RowMaterial | null);

  /** Is a material bundle "set" (any of colour / preset / opacity present)? */
  function matSet(m: RowMaterial | null): boolean {
    return !!m && (!!m.color || !!m.preset || typeof m.opacity === 'number');
  }
  /** The tint for a material sphere — its override colour when set; the purple accent
   *  when the override is colourless (preset/opacity only) so a SET one still reads
   *  distinct; 'transparent' when unset (button then shows pure black/white). */
  function swatchTint(m: RowMaterial | null): string {
    return m?.color ?? (matSet(m) ? '#7c5fc0' : 'transparent');
  }
  /** Row `idx`'s current override (null when unset). */
  function matOf(idx: number): RowMaterial | null { return rowMaterials[idx] ?? null; }
  function swatchFill(idx: number): string { return swatchTint(matOf(idx)); }
  function isMatSet(idx: number): boolean { return matSet(matOf(idx)); }

  // SELF-CONTAINED material popover — its open row + screen anchor live HERE (the
  // card owns it; no state routes through GraphEditorPane, per #38d). matPopIdx === -1
  // is the sentinel for the CARD-LEVEL (table) material; >= 0 is a row index.
  let matPopIdx = $state<number | null>(null);
  let matAnchor = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  function openMatPop(idx: number, ev: MouseEvent) {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    matAnchor = { x: r.left, y: r.bottom + 4 };
    matPopIdx = idx;
    confirmDelIdx = null;
  }

  // Two-click delete confirm (#38d) — clicking 🗑 ARMS the row (swaps to ✓/✕); we
  // never use a native confirm() dialog (it wedges the in-browser extension). Only
  // one row can be armed at a time, so arming another row disarms the first.
  let confirmDelIdx = $state<number | null>(null);

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

<!-- No header here — the title + template-part selector live on the NodeCard SVG
     title row (#38b R1/R2); this card is just the scrollable row table + footer. -->
<div class="pt-card">
  <div class="pt-scroll">
    <table class="pt-table">
      <thead>
        <tr>
          <!-- CARD-LEVEL master material (#38d): a black|white "material sphere" in the
               TITLE row that skins the WHOLE table (every row) when set; per-row swatches
               below still win. SET tints the light hemisphere to the override colour. -->
          <th class="pt-th pt-th-mat">
            <button class="pt-swatch" class:pt-swatch-set={matSet(tableMaterial)}
              style={`--sw:${swatchTint(tableMaterial)}`} title="table material / colour — applies to every row"
              onclick={(e) => openMatPop(-1, e)} aria-label="table material"></button>
          </th>
          {#each columns as col (col)}
            <th class="pt-th">{col}</th>
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
          <th class="pt-th pt-th-rtools"></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row, idx (idx)}
          <tr class="pt-row">
            <!-- Per-row material / colour override (#38d): a round black|white "material
                 sphere" (rows share one template, so this is how a row differs). Opens
                 RowMaterialPopover; wins over the card-level master ● above. -->
            <td class="pt-cell pt-cell-mat">
              <button class="pt-swatch" class:pt-swatch-set={isMatSet(idx)}
                style={`--sw:${swatchFill(idx)}`} title="row {idx + 1} material / colour"
                onclick={(e) => openMatPop(idx, e)} aria-label="row {idx + 1} material"></button>
            </td>
            {#each columns as col (col)}
              <td class="pt-cell" class:pt-fx={isFx(row?.[col])}>
                <input
                  class="pt-in" value={cellText(row?.[col])}
                  placeholder="·"
                  onkeydown={(e) => { if (e.key === 'Enter') commitCell(idx, col, (e.currentTarget as HTMLInputElement).value); }}
                  onblur={(e) => commitCell(idx, col, (e.currentTarget as HTMLInputElement).value)} />
              </td>
            {/each}
            <td class="pt-cell pt-cell-add"></td>
            <!-- RIGHT WALL cluster (user 2026-07-21): the delete button then the row's
                 OWN output socket, both pinned to the card's right edge (sticky). Delete
                 is TWO-CLICK (🗑 arms → ✓/✕) so a row is never lost on a stray click. The
                 socket's stable wire name is partsTableRowVar(id, idx). -->
            <td class="pt-cell pt-cell-rtools">
              <span class="pt-rcluster">
                {#if confirmDelIdx === idx}
                  <button class="pt-tool pt-del-yes" title="confirm — delete row {idx + 1}"
                    onclick={() => { onRemoveRow?.(idx); confirmDelIdx = null; }} aria-label="confirm delete row {idx + 1}">✓</button>
                  <button class="pt-tool pt-del-no" title="cancel"
                    onclick={() => (confirmDelIdx = null)} aria-label="cancel delete">✕</button>
                {:else}
                  <button class="pt-tool pt-del" title="delete row {idx + 1}"
                    onclick={() => (confirmDelIdx = idx)} aria-label="delete row {idx + 1}">🗑</button>
                {/if}
                <button class="pt-socket" title="output socket — row {idx + 1}"
                  onpointerdown={(e) => onRowSocketDown?.(idx, e)} aria-label="row {idx + 1} output">◇</button>
              </span>
            </td>
          </tr>
        {/each}
        <!-- Compact add-row: a small + at the bottom of the last row (no footer/count). -->
        <tr class="pt-addrow">
          <td class="pt-cell pt-addrow-cell" colspan={columns.length + 3}>
            <button class="pt-add-mini" title="add a row" onclick={() => onAddRow?.()} aria-label="add a row">＋</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</div>

<!-- SELF-CONTAINED per-row material popover (#38d) — mounted here, inside the card,
     so no popover state routes through GraphEditorPane. -->
{#if matPopIdx !== null}
  <RowMaterialPopover
    material={matPopIdx === -1 ? tableMaterial : matOf(matPopIdx)}
    anchor={matAnchor}
    onCommit={(m) => (matPopIdx === -1 ? onTableMaterial?.(m) : onRowMaterial?.(matPopIdx as number, m))}
    onClose={() => (matPopIdx = null)}
  />
{/if}

<style>
  /* The card fills its foreignObject host so the whole table (`.pt-scroll`) takes
     the middle and scrolls in BOTH axes past the node's PT_MAX_H cap (#38b R5).
     Lighter ground + slightly bolder text for legibility (user 2026-07-13). */
  .pt-card { display: flex; flex-direction: column; padding: 0; box-sizing: border-box; height: 100%; font-size: 11px; font-weight: 600; color: #34235a; background: #fdfcff; border: 1.5px solid #6d4fb0; border-radius: 8px; overflow: hidden; min-width: 240px; }
  /* Grow-to-fit → only the COLUMNS scroll (horizontal); height always fits the
     rows so there is no vertical scrollbar (user 2026-07-13). */
  .pt-scroll { flex: 1 1 auto; min-height: 0; overflow-x: auto; overflow-y: hidden; }
  /* Full GRID outline on every header + data cell, in a DARKER violet so the grid
     reads clearly; the card's rounded overflow:hidden clips it to soft corners
     (user 2026-07-13). */
  .pt-table { border-collapse: collapse; width: 100%; }
  .pt-th { text-align: left; font-weight: 600; padding: 0 4px; border: 1px solid #7c5fc0; white-space: nowrap; }
  .pt-col-add { font-size: 10px; border: 1px dashed #c9b6ef; border-radius: 4px; background: transparent; }
  .pt-cell { padding: 1px 4px; border: 1px solid #a98fd8; }
  /* Columns size to their FIELD-NAME width (user 2026-07-13): the `th` name is
     nowrap so it sets the column's natural width; the input FILLS that column
     (width:100%, min-width:0 lets it shrink to the name) with a small floor so a
     2-char name like `od` stays typeable. Longer values scroll inside the input. */
  .pt-in { width: 100%; min-width: 3ch; box-sizing: border-box; font-size: 11px; font-weight: 600; padding: 1px 4px; border: 1px solid transparent; border-radius: 4px; background: #fff; }
  .pt-in:focus { border-color: #8a5cd6; outline: none; }
  .pt-fx .pt-in { color: #6b3fb0; font-style: italic; }

  /* Material swatch column — LEFT edge of every row (per-row) + the title row (the
     card-level master). Both share `.pt-swatch`. */
  .pt-cell-mat, .pt-th-mat { width: 1%; text-align: center; white-space: nowrap; }
  .pt-tool { border: none; background: none; cursor: pointer; opacity: 0.55; padding: 0 2px; font-size: 11px; }
  .pt-tool:hover { opacity: 1; }
  .pt-del:hover { color: #b3261e; }
  /* Two-click delete confirm (#38d): ✓ commits (red), ✕ cancels (grey); both always
     full-opacity so the armed state reads clearly. */
  .pt-del-yes { opacity: 1; color: #b3261e; font-weight: 700; }
  .pt-del-no { opacity: 0.8; color: #6b7280; }
  /* Material / colour trigger (#38d) — a round "material sphere" button, hemispherically
     split black|white (evokes a shaded material-preview ball). Used both per-row (left
     column) and card-level (title row). UNSET = pure black|white halves; SET tints the
     light hemisphere to the override colour (--sw) so it reads distinct. A thin
     purple-grey ring keeps the white half legible on the light card. Opens RowMaterialPopover. */
  .pt-swatch { width: 14px; height: 14px; padding: 0; border-radius: 50%; cursor: pointer;
    box-sizing: border-box; flex: none; border: 1px solid #9b86c9;
    background: linear-gradient(90deg, #111 0 50%, #fff 50% 100%); }
  .pt-swatch.pt-swatch-set { background: linear-gradient(90deg, #111 0 50%, var(--sw, #7c5fc0) 50% 100%); }
  .pt-swatch:hover { outline: 1px solid #7c5fc0; outline-offset: 1px; }
  .pt-swatch:focus-visible { outline: 2px solid #7c5fc0; outline-offset: 1px; }

  /* RIGHT-WALL tools cluster — delete + the row's output socket, pinned to the card's
     right edge so they stay at the wall even while the columns scroll horizontally
     (sticky right; delete moved here + socket to the wall, user 2026-07-21). */
  .pt-cell-rtools, .pt-th-rtools { position: sticky; right: 0; width: 1%; text-align: right; white-space: nowrap; background: #fdfcff; }
  .pt-rcluster { display: inline-flex; align-items: center; gap: 3px; }
  /* The socket is the LAST child → flush against the right wall. */
  .pt-socket { border: none; background: none; cursor: crosshair; color: #b3261e; font-size: 13px; line-height: 1; padding: 0; }

  /* Compact add-row — a single small + at the bottom of the last row (replaces the
     footer button + row-count caption; less wasted vertical space, user 2026-07-13). */
  .pt-addrow-cell { text-align: left; padding: 2px 4px; border: none; }
  .pt-add-mini { font-size: 12px; line-height: 1; padding: 0 8px; border: 1px solid #c9b6ef; border-radius: 4px; background: #fff; cursor: pointer; color: #6b3fb0; }
  .pt-add-mini:hover { background: #efe7fb; }
</style>
