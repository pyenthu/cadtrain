<!--
  PartSrcPickerPopover.svelte — the search-to-pick popover for a parts_table's
  TEMPLATE part (#38b R3). Opened from the selector chip on the parts_table card
  title row; filters the primitive list (the same ids the ＋ Call picker offers)
  and calls onPick(src) with the chosen template. Fixed-positioned (screen space)
  and anchored to the chip, like MaterialEditorPopover. Closes on ×/outside/Escape.
-->
<script lang="ts">
  let {
    srcs = [],
    srcMeta = {},
    anchor,
    current,
    onPick,
    onClose,
  }: {
    /** Candidate template ids (GEP's loaded pickerSrcs). */
    srcs?: string[];
    /** id → { source } so each row can show its origin tag. */
    srcMeta?: Record<string, { source?: string }>;
    anchor: { x: number; y: number };
    /** The currently-selected src (highlighted in the list). */
    current?: string;
    onPick: (src: string) => void;
    onClose: () => void;
  } = $props();

  let filter = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);
  $effect(() => { inputEl?.focus(); });

  const filtered = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    return q ? srcs.filter((s) => s.toLowerCase().includes(q)) : srcs;
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return; }
    // Enter picks the sole/first match — quick keyboard flow.
    if (e.key === 'Enter' && filtered.length) { onPick(filtered[0]); onClose(); }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="ps-scrim" onpointerdown={onClose}></div>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="ps-pop" style={`left:${anchor.x}px; top:${anchor.y}px`}
     onpointerdown={(e) => e.stopPropagation()}>
  <input class="ps-search" type="text" placeholder="search part…"
    bind:this={inputEl} bind:value={filter} onkeydown={onKey} />
  <div class="ps-list">
    {#each filtered as src (src)}
      <button class="ps-item" type="button" class:sel={src === current}
        onclick={() => { onPick(src); onClose(); }}>
        <span class="ps-name">{src}</span>
        {#if srcMeta[src]?.source}<span class="ps-src src-{srcMeta[src].source}">{srcMeta[src].source}</span>{/if}
      </button>
    {/each}
    {#if filtered.length === 0}
      <div class="ps-empty">{srcs.length ? 'no match' : 'loading…'}</div>
    {/if}
  </div>
</div>

<style>
  .ps-scrim { position: fixed; inset: 0; z-index: 1000; }
  .ps-pop {
    position: fixed; z-index: 1001; width: 200px; max-height: 300px;
    display: flex; flex-direction: column;
    background: #f6f1fe; border: 1.5px solid #7c3aed; border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.18); padding: 6px;
    font: 600 11px ui-monospace, monospace; color: #3a2a55;
  }
  .ps-search {
    width: 100%; box-sizing: border-box; height: 24px; padding: 0 6px; margin-bottom: 4px;
    font: 11px ui-monospace, monospace; color: #3a2a55;
    background: #fff; border: 1px solid #c9b6ef; border-radius: 4px;
  }
  .ps-search:focus { outline: none; border-color: #7c3aed; }
  .ps-list { overflow-y: auto; display: flex; flex-direction: column; gap: 1px; min-height: 0; }
  .ps-item {
    display: flex; align-items: center; justify-content: space-between; gap: 6px;
    width: 100%; box-sizing: border-box; padding: 3px 6px; cursor: pointer;
    background: none; border: none; border-radius: 4px; text-align: left;
    font: 600 11px ui-monospace, monospace; color: #3a2a55;
  }
  .ps-item:hover { background: #e9defb; }
  .ps-item.sel { background: #ddc9fa; }
  .ps-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ps-src { font-size: 8px; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.3px; flex: none; }
  .ps-empty { padding: 8px; opacity: 0.5; text-align: center; }
</style>
