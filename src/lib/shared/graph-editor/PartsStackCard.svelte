<!--
  PartsStackCard.svelte — the "completion string" card body (the heterogeneous,
  auto-stacked sibling of PartsTableCard). Each ROW is a DIFFERENT element part:
  the row shows only the PART-TYPE picker + its `length` inline; every OTHER param
  the part has, plus the per-row material, lives in the ⚙ popover (StackRowPopover),
  driven by that part's own meta.params. The rows mate end-to-end via `stack([...])`
  (emit), so row order == physical order down the string.

  DECOUPLED like PartsTableCard: it takes the PartsStackNode + a `paramsForSrc`
  resolver and emits intent callbacks; NodeCard maps them to the setPartsStack*
  mutators. Imports nothing from GEP / the graph.
-->
<script lang="ts">
  import type { PartsStackNode, ArgValue, RowMaterial } from '$lib/graph/composition-graph-types';
  import StackRowPopover from './StackRowPopover.svelte';

  let {
    node,
    paramsForSrc,
    onAddRow,
    onRemoveRow,
    onRowSrc,
    onRowArg,
    onRowMaterial,
  }: {
    node: PartsStackNode;
    /** The ordered meta.params names of a given part `src` (from `expected.params`). */
    paramsForSrc: (src: string) => string[];
    onAddRow?: () => void;
    onRemoveRow?: (idx: number) => void;
    /** Open the per-row part-type SEARCH picker (anchored to the chip). */
    onRowSrc?: (idx: number, ev: MouseEvent) => void;
    /** Set / clear one arg of row `idx` — a literal, an `{expr}`, or null to clear. */
    onRowArg?: (idx: number, name: string, value: { expr: string } | number | string | boolean | null) => void;
    /** Set / clear row `idx`'s material override (null clears). */
    onRowMaterial?: (idx: number, material: RowMaterial | null) => void;
  } = $props();

  const rows = $derived(Array.isArray(node.rows) ? node.rows : []);

  /** The current text for a row's length cell — its `length` arg (literal or ƒ), else ''. */
  function lengthText(v: ArgValue | undefined): string {
    if (!v) return '';
    if (v.kind === 'literal') return String(v.value);
    if (v.kind === 'expr') return v.expr;
    return `p.${v.param}${v.field ? '.' + v.field : ''}`;
  }
  /** Commit a length cell on Enter/blur — same coercion as PartsTableCard.commitCell:
   *  blank clears, a leading `=` or a non-numeric string is an expr, else a literal. */
  function commitLength(idx: number, raw: string) {
    const t = raw.trim();
    if (t === '') { onRowArg?.(idx, 'length', null); return; }
    if (t.startsWith('=')) { onRowArg?.(idx, 'length', { expr: t.slice(1).trim() }); return; }
    const n = Number(t);
    if (Number.isFinite(n) && /^[-+]?[0-9.eE]+$/.test(t)) onRowArg?.(idx, 'length', n);
    else onRowArg?.(idx, 'length', { expr: t });
  }

  /** Does a row carry any ⚙-level override (a non-length arg or a material)? Tints the ⚙. */
  function hasMore(idx: number): boolean {
    const r = rows[idx];
    if (!r) return false;
    const argKeys = Object.keys(r.args ?? {}).filter((k) => k !== 'length');
    const m = r.material;
    return argKeys.length > 0 || !!(m && (m.color || m.preset || typeof m.opacity === 'number'));
  }

  // The ⚙ "more" popover — its open row + anchor live HERE (self-contained, #38d style).
  let morePopIdx = $state<number | null>(null);
  let moreAnchor = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  function openMore(idx: number, ev: MouseEvent) {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    moreAnchor = { x: r.left, y: r.bottom + 4 };
    morePopIdx = idx;
    confirmDelIdx = null;
  }

  // Two-click delete confirm (no native confirm() — it wedges the extension).
  let confirmDelIdx = $state<number | null>(null);
</script>

<div class="ps-card">
  <div class="ps-scroll">
    <table class="ps-table">
      <thead>
        <tr>
          <th class="ps-th ps-th-el">element</th>
          <th class="ps-th ps-th-len">length</th>
          <th class="ps-th ps-th-tools"></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row, idx (idx)}
          <tr class="ps-row">
            <!-- Part-type picker chip — each row its OWN element (heterogeneous). -->
            <td class="ps-cell ps-cell-el">
              <button class="ps-srcsel" class:empty={!row.src} title="choose the element part"
                onclick={(e) => onRowSrc?.(idx, e)}>
                <span class="ps-srcsel-id">{row.src || 'select part'}</span>
                <span class="ps-srcsel-ic">🔍</span>
              </button>
            </td>
            <!-- The ONE inline param: length. Everything else → the ⚙ popover. -->
            <td class="ps-cell ps-cell-len" class:ps-fx={row.args?.length && row.args.length.kind !== 'literal'}>
              <input class="ps-in" value={lengthText(row.args?.length)} placeholder="·"
                onkeydown={(e) => { if (e.key === 'Enter') commitLength(idx, (e.currentTarget as HTMLInputElement).value); }}
                onblur={(e) => commitLength(idx, (e.currentTarget as HTMLInputElement).value)} />
            </td>
            <!-- Right-wall tools: ⚙ more (params + material) then two-click delete. -->
            <td class="ps-cell ps-cell-tools">
              <span class="ps-rcluster">
                <button class="ps-tool ps-more" class:on={hasMore(idx)} title="more — {row.src || 'element'} params + material"
                  onclick={(e) => openMore(idx, e)} aria-label="row {idx + 1} params and material">⚙</button>
                {#if confirmDelIdx === idx}
                  <button class="ps-tool ps-del-yes" title="confirm — remove element {idx + 1}"
                    onclick={() => { onRemoveRow?.(idx); confirmDelIdx = null; }} aria-label="confirm remove element {idx + 1}">✓</button>
                  <button class="ps-tool ps-del-no" title="cancel"
                    onclick={() => (confirmDelIdx = null)} aria-label="cancel remove">✕</button>
                {:else}
                  <button class="ps-tool ps-del" title="remove element {idx + 1}"
                    onclick={() => (confirmDelIdx = idx)} aria-label="remove element {idx + 1}">🗑</button>
                {/if}
              </span>
            </td>
          </tr>
        {/each}
        <tr class="ps-addrow">
          <td class="ps-cell ps-addrow-cell" colspan="3">
            <button class="ps-add-mini" title="add an element" onclick={() => onAddRow?.()} aria-label="add an element">＋ element</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</div>

{#if morePopIdx !== null}
  <StackRowPopover
    src={rows[morePopIdx]?.src ?? ''}
    paramNames={paramsForSrc(rows[morePopIdx]?.src ?? '').filter((p) => p !== 'length')}
    args={rows[morePopIdx]?.args ?? {}}
    material={rows[morePopIdx]?.material ?? null}
    anchor={moreAnchor}
    onArg={(name, value) => onRowArg?.(morePopIdx as number, name, value)}
    onMaterial={(m) => onRowMaterial?.(morePopIdx as number, m)}
    onClose={() => (morePopIdx = null)}
  />
{/if}

<style>
  .ps-card { display: flex; flex-direction: column; padding: 0; box-sizing: border-box; height: 100%; font-size: 11px; font-weight: 600; color: #34235a; background: #fdfcff; border: 1.5px solid #6d4fb0; border-radius: 8px; overflow: hidden; min-width: 220px; }
  .ps-scroll { flex: 1 1 auto; min-height: 0; overflow-x: auto; overflow-y: hidden; }
  .ps-table { border-collapse: collapse; width: 100%; }
  .ps-th { text-align: left; font-weight: 600; padding: 0 4px; border: 1px solid #7c5fc0; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.3px; font-size: 9px; color: #6b3fb0; }
  .ps-th-len { width: 5.5ch; }
  .ps-th-tools { width: 1%; }
  .ps-cell { padding: 1px 4px; border: 1px solid #a98fd8; }

  /* Element (part-type) picker chip — fills the column, opens the search picker. */
  .ps-cell-el { min-width: 8ch; }
  .ps-srcsel { display: flex; align-items: center; gap: 4px; width: 100%; box-sizing: border-box; height: 22px; padding: 0 5px; border: 1px solid #c9b6ef; border-radius: 4px; background: #fff; cursor: pointer; font: 600 11px ui-monospace, monospace; color: #3a2a55; }
  .ps-srcsel.empty { color: #9b86c9; font-style: italic; }
  .ps-srcsel:hover { border-color: #8a5cd6; background: #f6f1fe; }
  .ps-srcsel-id { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
  .ps-srcsel-ic { flex: none; opacity: 0.6; font-size: 10px; }

  .ps-cell-len { width: 5.5ch; }
  .ps-in { width: 100%; min-width: 3ch; box-sizing: border-box; font-size: 11px; font-weight: 600; padding: 1px 4px; border: 1px solid transparent; border-radius: 4px; background: #fff; }
  .ps-in:focus { border-color: #8a5cd6; outline: none; }
  .ps-fx .ps-in { color: #6b3fb0; font-style: italic; }

  /* Right-wall tools — ⚙ more + two-click delete. */
  .ps-cell-tools { width: 1%; text-align: right; white-space: nowrap; }
  .ps-rcluster { display: inline-flex; align-items: center; gap: 3px; }
  .ps-tool { border: none; background: none; cursor: pointer; opacity: 0.55; padding: 0 2px; font-size: 12px; }
  .ps-tool:hover { opacity: 1; }
  .ps-more.on { opacity: 1; color: #7c3aed; }
  .ps-del:hover { color: #b3261e; }
  .ps-del-yes { opacity: 1; color: #b3261e; font-weight: 700; }
  .ps-del-no { opacity: 0.8; color: #6b7280; }

  .ps-addrow-cell { text-align: left; padding: 2px 4px; border: none; }
  .ps-add-mini { font-size: 10px; line-height: 1; padding: 2px 8px; border: 1px solid #c9b6ef; border-radius: 4px; background: #fff; cursor: pointer; color: #6b3fb0; font-weight: 600; }
  .ps-add-mini:hover { background: #efe7fb; }
</style>
