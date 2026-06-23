<!--
  OperatorBlock.svelte — an OperatorNode: `left ∘ right` (binary) or `∘ operand`
  (unary, e.g. `-p.x`). Operands recurse through ExpressionNode. Red ring iff
  the validator flags this node.
-->
<script lang="ts">
  import ExpressionNode from './ExpressionNode.svelte';
  import { hasError, opGlyph, focusStore } from './block-util';
  import type { ExprError } from '$lib/cad/graph-exprs';

  let { node, errors }: { node: any; errors: ExprError[] } = $props();
  const focus = focusStore();

  let args = $derived((node?.args ?? []) as any[]);
  let glyph = $derived(opGlyph(node?.op ?? '?'));
  let err = $derived(hasError(errors, node));
  let focused = $derived(focus?.node === node);
</script>

<span class="ge-expr-op" class:err class:focused>
  {#if args.length === 1}
    <span class="ge-expr-op-sym">{glyph}</span>
    <ExpressionNode node={args[0]} {errors} />
  {:else if args.length >= 2}
    <ExpressionNode node={args[0]} {errors} />
    <span class="ge-expr-op-sym">{glyph}</span>
    <ExpressionNode node={args[1]} {errors} />
    {#each args.slice(2) as extra}
      <span class="ge-expr-op-sym">{glyph}</span>
      <ExpressionNode node={extra} {errors} />
    {/each}
  {/if}
</span>

<style>
  .ge-expr-op {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 4px; border-radius: 5px;
    background: #f8fafc; border: 1px solid #e2e8f0;
  }
  .ge-expr-op.err { border-color: #ef4444; background: #fef2f2; }
  .ge-expr-op.focused { box-shadow: 0 0 0 2px #2563eb; }
  .ge-expr-op-sym { font: 700 12px ui-monospace, monospace; color: #475569; }
</style>
