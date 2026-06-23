<!--
  InputChip.svelte — a read-only `p.<param>` / `e.<expr>` reference block.
  An AccessorNode in the visual tree. Coloured by namespace group (p.* green,
  e.* purple); red ring iff the node is flagged by the validator (unknown
  input). PR-3 = read-only (drag/edit is PR-4).
-->
<script lang="ts">
  import { hasError, accessorName, focusStore } from './block-util';
  import type { ExprError } from '$lib/cad/graph-exprs';

  let { node, errors }: { node: any; errors: ExprError[] } = $props();
  const focus = focusStore();

  let full = $derived(accessorName(node));
  let group = $derived(node?.object?.name === 'e' ? 'e' : node?.object?.name === 'p' ? 'p' : 'x');
  let err = $derived(hasError(errors, node));
  let focused = $derived(focus?.node === node);
</script>

<span class="ge-expr-chip" class:p={group === 'p'} class:e={group === 'e'} class:x={group === 'x'} class:err class:focused title={full}>{full}</span>

<style>
  .ge-expr-chip {
    font: 600 11px ui-monospace, monospace;
    border-radius: 4px;
    padding: 1px 6px;
    border: 1px solid transparent;
    white-space: nowrap;
  }
  .ge-expr-chip.p { color: #166534; background: #dcfce7; border-color: #86efac; }
  .ge-expr-chip.e { color: #6b21a8; background: #f3e8ff; border-color: #d8b4fe; }
  .ge-expr-chip.x { color: #6b7280; background: #f3f4f6; border-color: #d1d5db; }
  .ge-expr-chip.err { color: #991b1b; background: #fee2e2; border-color: #ef4444; box-shadow: 0 0 0 1px #ef4444; }
  .ge-expr-chip.focused { box-shadow: 0 0 0 2px #2563eb; }
</style>
