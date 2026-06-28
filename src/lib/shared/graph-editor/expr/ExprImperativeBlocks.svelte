<script lang="ts">
  /**
   * ExprImperativeBlocks — BUILD + edit a `list<point>` output as an IMPERATIVE
   * accumulator program (#11): a list, for-loops, and per-iteration statements
   * (assign a var, or append to the list). The visual form of expr-imperative.ts:
   *   ◇ poly : list<point>
   *   ↻ for i = 0 … [NPts ▾]
   *       point = [ … ]          (assign — autocomplete body, resizable)
   *       poly.append(point)     (append)
   * A functional `map/concat` formula is CONVERTED to this on load (each map → a
   * loop with one append), so old expressions open here too. Edits serialize to
   * the imperative DSL. Count = a variable dropdown; loops collapsible.
   */
  import { parseImperative, serializeImperative, type ImperativeProgram, type ImpStatement } from '$lib/cad/expr-imperative';
  import { parseLoops, type LoopForm } from '$lib/cad/expr-loops';
  import ExpressionSrcPane, { type Completion } from './ExpressionSrcPane.svelte';
  import { ALLOWED_FUNCTIONS, ALLOWED_CONSTANTS } from '$lib/cad/expr-schema';

  let { formula = $bindable(), variables = [] }:
    { formula: string; variables?: string[] } = $props();

  let prog = $state<ImperativeProgram | null>(null);
  let lastSerialized = '';
  let collapsed = $state<Set<number>>(new Set());
  let customStop = $state<Set<number>>(new Set());
  let addMenu = $state<number | null>(null); // which loop's "+ statement" menu is open

  function loopsToImperative(form: LoopForm): ImperativeProgram {
    return {
      accumulators: ['poly'],
      loops: form.loops.map((l) => ({
        loopVar: l.varName, start: l.start, stop: l.stop,
        statements: [{ kind: 'append', list: 'poly', expr: l.body }],
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
    if (!prog) prog = { accumulators: ['poly'], loops: [], result: 'poly' };
    return prog;
  }
  function addLoop() {
    const p = ensureProg();
    p.loops = [...p.loops, { loopVar: 'i', start: '0', stop: variables[0] ?? 'N',
      statements: [{ kind: 'append', list: p.accumulators[0]!, expr: '[i, 0]' }] }];
    commit();
  }
  function removeLoop(k: number) { if (prog) { prog.loops = prog.loops.filter((_, j) => j !== k); commit(); } }
  function addStatement(k: number, kind: 'assign' | 'append') {
    if (!prog) return;
    const s: ImpStatement = kind === 'append'
      ? { kind: 'append', list: prog.accumulators[0]!, expr: '[i, 0]' }
      : { kind: 'assign', name: 'p', expr: '[i, 0]' };
    prog.loops[k]!.statements = [...prog.loops[k]!.statements, s];
    addMenu = null; commit();
  }
  function removeStatement(k: number, si: number) {
    if (!prog) return;
    prog.loops[k]!.statements = prog.loops[k]!.statements.filter((_, j) => j !== si);
    commit();
  }
  function toggleSet(set: Set<number>, k: number): Set<number> {
    const s = new Set(set); s.has(k) ? s.delete(k) : s.add(k); return s;
  }
  function onStopSelect(k: number, v: string) {
    if (v === '__custom') { customStop = new Set(customStop).add(k); return; }
    prog!.loops[k]!.stop = v; commit();
  }
  const asDropdown = (k: number, stop: string) =>
    variables.length > 0 && !customStop.has(k) && variables.includes(stop);

  // autocomplete corpus for a statement body: loop vars + assigned vars +
  // accumulators + your variables + math.
  function bodyCompletions(loopVar: string): Completion[] {
    const out: Completion[] = [{ text: loopVar, kind: 'param' }];
    for (const a of prog?.accumulators ?? []) out.push({ text: a, kind: 'param' });
    for (const lp of prog?.loops ?? []) for (const s of lp.statements) if (s.kind === 'assign') out.push({ text: s.name, kind: 'param' });
    for (const v of variables) if (v) out.push({ text: v, kind: 'param' });
    for (const fn of ALLOWED_FUNCTIONS) out.push({ text: fn, kind: 'fn' });
    for (const c of ALLOWED_CONSTANTS) out.push({ text: c, kind: 'const' });
    return out;
  }
</script>

<div class="ib-root">
  {#if prog && prog.loops.length}
    <div class="ib-acc"><span class="ib-acc-glyph">◇</span> <code>{prog.accumulators[0]}</code>
      <span class="ib-acc-ty">: list⟨point⟩</span></div>
  {/if}

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
        <div class="ib-stmts">
          {#each lp.statements as s, si (si)}
            <div class="ib-stmt" onfocusout={commit}>
              {#if s.kind === 'assign'}
                <input class="ib-sname" bind:value={s.name} onchange={commit} spellcheck="false" title="variable name" />
                <span class="ib-seq">=</span>
              {:else}
                <code class="ib-sappend">{s.list}.append(</code>
              {/if}
              <div class="ib-sbody">
                <ExpressionSrcPane bind:src={s.expr} completions={bodyCompletions(lp.loopVar)} label="" rows={2} placeholder="[ r , z ]" />
              </div>
              {#if s.kind === 'append'}<code class="ib-sappend">)</code>{/if}
              <button class="ib-sdel" type="button" title="remove statement" onclick={() => removeStatement(k, si)}>×</button>
            </div>
          {/each}

          <div class="ib-addstmt">
            <button class="ib-stmtbtn" type="button" onclick={() => (addMenu = addMenu === k ? null : k)}>+ statement</button>
            {#if addMenu === k}
              <div class="ib-stmtmenu">
                <button type="button" onclick={() => addStatement(k, 'assign')}><code>x = …</code> assign a variable</button>
                <button type="button" onclick={() => addStatement(k, 'append')}><code>{prog?.accumulators[0]}.append(…)</code> add to the list</button>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/each}

  {#if prog && prog.loops.length}
    <div class="ib-return">return <code>{prog.result}</code></div>
  {:else}
    <p class="ib-empty">No loop yet{variables.length ? '' : ' — tip: add your variables first'}.</p>
  {/if}

  <button class="ib-add" type="button" onclick={addLoop}>↻ + for loop</button>
</div>

<style>
  .ib-root { display: flex; flex-direction: column; gap: 6px; }
  .ib-acc { font: 600 12px ui-monospace, monospace; color: #4338ca; }
  .ib-acc-glyph { color: #7c3aed; }
  .ib-acc code { color: #4338ca; }
  .ib-acc-ty { color: #94a3b8; }
  .ib-loop { border: 1.5px solid #c4b5fd; border-radius: 8px; background: #faf8ff; overflow: hidden; }
  .ib-head { display: flex; align-items: center; gap: 5px; padding: 5px 8px; background: #f0e9ff; }
  .ib-caret { font-size: 10px; color: #7c3aed; background: none; border: none; cursor: pointer; }
  .ib-icon { font-size: 14px; color: #7c3aed; }
  .ib-kw { font: 700 12px ui-monospace, monospace; color: #6d28d9; }
  .ib-var { width: 28px; text-align: center; font: 700 13px ui-monospace, monospace; color: #4338ca; border: 1px solid #c4b5fd; border-radius: 5px; padding: 2px 3px; }
  .ib-eq, .ib-dots, .ib-seq { color: #94a3b8; font: 13px ui-monospace, monospace; }
  .ib-bound { width: 60px; font: 12px ui-monospace, monospace; color: #334155; border: 1px solid #cbd5e1; border-radius: 5px; padding: 2px 6px; }
  .ib-bound.sm { width: 36px; }
  .ib-boundsel { font: 600 12px ui-monospace, monospace; color: #4338ca; border: 1px solid #a5b4fc; border-radius: 5px; padding: 2px 6px; background: #eef2ff; cursor: pointer; }
  .ib-assign { font-size: 10px; color: #7c3aed; background: #ede9fe; border: 1px solid #c4b5fd; border-radius: 4px; cursor: pointer; padding: 2px 4px; }
  .ib-del { margin-left: auto; font: 700 14px Arial; color: #cbd5e1; background: none; border: none; cursor: pointer; }
  .ib-del:hover { color: #ef4444; }
  .ib-stmts { padding: 6px 8px 6px 18px; display: flex; flex-direction: column; gap: 5px; border-top: 1px solid #ddd6fe; }
  .ib-stmt { display: flex; align-items: flex-start; gap: 5px; }
  .ib-sname { width: 44px; font: 600 12px ui-monospace, monospace; color: #4338ca; border: 1px solid #c4b5fd; border-radius: 5px; padding: 4px 5px; margin-top: 1px; }
  .ib-sappend { font: 12px ui-monospace, monospace; color: #6d28d9; padding-top: 6px; }
  .ib-sbody { flex: 1 1 auto; min-width: 0; }
  .ib-sdel { font: 700 13px Arial; color: #cbd5e1; background: none; border: none; cursor: pointer; padding-top: 4px; }
  .ib-sdel:hover { color: #ef4444; }
  .ib-addstmt { position: relative; }
  .ib-stmtbtn { font: 600 11px Arial; color: #6d28d9; background: #f5f3ff; border: 1px dashed #c4b5fd; border-radius: 5px; padding: 3px 10px; cursor: pointer; }
  .ib-stmtbtn:hover { background: #ede9fe; }
  .ib-stmtmenu { position: absolute; left: 0; top: 100%; margin-top: 3px; z-index: 5; display: flex; flex-direction: column; gap: 2px; padding: 4px; background: #fff; border: 1px solid #ddd6fe; border-radius: 7px; box-shadow: 0 6px 20px rgba(0,0,0,.12); }
  .ib-stmtmenu button { display: flex; gap: 7px; align-items: baseline; text-align: left; background: none; border: none; border-radius: 5px; padding: 5px 8px; cursor: pointer; font: 11px Arial; color: #64748b; white-space: nowrap; }
  .ib-stmtmenu button:hover { background: #f5f3ff; }
  .ib-stmtmenu code { font: 600 11px ui-monospace, monospace; color: #4338ca; }
  .ib-return { font: 600 12px ui-monospace, monospace; color: #6d28d9; }
  .ib-return code { color: #4338ca; }
  .ib-empty { font-size: 12px; color: #64748b; margin: 2px; }
  .ib-add { font: 700 12px Arial; color: #6d28d9; background: #f5f3ff; border: 1.5px dashed #c4b5fd; border-radius: 7px; padding: 6px 12px; cursor: pointer; width: 100%; }
  .ib-add:hover { background: #ede9fe; border-style: solid; border-color: #a78bfa; }
</style>
