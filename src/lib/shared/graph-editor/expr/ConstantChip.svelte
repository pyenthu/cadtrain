<!--
  ConstantChip.svelte — a read-only literal (ConstantNode) or bare constant
  symbol (`pi`/`tau`, a SymbolNode). Red ring iff the validator flags it (an
  unknown bare symbol). Editing the literal value is PR-4.
-->
<script lang="ts">
  import { hasError, focusStore } from './block-util';
  import type { ExprError } from '$lib/cad/graph-exprs';

  let { node, errors }: { node: any; errors: ExprError[] } = $props();
  const focus = focusStore();
  let focused = $derived(focus?.node === node);

  // ConstantNode carries `.value`; a SymbolNode (pi/tau) carries `.name`.
  let label = $derived(
    node?.type === 'ConstantNode' ? String(node.value)
      : node?.type === 'SymbolNode' ? String(node.name)
      : '?',
  );
  let isSymbol = $derived(node?.type === 'SymbolNode');
  let err = $derived(hasError(errors, node));
</script>

<span class="ge-expr-const" class:sym={isSymbol} class:err class:focused>{label}</span>

<style>
  .ge-expr-const {
    font: 600 11px ui-monospace, monospace;
    color: #1e3a8a;
    background: #e0e7ff;
    border: 1px solid #c7d2fe;
    border-radius: 4px;
    padding: 1px 6px;
    white-space: nowrap;
  }
  .ge-expr-const.sym { color: #92400e; background: #fef3c7; border-color: #fcd34d; }
  .ge-expr-const.err { color: #991b1b; background: #fee2e2; border-color: #ef4444; box-shadow: 0 0 0 1px #ef4444; }
  .ge-expr-const.focused { box-shadow: 0 0 0 2px #2563eb; }
</style>
