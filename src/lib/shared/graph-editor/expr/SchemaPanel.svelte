<!--
  SchemaPanel.svelte — the strictly-controlled INPUT palette: the part's `p.*`
  params + already-declared `e.*` exprs. These chips document exactly what the
  expression may reference (a compact at-a-glance reference). The allowlisted
  FUNCTIONS + constants are NO LONGER listed here — they surface via the SRC
  pane's type-as-you-go autocomplete (B.7 step 3), so the panel stays compact.
  Clicking a chip is a no-op for now (a hook point for chip-insert).
-->
<script lang="ts">
  let { paramNames, exprNames }: { paramNames: string[]; exprNames: string[] } = $props();
</script>

<div class="ge-expr-schema">
  <div class="ge-expr-schema-group">
    <div class="ge-expr-schema-title">inputs · p.*</div>
    <div class="ge-expr-schema-chips">
      {#if paramNames.length === 0}
        <span class="ge-expr-schema-empty">no params</span>
      {:else}
        {#each paramNames as nm}
          <span class="ge-expr-schema-chip p">p.{nm}</span>
        {/each}
      {/if}
    </div>
  </div>

  <div class="ge-expr-schema-group">
    <div class="ge-expr-schema-title">exprs · e.*</div>
    <div class="ge-expr-schema-chips">
      {#if exprNames.length === 0}
        <span class="ge-expr-schema-empty">none yet</span>
      {:else}
        {#each exprNames as nm}
          <span class="ge-expr-schema-chip e">e.{nm}</span>
        {/each}
      {/if}
    </div>
  </div>

  <div class="ge-expr-schema-hint">functions &amp; constants — type to autocomplete in SRC</div>
</div>

<style>
  .ge-expr-schema {
    display: flex; flex-direction: column; gap: 8px;
    overflow: auto; padding: 2px;
  }
  .ge-expr-schema-group { display: flex; flex-direction: column; gap: 3px; }
  .ge-expr-schema-title { font: 600 10px Arial; letter-spacing: 0.05em; text-transform: uppercase; color: #9ca3af; }
  .ge-expr-schema-chips { display: flex; flex-wrap: wrap; gap: 3px; }
  .ge-expr-schema-empty { font: italic 11px Arial; color: #cbd5e1; }
  .ge-expr-schema-chip {
    font: 600 10px ui-monospace, monospace; border-radius: 4px;
    padding: 1px 6px; border: 1px solid transparent; cursor: default;
  }
  .ge-expr-schema-chip.p { color: #166534; background: #dcfce7; border-color: #86efac; }
  .ge-expr-schema-chip.e { color: #6b21a8; background: #f3e8ff; border-color: #d8b4fe; }
  .ge-expr-schema-hint { font: italic 10px Arial; color: #cbd5e1; line-height: 1.35; }
</style>
