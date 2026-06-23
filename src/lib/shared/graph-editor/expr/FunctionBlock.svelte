<!--
  FunctionBlock.svelte — a FunctionNode: a function name + comma-separated arg
  slots, each recursing through ExpressionNode. Red ring iff the validator flags
  this node (disallowed fn / wrong arity).
-->
<script lang="ts">
  import ExpressionNode from './ExpressionNode.svelte';
  import { hasError, focusStore } from './block-util';
  import type { ExprError } from '$lib/cad/graph-exprs';

  let { node, errors }: { node: any; errors: ExprError[] } = $props();
  const focus = focusStore();

  let fnName = $derived(node?.fn?.type === 'SymbolNode' ? node.fn.name : String(node?.fn?.name ?? '?'));
  let args = $derived((node?.args ?? []) as any[]);
  let err = $derived(hasError(errors, node));
  let focused = $derived(focus?.node === node);
</script>

<span class="ge-expr-fn" class:err class:focused>
  <span class="ge-expr-fn-name">{fnName}</span>
  <span class="ge-expr-fn-paren">(</span>
  {#each args as arg, i}
    {#if i > 0}<span class="ge-expr-fn-comma">,</span>{/if}
    <span class="ge-expr-fn-arg"><ExpressionNode node={arg} {errors} /></span>
  {/each}
  <span class="ge-expr-fn-paren">)</span>
</span>

<style>
  .ge-expr-fn {
    display: inline-flex; align-items: center; gap: 3px;
    padding: 2px 5px; border-radius: 5px;
    background: #eff6ff; border: 1px solid #bfdbfe;
  }
  .ge-expr-fn.err { border-color: #ef4444; background: #fef2f2; }
  .ge-expr-fn.focused { box-shadow: 0 0 0 2px #2563eb; }
  .ge-expr-fn-name { font: 700 11px ui-monospace, monospace; color: #1d4ed8; }
  .ge-expr-fn-paren { color: #93c5fd; font: 12px ui-monospace, monospace; }
  .ge-expr-fn-comma { color: #93c5fd; font: 12px ui-monospace, monospace; }
  .ge-expr-fn-arg { display: inline-flex; align-items: center; }
</style>
