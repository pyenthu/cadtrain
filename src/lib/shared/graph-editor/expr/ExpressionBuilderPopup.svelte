<!--
  ExpressionBuilderPopup.svelte — the four-section expression DEFINITION editor
  (B.7 / id 914, v3). docs/plans/expression-builder.md §v3.5.

  Edits a reusable per-part `ExprDef` (NOT a single node): four declared
  sections — PARAMS · CONSTS · VARIABLES · OUTPUTS — each an editable table with
  a `+ row` and per-row delete + per-row validation. NO host-graph `p.*`/`e.*`
  here: a def declares all of its own names. The header carries the def name +
  a tabs/accordions LAYOUT toggle (⊞/≡), persisted in `localStorage`
  `cad-expr-editor-layout`.

  Autocomplete corpus (VARIABLES/OUTPUTS formula fields) = the names declared
  EARLIER in THIS def + ALLOWED_FUNCTIONS + ALLOWED_CONSTANTS. Commit writes the
  WHOLE ExprDef back (so every instance updates). The Σ Expressions MENU +
  drop-instance is PR-3.

  Per-instance local $state only (mounts per launcher; /primitives mounts many
  panes → NO module singletons).
-->
<script lang="ts">
  import { clampToViewport } from '../popover-clamp';
  import { isIdentSafe, ALLOWED_FUNCTIONS, ALLOWED_CONSTANTS } from '$lib/cad/expr-schema';
  import { parseAndValidateBare } from '$lib/cad/graph-exprs';
  import type { ExprDef } from '$lib/cad/composition-graph-types';
  import ExpressionSrcPane, { type Completion } from './ExpressionSrcPane.svelte';

  let {
    def,
    anchor,
    onCommit,
    onCancel,
  }: {
    /** The definition being edited (a snapshot — committed back as a whole). */
    def: ExprDef;
    /** Click point to anchor the popover (ignored when expanded). */
    anchor: { x: number; y: number };
    onCommit: (def: ExprDef) => void;
    onCancel: () => void;
  } = $props();

  type Row = { name: string };
  type ParamRow = { name: string; default: number | null };
  type ConstRow = { name: string; value: number | null };
  type FormulaRow = { name: string; formula: string };

  // ─── per-instance local state (seeded from `def`) ──────────────────────────
  let name = $state('');
  let params = $state<ParamRow[]>([]);
  let consts = $state<ConstRow[]>([]);
  let vars = $state<FormulaRow[]>([]);
  let outputs = $state<FormulaRow[]>([]);
  let expanded = $state(false);

  // The LEFT rail tabs the inputs/intermediates (params · consts · vars);
  // OUTPUTS get their own permanent RIGHT pane (the results + output sockets).
  let activeTab = $state<'params' | 'consts' | 'vars'>('params');

  // Seed on def-identity change (reopening the popup against a new def reseeds).
  let seededFrom: ExprDef | null = null;
  $effect(() => {
    if (seededFrom === def) return;
    seededFrom = def;
    name = def.name ?? '';
    params = (def.params ?? []).map((p) => ({ name: p.name, default: p.default ?? null }));
    consts = (def.consts ?? []).map((c) => ({ name: c.name, value: c.value ?? 0 }));
    vars = (def.vars ?? []).map((v) => ({ name: v.name, formula: v.formula }));
    outputs = (def.outputs ?? []).map((o) => ({ name: o.name, formula: o.formula }));
  });

  // ─── derived name sets ─────────────────────────────────────────────────────
  let paramNames = $derived(params.map((p) => p.name));
  let constNames = $derived(consts.map((c) => c.name));
  let varNames = $derived(vars.map((v) => v.name));
  let outputNames = $derived(outputs.map((o) => o.name));
  let allNames = $derived([...paramNames, ...constNames, ...varNames, ...outputNames]);
  let dupNames = $derived.by(() => {
    const seen = new Set<string>(); const dup = new Set<string>();
    for (const n of allNames) { if (n === '') continue; if (seen.has(n)) dup.add(n); else seen.add(n); }
    return dup;
  });

  // A row name is bad if blank, not a safe ident, or duplicated.
  function nameError(n: string): string | null {
    if (n.trim() === '') return 'name required';
    if (!isIdentSafe(n)) return 'invalid identifier';
    if (dupNames.has(n)) return 'duplicate name';
    return null;
  }

  // Earlier-declared names available to a VARIABLES / OUTPUTS formula row.
  function varAllowed(i: number): Set<string> {
    return new Set<string>([...paramNames, ...constNames, ...varNames.slice(0, i)]);
  }
  function outAllowed(i: number): Set<string> {
    return new Set<string>([...paramNames, ...constNames, ...varNames, ...outputNames.slice(0, i)]);
  }
  function completionsFor(names: Iterable<string>): Completion[] {
    const out: Completion[] = [];
    for (const n of names) if (n) out.push({ text: n, kind: 'param' });
    for (const fn of ALLOWED_FUNCTIONS) out.push({ text: fn, kind: 'fn' });
    for (const c of ALLOWED_CONSTANTS) out.push({ text: c, kind: 'const' });
    return out;
  }
  // First validation issue for a formula row, or null.
  function formulaError(formula: string, allowed: Set<string>): string | null {
    if (formula.trim() === '') return 'formula required';
    const { errors } = parseAndValidateBare(formula, allowed);
    return errors.length ? errors[0]!.msg : null;
  }

  let canCommit = $derived.by(() => {
    if (name.trim() === '') return false;
    for (const n of allNames) if (nameError(n)) return false;
    for (let i = 0; i < vars.length; i++) if (formulaError(vars[i]!.formula, varAllowed(i))) return false;
    for (let i = 0; i < outputs.length; i++) if (formulaError(outputs[i]!.formula, outAllowed(i))) return false;
    return true;
  });

  // ─── row mutators (operate on the local $state arrays) ─────────────────────
  function uniqueName(base: string): string {
    const used = new Set(allNames);
    let k = 1; let n = `${base}${k}`;
    while (used.has(n)) n = `${base}${++k}`;
    return n;
  }
  const addParam = () => { params = [...params, { name: uniqueName('p'), default: null }]; };
  const addConst = () => { consts = [...consts, { name: uniqueName('c'), value: 0 }]; };
  const addVar = () => { vars = [...vars, { name: uniqueName('v'), formula: '' }]; };
  const addOutput = () => { outputs = [...outputs, { name: uniqueName('out'), formula: '' }]; };
  const delParam = (i: number) => { params = params.filter((_, j) => j !== i); };
  const delConst = (i: number) => { consts = consts.filter((_, j) => j !== i); };
  const delVar = (i: number) => { vars = vars.filter((_, j) => j !== i); };
  const delOutput = (i: number) => { outputs = outputs.filter((_, j) => j !== i); };

  function commit() {
    if (!canCommit) return;
    const out: ExprDef = {
      id: def.id,
      name: name.trim(),
      params: params.map((p) => (p.default == null || Number.isNaN(p.default)
        ? { name: p.name.trim() }
        : { name: p.name.trim(), default: p.default })),
      consts: consts.map((c) => ({ name: c.name.trim(), value: (c.value == null || Number.isNaN(c.value)) ? 0 : c.value })),
      vars: vars.map((v) => ({ name: v.name.trim(), formula: v.formula })),
      outputs: outputs.map((o) => ({ name: o.name.trim(), formula: o.formula })),
    };
    onCommit(out);
  }

  function onKeydown(ev: KeyboardEvent) {
    if (ev.key === 'Escape') { ev.preventDefault(); onCancel(); }
    else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); commit(); }
  }

  const SECTIONS: Array<{ key: 'params' | 'consts' | 'vars' | 'outputs'; label: string }> = [
    { key: 'params', label: 'PARAMS' },
    { key: 'consts', label: 'CONSTS' },
    { key: 'vars', label: 'VARIABLES' },
    { key: 'outputs', label: 'OUTPUTS' },
  ];
  function sectionCount(k: string): number {
    return k === 'params' ? params.length : k === 'consts' ? consts.length : k === 'vars' ? vars.length : outputs.length;
  }
  // Left-rail tabs = inputs + intermediates; OUTPUTS live in the right pane.
  const INPUT_SECTIONS = SECTIONS.filter((s) => s.key !== 'outputs');
  let activeLabel = $derived(SECTIONS.find((s) => s.key === activeTab)?.label ?? 'PARAMS');
</script>

<svelte:window onkeydown={onKeydown} />

{#if expanded}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="ge-expr-shade" onclick={onCancel}></div>
{/if}

<!-- ─── section bodies (shared by tabs + accordions modes) ─────────────────── -->
{#snippet paramsBody()}
  <div class="ge-xs-table">
    {#each params as p, i (i)}
      {@const err = nameError(p.name)}
      <div class="ge-xs-row" class:bad={!!err}>
        <input class="ge-xs-name" type="text" placeholder="name" bind:value={p.name} title={err ?? 'param name → input socket'} />
        <input class="ge-xs-num" type="number" step="any" placeholder="default" bind:value={p.default} title="optional default (used when the socket is unwired)" />
        <button class="ge-xs-del" type="button" title="Remove" onclick={() => delParam(i)}>×</button>
      </div>
    {/each}
    <button class="ge-xs-add" type="button" onclick={addParam}>+ row</button>
  </div>
{/snippet}

{#snippet constsBody()}
  <div class="ge-xs-table">
    {#each consts as c, i (i)}
      {@const err = nameError(c.name)}
      <div class="ge-xs-row" class:bad={!!err}>
        <input class="ge-xs-name" type="text" placeholder="name" bind:value={c.name} title={err ?? 'fixed local value'} />
        <input class="ge-xs-num" type="number" step="any" placeholder="value" bind:value={c.value} title="constant value" />
        <button class="ge-xs-del" type="button" title="Remove" onclick={() => delConst(i)}>×</button>
      </div>
    {/each}
    <button class="ge-xs-add" type="button" onclick={addConst}>+ row</button>
  </div>
{/snippet}

{#snippet varsBody()}
  <div class="ge-xs-table">
    {#each vars as v, i (i)}
      {@const nErr = nameError(v.name)}
      {@const fErr = formulaError(v.formula, varAllowed(i))}
      <div class="ge-xs-row formula" class:bad={!!nErr || !!fErr}>
        <input class="ge-xs-name" type="text" placeholder="name" bind:value={v.name} title={nErr ?? 'intermediate name'} />
        <span class="ge-xs-eq">=</span>
        <ExpressionSrcPane bind:src={v.formula} completions={completionsFor(varAllowed(i))} label="" rows={1} placeholder="od / two" />
        <button class="ge-xs-del" type="button" title="Remove" onclick={() => delVar(i)}>×</button>
      </div>
      {#if fErr}<div class="ge-xs-err">{fErr}</div>{/if}
    {/each}
    <button class="ge-xs-add" type="button" onclick={addVar}>+ row</button>
  </div>
{/snippet}

{#snippet outputsBody()}
  <div class="ge-xs-table">
    {#each outputs as o, i (i)}
      {@const nErr = nameError(o.name)}
      {@const fErr = formulaError(o.formula, outAllowed(i))}
      <div class="ge-xs-row formula" class:bad={!!nErr || !!fErr}>
        <input class="ge-xs-name out" type="text" placeholder="name" bind:value={o.name} title={nErr ?? 'output name → output socket'} />
        <span class="ge-xs-eq">=</span>
        <ExpressionSrcPane bind:src={o.formula} completions={completionsFor(outAllowed(i))} label="" rows={1} placeholder="diff / two" />
        <button class="ge-xs-del" type="button" title="Remove" onclick={() => delOutput(i)}>×</button>
      </div>
      {#if fErr}<div class="ge-xs-err">{fErr}</div>{/if}
    {/each}
    <button class="ge-xs-add" type="button" onclick={addOutput}>+ row</button>
  </div>
{/snippet}

{#snippet sectionBody(key: string)}
  {#if key === 'params'}{@render paramsBody()}
  {:else if key === 'consts'}{@render constsBody()}
  {:else if key === 'vars'}{@render varsBody()}
  {:else}{@render outputsBody()}{/if}
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="ge-expr-pop"
  class:expanded
  use:clampToViewport={expanded ? null : anchor}
  style={expanded ? '' : `left: ${anchor.x}px; top: ${anchor.y}px;`}>
  <div class="ge-expr-head">
    <span class="ge-expr-title">ƒ Expression</span>
    <input class="ge-expr-defname" type="text" placeholder="definition name" bind:value={name}
      class:bad={name.trim() === ''} title="Definition name (shown in the Σ menu + on instance cards)" />
    <div class="ge-expr-head-actions">
      <button type="button" class="ge-expr-iconbtn" title={expanded ? 'Collapse to popover' : 'Expand to full screen'} onclick={() => (expanded = !expanded)}>{expanded ? '⤡' : '⤢'}</button>
      <button type="button" class="ge-expr-iconbtn" title="Close (Esc)" onclick={onCancel}>✕</button>
    </div>
  </div>

  <div class="ge-expr-body">
    <!-- LEFT: vertical tab rail — inputs + intermediates (vertical text). -->
    <div class="ge-xs-rail">
      {#each INPUT_SECTIONS as s (s.key)}
        <button type="button" class="ge-xs-vtab {s.key}" class:on={activeTab === s.key}
          onclick={() => (activeTab = s.key as 'params' | 'consts' | 'vars')}>
          <span class="ge-xs-vlabel">{s.label}</span>
          <span class="ge-xs-vcount">{sectionCount(s.key)}</span>
        </button>
      {/each}
    </div>

    <!-- MIDDLE: the active input/intermediate section. -->
    <div class="ge-xs-editor {activeTab}">
      <div class="ge-xs-pane-head">{activeLabel}</div>
      {@render sectionBody(activeTab)}
    </div>

    <!-- RIGHT: OUTPUTS, always visible — the results + output sockets. -->
    <div class="ge-xs-outpane">
      <div class="ge-xs-pane-head out">OUTPUTS<span class="ge-xs-tabcount">{outputs.length}</span></div>
      {@render outputsBody()}
    </div>
  </div>

  <div class="ge-expr-foot">
    <span class="ge-expr-foot-msg" class:bad={!canCommit}>
      {canCommit ? '✓ ready' : '⚠ fix the highlighted rows'}
    </span>
    <div class="ge-expr-foot-actions">
      <button type="button" class="ge-xs-btn" onclick={onCancel}>Cancel</button>
      <button type="button" class="ge-xs-btn primary" disabled={!canCommit} onclick={commit}>Save</button>
    </div>
  </div>
</div>

<style>
  .ge-expr-shade { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.35); z-index: 1400; }
  .ge-expr-pop {
    position: fixed; z-index: 1401;
    width: 660px; max-width: calc(100vw - 24px);
    background: #fff; border: 1px solid #cbd5e1; border-radius: 10px;
    box-shadow: 0 12px 40px rgba(15, 23, 42, 0.25);
    display: flex; flex-direction: column; overflow: hidden;
    font-family: Arial, sans-serif;
  }
  .ge-expr-pop.expanded { inset: 24px; left: 24px !important; top: 24px !important; width: auto; max-width: none; }
  .ge-expr-head {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px; border-bottom: 1px solid #e5e7eb; background: #f8fafc;
  }
  .ge-expr-title { font: 700 12px Arial; color: #334155; white-space: nowrap; }
  .ge-expr-defname {
    flex: 1 1 auto; min-width: 0; font: 700 12px ui-monospace, monospace; color: #0e7490;
    padding: 4px 7px; border: 1px solid #cbd5e1; border-radius: 5px; background: #fff;
  }
  .ge-expr-defname.bad { border-color: #fca5a5; background: #fef2f2; }
  .ge-expr-head-actions { display: flex; gap: 4px; }
  .ge-expr-iconbtn {
    font: 13px Arial; color: #64748b; background: #fff; border: 1px solid #e2e8f0; border-radius: 5px;
    width: 24px; height: 24px; cursor: pointer; line-height: 1;
  }
  .ge-expr-iconbtn:hover { background: #f1f5f9; color: #334155; }
  .ge-expr-iconbtn.on { background: #0e7490; color: #fff; border-color: #0e7490; }
  .ge-expr-body { display: flex; align-items: stretch; flex: 1 1 auto; min-height: 220px; max-height: 56vh; overflow: hidden; }
  .ge-expr-pop.expanded .ge-expr-body { max-height: none; }

  /* LEFT vertical tab rail — vertical text + per-section accent. */
  .ge-xs-rail { display: flex; flex-direction: column; flex: 0 0 auto; background: #f8fafc; border-right: 1px solid #e5e7eb; }
  .ge-xs-vtab {
    flex: 1 1 0; min-height: 62px; width: 40px; cursor: pointer; position: relative;
    display: flex; flex-direction: column-reverse; align-items: center; justify-content: center; gap: 7px;
    background: transparent; border: none; border-left: 3px solid transparent; color: #64748b;
  }
  .ge-xs-vlabel { writing-mode: vertical-rl; transform: rotate(180deg); font: 700 10px Arial; letter-spacing: 0.14em; }
  .ge-xs-vcount {
    font: 700 9px ui-monospace, monospace; background: rgba(100,116,139,0.16); color: inherit;
    border-radius: 8px; padding: 1px 5px; min-width: 16px; text-align: center;
  }
  .ge-xs-vtab:hover { background: #f1f5f9; color: #334155; }
  .ge-xs-vtab.on { background: #fff; color: #0f172a; }
  .ge-xs-vtab.params.on { border-left-color: #3b82f6; }
  .ge-xs-vtab.consts.on { border-left-color: #64748b; }
  .ge-xs-vtab.vars.on   { border-left-color: #f59e0b; }
  .ge-xs-vtab.params.on .ge-xs-vlabel { color: #2563eb; }
  .ge-xs-vtab.consts.on .ge-xs-vlabel { color: #475569; }
  .ge-xs-vtab.vars.on   .ge-xs-vlabel { color: #b45309; }

  /* MIDDLE editor + RIGHT outputs panes. */
  .ge-xs-editor  { flex: 1 1 58%; min-width: 0; overflow: auto; }
  .ge-xs-outpane { flex: 1 1 42%; min-width: 0; overflow: auto; border-left: 1px solid #eef2f7; background: #fcfcff; }
  .ge-xs-pane-head {
    font: 700 10px Arial; letter-spacing: 0.09em; color: #475569;
    padding: 8px 10px 2px; display: flex; align-items: center; gap: 6px;
  }
  .ge-xs-pane-head.out { color: #7c3aed; }
  .ge-xs-pane-head .ge-xs-tabcount {
    font: 700 9px ui-monospace, monospace; background: rgba(124,58,237,0.14); color: #7c3aed;
    border-radius: 8px; padding: 1px 5px; min-width: 16px; text-align: center;
  }

  .ge-xs-table { display: flex; flex-direction: column; gap: 4px; padding: 6px; }
  .ge-xs-row { display: flex; align-items: center; gap: 5px; }
  .ge-xs-row.formula :global(.ge-expr-src) { flex: 1 1 auto; min-width: 0; }
  .ge-xs-name {
    flex: 0 0 92px; min-width: 0; font: 700 12px ui-monospace, monospace; color: #0e7490;
    padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 5px; background: #fff;
  }
  .ge-xs-name.out { color: #0369a1; }
  .ge-xs-num { flex: 1 1 auto; min-width: 0; font: 12px ui-monospace, monospace; padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 5px; background: #fff; }
  .ge-xs-eq { color: #94a3b8; font: 13px ui-monospace, monospace; }
  .ge-xs-row.bad .ge-xs-name { border-color: #fca5a5; background: #fef2f2; }
  .ge-xs-del {
    flex: 0 0 auto; width: 22px; height: 22px; line-height: 1; font: 14px Arial; color: #94a3b8;
    background: #fff; border: 1px solid #e2e8f0; border-radius: 5px; cursor: pointer;
  }
  .ge-xs-del:hover { color: #dc2626; border-color: #fecaca; background: #fef2f2; }
  .ge-xs-err { font: 11px Arial; color: #b91c1c; padding: 0 28px 0 98px; }
  .ge-xs-add {
    align-self: flex-start; font: 600 11px Arial; color: #0e7490; background: #ecfeff;
    border: 1px dashed #67e8f9; border-radius: 6px; padding: 4px 10px; cursor: pointer;
  }
  .ge-xs-add:hover { background: #cffafe; }

  .ge-expr-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; border-top: 1px solid #e5e7eb; padding: 8px 12px; background: #f8fafc; }
  .ge-expr-foot-msg { font: 600 11px Arial; color: #16a34a; }
  .ge-expr-foot-msg.bad { color: #b45309; }
  .ge-expr-foot-actions { display: flex; gap: 6px; }
  .ge-xs-btn { font: 600 12px Arial; color: #334155; background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 5px 12px; cursor: pointer; }
  .ge-xs-btn.primary { background: #0e7490; color: #fff; border-color: #0e7490; }
  .ge-xs-btn.primary:disabled { background: #cbd5e1; border-color: #cbd5e1; cursor: not-allowed; }
</style>
