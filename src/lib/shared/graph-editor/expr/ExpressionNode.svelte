<!--
  ExpressionNode.svelte — the recursive dispatcher. Given one mathjs AST node,
  pick the block component for its `type` and render it. Children recurse back
  through this dispatcher (the blocks import it), so the whole expression renders
  as a tree of blocks. READ-ONLY (PR-3) — interactivity (drop slots, edits) is
  PR-4.
-->
<script lang="ts">
  import InputChip from './InputChip.svelte';
  import ConstantChip from './ConstantChip.svelte';
  import OperatorBlock from './OperatorBlock.svelte';
  import FunctionBlock from './FunctionBlock.svelte';
  import ConditionalBlock from './ConditionalBlock.svelte';
  import { hasError } from './block-util';
  import type { ExprError } from '$lib/cad/graph-exprs';

  let { node, errors }: { node: any; errors: ExprError[] } = $props();
</script>

{#if !node}
  <span class="ge-expr-nil">∅</span>
{:else if node.type === 'ConstantNode'}
  <ConstantChip {node} {errors} />
{:else if node.type === 'SymbolNode'}
  <ConstantChip {node} {errors} />
{:else if node.type === 'AccessorNode'}
  <InputChip {node} {errors} />
{:else if node.type === 'OperatorNode'}
  <OperatorBlock {node} {errors} />
{:else if node.type === 'FunctionNode'}
  <FunctionBlock {node} {errors} />
{:else if node.type === 'ConditionalNode'}
  <ConditionalBlock {node} {errors} />
{:else if node.type === 'ParenthesisNode'}
  <span class="ge-expr-paren" class:err={hasError(errors, node)}>
    <span class="ge-expr-paren-mark">(</span>
    <ExpressionNode node={node.content} {errors} />
    <span class="ge-expr-paren-mark">)</span>
  </span>
{:else}
  <span class="ge-expr-unknown" class:err={hasError(errors, node)} title={node.type}>{node.type}</span>
{/if}

<style>
  .ge-expr-nil { font: 11px ui-monospace, monospace; color: #9ca3af; padding: 1px 4px; }
  .ge-expr-paren { display: inline-flex; align-items: center; gap: 2px; }
  .ge-expr-paren.err { box-shadow: 0 0 0 1px #ef4444; border-radius: 4px; }
  .ge-expr-paren-mark { color: #9ca3af; font: 12px ui-monospace, monospace; }
  .ge-expr-unknown {
    font: 600 11px ui-monospace, monospace;
    color: #6b7280; background: #f3f4f6; border: 1px solid #d1d5db;
    border-radius: 4px; padding: 1px 6px;
  }
  .ge-expr-unknown.err { color: #991b1b; background: #fee2e2; border-color: #ef4444; }
</style>
