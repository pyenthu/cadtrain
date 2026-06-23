<!--
  ExpressionSrcPane.svelte — the raw SRC textarea (plain textarea v1; CodeMirror
  later). Per cadtrain convention the value commits on blur / Enter, NOT per
  keystroke — but the live block tree wants to update as you type, so we bind a
  LOCAL draft and push it up on input (the parse is cheap + the visual feedback
  is the point). Ctrl/Cmd+Enter is reserved by the popup for commit.
-->
<script lang="ts">
  let { src = $bindable() }: { src: string } = $props();
</script>

<div class="ge-expr-src">
  <label class="ge-expr-src-label" for="ge-expr-src-ta">SRC</label>
  <textarea
    id="ge-expr-src-ta"
    class="ge-expr-src-ta"
    spellcheck="false"
    autocomplete="off"
    rows="2"
    bind:value={src}
    placeholder="max((p.od - p.id) / 2, 0)"></textarea>
</div>

<style>
  .ge-expr-src { display: flex; flex-direction: column; gap: 3px; }
  .ge-expr-src-label { font: 600 10px Arial; letter-spacing: 0.05em; color: #6b7280; }
  .ge-expr-src-ta {
    width: 100%; box-sizing: border-box; resize: vertical;
    font: 12px ui-monospace, monospace; color: #111827;
    padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px;
    background: #f9fafb;
  }
  .ge-expr-src-ta:focus { outline: 2px solid #93c5fd; outline-offset: -1px; background: #fff; }
</style>
