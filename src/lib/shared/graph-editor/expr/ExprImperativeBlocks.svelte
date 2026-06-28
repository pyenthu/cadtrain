<script lang="ts">
  /**
   * ExprImperativeBlocks — BUILD + edit a `list<point>` output as an IMPERATIVE
   * accumulator program (#11). The visual form of expr-imperative.ts:
   *   ◇ poly : list<point>
   *   ↻ for i = 0 … [NPts ▾]
   *       │ rx = (r0 + growth*i/NPts)*cos(…)   │  ← ONE text field — type the body:
   *       │ rz = (r0 + growth*i/NPts)*sin(…)   │     temp vars + the append. Autocomplete
   *       │ poly.append([rx, rz])              │     + resizable. No per-statement GUI.
   *   return poly
   * A functional `map/concat` formula CONVERTS to this on load. Count = a variable
   * dropdown; loops collapsible; bodies resizable.
   */
  import { parseImperative, serializeImperative, type ImperativeProgram } from '$lib/cad/expr-imperative';
  import { parseLoops, type LoopForm } from '$lib/cad/expr-loops';
  import ExpressionSrcPane, { type Completion } from './ExpressionSrcPane.svelte';
  import { ALLOWED_FUNCTIONS, ALLOWED_CONSTANTS } from '$lib/cad/expr-schema';

  let { formula = $bindable(), variables = [], onAddVariable }:
    { formula: string; variables?: string[]; onAddVariable?: () => void } = $props();

  let prog = $state<ImperativeProgram | null>(null);
  let lastSerialized = '';
  let collapsed = $state<Set<number>>(new Set());
  let customStop = $state<Set<number>>(new Set());
  let addOpen = $state(false);

  function loopsToImperative(form: LoopForm): ImperativeProgram {
    return {
      accumulators: ['poly'], vars: [],
      loops: form.loops.map((l) => ({
        loopVar: l.varName, start: l.start, stop: l.stop,
        body: `poly.append(${l.body})`,
      })),
      result: 'poly',
    };
  }

  $effect(() => {
    if (formula === lastSerialized) return;
    let p = parseImperative(formula);
    if (!p) { const f = parseLoops(formula); if (f) p = loopsToImperative(f); }
    prog = p ? structuredClone(p) : null;
  });

  function commit() {
    if (!prog || !prog.loops.length) { lastSerialized = ''; formula = ''; return; }
    const s = serializeImperative($state.snapshot(prog) as ImperativeProgram);
    lastSerialized = s; formula = s;
  }
  function ensureProg(): ImperativeProgram {
    if (!prog) prog = { accumulators: ['poly'], vars: [], loops: [], result: 'poly' };
    return prog;
  }
  function addLoop() {
    const p = ensureProg();
    p.loops = [...p.loops, { loopVar: 'i', start: '0', stop: variables[0] ?? 'N',
      body: `${p.accumulators[0]}.append([i, 0])` }];
    addOpen = false; commit();
  }
  function removeLoop(k: number) { if (prog) { prog.loops = prog.loops.filter((_, j) => j !== k); commit(); } }
  function addExpr() {
    const p = ensureProg();
    p.vars = [...p.vars, { kind: 'assign', name: `v${p.vars.length + 1}`, expr: '0' }];
    addOpen = false; commit();
  }
  function removeVar(vi: number) { if (prog) { prog.vars = prog.vars.filter((_, j) => j !== vi); commit(); } }
  function toggleSet(set: Set<number>, k: number): Set<number> {
    const s = new Set(set); s.has(k) ? s.delete(k) : s.add(k); return s;
  }
  function onStopSelect(k: number, v: string) {
    if (v === '__custom') { customStop = new Set(customStop).add(k); return; }
    prog!.loops[k]!.stop = v; commit();
  }
  const asDropdown = (k: number, stop: string) =>
    variables.length > 0 && !customStop.has(k) && variables.includes(stop);

  function bodyCompletions(loopVar?: string): Completion[] {
    const out: Completion[] = [];
    if (loopVar) out.push({ text: loopVar, kind: 'param' });
    for (const v of prog?.vars ?? []) out.push({ text: v.name, kind: 'param' });
    for (const a of prog?.accumulators ?? []) out.push({ text: a, kind: 'param' });
    for (const v of variables) if (v) out.push({ text: v, kind: 'param' });
    for (const fn of ALLOWED_FUNCTIONS) out.push({ text: fn, kind: 'fn' });
    for (const c of ALLOWED_CONSTANTS) out.push({ text: c, kind: 'const' });
    return out;
  }
</script>

<div class="ib-root">
  <!-- top bar: the accumulator + the unified "+ add" (variable / expression / loop) -->
  <div class="ib-topbar">
    <span class="ib-acc-glyph">◇</span> <code>{prog?.accumulators[0] ?? 'poly'}</code>
    <span class="ib-acc-ty">: list⟨point⟩</span>
    <span class="ib-sp"></span>
    <div class="ib-addwrap">
      <button class="ib-addbtn" type="button" class:on={addOpen} onclick={() => (addOpen = !addOpen)}>+ add ▾</button>
      {#if addOpen}
        <div class="ib-addmenu">
          {#if onAddVariable}<button type="button" onclick={() => { onAddVariable?.(); addOpen = false; }}><b>variable</b><span>an input param</span></button>{/if}
          <button type="button" onclick={addExpr}><b>expression</b><span>an intermediate value (once)</span></button>
          <button type="button" onclick={addLoop}><b>loop</b><span>a for-loop</span></button>
        </div>
      {/if}
    </div>
  </div>

  <!-- top-level expressions — computed once, before the loops -->
  {#each prog?.vars ?? [] as v, vi (vi)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="ib-varrow" onfocusout={commit}>
      <input class="ib-sname" bind:value={v.name} onchange={commit} spellcheck="false" />
      <span class="ib-eq">=</span>
      <div class="ib-sbody"><ExpressionSrcPane bind:src={v.expr} completions={bodyCompletions()} label="" rows={1} placeholder="(r0 + growth) / 2" /></div>
      <button class="ib-del" type="button" title="remove" onclick={() => removeVar(vi)}>×</button>
    </div>
  {/each}

  {#each prog?.loops ?? [] as lp, k (k)}
    {@const open = !collapsed.has(k)}
    <div class="ib-loop">
      <div class="ib-head">
        <button class="ib-caret" type="button" onclick={() => (collapsed = toggleSet(collapsed, k))}>{open ? '▾' : '▸'}</button>
        <span class="ib-icon">↻</span><span class="ib-kw">for</span>
        <input class="ib-var" bind:value={lp.loopVar} onchange={commit} spellcheck="false" />
        <span class="ib-eq">=</span>
        <input class="ib-bound sm" bind:value={lp.start} onchange={commit} spellcheck="false" title="start" />
        <span class="ib-dots">…</span>
        {#if asDropdown(k, lp.stop)}
          <select class="ib-boundsel" value={lp.stop} onchange={(e) => onStopSelect(k, (e.currentTarget as HTMLSelectElement).value)}>
            {#each variables as v}<option value={v}>{v}</option>{/each}
            <option value="__custom">123 custom…</option>
          </select>
        {:else}
          <input class="ib-bound" bind:value={lp.stop} onchange={commit} spellcheck="false" title="count" />
          {#if variables.length}<button class="ib-assign" type="button" title="assign a variable" onclick={() => (customStop = toggleSet(customStop, k))}>▾</button>{/if}
        {/if}
        <button class="ib-del" type="button" title="remove loop" onclick={() => removeLoop(k)}>×</button>
      </div>
      {#if open}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="ib-body" onfocusout={commit}>
          <ExpressionSrcPane bind:src={lp.body} completions={bodyCompletions(lp.loopVar)}
            label="" rows={3} placeholder={`rx = …\nrz = …\n${prog?.accumulators[0]}.append([rx, rz])`} />
        </div>
      {/if}
    </div>
  {/each}

  {#if prog && prog.loops.length}
    <div class="ib-return">return <code>{prog.result}</code></div>
  {:else}
    <p class="ib-empty">Nothing yet — use <b>+ add</b> (top right) to add a loop.</p>
  {/if}
</div>

<style>
  .ib-root { display: flex; flex-direction: column; gap: 6px; }
  .ib-topbar { display: flex; align-items: center; gap: 5px; font: 600 12px ui-monospace, monospace; color: #4338ca; }
  .ib-acc-glyph { color: #7c3aed; }
  .ib-acc-ty { color: #94a3b8; }
  .ib-sp { flex: 1 1 auto; }
  .ib-addwrap { position: relative; }
  .ib-addbtn { font: 700 11px Arial; color: #6d28d9; background: #f5f3ff; border: 1px solid #c4b5fd; border-radius: 6px; padding: 3px 10px; cursor: pointer; }
  .ib-addbtn:hover, .ib-addbtn.on { background: #ede9fe; border-color: #a78bfa; }
  .ib-addmenu { position: absolute; right: 0; top: 100%; margin-top: 3px; z-index: 5; display: flex; flex-direction: column; gap: 1px; padding: 4px; background: #fff; border: 1px solid #ddd6fe; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.14); min-width: 190px; }
  .ib-addmenu button { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; text-align: left; background: none; border: none; border-radius: 5px; padding: 6px 9px; cursor: pointer; }
  .ib-addmenu button:hover { background: #f5f3ff; }
  .ib-addmenu b { font: 700 12px Arial; color: #4338ca; }
  .ib-addmenu span { font: 10px Arial; color: #94a3b8; }
  .ib-varrow { display: flex; align-items: flex-start; gap: 5px; }
  .ib-sname { width: 48px; font: 600 12px ui-monospace, monospace; color: #4338ca; border: 1px solid #c4b5fd; border-radius: 5px; padding: 4px 5px; margin-top: 1px; }
  .ib-sbody { flex: 1 1 auto; min-width: 0; }
  .ib-loop { border: 1.5px solid #c4b5fd; border-radius: 8px; background: #faf8ff; overflow: hidden; }
  .ib-head { display: flex; align-items: center; gap: 5px; padding: 5px 8px; background: #f0e9ff; }
  .ib-caret { font-size: 10px; color: #7c3aed; background: none; border: none; cursor: pointer; }
  .ib-icon { font-size: 14px; color: #7c3aed; }
  .ib-kw { font: 700 12px ui-monospace, monospace; color: #6d28d9; }
  .ib-var { width: 28px; text-align: center; font: 700 13px ui-monospace, monospace; color: #4338ca; border: 1px solid #c4b5fd; border-radius: 5px; padding: 2px 3px; }
  .ib-eq, .ib-dots { color: #94a3b8; font: 13px ui-monospace, monospace; }
  .ib-bound { width: 60px; font: 12px ui-monospace, monospace; color: #334155; border: 1px solid #cbd5e1; border-radius: 5px; padding: 2px 6px; }
  .ib-bound.sm { width: 36px; }
  .ib-boundsel { font: 600 12px ui-monospace, monospace; color: #4338ca; border: 1px solid #a5b4fc; border-radius: 5px; padding: 2px 6px; background: #eef2ff; cursor: pointer; }
  .ib-assign { font-size: 10px; color: #7c3aed; background: #ede9fe; border: 1px solid #c4b5fd; border-radius: 4px; cursor: pointer; padding: 2px 4px; }
  .ib-del { margin-left: auto; font: 700 14px Arial; color: #cbd5e1; background: none; border: none; cursor: pointer; }
  .ib-del:hover { color: #ef4444; }
  .ib-body { padding: 6px 8px; border-top: 1px solid #ddd6fe; }
  .ib-return { font: 600 12px ui-monospace, monospace; color: #6d28d9; }
  .ib-return code { color: #4338ca; }
  .ib-empty { font-size: 12px; color: #64748b; margin: 2px; }
</style>
