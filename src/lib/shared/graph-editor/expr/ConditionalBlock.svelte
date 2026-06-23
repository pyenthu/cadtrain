<!--
  ConditionalBlock.svelte — a ConditionalNode (`cond ? then : else`), rendered
  as an `if / then / else` row. Each branch recurses through ExpressionNode.
-->
<script lang="ts">
  import ExpressionNode from './ExpressionNode.svelte';
  import { hasError, focusStore } from './block-util';
  import type { ExprError } from '$lib/cad/graph-exprs';

  let { node, errors }: { node: any; errors: ExprError[] } = $props();
  const focus = focusStore();
  let err = $derived(hasError(errors, node));
  let focused = $derived(focus?.node === node);
</script>

<span class="ge-expr-cond" class:err class:focused>
  <span class="ge-expr-cond-kw">if</span>
  <ExpressionNode node={node.condition} {errors} />
  <span class="ge-expr-cond-kw">then</span>
  <ExpressionNode node={node.trueExpr} {errors} />
  <span class="ge-expr-cond-kw">else</span>
  <ExpressionNode node={node.falseExpr} {errors} />
</span>

<style>
  .ge-expr-cond {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 5px; border-radius: 5px;
    background: #fefce8; border: 1px solid #fde68a;
  }
  .ge-expr-cond.err { border-color: #ef4444; background: #fef2f2; }
  .ge-expr-cond.focused { box-shadow: 0 0 0 2px #2563eb; }
  .ge-expr-cond-kw { font: 700 10px Arial; text-transform: uppercase; letter-spacing: 0.04em; color: #a16207; }
</style>
