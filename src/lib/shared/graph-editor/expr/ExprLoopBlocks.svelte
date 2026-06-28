<script lang="ts">
  /**
   * ExprLoopBlocks — renders a `list<point>` formula as visual FOR blocks
   * (#11 loop readability). `map(range(s,e), f(i)=body)` shows as
   *   ↻ for i = s … e   →  [ body ]
   * with editable iterator / range / body; edits re-serialize to the formula.
   * Falls back (renders nothing) when the formula isn't a recognized loop shape —
   * the popup shows its raw-text editor instead. Parser: $lib/cad/expr-loops.
   */
  import { parseLoops, serializeLoops, type LoopBlock } from '$lib/cad/expr-loops';

  let { formula = $bindable(), parseable = $bindable(false) }:
    { formula: string; parseable?: boolean } = $props();

  let loops = $state<LoopBlock[]>([]);
  let lastSerialized = '';

  // text → blocks (only when the formula changed EXTERNALLY, not from my commit).
  $effect(() => {
    if (formula === lastSerialized) return;
    const f = parseLoops(formula);
    if (f) { loops = f.loops.map((l) => ({ ...l })); parseable = true; }
    else { parseable = false; }
  });

  function commit() {
    const s = serializeLoops({ loops: $state.snapshot(loops) as LoopBlock[] });
    lastSerialized = s;
    formula = s;
  }
</script>

{#if parseable && loops.length}
  <div class="lb-root">
    {#each loops as l, k (k)}
      {#if k > 0}<div class="lb-join">⊕ then join (concat)</div>{/if}
      <div class="lb-loop">
        <div class="lb-head">
          <span class="lb-icon" title="loop — runs once per index">↻</span>
          <span class="lb-kw">for</span>
          <input class="lb-var" bind:value={l.varName} onchange={commit} spellcheck="false"
            title="iterator — the index, runs 0, 1, 2, …" />
          <span class="lb-eq">=</span>
          <input class="lb-bound" bind:value={l.start} onchange={commit} spellcheck="false" title="start" />
          <span class="lb-dots">…</span>
          <input class="lb-bound" bind:value={l.stop} onchange={commit} spellcheck="false" title="stop (exclusive)" />
          <span class="lb-times" title="iterations">×</span>
        </div>
        <div class="lb-body">
          <span class="lb-arrow" title="each {l.varName} produces…">→</span>
          <textarea class="lb-bodytext" bind:value={l.body} onchange={commit}
            spellcheck="false" rows="2" placeholder="[ r , z ]"></textarea>
        </div>
      </div>
    {/each}
    <p class="lb-hint">Each <code>for</code> runs its body for every index in the range, collecting the
      <code>[r,z]</code> points; multiple loops are joined end-to-end. Edit the range or the body — switch to
      <em>text</em> for the raw formula.</p>
  </div>
{/if}

<style>
  .lb-root { display: flex; flex-direction: column; gap: 8px; }
  .lb-join { font: 600 11px Arial; color: #6d28d9; text-align: center; }
  .lb-loop { border: 1.5px solid #c4b5fd; border-radius: 8px; background: #faf8ff; overflow: hidden; }
  .lb-head { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: #f0e9ff; border-bottom: 1px solid #ddd6fe; }
  .lb-icon { font-size: 15px; color: #7c3aed; }
  .lb-kw { font: 700 12px ui-monospace, monospace; color: #6d28d9; }
  .lb-var { width: 34px; text-align: center; font: 700 13px ui-monospace, monospace; color: #4338ca; border: 1px solid #c4b5fd; border-radius: 5px; padding: 3px 4px; background: #fff; }
  .lb-eq, .lb-dots { color: #94a3b8; font: 13px ui-monospace, monospace; }
  .lb-bound { width: 70px; font: 12px ui-monospace, monospace; color: #334155; border: 1px solid #cbd5e1; border-radius: 5px; padding: 3px 6px; background: #fff; }
  .lb-bound:focus, .lb-var:focus { outline: none; border-color: #a855f7; }
  .lb-times { margin-left: auto; color: #c4b5fd; font-size: 13px; }
  .lb-body { display: flex; align-items: flex-start; gap: 6px; padding: 8px 10px; }
  .lb-arrow { color: #7c3aed; font-size: 14px; padding-top: 6px; }
  .lb-bodytext { flex: 1 1 auto; font: 12px/1.45 ui-monospace, monospace; color: #1e293b; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; resize: vertical; background: #fff; }
  .lb-bodytext:focus { outline: none; border-color: #a855f7; }
  .lb-hint { font-size: 11px; color: #94a3b8; margin: 2px 2px 0; }
  .lb-hint code { background: #ede9fe; color: #5b21b6; padding: 0 4px; border-radius: 3px; }
</style>
