<!--
  Browse left-tab body — searchable term list (curated + seeds).
  Extracted from vocab/+page.svelte (R8 modularize). Presentational: the
  page owns term data, format/cache maps, and selection; this renders rows
  and bubbles search + clicks back up.
-->
<script lang="ts">
  type Term = string;
  type Row = { term: Term; entry: any; seed: boolean };
  type Fmt = 'graph' | 'text' | 'unknown' | 'missing' | 'rev' | 'seed';

  let {
    terms,
    selected,
    search = $bindable(),
    termFormat,
    cacheByExemplar,
    ruleSummary,
    onSelect,
  }: {
    terms: Row[];
    selected: Term | null;
    search: string;
    termFormat: (term: Term, entry: any, seed: boolean) => Fmt;
    cacheByExemplar: Record<string, number>;
    ruleSummary: (entry: any) => string;
    onSelect: (term: Term) => void;
  } = $props();
</script>

<div class="browser browser-full">
  <input
    type="text"
    class="browser-search"
    placeholder="search terms · synonyms · definitions"
    bind:value={search}
  />
  <div class="browser-list">
    {#each terms as { term, entry, seed } (term)}
      {@const fmt = termFormat(term, entry, seed)}
      {@const cacheCount = entry?.exemplar ? (cacheByExemplar[entry.exemplar] ?? 0) : 0}
      <button
        class="browser-row"
        class:active={selected === term}
        class:asm={!seed && entry.kind === 'asm'}
        class:seed
        type="button"
        onclick={() => onSelect(term)}
      >
        <span class="row-kind">{seed ? 'seed' : (entry.kind === 'asm' ? 'asm' : 'rev')}</span>
        <span class="row-format" class:graph={fmt === 'graph'} class:text={fmt === 'text'}
              class:unknown={fmt === 'unknown'} class:missing={fmt === 'missing'}
              class:rev={fmt === 'rev'} class:seed={fmt === 'seed'}
              title={fmt === 'graph' ? 'Graph-format source — hydrates in /graph-editor'
                   : fmt === 'text' ? 'Legacy text-body source — shows legacy banner in /graph-editor (regenerate to migrate)'
                   : fmt === 'missing' ? 'Not saved to volume yet'
                   : fmt === 'rev' ? 'Single revolved primitive — opens in /primitives'
                   : fmt === 'seed' ? 'Seed entry — not yet promoted'
                   : 'Loading format…'}>
          {#if fmt === 'graph'}🧬{:else if fmt === 'text'}📝{:else if fmt === 'missing'}∅{:else if fmt === 'unknown'}…{:else}—{/if}
        </span>
        {#if cacheCount > 0}
          <span class="row-cache-badge" title={`${cacheCount} cached bake${cacheCount === 1 ? '' : 's'} on volume`}>● {cacheCount}</span>
        {:else}
          <span class="row-cache-spacer"></span>
        {/if}
        <span class="row-name">{term}</span>
        <span class="row-rule">{seed
          ? `${entry.category} · ${entry.sub_category}${entry.variants?.length > 1 ? ` · ${entry.variants.length} variants` : ''}`
          : ruleSummary(entry)}</span>
      </button>
    {/each}
    {#if terms.length === 0}
      <div class="empty">no terms match "{search}"</div>
    {/if}
  </div>
</div>

<style>
  .browser { border-top: 1px solid #e5e7eb; max-height: 280px; display: grid; grid-template-rows: auto 1fr; }
  .browser-search { padding: 6px 12px; border: 0; border-bottom: 1px solid #f1f5f9; font: 13px Arial; outline: none; }
  .browser-search:focus { background: #f9fafb; }
  .browser-list { overflow: auto; }
  .browser-row { display: grid; grid-template-columns: 36px 22px 36px 120px 1fr; align-items: center; gap: 8px; padding: 4px 12px; width: 100%; background: transparent; border: 0; text-align: left; cursor: pointer; font: 12px Arial; }
  .row-cache-badge { display: inline-flex; align-items: center; gap: 2px; padding: 1px 6px; font: 600 10px ui-monospace, monospace; color: #065f46; background: #d1fae5; border: 1px solid #6ee7b7; border-radius: 9999px; white-space: nowrap; justify-self: start; }
  .row-cache-spacer { /* maintains grid column when no badge */ }
  .row-format { font: 13px 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', Arial; text-align: center; color: #6b7280; }
  .row-format.graph { color: #6d28d9; }
  .row-format.text  { color: #b45309; }
  .row-format.missing { color: #b91c1c; }
  .row-format.unknown { color: #d1d5db; font-style: italic; }
  .browser-row:hover { background: #f9fafb; }
  .browser-row.active { background: #e0f2fe; }
  .browser-row.asm .row-kind { background: #dcfce7; color: #14532d; }
  .browser-row.seed .row-kind { background: #fef3c7; color: #78350f; }
  .browser-row.seed.active { background: #fffbeb; }
  .row-kind { padding: 1px 6px; border-radius: 4px; background: #e0f2fe; color: #0c4a6e; font: 600 10px Arial; text-transform: uppercase; text-align: center; }
  .row-name { font: 600 12px ui-monospace, monospace; color: #1f2937; }
  .row-rule { color: #6b7280; font: 11px Arial; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Browse tab — fills the diagram-pane's 1fr row. */
  .browser-full { max-height: none !important; border-top: 0 !important; height: 100%; min-height: 0; }
  .browser-full .browser-list { min-height: 0; overflow-y: auto; }
  .empty { color: #6b7280; font: 12px Arial; padding: 8px; }
</style>
