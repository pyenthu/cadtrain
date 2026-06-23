<!--
  ValidationBanner.svelte — surfaces the validator's error list (+ the name
  error). Clicking an error calls `onErrorClick(node)` so the popup can flag /
  focus the offending block. Green "valid" state when the list is empty.
-->
<script lang="ts">
  import type { ExprError } from '$lib/cad/graph-exprs';

  let { errors, nameError, onErrorClick }: {
    errors: ExprError[];
    nameError: string | null;
    onErrorClick: (node: any) => void;
  } = $props();

  let total = $derived(errors.length + (nameError ? 1 : 0));
</script>

<div class="ge-expr-banner" class:ok={total === 0} class:bad={total > 0}>
  {#if total === 0}
    <span class="ge-expr-banner-ok">✓ valid</span>
  {:else}
    <span class="ge-expr-banner-count">⚠ {total} issue{total === 1 ? '' : 's'}</span>
    <div class="ge-expr-banner-list">
      {#if nameError}
        <span class="ge-expr-banner-item name">{nameError}</span>
      {/if}
      {#each errors as e}
        <button type="button" class="ge-expr-banner-item" onclick={() => onErrorClick(e.node)} title="Highlight the offending block">{e.msg}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .ge-expr-banner { display: flex; flex-direction: column; gap: 4px; font: 11px Arial; }
  .ge-expr-banner-ok { color: #15803d; font-weight: 600; }
  .ge-expr-banner-count { color: #b91c1c; font-weight: 600; }
  .ge-expr-banner-list { display: flex; flex-direction: column; gap: 2px; max-height: 96px; overflow: auto; }
  .ge-expr-banner-item {
    text-align: left; font: 11px ui-monospace, monospace; color: #991b1b;
    background: #fef2f2; border: 1px solid #fecaca; border-radius: 4px;
    padding: 2px 6px; cursor: pointer;
  }
  .ge-expr-banner-item.name { cursor: default; }
  button.ge-expr-banner-item:hover { background: #fee2e2; }
</style>
