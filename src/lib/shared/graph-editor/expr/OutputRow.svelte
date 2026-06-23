<!--
  OutputRow.svelte — the named `e.<name>` output + the Cancel / commit actions.
  Single output this PR; `[+ output]` (multi-output) is PR-5. The name input
  commits to the bound `name` on input; the popup derives `nameError` and gates
  the ✓ button.
-->
<script lang="ts">
  let { name = $bindable(), canCommit, onCommit, onCancel }: {
    name: string;
    canCommit: boolean;
    onCommit: () => void;
    onCancel: () => void;
  } = $props();
</script>

<div class="ge-expr-output">
  <span class="ge-expr-output-label">output</span>
  <span class="ge-expr-output-ns">e.</span>
  <input
    class="ge-expr-output-name"
    spellcheck="false"
    autocomplete="off"
    bind:value={name}
    placeholder="name" />
  <div class="ge-expr-output-actions">
    <button type="button" class="ge-expr-btn cancel" onclick={onCancel}>Cancel</button>
    <button type="button" class="ge-expr-btn commit" disabled={!canCommit} onclick={onCommit} title={canCommit ? 'Save this expression' : 'Fix the issues first'}>✓ Commit</button>
  </div>
</div>

<style>
  .ge-expr-output { display: flex; align-items: center; gap: 6px; }
  .ge-expr-output-label { font: 600 10px Arial; letter-spacing: 0.05em; text-transform: uppercase; color: #9ca3af; }
  .ge-expr-output-ns { font: 700 12px ui-monospace, monospace; color: #6b21a8; }
  .ge-expr-output-name {
    width: 110px; font: 600 12px ui-monospace, monospace; color: #6b21a8;
    padding: 3px 6px; border: 1px solid #d8b4fe; border-radius: 5px; background: #faf5ff;
  }
  .ge-expr-output-name:focus { outline: 2px solid #c4b5fd; outline-offset: -1px; }
  .ge-expr-output-actions { margin-left: auto; display: flex; gap: 6px; }
  .ge-expr-btn { font: 600 11px Arial; border-radius: 5px; padding: 4px 10px; cursor: pointer; border: 1px solid #d1d5db; }
  .ge-expr-btn.cancel { background: #fff; color: #6b7280; }
  .ge-expr-btn.cancel:hover { background: #f3f4f6; }
  .ge-expr-btn.commit { background: #4f46e5; color: #fff; border-color: #4338ca; }
  .ge-expr-btn.commit:hover:not(:disabled) { background: #4338ca; }
  .ge-expr-btn.commit:disabled { background: #c7d2fe; border-color: #c7d2fe; cursor: not-allowed; }
</style>
