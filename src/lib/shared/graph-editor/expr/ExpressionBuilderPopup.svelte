<!--
  ExpressionBuilderPopup.svelte — the four-section expression DEFINITION editor
  (B.7 / id 914, v3). docs/plans/expression-builder.md §v3.5.

  Edits a reusable per-part `ExprDef` (NOT a single node). NO host-graph
  `p.*`/`e.*` here: a def declares all of its own names. Commit writes the WHOLE
  ExprDef back (so every instance updates).

  Layout (redesigned 2026-06-26) — a 30 / 70 vertical split. This is a POPOVER,
  not a node, so it shows NO socket dots and a minimal "ƒ" header (the actions
  only — expand + close).
    • LEFT pane (30%)  — the def NAME field (top) + a plain PARAMS table (no
      tabs). Params are the sole declaration section; an UNWIRED param uses its
      default, which replaces the old CONSTS (dropped entirely — NOT backward-
      compatible: a def that still references a const name fails validation).
    • RIGHT pane (70%) — the OUTPUTS, split columnarly: a clickable LIST of
      output names (left) + the EDIT column (right) = a WIDE MULTI-LINE
      function-body editor (if/then ternary) for the selected output.

  Autocomplete corpus (OUTPUTS formula fields) = the names declared EARLIER in
  THIS def (params + vars) + ALLOWED_FUNCTIONS + ALLOWED_CONSTANTS.

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

  type ParamRow = { name: string; default: number | null };
  type FormulaRow = { name: string; formula: string };

  // ─── per-instance local state (seeded from `def`) ──────────────────────────
  let name = $state('');
  let params = $state<ParamRow[]>([]);
  let vars = $state<FormulaRow[]>([]);
  let outputs = $state<FormulaRow[]>([]);
  let expanded = $state(false);

  // Two-pane 30/70 split. LEFT pane (30%) is a plain PARAMS pane (no tabs —
  // params are the sole declaration section now; an unwired param uses its
  // default, which covers the old CONSTS case). RIGHT pane (70%) edits OUTPUTS.
  let selOut = $state(0); // index into `outputs` shown in the right pane

  // Seed on def-identity change (reopening the popup against a new def reseeds).
  let seededFrom: ExprDef | null = null;
  $effect(() => {
    if (seededFrom === def) return;
    seededFrom = def;
    name = def.name ?? '';
    params = (def.params ?? []).map((p) => ({ name: p.name, default: p.default ?? null }));
    vars = (def.vars ?? []).map((v) => ({ name: v.name, formula: v.formula }));
    outputs = (def.outputs ?? []).map((o) => ({ name: o.name, formula: o.formula }));
    selOut = 0;
  });

  // Keep the output-pane selection valid as outputs are deleted.
  $effect(() => {
    if (selOut >= outputs.length) selOut = Math.max(0, outputs.length - 1);
  });

  // ─── derived name sets ─────────────────────────────────────────────────────
  let paramNames = $derived(params.map((p) => p.name));
  let varNames = $derived(vars.map((v) => v.name));
  let outputNames = $derived(outputs.map((o) => o.name));
  let allNames = $derived([...paramNames, ...varNames, ...outputNames]);
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
    return new Set<string>([...paramNames, ...varNames.slice(0, i)]);
  }
  function outAllowed(i: number): Set<string> {
    return new Set<string>([...paramNames, ...varNames, ...outputNames.slice(0, i)]);
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
  const addOutput = () => { outputs = [...outputs, { name: uniqueName('out'), formula: '' }]; selOut = outputs.length - 1; };
  const delParam = (i: number) => { params = params.filter((_, j) => j !== i); };
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
      consts: [], // CONSTS dropped — use a param with a default instead
      vars: vars.map((v) => ({ name: v.name.trim(), formula: v.formula })),
      outputs: outputs.map((o) => ({ name: o.name.trim(), formula: o.formula })),
    };
    onCommit(out);
  }

  function onKeydown(ev: KeyboardEvent) {
    if (ev.key === 'Escape') { ev.preventDefault(); onCancel(); }
    else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); commit(); }
  }

</script>

<svelte:window onkeydown={onKeydown} />

{#if expanded}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="ge-expr-shade" onclick={onCancel}></div>
{/if}

<!-- ─── input section tables (params / consts) ─────────────────────────────── -->
{#snippet paramsBody()}
  <div class="ge-xs-table">
    {#each params as p, i (i)}
      {@const err = nameError(p.name)}
      <div class="ge-xs-row" class:bad={!!err}>
        <input class="ge-xs-name" type="text" placeholder="name" bind:value={p.name} title={err ?? 'param name'} />
        <input class="ge-xs-num" type="number" step="any" placeholder="default" bind:value={p.default} title="optional default (used when unwired)" />
        <button class="ge-xs-del" type="button" title="Remove" onclick={() => delParam(i)}>×</button>
      </div>
    {/each}
    <button class="ge-xs-add" type="button" onclick={addParam}>+ add param</button>
  </div>
{/snippet}

<!-- ─── full-body formula editor (one variable / output at a time) ──────────── -->
{#snippet formulaEditor(kind: 'var' | 'output', i: number)}
  {@const row = kind === 'var' ? vars[i] : outputs[i]}
  {#if row}
    {@const allowed = kind === 'var' ? varAllowed(i) : outAllowed(i)}
    {@const nErr = nameError(row.name)}
    {@const fErr = formulaError(row.formula, allowed)}
    <div class="ge-xs-mainedit">
      <div class="ge-xs-edhead">
        <input class="ge-xs-name big out" type="text" placeholder="output name"
          bind:value={row.name} title={nErr ?? 'output name'} />
        <button class="ge-xs-del" type="button" title="Remove"
          onclick={() => (kind === 'var' ? delVar(i) : delOutput(i))}>×</button>
      </div>
      <ExpressionSrcPane
        bind:src={row.formula}
        completions={completionsFor(allowed)}
        label=""
        rows={expanded ? 18 : 9}
        placeholder={kind === 'var' ? 'od / two' : 'diff > 0 ? diff : 0'} />
      {#if fErr}<div class="ge-xs-err big">{fErr}</div>{/if}
      <p class="ge-xs-edhint">Full expression body — supports multi-line + ternary <code>cond ? a : b</code> logic. Refers to earlier-declared names + math functions.</p>
    </div>
  {/if}
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="ge-expr-pop"
  class:expanded
  use:clampToViewport={expanded ? null : anchor}
  style={expanded ? '' : `left: ${anchor.x}px; top: ${anchor.y}px;`}>
  <div class="ge-expr-head">
    <span class="ge-expr-title">ƒ</span>
    <div class="ge-expr-head-actions">
      <button type="button" class="ge-expr-iconbtn" title={expanded ? 'Collapse to popover' : 'Expand to full screen'} onclick={() => (expanded = !expanded)}>{expanded ? '⤡' : '⤢'}</button>
      <button type="button" class="ge-expr-iconbtn" title="Close (Esc)" onclick={onCancel}>✕</button>
    </div>
  </div>

  <div class="ge-expr-body">
    <!-- ─── LEFT PANE (30%) — def NAME + PARAMS (no tabs) ──────────────────── -->
    <div class="ge-xs-pane left">
      <div class="ge-xs-main">
        <input class="ge-expr-defname" type="text" placeholder="expression name" bind:value={name}
          class:bad={name.trim() === ''} title="Expression name (shown in the Σ menu + on instance cards)" />
        {@render paramsBody()}
      </div>
    </div>

    <!-- ─── RIGHT PANE (70%) — OUTPUTS: a clickable LIST + the edit column ──── -->
    <div class="ge-xs-pane right">
      <div class="ge-xs-outlist">
        {#each outputs as o, i (i)}
          <button type="button" class="ge-xs-outitem" class:on={selOut === i}
            onclick={() => (selOut = i)} title={o.name || 'output'}>{o.name || 'out?'}</button>
        {/each}
        <button type="button" class="ge-xs-add" onclick={addOutput}>+ add output</button>
      </div>
      <div class="ge-xs-outedit">
        {#if outputs.length}
          {@render formulaEditor('output', selOut)}
        {:else}
          <div class="ge-xs-empty">
            <p>No outputs yet. Each output is a full expression body (multi-line + <code>cond ? a : b</code>).</p>
            <button type="button" class="ge-xs-add" onclick={addOutput}>+ add output</button>
          </div>
        {/if}
      </div>
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
    width: 860px; max-width: calc(100vw - 24px);
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
  .ge-expr-title { font: 700 15px Arial; color: #334155; white-space: nowrap; }
  /* def name now lives at the TOP of the LEFT pane (block, full-width). */
  .ge-expr-defname {
    display: block; width: auto; margin: 8px 12px 2px; font: 700 13px ui-monospace, monospace;
    color: #0e7490; padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 5px; background: #fff;
  }
  .ge-expr-defname.bad { border-color: #fca5a5; background: #fef2f2; }
  .ge-expr-head-actions { display: flex; gap: 4px; margin-left: auto; }
  .ge-expr-iconbtn {
    font: 13px Arial; color: #64748b; background: #fff; border: 1px solid #e2e8f0; border-radius: 5px;
    width: 24px; height: 24px; cursor: pointer; line-height: 1;
  }
  .ge-expr-iconbtn:hover { background: #f1f5f9; color: #334155; }
  .ge-expr-body { display: flex; align-items: stretch; flex: 1 1 auto; min-height: 280px; max-height: 60vh; overflow: hidden; }
  .ge-expr-pop.expanded .ge-expr-body { max-height: none; }

  /* 30 / 70 vertical split: declarations (left) | outputs (right). */
  .ge-xs-pane { display: flex; align-items: stretch; min-height: 0; min-width: 0; overflow: hidden; }
  .ge-xs-pane.left  { flex: 0 0 30%; max-width: 30%; }
  .ge-xs-pane.right { flex: 1 1 70%; border-left: 2px solid #e2e8f0; }

  /* RIGHT pane = an OUTPUTS list column + the edit column. */
  .ge-xs-outlist {
    flex: 0 0 150px; display: flex; flex-direction: column; gap: 2px;
    padding: 8px 6px; border-right: 1px solid #e5e7eb; background: #f8fafc; overflow-y: auto;
  }
  .ge-xs-outitem {
    text-align: left; font: 600 12px ui-monospace, monospace; color: #475569;
    background: transparent; border: none; border-left: 3px solid transparent;
    padding: 6px 8px; border-radius: 0 4px 4px 0; cursor: pointer;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .ge-xs-outitem:hover { background: #f1f5f9; color: #334155; }
  .ge-xs-outitem.on { background: #fff; color: #7c3aed; border-left-color: #a855f7; }
  .ge-xs-outedit { flex: 1 1 auto; min-width: 0; overflow: auto; display: flex; flex-direction: column; }

  /* LEFT pane body (def name + params). */
  .ge-xs-main { flex: 1 1 auto; min-width: 0; overflow: auto; display: flex; flex-direction: column; }

  /* full-body formula editor. */
  .ge-xs-mainedit { display: flex; flex-direction: column; gap: 6px; padding: 8px 12px 12px; flex: 1 1 auto; min-height: 0; }
  .ge-xs-edhead { display: flex; align-items: center; gap: 6px; }
  .ge-xs-mainedit :global(.ge-expr-src) { flex: 1 1 auto; min-height: 0; }
  .ge-xs-mainedit :global(.ge-expr-src-ta) { min-height: 180px; resize: vertical; }
  .ge-xs-edhint { margin: 0; font: 11px Arial; color: #94a3b8; line-height: 1.4; }
  .ge-xs-edhint code { font: 11px ui-monospace, monospace; background: #f1f5f9; padding: 0 3px; border-radius: 3px; color: #475569; }

  .ge-xs-table { display: flex; flex-direction: column; gap: 4px; padding: 6px 12px; }
  .ge-xs-row { display: flex; align-items: center; gap: 5px; }
  .ge-xs-name {
    flex: 0 0 110px; min-width: 0; font: 700 12px ui-monospace, monospace; color: #0e7490;
    padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 5px; background: #fff;
  }
  .ge-xs-name.big { flex: 1 1 auto; font-size: 13px; padding: 6px 8px; }
  .ge-xs-name.out { color: #0369a1; }
  .ge-xs-num { flex: 1 1 auto; min-width: 0; font: 12px ui-monospace, monospace; padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 5px; background: #fff; }
  .ge-xs-row.bad .ge-xs-name { border-color: #fca5a5; background: #fef2f2; }
  .ge-xs-del {
    flex: 0 0 auto; width: 22px; height: 22px; line-height: 1; font: 14px Arial; color: #94a3b8;
    background: #fff; border: 1px solid #e2e8f0; border-radius: 5px; cursor: pointer;
  }
  .ge-xs-del:hover { color: #dc2626; border-color: #fecaca; background: #fef2f2; }
  .ge-xs-err { font: 11px Arial; color: #b91c1c; }
  .ge-xs-err.big { padding: 2px 0; }
  .ge-xs-add {
    align-self: flex-start; font: 600 11px Arial; color: #0e7490; background: #ecfeff;
    border: 1px dashed #67e8f9; border-radius: 6px; padding: 4px 10px; cursor: pointer;
  }
  .ge-xs-add:hover { background: #cffafe; }
  .ge-xs-empty { padding: 16px 14px; display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
  .ge-xs-empty p { margin: 0; font: 12px Arial; color: #94a3b8; line-height: 1.5; }
  .ge-xs-empty code { font: 11px ui-monospace, monospace; background: #f1f5f9; padding: 0 3px; border-radius: 3px; color: #475569; }

  .ge-expr-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; border-top: 1px solid #e5e7eb; padding: 8px 12px; background: #f8fafc; }
  .ge-expr-foot-msg { font: 600 11px Arial; color: #16a34a; }
  .ge-expr-foot-msg.bad { color: #b45309; }
  .ge-expr-foot-actions { display: flex; gap: 6px; }
  .ge-xs-btn { font: 600 12px Arial; color: #334155; background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 5px 12px; cursor: pointer; }
  .ge-xs-btn.primary { background: #0e7490; color: #fff; border-color: #0e7490; }
  .ge-xs-btn.primary:disabled { background: #cbd5e1; border-color: #cbd5e1; cursor: not-allowed; }
</style>
