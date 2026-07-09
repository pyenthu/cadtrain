<script lang="ts">
  /**
   * SurveyEditor.svelte — the MD / inc / az survey-station table for /wells
   * (#42b-B, gap doc §B3). Rows = `wson.profile[]` survey stations, each with
   * md (measured depth, m) · dev (inclination, °) · az (azimuth, °). Add · remove
   * · edit stations, all WRITING THROUGH the `WellEditStore`.
   *
   * A station edit signals a LIVE RE-WARP: after any mutation the component calls
   * `onReWarp` so the shell re-bakes the trajectory (the survey drives the warp).
   * (The store ALSO fires its own `onSurveyChange` for survey mutations — use
   * whichever seam the shell prefers; both are the same signal.)
   *
   * DUMB component: row DATA + write CALLBACKS via props; the shell binds them to
   * `WellEditStore.{addStation,updateStation,removeStation}`. Selection is lifted
   * (`selectedIndex` / `onSelect`) for a highlight / inspector link. Inputs commit
   * on `change` (blur or Enter); a blank field → NaN which the store's guard skips.
   */
  import type { SurveyStation } from './wson';

  interface Props {
    /** The survey stations — the shell passes `store.doc.profile ?? []`. */
    stations: SurveyStation[];
    /** Append a new station (→ `store.addStation`). */
    onAddStation: () => void;
    /** Patch station `index` (→ `store.updateStation`). */
    onUpdateStation: (index: number, patch: Partial<SurveyStation>) => void;
    /** Remove station `index` (→ `store.removeStation`). */
    onRemoveStation: (index: number) => void;
    /** LIVE RE-WARP hook — fired after any station mutation so the shell re-bakes
     *  the trajectory. Optional (the store's `onSurveyChange` is the alternative). */
    onReWarp?: () => void;
    /** Currently-selected station (for highlight + inspector link), or null. */
    selectedIndex?: number | null;
    /** Station-select callback (null = clear). */
    onSelect?: (index: number | null) => void;
  }
  let {
    stations,
    onAddStation,
    onUpdateStation,
    onRemoveStation,
    onReWarp,
    selectedIndex = null,
    onSelect,
  }: Props = $props();

  /** Blank → NaN so the store's finite-guard skips it (never clobbers). */
  function num(v: string): number { return v.trim() === '' ? NaN : Number(v); }

  function edit(i: number, field: keyof SurveyStation, ev: Event): void {
    onUpdateStation(i, { [field]: num((ev.currentTarget as HTMLInputElement).value) } as Partial<SurveyStation>);
    onReWarp?.(); // survey moved → live re-warp
  }
  function add(): void { onAddStation(); onReWarp?.(); }
  function remove(i: number): void { onRemoveStation(i); onReWarp?.(); }
  function selectRow(i: number): void { onSelect?.(selectedIndex === i ? null : i); }
  /** Keyboard row-select — only when the key lands ON the row (not an input). */
  function rowKey(i: number, ev: KeyboardEvent): void {
    if (ev.target !== ev.currentTarget) return;
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectRow(i); }
  }

  /** A survey with any station off-vertical is deviated (matches `isDeviated`). */
  const deviated = $derived(stations.some((s) => Number(s.dev) > 0.5));
</script>

<div class="se">
  <div class="se-head">
    <span class="se-title">Survey</span>
    <span class="se-count">{stations.length}</span>
    {#if stations.length}
      <span class="se-kind">{deviated ? '⟋ deviated' : '│ vertical'}</span>
    {/if}
    <button class="se-add" type="button" title="Add station" onclick={add}>+ station</button>
  </div>

  {#if stations.length === 0}
    <p class="se-empty">No survey — the well is vertical. <button type="button" class="se-empty-add" onclick={add}>Add a station</button> to deviate it.</p>
  {:else}
    <div class="se-grid" role="table" aria-label="Survey stations">
      <div class="se-row se-row-hd" role="row">
        <span role="columnheader" title="Measured depth (m)">MD</span>
        <span role="columnheader" title="Inclination / deviation (deg)">Inc°</span>
        <span role="columnheader" title="Azimuth (deg)">Az°</span>
        <span role="columnheader" aria-label="Remove"></span>
      </div>

      {#each stations as s, i (i)}
        <div class="se-row" class:sel={selectedIndex === i} role="row" tabindex="0" onclick={() => selectRow(i)} onkeydown={(e) => rowKey(i, e)}>
          <input class="se-num" type="number" step="1" value={s.md ?? ''} aria-label="MD" onclick={(e) => e.stopPropagation()} onchange={(e) => edit(i, 'md', e)} />
          <input class="se-num" type="number" step="0.1" value={s.dev ?? ''} aria-label="Inclination" onclick={(e) => e.stopPropagation()} onchange={(e) => edit(i, 'dev', e)} />
          <input class="se-num" type="number" step="0.1" value={s.az ?? ''} aria-label="Azimuth" onclick={(e) => e.stopPropagation()} onchange={(e) => edit(i, 'az', e)} />
          <button
            class="se-del"
            type="button"
            title="Remove station"
            aria-label="Remove station {i + 1}"
            onclick={(e) => { e.stopPropagation(); remove(i); }}>×</button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .se {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-family: ui-monospace, monospace;
    color: #cdd;
  }
  .se-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .se-title {
    font: 700 12px Arial;
    color: #fff;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .se-count {
    font-size: 11px;
    color: #778;
    background: #232340;
    border-radius: 9999px;
    padding: 1px 8px;
  }
  .se-kind {
    font-size: 11px;
    color: #ffb;
  }
  .se-add {
    margin-left: auto;
    background: #232340;
    border: 1px solid #34345a;
    color: #aab;
    border-radius: 5px;
    padding: 3px 9px;
    font: 600 11px ui-monospace, monospace;
    cursor: pointer;
  }
  .se-add:hover { border-color: #cc3333; color: #fff; }

  .se-empty {
    margin: 0;
    font-size: 11px;
    color: #667;
  }
  .se-empty-add {
    background: none;
    border: none;
    color: #7fa;
    cursor: pointer;
    font: inherit;
    padding: 0;
    text-decoration: underline;
  }

  .se-grid {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .se-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 22px;
    gap: 4px;
    align-items: center;
    padding: 2px 4px;
    border: 1px solid transparent;
    border-radius: 5px;
    cursor: pointer;
  }
  .se-row:hover { background: #1a1a2a; }
  .se-row.sel {
    background: #232340;
    border-color: #cc3333;
  }
  .se-row-hd {
    cursor: default;
    color: #667;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .se-row-hd:hover { background: none; }
  .se-row-hd > span { padding: 0 3px; }

  .se-num {
    min-width: 0;
    background: #10101a;
    border: 1px solid #2a2a3e;
    border-radius: 4px;
    color: #e8e8ef;
    font: 11px ui-monospace, monospace;
    padding: 3px 4px;
    text-align: right;
  }
  .se-num:focus {
    outline: none;
    border-color: #cc3333;
  }

  .se-del {
    background: none;
    border: none;
    color: #6a6a80;
    cursor: pointer;
    font-size: 15px;
    line-height: 1;
    padding: 0;
  }
  .se-del:hover { color: #ff6666; }
</style>
