<!--
  ExpressionBuilderPopup.svelte — the calculated-expression builder (B.6 / id
  914, PR-3). docs/plans/expression-builder.md §4/§7.

  A popover-FIRST surface: anchored to the ƒ/Σ launcher, with a header expand
  button that grows the SAME content into a full-screen overlay (and back) —
  NOT a persistent tab (the SketchEditorPane overlay/expand pattern).

  Two synchronized sections + strict IO:
    • SchemaPanel  — the allowed inputs (p.* params + e.* exprs) + fn palette.
    • VISUAL pane  — the parsed AST rendered as a READ-ONLY block tree; each
                     block rings red iff the validator flags its node.
    • SRC textarea — the raw mathjs source; the live block tree re-derives.
    • ValidationBanner + OutputRow — errors + the named e.<name> output + commit.

  Reuses the pure model layer (parseExpr/validateExpr) merged in PR-1/PR-2 — this
  component owns ONLY local UI $state (per-instance: it mounts per launcher, and
  /primitives mounts many panes, so NO module singletons). Interactivity (chip
  drag into slots) is PR-4; multi-output is PR-5.
-->
<script lang="ts">
  import { setContext } from 'svelte';
  import { clampToViewport } from '../popover-clamp';
  import { parseExpr, validateExpr, type ExprError, type ExprSchema } from '$lib/cad/graph-exprs';
  import { isIdentSafe } from '$lib/cad/expr-schema';
  import { EXPR_FOCUS_KEY } from './block-util';
  import SchemaPanel from './SchemaPanel.svelte';
  import ExpressionVisualPane from './ExpressionVisualPane.svelte';
  import ExpressionSrcPane from './ExpressionSrcPane.svelte';
  import ValidationBanner from './ValidationBanner.svelte';
  import OutputRow from './OutputRow.svelte';

  let {
    schema,
    initial,
    anchor,
    onCommit,
    onCancel,
  }: {
    /** Allowed inputs (p.* params + OTHER e.* exprs — NOT the one being edited). */
    schema: ExprSchema;
    /** The expr being authored/edited. `name: ''` ⇒ a fresh output. */
    initial: { name: string; src: string };
    /** Click point to anchor the popover (ignored when expanded). */
    anchor: { x: number; y: number };
    onCommit: (e: { name: string; src: string }) => void;
    onCancel: () => void;
  } = $props();

  // ─── per-instance local state ─────────────────────────────────────────────
  let src = $state(initial.src ?? '');
  let name = $state(initial.name ?? '');
  let expanded = $state(false);

  // Focus highlight: blocks read this $state object from context and ring
  // themselves when their node matches (set by clicking a banner error).
  const focus = $state<{ node: any }>({ node: null });
  setContext(EXPR_FOCUS_KEY, focus);

  // ─── derived: parse → validate ─────────────────────────────────────────────
  let parsed = $derived(parseExpr(src));
  let ast = $derived(parsed.ok ? parsed.ast : null);
  let srcEmpty = $derived(src.trim() === '');
  let errors = $derived<ExprError[]>(
    srcEmpty ? []
      : ast ? validateExpr(ast, schema)
      : [{ msg: (parsed as any).error ?? 'parse error' }],
  );

  // Display lists derived from the schema's dotted member set.
  let paramNames = $derived([...schema.inputs.dotted].filter((d) => d.startsWith('p.')).map((d) => d.slice(2)));
  let exprNames = $derived([...schema.inputs.dotted].filter((d) => d.startsWith('e.')).map((d) => d.slice(2)));

  // ─── name validation (unique ident, no param-shadow) ───────────────────────
  let nameError = $derived.by<string | null>(() => {
    const n = name.trim();
    if (n === '') return 'output name required';
    if (!isIdentSafe(n)) return `"${n}" is not a valid identifier`;
    if (paramNames.includes(n)) return `name shadows param p.${n}`;
    if (exprNames.includes(n)) return `duplicate expr e.${n}`;
    return null;
  });

  let canCommit = $derived(!srcEmpty && !!ast && errors.length === 0 && !nameError);

  function commit() {
    if (!canCommit) return;
    onCommit({ name: name.trim(), src: src.trim() });
  }

  function onKeydown(ev: KeyboardEvent) {
    if (ev.key === 'Escape') { ev.preventDefault(); onCancel(); }
    else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); commit(); }
  }

  function focusBlock(node: any) { focus.node = node; }
</script>

<svelte:window onkeydown={onKeydown} />

{#if expanded}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="ge-expr-shade" onclick={onCancel}></div>
{/if}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="ge-expr-pop"
  class:expanded
  use:clampToViewport={expanded ? null : anchor}
  style={expanded ? '' : `left: ${anchor.x}px; top: ${anchor.y}px;`}>
  <div class="ge-expr-head">
    <span class="ge-expr-title">ƒ Expression builder</span>
    <div class="ge-expr-head-actions">
      <button type="button" class="ge-expr-iconbtn" title={expanded ? 'Collapse to popover' : 'Expand to full screen'} onclick={() => (expanded = !expanded)}>{expanded ? '⤡' : '⤢'}</button>
      <button type="button" class="ge-expr-iconbtn" title="Close (Esc)" onclick={onCancel}>✕</button>
    </div>
  </div>

  <div class="ge-expr-body">
    <div class="ge-expr-cols">
      <div class="ge-expr-schema-col"><SchemaPanel {paramNames} {exprNames} /></div>
      <div class="ge-expr-visual-col"><ExpressionVisualPane {ast} {errors} hasSrc={!srcEmpty} /></div>
    </div>

    <ExpressionSrcPane bind:src />

    <div class="ge-expr-foot">
      <ValidationBanner {errors} {nameError} onErrorClick={focusBlock} />
      <OutputRow bind:name {canCommit} onCommit={commit} {onCancel} />
    </div>
  </div>
</div>

<style>
  .ge-expr-shade { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.35); z-index: 1400; }
  .ge-expr-pop {
    position: fixed; z-index: 1401;
    width: 520px; max-width: calc(100vw - 24px);
    background: #fff; border: 1px solid #cbd5e1; border-radius: 10px;
    box-shadow: 0 12px 40px rgba(15, 23, 42, 0.25);
    display: flex; flex-direction: column; overflow: hidden;
    font-family: Arial, sans-serif;
  }
  .ge-expr-pop.expanded {
    inset: 24px; left: 24px !important; top: 24px !important;
    width: auto; max-width: none;
  }
  .ge-expr-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 10px; border-bottom: 1px solid #e5e7eb;
    background: #f8fafc;
  }
  .ge-expr-title { font: 700 12px Arial; color: #334155; }
  .ge-expr-head-actions { display: flex; gap: 4px; }
  .ge-expr-iconbtn {
    font: 13px Arial; color: #64748b; background: #fff;
    border: 1px solid #e2e8f0; border-radius: 5px;
    width: 24px; height: 24px; cursor: pointer; line-height: 1;
  }
  .ge-expr-iconbtn:hover { background: #f1f5f9; color: #334155; }
  .ge-expr-body {
    display: flex; flex-direction: column; gap: 8px;
    padding: 10px; flex: 1 1 auto; min-height: 0; overflow: auto;
  }
  .ge-expr-cols { display: flex; gap: 10px; flex: 1 1 auto; min-height: 110px; }
  .ge-expr-schema-col { flex: 0 0 150px; min-width: 0; }
  .ge-expr-visual-col { flex: 1 1 auto; min-width: 0; display: flex; }
  .ge-expr-pop.expanded .ge-expr-schema-col { flex-basis: 220px; }
  .ge-expr-foot { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid #f1f5f9; padding-top: 8px; }
</style>
