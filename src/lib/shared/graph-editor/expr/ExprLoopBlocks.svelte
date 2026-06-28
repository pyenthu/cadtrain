<script lang="ts">
  /**
   * ExprLoopBlocks — BUILD + edit a `list<point>` formula as visual FOR blocks
   * (#11). Variables-first: define vars (params), then ASSIGN one into a loop's
   * count via a dropdown. `map(range(s,e), f(i)=body)` shows as
   *   ↻ for i = 0 … [NPts ▾]   →  [ body ]
   * One bare `+ for loop` (no shape presets); join loops with concat in the
   * formula. Each block is collapsible. Parser: $lib/cad/expr-loops.
   */
  import { parseLoops, serializeLoops, type LoopBlock } from '$lib/cad/expr-loops';

  let { formula = $bindable(), variables = [] }:
    { formula: string; variables?: string[] } = $props();

  let loops = $state<LoopBlock[]>([]);
  let lastSerialized = '';
  let collapsed = $state<Set<number>>(new Set());
  let customStop = $state<Set<number>>(new Set()); // force the count to a text field

  $effect(() => {
    if (formula === lastSerialized) return;
    const f = parseLoops(formula);
    loops = f ? f.loops.map((l) => ({ ...l })) : [];
  });

  function commit() {
    const s = loops.length ? serializeLoops({ loops: $state.snapshot(loops) as LoopBlock[] }) : '';
    lastSerialized = s;
    formula = s;
  }
  function addLoop() {
    loops = [...loops, { varName: 'i', start: '0', stop: variables[0] ?? 'N', body: '[i, 0]' }];
    commit();
  }
  function removeLoop(k: number) { loops = loops.filter((_, j) => j !== k); commit(); }
  function toggleSet(set: Set<number>, k: number): Set<number> {
    const s = new Set(set); s.has(k) ? s.delete(k) : s.add(k); return s;
  }
  function onStopSelect(k: number, v: string) {
    if (v === '__custom') { customStop = new Set(customStop).add(k); return; }
    loops[k]!.stop = v; commit();
  }
  // the count is a dropdown when it IS one of the variables (and not forced to text).
  const asDropdown = (k: number, l: LoopBlock) =>
    variables.length > 0 && !customStop.has(k) && variables.includes(l.stop);
</script>

<div class="lb-root">
  {#each loops as l, k (k)}
    {#if k > 0}<div class="lb-join">⊕ then join (concat)</div>{/if}
    {@const open = !collapsed.has(k)}
    <div class="lb-loop">
      <div class="lb-head">
        <button class="lb-caret" type="button" title={open ? 'collapse' : 'expand'}
          onclick={() => (collapsed = toggleSet(collapsed, k))}>{open ? '▾' : '▸'}</button>
        <span class="lb-icon" title="loop — runs once per index">↻</span>
        <span class="lb-kw">for</span>
        <input class="lb-var" bind:value={l.varName} onchange={commit} spellcheck="false"
          title="iterator — runs 0, 1, 2, …" />
        <span class="lb-eq">=</span>
        <input class="lb-bound sm" bind:value={l.start} onchange={commit} spellcheck="false" title="start" />
        <span class="lb-dots">…</span>
        {#if asDropdown(k, l)}
          <select class="lb-boundsel" value={l.stop}
            title="count — a variable"
            onchange={(e) => onStopSelect(k, (e.currentTarget as HTMLSelectElement).value)}>
            {#each variables as v}<option value={v}>{v}</option>{/each}
            <option value="__custom">123 custom…</option>
          </select>
        {:else}
          <input class="lb-bound" bind:value={l.stop} onchange={commit} spellcheck="false" title="count (stop)" />
          {#if variables.length}
            <button class="lb-assign" type="button" title="assign a variable"
              onclick={() => (customStop = toggleSet(customStop, k))}>▾</button>
          {/if}
        {/if}
        <button class="lb-del" type="button" title="remove this loop" onclick={() => removeLoop(k)}>×</button>
      </div>
      {#if open}
        <div class="lb-body">
          <span class="lb-arrow" title="each {l.varName} produces…">→</span>
          <textarea class="lb-bodytext" bind:value={l.body} onchange={commit}
            spellcheck="false" rows="2" placeholder="[ r , z ]"></textarea>
        </div>
      {/if}
    </div>
  {/each}

  {#if !loops.length}
    <p class="lb-empty">No loop yet{variables.length ? '' : ' — tip: add your variables (params) first'}.</p>
  {/if}

  <button class="lb-add" type="button" onclick={addLoop}>↻ + for loop</button>

  {#if loops.length}
    <p class="lb-hint">A <code>for</code> runs its body for every index in the range, collecting the
      <code>[r,z]</code> points. Set the count to one of your variables; join loops with
      <code>concat(…)</code> (or switch to <em>text</em>).</p>
  {/if}
</div>

<style>
  .lb-root { display: flex; flex-direction: column; gap: 8px; }
  .lb-join { font: 600 11px Arial; color: #6d28d9; text-align: center; }
  .lb-loop { border: 1.5px solid #c4b5fd; border-radius: 8px; background: #faf8ff; overflow: hidden; }
  .lb-head { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: #f0e9ff; }
  .lb-caret { font-size: 10px; color: #7c3aed; background: none; border: none; cursor: pointer; padding: 0 2px; }
  .lb-icon { font-size: 15px; color: #7c3aed; }
  .lb-kw { font: 700 12px ui-monospace, monospace; color: #6d28d9; }
  .lb-var { width: 32px; text-align: center; font: 700 13px ui-monospace, monospace; color: #4338ca; border: 1px solid #c4b5fd; border-radius: 5px; padding: 3px 4px; background: #fff; }
  .lb-eq, .lb-dots { color: #94a3b8; font: 13px ui-monospace, monospace; }
  .lb-bound { width: 70px; font: 12px ui-monospace, monospace; color: #334155; border: 1px solid #cbd5e1; border-radius: 5px; padding: 3px 6px; background: #fff; }
  .lb-bound.sm { width: 44px; }
  .lb-bound:focus, .lb-var:focus { outline: none; border-color: #a855f7; }
  .lb-boundsel { font: 600 12px ui-monospace, monospace; color: #4338ca; border: 1px solid #a5b4fc; border-radius: 5px; padding: 3px 6px; background: #eef2ff; cursor: pointer; }
  .lb-assign { font-size: 10px; color: #7c3aed; background: #ede9fe; border: 1px solid #c4b5fd; border-radius: 4px; cursor: pointer; padding: 2px 4px; }
  .lb-del { margin-left: auto; font: 700 14px Arial; color: #cbd5e1; background: none; border: none; cursor: pointer; padding: 0 2px; }
  .lb-del:hover { color: #ef4444; }
  .lb-body { display: flex; align-items: flex-start; gap: 6px; padding: 8px 10px; border-top: 1px solid #ddd6fe; }
  .lb-arrow { color: #7c3aed; font-size: 14px; padding-top: 6px; }
  .lb-bodytext { flex: 1 1 auto; font: 12px/1.45 ui-monospace, monospace; color: #1e293b; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; resize: vertical; background: #fff; }
  .lb-bodytext:focus { outline: none; border-color: #a855f7; }
  .lb-empty { font-size: 12px; color: #64748b; margin: 2px; }
  .lb-add { font: 700 12px Arial; color: #6d28d9; background: #f5f3ff; border: 1.5px dashed #c4b5fd; border-radius: 7px; padding: 7px 14px; cursor: pointer; width: 100%; }
  .lb-add:hover { background: #ede9fe; border-style: solid; border-color: #a78bfa; }
  .lb-hint { font-size: 11px; color: #94a3b8; margin: 2px 2px 0; }
  .lb-hint code { background: #ede9fe; color: #5b21b6; padding: 0 4px; border-radius: 3px; }
</style>
