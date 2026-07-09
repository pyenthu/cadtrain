<script lang="ts">
  /**
   * CompletionsEditor.svelte — the STRINGS TABLE editor for /wells (#42b-B, gap
   * doc §B2). Rows = casing / tubing / liner strings (`wson.ch[]`), each with
   * od / id / top / bottom / grade / weight / type. Add · remove · edit rows,
   * all WRITING THROUGH the `WellEditStore` (mutation + undo/redo).
   *
   * DUMB component: it takes the row DATA + write CALLBACKS via props; the shell
   * binds the callbacks to `WellEditStore.{addString,updateString,removeString}`
   * so every edit lands in the undoable store. Selection is lifted too
   * (`selectedIndex` + `onSelect`) so the shell can link a selected row to the
   * B4 inspector / 3D highlight. No store/Manifold/DOM-global reach — props only.
   *
   * Inputs commit on `change` (blur or Enter — the codebase's apply-on-Enter
   * convention), never per-keystroke; a blank field yields NaN which the store's
   * guard skips (never clobbers a value).
   */
  import type { CasingString, CasingType } from './wson';

  interface Props {
    /** The string rows to render — the shell passes `store.doc.ch ?? []`. */
    strings: CasingString[];
    /** Append a new default string (→ `store.addString`). */
    onAddString: () => void;
    /** Patch row `index` (→ `store.updateString`). */
    onUpdateString: (index: number, patch: Partial<CasingString>) => void;
    /** Remove row `index` (→ `store.removeString`). */
    onRemoveString: (index: number) => void;
    /** Currently-selected row (for highlight + inspector link), or null. */
    selectedIndex?: number | null;
    /** Row-select callback (null = clear). */
    onSelect?: (index: number | null) => void;
  }
  let {
    strings,
    onAddString,
    onUpdateString,
    onRemoveString,
    selectedIndex = null,
    onSelect,
  }: Props = $props();

  const TYPES: CasingType[] = ['conductor', 'surface', 'intermediate', 'production', 'liner', 'tubing'];

  /** Blank → NaN so the store's finite-guard skips it (never clobbers). */
  function num(v: string): number { return v.trim() === '' ? NaN : Number(v); }

  function editNum(i: number, field: keyof CasingString, ev: Event): void {
    onUpdateString(i, { [field]: num((ev.currentTarget as HTMLInputElement).value) } as Partial<CasingString>);
  }
  function editStr(i: number, field: keyof CasingString, ev: Event): void {
    const value = (ev.currentTarget as HTMLInputElement | HTMLSelectElement).value;
    onUpdateString(i, { [field]: value } as Partial<CasingString>);
  }
  function selectRow(i: number): void { onSelect?.(selectedIndex === i ? null : i); }
  /** Keyboard row-select — only when the key lands ON the row (not an input). */
  function rowKey(i: number, ev: KeyboardEvent): void {
    if (ev.target !== ev.currentTarget) return;
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectRow(i); }
  }

  /** Type-option list for a row — the union plus any legacy value (e.g. "casing"
   *  in the samples) so an existing row's type still displays. */
  function typeOptions(current: string | undefined): string[] {
    return current && !TYPES.includes(current as CasingType) ? [current, ...TYPES] : [...TYPES];
  }
</script>

<div class="ce">
  <div class="ce-head">
    <span class="ce-title">Strings</span>
    <span class="ce-count">{strings.length}</span>
    <button class="ce-add" type="button" title="Add string" onclick={onAddString}>+ string</button>
  </div>

  {#if strings.length === 0}
    <p class="ce-empty">No casing / tubing strings. <button type="button" class="ce-empty-add" onclick={onAddString}>Add one</button>.</p>
  {:else}
    <div class="ce-grid" role="table" aria-label="Casing and tubing strings">
      <div class="ce-row ce-row-hd" role="row">
        <span role="columnheader">Type</span>
        <span role="columnheader" title="Outer diameter (in)">OD</span>
        <span role="columnheader" title="Inner diameter (in)">ID</span>
        <span role="columnheader" title="Top MD (m)">Top</span>
        <span role="columnheader" title="Bottom MD (m)">Bot</span>
        <span role="columnheader">Grade</span>
        <span role="columnheader" title="Weight (lb/ft)">Wt</span>
        <span role="columnheader" aria-label="Remove"></span>
      </div>

      {#each strings as s, i (i)}
        <div class="ce-row" class:sel={selectedIndex === i} role="row" tabindex="0" onclick={() => selectRow(i)} onkeydown={(e) => rowKey(i, e)}>
          <select
            class="ce-type"
            value={s.type ?? ''}
            aria-label="Type"
            onclick={(e) => e.stopPropagation()}
            onchange={(e) => editStr(i, 'type', e)}
          >
            {#each typeOptions(s.type) as t (t)}
              <option value={t}>{t}</option>
            {/each}
          </select>
          <input class="ce-num" type="number" step="0.125" value={s.od ?? ''} aria-label="OD" onclick={(e) => e.stopPropagation()} onchange={(e) => editNum(i, 'od', e)} />
          <input class="ce-num" type="number" step="0.125" value={s.id ?? ''} aria-label="ID" onclick={(e) => e.stopPropagation()} onchange={(e) => editNum(i, 'id', e)} />
          <input class="ce-num" type="number" step="1" value={s.top ?? ''} aria-label="Top" onclick={(e) => e.stopPropagation()} onchange={(e) => editNum(i, 'top', e)} />
          <input class="ce-num" type="number" step="1" value={s.bot ?? ''} aria-label="Bottom" onclick={(e) => e.stopPropagation()} onchange={(e) => editNum(i, 'bot', e)} />
          <input class="ce-txt" type="text" value={s.grade ?? ''} aria-label="Grade" onclick={(e) => e.stopPropagation()} onchange={(e) => editStr(i, 'grade', e)} />
          <input class="ce-num" type="number" step="0.5" value={s.weight ?? ''} aria-label="Weight" onclick={(e) => e.stopPropagation()} onchange={(e) => editNum(i, 'weight', e)} />
          <button
            class="ce-del"
            type="button"
            title="Remove string"
            aria-label="Remove string {i + 1}"
            onclick={(e) => { e.stopPropagation(); onRemoveString(i); }}>×</button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .ce {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-family: ui-monospace, monospace;
    color: #cdd;
  }
  .ce-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ce-title {
    font: 700 12px Arial;
    color: #fff;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .ce-count {
    font-size: 11px;
    color: #778;
    background: #232340;
    border-radius: 9999px;
    padding: 1px 8px;
  }
  .ce-add {
    margin-left: auto;
    background: #232340;
    border: 1px solid #34345a;
    color: #aab;
    border-radius: 5px;
    padding: 3px 9px;
    font: 600 11px ui-monospace, monospace;
    cursor: pointer;
  }
  .ce-add:hover { border-color: #cc3333; color: #fff; }

  .ce-empty {
    margin: 0;
    font-size: 11px;
    color: #667;
  }
  .ce-empty-add {
    background: none;
    border: none;
    color: #7fa;
    cursor: pointer;
    font: inherit;
    padding: 0;
    text-decoration: underline;
  }

  .ce-grid {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ce-row {
    display: grid;
    grid-template-columns: minmax(88px, 1.4fr) repeat(2, 56px) repeat(2, 60px) minmax(52px, 1fr) 48px 22px;
    gap: 4px;
    align-items: center;
    padding: 2px 4px;
    border: 1px solid transparent;
    border-radius: 5px;
    cursor: pointer;
  }
  .ce-row:hover { background: #1a1a2a; }
  .ce-row.sel {
    background: #232340;
    border-color: #cc3333;
  }
  .ce-row-hd {
    cursor: default;
    color: #667;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .ce-row-hd:hover { background: none; }
  .ce-row-hd > span { padding: 0 3px; }

  .ce-num,
  .ce-txt,
  .ce-type {
    min-width: 0;
    background: #10101a;
    border: 1px solid #2a2a3e;
    border-radius: 4px;
    color: #e8e8ef;
    font: 11px ui-monospace, monospace;
    padding: 3px 4px;
  }
  .ce-num { text-align: right; }
  .ce-num:focus,
  .ce-txt:focus,
  .ce-type:focus {
    outline: none;
    border-color: #cc3333;
  }
  .ce-type { text-transform: capitalize; }

  .ce-del {
    background: none;
    border: none;
    color: #6a6a80;
    cursor: pointer;
    font-size: 15px;
    line-height: 1;
    padding: 0;
  }
  .ce-del:hover { color: #ff6666; }
</style>
