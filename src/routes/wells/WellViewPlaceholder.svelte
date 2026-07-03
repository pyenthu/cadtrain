<script lang="ts">
  /**
   * WellViewPlaceholder — the CENTRAL view of the /wells app shell, one per
   * open `.wson` tab.
   *
   * THIS IS A MOUNT SEAM. A parallel session is porting the 3D well engine into
   * `src/lib/wells/` and will expose `src/lib/wells/WellSchematic3D.svelte`
   * (prop: `wson`). At merge, the real 3D view replaces this placeholder at the
   * clearly-marked `<!-- MOUNT: ... -->` comment below. Until then this shows
   * the loaded WSON's header summary so the shell is useful + testable on its
   * own. This component deliberately does NOT import from `$lib/wells/**`
   * (engine turf) — it uses the route-local `wson-summary.ts` parser.
   */
  import { Canvas } from '@threlte/core';
  import WellSchematic3D from '$lib/wells/WellSchematic3D.svelte';
  import { summarise, type WsonDoc } from './wson-summary';

  let {
    wson = null,
    error = null,
    fileName = '',
  }: { wson?: WsonDoc | null; error?: string | null; fileName?: string } = $props();

  // Presence of a summary gates the 3D stage vs. the empty message. The
  // well name + type chips + counts now render in the workspace header
  // (the /wells shell owns that row, WsonApp-style), so this view is just
  // the diagram surface.
  const summary = $derived(summarise(wson));
</script>

<div class="wv">
  {#if error}
    <div class="wv-error">
      <div class="wv-error-ic">⚠</div>
      <div>
        <div class="wv-error-title">Failed to parse {fileName}</div>
        <code class="wv-error-msg">{error}</code>
      </div>
    </div>
  {:else if summary}
    <!-- Real 3D well-schematic view: WellSchematic3D is Threlte scene content
         (own camera + OrbitControls), so it mounts inside a <Canvas>. -->
    <section class="wv-stage">
      <Canvas>
        <WellSchematic3D wson={wson as any} />
      </Canvas>
    </section>
  {:else}
    <div class="wv-empty">No WSON loaded.</div>
  {/if}
</div>

<style>
  .wv {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: #14141f;
    color: #e8e8ef;
    overflow: hidden;
  }

  .wv-stage {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 14px;
    border: 1px dashed #34345a;
    border-radius: 10px;
    background: radial-gradient(circle at 50% 35%, #20203a 0%, #10101a 80%);
  }
  .wv-error {
    margin: 24px;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    background: #2a1620;
    border: 1px solid #cc3333;
    border-radius: 8px;
    padding: 14px 16px;
  }
  .wv-error-ic {
    font-size: 20px;
    color: #ff6666;
  }
  .wv-error-title {
    font: 600 13px Arial;
    color: #ff8a8a;
  }
  .wv-error-msg {
    display: block;
    margin-top: 4px;
    font: 11px ui-monospace, monospace;
    color: #d99;
  }
  .wv-empty {
    margin: auto;
    color: #55556a;
    font: 12px ui-monospace, monospace;
  }
</style>
