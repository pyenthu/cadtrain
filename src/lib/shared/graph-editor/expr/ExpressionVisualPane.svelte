<!--
  ExpressionVisualPane.svelte — renders the parsed AST as the read-only block
  tree (PR-3). Empty src ⇒ a hint; parse failure (ast === null) ⇒ a parse
  notice (the ValidationBanner carries the message).
-->
<script lang="ts">
  import ExpressionNode from './ExpressionNode.svelte';
  import type { ExprError } from '$lib/cad/graph-exprs';

  let { ast, errors, hasSrc }: { ast: any; errors: ExprError[]; hasSrc: boolean } = $props();
</script>

<div class="ge-expr-visual">
  {#if !hasSrc}
    <div class="ge-expr-visual-hint">Type an expression in the SRC box below — the block tree renders here.</div>
  {:else if !ast}
    <div class="ge-expr-visual-parse">⚠ Cannot parse — fix the SRC text.</div>
  {:else}
    <div class="ge-expr-visual-tree"><ExpressionNode node={ast} {errors} /></div>
  {/if}
</div>

<style>
  .ge-expr-visual {
    flex: 1 1 auto; min-height: 80px; overflow: auto;
    padding: 10px; background: #fff;
    border: 1px solid #e5e7eb; border-radius: 6px;
  }
  .ge-expr-visual-hint { font: 12px Arial; color: #9ca3af; }
  .ge-expr-visual-parse { font: 12px Arial; color: #b91c1c; }
  .ge-expr-visual-tree { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 3px; }
</style>
