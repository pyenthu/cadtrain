<script lang="ts">
  /**
   * ExprLoopBlocks — BUILD + edit a `list<point>` formula as visual FOR blocks
   * (#11). Variables-first: define vars, then ASSIGN one into a loop's count via a
   * dropdown. `map(range(s,e), f(i)=body)` shows as
   *   ↻ for i = 0 … [NPts ▾]   →  [ body ]
   * The body is a compact text field with autocomplete (type a variable / fn) —
   * no chips. One bare `+ for loop`; join with concat in the formula. Collapsible.
   */
  import { parseLoops, serializeLoops, type LoopBlock } from '$lib/cad/expr-loops';
  import ExpressionSrcPane, { type Completion } from './ExpressionSrcPane.svelte';
  import { ALLOWED_FUNCTIONS, ALLOWED_CONSTANTS } from '$lib/cad/expr-schema';

  let { formula = $bindable(), variables = [] }:
    { formula: string; variables?: string[] } = $props();

  let loops = $state<LoopBlock[]>([]);
  let lastSerialized = '';
  let collapsed = $state<Set<number>>(new Set());
  let customStop = $state<Set<number>>(new Set());

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
  const asDropdown = (k: number, l: LoopBlock) =>
    variables.length > 0 && !customStop.has(k) && variables.includes(l.stop);

  // body autocomplete corpus: the loop's own index + your variables + math.
  function bodyCompletions(loopVar: string): Completion[] {
    const out: Completion[] = [{ text: loopVar, kind: 'param' }];
    for (const v of variables) if (v) out.push({ text: v, kind: 'param' });
    for (const fn of ALLOWED_FUNCTIONS) out.push({ text: fn, kind: 'fn' });
    for (const c of ALLOWED_CONSTANTS) out.push({ text: c, kind: 'const' });
    return out;
  }
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
        <input class="lb-var" bind:value={l.varName} onchange={commit} spellcheck="false" title="iterator" />
        <span class="lb-eq">=</span>
        <input class="lb-bound sm" bind:value={l.start} onchange={commit} spellcheck="false" title="start" />
        <span class="lb-dots">…</span>
        {#if asDropdown(k, l)}
          <select class="lb-boundsel" value={l.stop} title="count — a variable"
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
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="lb-body" onfocusout={commit}>
          <span class="lb-arrow" title="each {l.varName} produces…">→</span>
          <div class="lb-bodysrc">
            <ExpressionSrcPane bind:src={l.body} completions={bodyCompletions(l.varName)}
              label="" rows={2} placeholder="[ r , z ]" />
          </div>
        </div>
      {/if}
    </div>
  {/each}

  {#if !loops.length}
    <p class="lb-empty">No loop yet{variables.length ? '' : ' — tip: add your variables (params) first'}.</p>
  {/if}

  <button class="lb-add" type="button" onclick={addLoop}>↻ + for loop</button>
</div>

<style>
  .lb-root { display: flex; flex-direction: column; gap: 6px; }
  .lb-join { font: 600 11px Arial; color: #6d28d9; text-align: center; }
  .lb-loop { border: 1.5px solid #c4b5fd; border-radius: 8px; background: #faf8ff; overflow: hidden; }
  .lb-head { display: flex; align-items: center; gap: 5px; padding: 5px 8px; background: #f0e9ff; }
  .lb-caret { font-size: 10px; color: #7c3aed; background: none; border: none; cursor: pointer; padding: 0 2px; }
  .lb-icon { font-size: 14px; color: #7c3aed; }
  .lb-kw { font: 700 12px ui-monospace, monospace; color: #6d28d9; }
  .lb-var { width: 30px; text-align: center; font: 700 13px ui-monospace, monospace; color: #4338ca; border: 1px solid #c4b5fd; border-radius: 5px; padding: 2px 3px; background: #fff; }
  .lb-eq, .lb-dots { color: #94a3b8; font: 13px ui-monospace, monospace; }
  .lb-bound { width: 64px; font: 12px ui-monospace, monospace; color: #334155; border: 1px solid #cbd5e1; border-radius: 5px; padding: 2px 6px; background: #fff; }
  .lb-bound.sm { width: 40px; }
  .lb-bound:focus, .lb-var:focus { outline: none; border-color: #a855f7; }
  .lb-boundsel { font: 600 12px ui-monospace, monospace; color: #4338ca; border: 1px solid #a5b4fc; border-radius: 5px; padding: 2px 6px; background: #eef2ff; cursor: pointer; }
  .lb-assign { font-size: 10px; color: #7c3aed; background: #ede9fe; border: 1px solid #c4b5fd; border-radius: 4px; cursor: pointer; padding: 2px 4px; }
  .lb-del { margin-left: auto; font: 700 14px Arial; color: #cbd5e1; background: none; border: none; cursor: pointer; padding: 0 2px; }
  .lb-del:hover { color: #ef4444; }
  .lb-body { display: flex; align-items: flex-start; gap: 6px; padding: 6px 8px; border-top: 1px solid #ddd6fe; }
  .lb-arrow { color: #7c3aed; font-size: 14px; padding-top: 5px; }
  .lb-bodysrc { flex: 1 1 auto; min-width: 0; }
  .lb-empty { font-size: 12px; color: #64748b; margin: 2px; }
  .lb-add { font: 700 12px Arial; color: #6d28d9; background: #f5f3ff; border: 1.5px dashed #c4b5fd; border-radius: 7px; padding: 6px 12px; cursor: pointer; width: 100%; }
  .lb-add:hover { background: #ede9fe; border-style: solid; border-color: #a78bfa; }
</style>
