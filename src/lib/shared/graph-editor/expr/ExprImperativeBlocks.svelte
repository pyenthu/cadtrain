<script lang="ts">
  /**
   * ExprImperativeBlocks — BUILD + edit a `list<point>` output as an IMPERATIVE
   * accumulator program (#11 + #31), fully VISUALLY. No raw `for(){}`, no
   * `poly=[]`/`return poly`, no `if(){}` — the block frame is MANAGED; the user
   * only types the meaningful EXPRESSIONS into small visual fields:
   *
   *   ◇ poly : list⟨point⟩
   *   ↻ for i = 0 … [NPts ▾]          ← header = labeled var/start/stop fields
   *       ⊕ add point  [ [cos(i), sin(i), 0] ]
   *       ◈ if  [ i > 2 ]             ← collapsible IF/THEN block, visual condition
   *           ⊕ add point  [ [i, 0] ]
   *         else
   *           = set  s = [ … ]
   *   return poly
   *
   * Each block collapses/expands. Statements nest (assign / append / if). Bodies
   * are held as a structured `ImpStatement[]` tree here and serialized back to the
   * canonical DSL text (expr-imperative.ts) on every commit — so blocks ↔ text ↔
   * the SAME compiled IIFE. A functional `map/concat` formula converts to this on
   * load. This is the PRIMARY view; the ⟨⟩ text mirror is the optional fallback.
   */
  import {
    parseImperative, serializeImperative, serializeStatements, bodyStatements,
    importLiteralPointList,
    type ImperativeProgram, type ImpStatement, type ImpIf, type ImpAssign,
  } from '$lib/graph/expr-imperative';
  import { parseLoops, type LoopForm } from '$lib/graph/expr-loops';
  import ExpressionSrcPane, { type Completion } from './ExpressionSrcPane.svelte';
  import { ALLOWED_FUNCTIONS, ALLOWED_CONSTANTS } from '$lib/graph/expr-schema';

  let { formula = $bindable(), variables = [], onAddVariable }:
    { formula: string; variables?: string[]; onAddVariable?: () => void } = $props();

  // ── local UI model — loop bodies are STRUCTURED statement trees (edited as
  //    blocks); serialized back to text on commit. ────────────────────────────
  type UiLoop = {
    loopVar: string; start: string; stop: string;
    loopVar2?: string; start2?: string; stop2?: string;
    stmts: ImpStatement[];
  };
  // `stmts` = TOP-LEVEL statements (add-point / set / if at the ROOT, outside any
  // loop) — this is where a LITERAL point list imports to (one append per point),
  // and where the user can add root-level points / ifs / a for-loop among them.
  type Ui = { accumulators: string[]; vars: ImpAssign[]; stmts: ImpStatement[]; loops: UiLoop[]; result: string };

  let ui = $state<Ui | null>(null);
  let lastSerialized = '';
  let collapsedLoops = $state<Set<number>>(new Set());
  let collapsedIfs = $state<Set<ImpIf>>(new Set()); // per-if collapse, keyed by object identity
  let customStop = $state<Set<number>>(new Set());
  let customStop2 = $state<Set<number>>(new Set());
  let addOpen = $state(false);
  let openPalette = $state<ImpStatement[] | null>(null); // which body's "+ step" menu is open

  const acc = () => ui?.accumulators[0] ?? 'poly';

  function toUi(p: ImperativeProgram): Ui {
    return {
      accumulators: [...p.accumulators],
      vars: structuredClone(p.vars ?? []),
      stmts: structuredClone(p.stmts ?? []),
      loops: p.loops.map((l) => ({
        loopVar: l.loopVar, start: l.start, stop: l.stop,
        loopVar2: l.loopVar2, start2: l.start2, stop2: l.stop2,
        stmts: bodyStatements(l.body),
      })),
      result: p.result,
    };
  }
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
    // 1) an imperative program (loops / top-level stmts) parses directly;
    // 2) a functional map/concat converts to loops;
    // 3) a LITERAL point list `[[…]]` imports to top-level add-point blocks
    //    (NO data loss — the whole reason the toggle used to be hidden);
    // 4) an empty formula becomes an empty program (shows the "+ step" palette).
    let p = parseImperative(formula);
    if (!p) { const f = parseLoops(formula); if (f) p = loopsToImperative(f); }
    if (!p) { const st = importLiteralPointList(formula); if (st) p = { accumulators: ['poly'], vars: [], stmts: st, loops: [], result: 'poly' }; }
    if (!p && formula.trim() === '') p = { accumulators: ['poly'], vars: [], stmts: [], loops: [], result: 'poly' };
    // A non-empty formula we CAN'T turn into blocks → ui stays null; commit()
    // then preserves the raw text (never wipes it).
    ui = p ? toUi(p) : null;
    collapsedIfs = new Set();
  });

  function commit() {
    openPalette = null;
    // Couldn't turn the formula into blocks → DON'T touch it (no data loss).
    if (!ui) return;
    const snap = $state.snapshot(ui) as Ui;
    // Only a GENUINELY empty program clears the formula; a program with points,
    // vars, or loops is serialized. This is the fix for the literal-wipe bug.
    if (!snap.stmts.length && !snap.loops.length && !snap.vars.length) {
      lastSerialized = ''; formula = ''; return;
    }
    const prog: ImperativeProgram = {
      accumulators: snap.accumulators,
      vars: snap.vars,
      stmts: snap.stmts as ImpStatement[],
      loops: snap.loops.map((l) => ({
        loopVar: l.loopVar, start: l.start, stop: l.stop,
        loopVar2: l.loopVar2, start2: l.start2, stop2: l.stop2,
        body: serializeStatements(l.stmts as ImpStatement[]),
      })),
      result: snap.result,
    };
    const s = serializeImperative(prog);
    lastSerialized = s; formula = s;
  }

  function ensureUi(): Ui {
    if (!ui) ui = { accumulators: ['poly'], vars: [], stmts: [], loops: [], result: 'poly' };
    return ui;
  }
  function toggleSet<T>(set: Set<T>, k: T): Set<T> {
    const s = new Set(set); s.has(k) ? s.delete(k) : s.add(k); return s;
  }

  // ── top-level adders (variable / intermediate expression / loop) ────────────
  function addLoop() {
    const u = ensureUi();
    u.loops = [...u.loops, {
      loopVar: 'i', start: '0', stop: variables[0] ?? 'N',
      stmts: [{ kind: 'append', list: acc(), expr: `[i, 0]` }],
    }];
    addOpen = false; commit();
  }
  function removeLoop(k: number) { if (ui) { ui.loops = ui.loops.filter((_, j) => j !== k); commit(); } }
  function addExpr() {
    const u = ensureUi();
    u.vars = [...u.vars, { kind: 'assign', name: uniqueName('v'), expr: '0' }];
    addOpen = false; commit();
  }
  function removeVar(vi: number) { if (ui) { ui.vars = ui.vars.filter((_, j) => j !== vi); commit(); } }

  // every assigned name in scope (top vars + loop set-blocks) — for unique names.
  function allAssignNames(): Set<string> {
    const out = new Set<string>();
    for (const v of ui?.vars ?? []) out.add(v.name);
    const walk = (ss: ImpStatement[]) => { for (const s of ss) {
      if (s.kind === 'assign') out.add(s.name);
      else if (s.kind === 'if') { walk(s.then); if (s.else) walk(s.else); }
    } };
    for (const l of ui?.loops ?? []) walk(l.stmts);
    return out;
  }
  function uniqueName(base: string): string {
    const used = allAssignNames();
    let k = 1; let n = `${base}${k}`;
    while (used.has(n)) n = `${base}${++k}`;
    return n;
  }

  // ── statement-body mutators (operate on a body's ImpStatement[] in-place) ────
  // Default expressions must be VALID in scope: inside a loop use its var (`[i,0]`);
  // at the ROOT (no loop var) use a literal `[0, 0, 0]` so the point is well-formed.
  const pointExpr = (loopVar: string) => (loopVar ? `[${loopVar}, 0]` : `[0, 0, 0]`);
  const ifCond = (loopVar: string) => (loopVar ? `${loopVar} > 0` : `1 > 0`);
  function addPoint(list: ImpStatement[], loopVar: string) {
    list.push({ kind: 'append', list: acc(), expr: pointExpr(loopVar) }); openPalette = null; commit();
  }
  function addSet(list: ImpStatement[]) {
    list.push({ kind: 'assign', name: uniqueName('v'), expr: '0' }); openPalette = null; commit();
  }
  function addIf(list: ImpStatement[], loopVar: string) {
    list.push({ kind: 'if', cond: ifCond(loopVar),
      then: [{ kind: 'append', list: acc(), expr: pointExpr(loopVar) }] }); openPalette = null; commit();
  }
  function removeStmt(list: ImpStatement[], s: ImpStatement) {
    const i = list.indexOf(s); if (i >= 0) list.splice(i, 1); commit();
  }
  function addElse(s: ImpIf, loopVar: string) {
    s.else = [{ kind: 'append', list: acc(), expr: pointExpr(loopVar) }]; commit();
  }
  function removeElse(s: ImpIf) { s.else = undefined; commit(); }

  // keyword type-cue: typing `point`/`add`, `set`, `if` (or `for`/`loop` at top)
  // in the palette input materializes that block (palette buttons are the must-have).
  function paletteKey(ev: KeyboardEvent, list: ImpStatement[], loopVar: string) {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const el = ev.currentTarget as HTMLInputElement;
    const w = el.value.trim().toLowerCase(); el.value = '';
    if (w === 'if') addIf(list, loopVar);
    else if (w === 'set') addSet(list);
    else if (w === 'point' || w === 'add' || w === 'p') addPoint(list, loopVar);
  }
  function topAddKey(ev: KeyboardEvent) {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const el = ev.currentTarget as HTMLInputElement;
    const w = el.value.trim().toLowerCase(); el.value = '';
    if (w === 'for' || w === 'loop') addLoop();
    else if (w === 'variable' || w === 'var') onAddVariable?.();
    else if (w === 'expression' || w === 'expr') addExpr();
  }

  // ── loop-header helpers (count dropdown + 2D grid toggle) ───────────────────
  function onStopSelect(k: number, v: string) {
    if (v === '__custom') { customStop = new Set(customStop).add(k); return; }
    ui!.loops[k]!.stop = v; commit();
  }
  const asDropdown = (k: number, stop: string) =>
    variables.length > 0 && !customStop.has(k) && variables.includes(stop);
  function toggleGrid(k: number) {
    const lp = ui!.loops[k]!;
    if (lp.loopVar2) { lp.loopVar2 = undefined; lp.start2 = undefined; lp.stop2 = undefined; }
    else { lp.loopVar2 = 'v'; lp.start2 = '0'; lp.stop2 = variables[0] ?? 'N'; }
    commit();
  }
  function onStop2Select(k: number, v: string) {
    if (v === '__custom') { customStop2 = new Set(customStop2).add(k); return; }
    ui!.loops[k]!.stop2 = v; commit();
  }
  const asDropdown2 = (k: number, stop: string | undefined) =>
    variables.length > 0 && !customStop2.has(k) && !!stop && variables.includes(stop);

  // completions for a body's expression fields (the given loop vars + names + fns).
  function bodyCompletions(loopVars: string[]): Completion[] {
    const out: Completion[] = [];
    const push = (t: string) => { if (t) out.push({ text: t, kind: 'param' }); };
    for (const lv of loopVars) push(lv);
    for (const a of ui?.accumulators ?? []) push(a);
    for (const v of ui?.vars ?? []) push(v.name);
    for (const n of allAssignNames()) push(n);
    for (const v of variables) push(v);
    for (const fn of ALLOWED_FUNCTIONS) out.push({ text: fn, kind: 'fn' });
    for (const c of ALLOWED_CONSTANTS) out.push({ text: c, kind: 'const' });
    return out;
  }
  const loopCompletions = (lp: UiLoop): Completion[] =>
    bodyCompletions([lp.loopVar, ...(lp.loopVar2 ? [lp.loopVar2] : [])]);
  // root-level body has no loop var in scope.
  const rootCompletions = (): Completion[] => bodyCompletions([]);
</script>

<!-- ── recursive statement-body renderer: if / add-point / set ───────────────── -->
{#snippet stmtBody(list: ImpStatement[], loopVar: string, comps: Completion[])}
  <div class="ib-stmts">
    {#each list as s (s)}
      {#if s.kind === 'append'}
        <div class="ib-stmt ib-append">
          <span class="ib-stmt-kw"><span class="ib-stmt-icon">⊕</span> add point</span>
          <div class="ib-stmt-field"><ExpressionSrcPane bind:src={s.expr} completions={comps} label="" rows={1} placeholder="[cos(i), sin(i), 0]" /></div>
          <button class="ib-del" type="button" title="remove" onclick={() => removeStmt(list, s)}>×</button>
        </div>
      {:else if s.kind === 'assign'}
        <div class="ib-stmt ib-set">
          <span class="ib-stmt-kw"><span class="ib-stmt-icon">=</span> set</span>
          <input class="ib-sname" bind:value={s.name} onchange={commit} spellcheck="false" title="variable name" />
          <span class="ib-eq">=</span>
          <div class="ib-stmt-field"><ExpressionSrcPane bind:src={s.expr} completions={comps} label="" rows={1} placeholder="(r0 + growth) / 2" /></div>
          <button class="ib-del" type="button" title="remove" onclick={() => removeStmt(list, s)}>×</button>
        </div>
      {:else}
        {@const ifs = s as ImpIf}
        {@const open = !collapsedIfs.has(ifs)}
        <div class="ib-if">
          <div class="ib-if-head">
            <button class="ib-caret" type="button" onclick={() => (collapsedIfs = toggleSet(collapsedIfs, ifs))}>{open ? '▾' : '▸'}</button>
            <span class="ib-if-icon">◈</span><span class="ib-if-kw">if</span>
            <div class="ib-stmt-field cond"><ExpressionSrcPane bind:src={ifs.cond} completions={comps} label="" rows={1} placeholder="i > 2" /></div>
            <button class="ib-del" type="button" title="remove if" onclick={() => removeStmt(list, s)}>×</button>
          </div>
          {#if open}
            <div class="ib-if-body">
              <div class="ib-branch-label">then</div>
              {@render stmtBody(ifs.then, loopVar, comps)}
              {#if ifs.else}
                <div class="ib-branch-label else">
                  else
                  <button class="ib-mini" type="button" title="remove else branch" onclick={() => removeElse(ifs)}>× else</button>
                </div>
                {@render stmtBody(ifs.else, loopVar, comps)}
              {:else}
                <button class="ib-addelse" type="button" onclick={() => addElse(ifs, loopVar)}>+ else</button>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    {/each}
    {@render palette(list, loopVar)}
  </div>
{/snippet}

<!-- ── the "+ step" block palette (point / set / if) + keyword type-cue ──────── -->
{#snippet palette(list: ImpStatement[], loopVar: string)}
  {@const on = openPalette === list}
  <div class="ib-palwrap">
    <button class="ib-palbtn" type="button" class:on onclick={() => (openPalette = on ? null : list)}>+ step ▾</button>
    {#if on}
      <div class="ib-palmenu">
        <button type="button" onclick={() => addPoint(list, loopVar)}><b>⊕ add point</b><span>append <code>[x, y, z]</code> to the list</span></button>
        <button type="button" onclick={() => addSet(list)}><b>= set</b><span>a named intermediate value</span></button>
        <button type="button" onclick={() => addIf(list, loopVar)}><b>◈ if / then</b><span>only run steps when a condition holds</span></button>
        <input class="ib-palkey" type="text" spellcheck="false" placeholder="or type: point · set · if" onkeydown={(e) => paletteKey(e, list, loopVar)} />
      </div>
    {/if}
  </div>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="ib-root" onfocusout={commit}>
  <!-- top bar: the accumulator + the unified "+ add" (variable / expression / loop) -->
  <div class="ib-topbar">
    <span class="ib-acc-glyph">◇</span> <code>{acc()}</code>
    <span class="ib-acc-ty">: list⟨point⟩</span>
    <span class="ib-sp"></span>
    <div class="ib-addwrap">
      <button class="ib-addbtn" type="button" class:on={addOpen} onclick={() => (addOpen = !addOpen)}>+ add ▾</button>
      {#if addOpen}
        <div class="ib-addmenu">
          {#if onAddVariable}<button type="button" onclick={() => { onAddVariable?.(); addOpen = false; }}><b>variable</b><span>an input param</span></button>{/if}
          <button type="button" onclick={addExpr}><b>expression</b><span>an intermediate value (once)</span></button>
          <button type="button" onclick={addLoop}><b>loop</b><span>a for-loop</span></button>
          <input class="ib-palkey" type="text" spellcheck="false" placeholder="or type: for · variable · expr" onkeydown={topAddKey} />
        </div>
      {/if}
    </div>
  </div>

  <!-- top-level expressions — computed once, before the loops -->
  {#each ui?.vars ?? [] as v, vi (vi)}
    <div class="ib-varrow">
      <input class="ib-sname" bind:value={v.name} onchange={commit} spellcheck="false" />
      <span class="ib-eq">=</span>
      <div class="ib-sbody"><ExpressionSrcPane bind:src={v.expr} completions={[]} label="" rows={1} placeholder="(r0 + growth) / 2" /></div>
      <button class="ib-del" type="button" title="remove" onclick={() => removeVar(vi)}>×</button>
    </div>
  {/each}

  <!-- ROOT-LEVEL statements: add-point / set / if OUTSIDE any loop. A literal
       point list lands here (one add-point per point); the "+ step" palette lets
       the user add more, or wrap them in an if — a for is added via "+ add". -->
  {#if ui}
    {@render stmtBody(ui.stmts, '', rootCompletions())}
  {/if}

  {#each ui?.loops ?? [] as lp, k (k)}
    {@const open = !collapsedLoops.has(k)}
    {@const comps = loopCompletions(lp)}
    <div class="ib-loop">
      <div class="ib-head">
        <button class="ib-caret" type="button" onclick={() => (collapsedLoops = toggleSet(collapsedLoops, k))}>{open ? '▾' : '▸'}</button>
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
        <button class="ib-grid" class:on={!!lp.loopVar2} type="button"
          title={lp.loopVar2 ? 'make 1D (single loop)' : 'make 2D (uv grid → surface)'}
          onclick={() => toggleGrid(k)}>⊞</button>
        <button class="ib-del" type="button" title="remove loop" onclick={() => removeLoop(k)}>×</button>
      </div>
      {#if lp.loopVar2}
        <div class="ib-head ib-head2">
          <span class="ib-sub">↳</span>
          <input class="ib-var" bind:value={lp.loopVar2} onchange={commit} spellcheck="false" />
          <span class="ib-eq">=</span>
          <input class="ib-bound sm" bind:value={lp.start2} onchange={commit} spellcheck="false" title="start" />
          <span class="ib-dots">…</span>
          {#if asDropdown2(k, lp.stop2)}
            <select class="ib-boundsel" value={lp.stop2} onchange={(e) => onStop2Select(k, (e.currentTarget as HTMLSelectElement).value)}>
              {#each variables as v}<option value={v}>{v}</option>{/each}
              <option value="__custom">123 custom…</option>
            </select>
          {:else}
            <input class="ib-bound" bind:value={lp.stop2} onchange={commit} spellcheck="false" title="count" />
            {#if variables.length}<button class="ib-assign" type="button" title="assign a variable" onclick={() => (customStop2 = toggleSet(customStop2, k))}>▾</button>{/if}
          {/if}
        </div>
      {/if}
      {#if open}
        <div class="ib-body">
          {@render stmtBody(lp.stmts, lp.loopVar, comps)}
        </div>
      {/if}
    </div>
  {/each}

  {#if ui && (ui.loops.length || ui.stmts.length)}
    <div class="ib-return">return <code>{ui.result}</code></div>
  {:else if !ui}
    <p class="ib-empty">This formula can't be shown as blocks — switch to <b>⟨⟩ text</b> to edit it.</p>
  {:else}
    <p class="ib-empty">Nothing yet — use <b>+ step</b> to add a point, or <b>+ add</b> (top right) for a loop.</p>
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
  .ib-addmenu { position: absolute; right: 0; top: 100%; margin-top: 3px; z-index: 5; display: flex; flex-direction: column; gap: 1px; padding: 4px; background: #fff; border: 1px solid #ddd6fe; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.14); min-width: 200px; }
  .ib-addmenu button { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; text-align: left; background: none; border: none; border-radius: 5px; padding: 6px 9px; cursor: pointer; }
  .ib-addmenu button:hover { background: #f5f3ff; }
  .ib-addmenu b { font: 700 12px Arial; color: #4338ca; }
  .ib-addmenu span { font: 10px Arial; color: #94a3b8; }
  .ib-varrow { display: flex; align-items: flex-start; gap: 5px; }
  .ib-sname { width: 56px; font: 600 12px ui-monospace, monospace; color: #4338ca; border: 1px solid #c4b5fd; border-radius: 5px; padding: 4px 5px; margin-top: 1px; }
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
  .ib-grid { font-size: 12px; line-height: 1; color: #7c3aed; background: #ede9fe; border: 1px solid #c4b5fd; border-radius: 5px; cursor: pointer; padding: 3px 6px; margin-left: auto; }
  .ib-grid:hover { background: #ddd6fe; }
  .ib-grid.on { color: #fff; background: #7c3aed; border-color: #6d28d9; }
  .ib-head2 { background: #ebe3ff; padding-left: 26px; border-top: 1px solid #ddd6fe; }
  .ib-sub { font-size: 13px; color: #7c3aed; margin-right: 1px; }
  .ib-del { flex: none; font: 700 14px Arial; color: #cbd5e1; background: none; border: none; cursor: pointer; padding: 0 2px; }
  .ib-del:hover { color: #ef4444; }
  .ib-body { padding: 6px 8px; border-top: 1px solid #ddd6fe; }

  /* ── nested statement blocks ─────────────────────────────────────────────── */
  .ib-stmts { display: flex; flex-direction: column; gap: 5px; }
  .ib-stmt { display: flex; align-items: center; gap: 6px; }
  .ib-stmt-kw { flex: none; display: inline-flex; align-items: center; gap: 3px; font: 700 11px Arial; color: #6d28d9; white-space: nowrap; }
  .ib-stmt-icon { font-size: 13px; color: #7c3aed; }
  .ib-stmt-field { flex: 1 1 auto; min-width: 0; }

  .ib-if { border: 1.25px solid #a5b4fc; border-radius: 7px; background: #eef2ff; overflow: hidden; }
  .ib-if-head { display: flex; align-items: center; gap: 5px; padding: 4px 7px; background: #e0e7ff; }
  .ib-if-icon { font-size: 12px; color: #4f46e5; }
  .ib-if-kw { font: 700 12px ui-monospace, monospace; color: #4338ca; }
  .ib-if-body { padding: 6px 7px 7px; display: flex; flex-direction: column; gap: 5px; border-top: 1px solid #c7d2fe; }
  .ib-branch-label { display: flex; align-items: center; gap: 6px; font: 700 10px Arial; letter-spacing: 0.05em; text-transform: uppercase; color: #6366f1; }
  .ib-branch-label.else { margin-top: 2px; color: #7c3aed; }
  .ib-mini { font: 600 10px Arial; color: #94a3b8; background: none; border: none; cursor: pointer; padding: 0; }
  .ib-mini:hover { color: #ef4444; }
  .ib-addelse { align-self: flex-start; font: 600 10px Arial; color: #6d28d9; background: #ede9fe; border: 1px dashed #c4b5fd; border-radius: 5px; padding: 2px 8px; cursor: pointer; }
  .ib-addelse:hover { background: #ddd6fe; }

  /* ── block palette ("+ step") ────────────────────────────────────────────── */
  .ib-palwrap { position: relative; }
  .ib-palbtn { align-self: flex-start; font: 600 10px Arial; color: #0e7490; background: #ecfeff; border: 1px dashed #67e8f9; border-radius: 6px; padding: 3px 10px; cursor: pointer; }
  .ib-palbtn:hover, .ib-palbtn.on { background: #cffafe; }
  .ib-palmenu { position: absolute; left: 0; top: 100%; margin-top: 3px; z-index: 6; display: flex; flex-direction: column; gap: 1px; padding: 4px; background: #fff; border: 1px solid #bae6fd; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.14); min-width: 220px; }
  .ib-palmenu button { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; text-align: left; background: none; border: none; border-radius: 5px; padding: 6px 9px; cursor: pointer; }
  .ib-palmenu button:hover { background: #f0f9ff; }
  .ib-palmenu b { font: 700 12px Arial; color: #0369a1; }
  .ib-palmenu span { font: 10px Arial; color: #94a3b8; }
  .ib-palmenu code { font: 10px ui-monospace, monospace; background: #f1f5f9; padding: 0 2px; border-radius: 3px; }
  .ib-palkey { margin-top: 3px; font: 11px ui-monospace, monospace; color: #334155; border: 1px solid #e2e8f0; border-radius: 5px; padding: 4px 6px; }
  .ib-palkey:focus { outline: 2px solid #93c5fd; outline-offset: -1px; }

  .ib-return { font: 600 12px ui-monospace, monospace; color: #6d28d9; }
  .ib-return code { color: #4338ca; }
  .ib-empty { font-size: 12px; color: #64748b; margin: 2px; }
</style>
