<script lang="ts">
  /**
   * /primitives/types — the visual TYPE DEFINER + manager (typed-ports Layer 2b).
   * Define composite record types (Point{r,z}, Casing{…}) and store them. Sits
   * under /primitives (a tool sibling of /primitives/profiles), not a new
   * top-level route. Plan: docs/plans/typed-ports.md.
   */
  import TypeDefinerPanel from '$lib/shared/TypeDefinerPanel.svelte';
</script>

<div class="tp-page">
  <header class="tp-head">
    <a class="tp-back" href="/primitives" title="Back to primitives">←</a>
    <h1 class="tp-title">Type Definer</h1>
    <span class="tp-sub">composite shapes for the node graph — define a record, wire it later</span>
  </header>
  <div class="tp-body">
    <TypeDefinerPanel />
  </div>
</div>

<style>
  .tp-page { display: flex; flex-direction: column; height: 100vh; }
  .tp-head { display: flex; align-items: baseline; gap: 12px; padding: 10px 16px; border-bottom: 1px solid #e2e8f0; }
  .tp-back { font-size: 18px; text-decoration: none; color: #64748b; }
  .tp-back:hover { color: #7c3aed; }
  .tp-title { font: 700 17px Arial, sans-serif; margin: 0; color: #1e293b; }
  .tp-sub { font-size: 12px; color: #94a3b8; }
  .tp-body { flex: 1 1 auto; min-height: 0; }
</style>
