<!--
  Proposed detail-tab body (seed terms with a hand-drafted proposal) —
  2-col layout: LEFT = the proposed 3D bake canvas; RIGHT = a Parameters
  accordion (drives live re-bake) over the composition tree + rule/definition
  details. Bake + Promote controls live in the page's detail-head; this body
  reads the cached bake + bubbles param edits via callbacks.
  Extracted from vocab/+page.svelte (R8).
-->
<script lang="ts">
  import ParamGrid from '$lib/shared/ui/ParamGrid.svelte';

  let {
    entry,
    pb,
    PrimitiveDualCanvas,
    pmap,
    paramsOpen,
    stableProposedArgs,
    promoteProposedStatus,
    onToggleParams,
    onParamUpdate,
  }: {
    entry: any;
    pb: any;
    PrimitiveDualCanvas: any;
    pmap: Record<string, number>;
    paramsOpen: boolean;
    stableProposedArgs: number[];
    promoteProposedStatus: string | null;
    onToggleParams: () => void;
    onParamUpdate: (key: string, value: number) => void;
  } = $props();
</script>

<div class="tab-body">
  <!-- Definition + chips encapsulated in the ⓘ Definition & tags popover
       (top-right of detail-head). Tab body focuses on params + 3D bake. -->

  <!-- 2-col layout: LEFT = canvas (full height of column);
       RIGHT = parameters on top, rule + details below. -->
  <div class="proposed-grid">
    <div class="proposed-canvas-col">
      <div class="bake-card no-head">
        <div class="bake-body">
          {#if !pb}
            <div class="bake-cta">
              Click <strong>Bake</strong> to render the hand-drafted <code>{entry.rule?.kind}</code> rule.
            </div>
          {:else if pb === 'loading'}
            <div class="empty">baking proposed source…</div>
          {:else if 'error' in (pb as any)}
            <div class="error">bake failed: {(pb as any).error}</div>
          {:else if !(pb as any).bake?.ok}
            <div class="error">bake failed: {(pb as any).bake?.message ?? 'no bake result'}</div>
          {:else if PrimitiveDualCanvas}
            {@const proposedPb = pb as any}
            <PrimitiveDualCanvas
              id={proposedPb.exemplar}
              name={proposedPb.exemplar}
              description=""
              args={stableProposedArgs}
              source={proposedPb.source}
              showControls={true}
              showLabels={false}
            />
          {:else}
            <div class="empty">3D canvas loading…</div>
          {/if}
        </div>
      </div>
    </div>

    <div class="proposed-right-col">
      <!-- Parameters at top of the right column -->
      {#if entry.params}
        <div class="pg-acc-wrap">
          <div class="pg-acc-head" class:collapsed={!paramsOpen}
            role="button" tabindex="0"
            aria-expanded={paramsOpen}
            onclick={onToggleParams}
            onkeydown={(ek) => { if (ek.key === 'Enter' || ek.key === ' ') { ek.preventDefault(); onToggleParams(); } }}>
            <span class="pg-acc-title">Parameters</span>
            <span class="pg-acc-count">({Object.keys(entry.params).length})</span>
            <div class="pv-spacer"></div>
            <span class="pg-acc-hint">drag to re-bake</span>
          </div>
          {#if paramsOpen}
            <div class="pg-acc-body">
              <ParamGrid
                schema={entry.params as any}
                pending={pmap}
                applied={pmap}
                onPending={(k, v) => onParamUpdate(k, v)}
                onCommit={(k, v) => onParamUpdate(k, v)}
                variant="fn"
              />
            </div>
          {/if}
        </div>
      {/if}

      <!-- Rule + details below parameters -->
      <div class="rule-details-col">
        {#if entry.rule}
          <!-- Composition tree (visual) — mirrors CompositionEditor's
               folder+file row style. -->
          <details class="block" open>
            <summary>composition · {entry.rule.kind}{entry.rule.engine ? ` · engine: ${(entry.rule.engine as string[]).join(', ')}` : ''}</summary>
            {#if entry.rule.kind === 'boolean_modify' && entry.rule.modifiers?.length}
              {@const firstOp = entry.rule.modifiers[0].op}
              {@const opGlyph = firstOp === 'subtract' ? '⊖' : firstOp === 'add' ? '⊕' : '⊗'}
              {@const bodyVerts = entry.rule.body?.polygon?.length ?? 0}
              {@const bodyEngine = (entry.rule.engine as string[])[0] ?? 'r_revolve'}
              <div class="ce-tree" role="tree" aria-label="Composition tree">
                <div class="ce-row ce-folder" style="--depth: 0">
                  <span class="ce-icon">📁</span>
                  <span class="ce-op-chip" data-op={firstOp}>{opGlyph} {firstOp}</span>
                  <span class="ce-folder-meta">{1 + entry.rule.modifiers.length} operands</span>
                </div>
                <div class="ce-folder-children">
                  <details class="ce-row-wrap" open>
                    <summary class="ce-row ce-file" style="--depth: 1">
                      <span class="ce-icon">📄</span>
                      <span class="ce-call-name">ƒ {bodyEngine}</span>
                      <span class="ce-call-args">(profile, segments)</span>
                      <span class="ce-spacer"></span>
                      <span class="ce-call-meta">{bodyVerts} verts</span>
                    </summary>
                    <div class="ce-detail" style="--depth: 1">
                      {#if entry.rule.body?.preamble?.length}
                        <div class="ce-detail-label">preamble</div>
                        <pre class="ce-detail-code">{entry.rule.body.preamble.join('\n')}</pre>
                      {/if}
                      {#if entry.rule.body?.polygon?.length}
                        <div class="ce-detail-label">polygon · {bodyVerts} verts</div>
                        <pre class="ce-detail-code">{entry.rule.body.polygon.map((p: string, i: number) => `  [${i}] ${p}`).join('\n')}</pre>
                      {/if}
                    </div>
                  </details>

                  <!-- Modifier calls — one row per shape. -->
                  {#each entry.rule.modifiers as mod, i (i)}
                    {@const mGlyph = mod.op === 'subtract' ? '⊖' : mod.op === 'add' ? '⊕' : '⊗'}
                    <details class="ce-row-wrap" open>
                      <summary class="ce-row ce-file" style="--depth: 1" data-op={mod.op}>
                        <span class="ce-icon">📄</span>
                        <span class="ce-mod-op">{mGlyph}</span>
                        <span class="ce-call-name">{mod.shape.kind}</span>
                        <span class="ce-call-args">({(Object.entries(mod.shape).filter(([k]) => k !== 'kind').map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', '))})</span>
                      </summary>
                      <div class="ce-detail" style="--depth: 1">
                        {#each Object.entries(mod.shape).filter(([k]) => k !== 'kind') as [k, v] (k)}
                          <div class="ce-detail-row">
                            <span class="ce-detail-key">{k}</span>
                            <span class="ce-detail-val">{typeof v === 'string' ? v : JSON.stringify(v)}</span>
                          </div>
                        {/each}
                      </div>
                    </details>
                  {/each}
                </div>
                <div class="ce-result">= Result</div>
              </div>
            {:else}
              <!-- Fallback for non-boolean_modify rules: show the JSON. -->
              <pre class="code">{JSON.stringify(entry.rule, null, 2)}</pre>
            {/if}
          </details>
        {/if}
        <details class="block">
          <summary>definition</summary>
          <p class="def-line rich">{entry.definition}</p>
        </details>
        {#if entry.expects_bake}
          <details class="block">
            <summary>expects bake</summary>
            <pre class="code">{JSON.stringify(entry.expects_bake, null, 2)}</pre>
          </details>
        {/if}
        <details class="block">
          <summary>raw proposed JSON</summary>
          <pre class="code">{JSON.stringify(entry, null, 2)}</pre>
        </details>
      </div>
    </div>
  </div>

  <!-- Promote button lives inline in the title row alongside Bake — see the
       page detail-head. -->
  {#if promoteProposedStatus}<div class="promote-status">{promoteProposedStatus}</div>{/if}
</div>

<style>
  /* Tab body — scrollable inner column. */
  .tab-body { padding: 6px 14px 14px; overflow-y: auto; display: grid; gap: 8px; align-content: start; min-height: 0; }
  .tab-body .def-line.rich { font: 14px/1.55 Arial; color: #1f2937; margin: 0; padding: 10px 12px; background: #f8fafc; border-left: 3px solid #0369a1; border-radius: 0 4px 4px 0; }
  /* New 2-col layout: LEFT = canvas (full height of column); RIGHT =
     params (top) + rule + details (below). */
  .proposed-grid { display: grid; grid-template-columns: 4fr 6fr; gap: 10px; align-items: stretch; min-height: 560px; }
  .proposed-grid > * { min-width: 0; }
  .proposed-canvas-col { display: flex; flex-direction: column; }
  .proposed-canvas-col .bake-card { flex: 1 1 auto; }
  /* Keep the bake-card a flex column so .bake-body has a defined height,
     otherwise the inner canvas collapses to 0 → auto-fit fires → bake-card
     grows → loop ("magnification keeps going indefinitely"). */
  .bake-card { background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px; overflow: hidden; }
  .bake-card.no-head { display: flex; flex-direction: column; }
  .bake-card.no-head .bake-body { flex: 1 1 auto; min-height: 480px; padding: 4px; overflow: hidden; }
  .bake-cta { padding: 24px 16px; text-align: center; color: #57534e; font: 12px Arial; line-height: 1.6; }
  .bake-cta code { font: 11px ui-monospace, monospace; color: #1e40af; }
  .proposed-right-col { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; }
  .proposed-right-col .block { margin: 0; }
  .proposed-right-col .pg-acc-wrap { margin: 0; padding: 0 2px 1px; }
  .rule-details-col { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; flex: 1 1 auto; }
  /* Accordion shell — copied from /primitives PrimitiveView (.pg-acc-*). */
  .pg-acc-wrap { border: 3px solid #d4d4dc; border-radius: 4px; background: #fff; padding: 0 3px 1px; margin: 0; }
  .pg-acc-head {
    display: flex; align-items: center; gap: 4px;
    padding: 2px 6px; margin: 0;
    background: transparent; border: 0;
    cursor: pointer;
    border-radius: 3px;
  }
  .pg-acc-head:hover { background: #ececf2; color: #cc2222; }
  .pg-acc-head.collapsed { background: #fafafa; }
  .pg-acc-title { font: bold 13px Arial; color: #333; flex: 0 0 auto; }
  .pg-acc-count { font: 11px ui-monospace, monospace; color: #6b7280; }
  .pg-acc-hint { font: 11px Arial; color: #9ca3af; }
  .pv-spacer { flex: 1; }
  .pg-acc-body { padding: 2px 4px 2px; max-height: 320px; overflow-y: auto; }
  /* Composition-tree visual — mirrors CompositionEditor's folder/file row look. */
  .ce-tree { padding: 4px 0; font: 12px Arial; color: #1f2937; }
  .ce-row { display: flex; align-items: center; gap: 6px; padding: 2px 6px 2px calc(6px + var(--depth, 0) * 16px); border-radius: 3px; }
  .ce-row.ce-folder { background: #fff8e6; border: 1px solid #fbbf24; font-weight: 600; }
  .ce-row.ce-file { background: #f8fafc; border: 1px solid #e2e8f0; cursor: pointer; }
  .ce-row.ce-file:hover { background: #e0f2fe; }
  .ce-folder-children { display: flex; flex-direction: column; gap: 2px; margin-left: 12px; padding-left: 6px; border-left: 2px solid #fbbf24; margin-top: 2px; }
  .ce-row-wrap { display: flex; flex-direction: column; }
  .ce-row-wrap summary { list-style: none; }
  .ce-row-wrap summary::-webkit-details-marker { display: none; }
  .ce-icon { font-size: 12px; opacity: 0.8; }
  .ce-op-chip { padding: 1px 8px; border-radius: 9999px; background: #fef3c7; color: #78350f; border: 1px solid #fbbf24; font: 600 11px Arial; text-transform: uppercase; letter-spacing: 0.5px; }
  .ce-folder-meta { font: 10px Arial; color: #92400e; margin-left: auto; }
  .ce-call-name { font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: #cc2222; }
  .ce-call-args { font: 11px ui-monospace, monospace; color: #6b7280; }
  .ce-call-meta { font: 10px Arial; color: #9ca3af; }
  .ce-spacer { flex: 1; }
  .ce-mod-op { display: inline-block; min-width: 16px; text-align: center; font: 600 13px Arial; color: #b91c1c; }
  .ce-row.ce-file[data-op="add"] .ce-mod-op { color: #15803d; }
  .ce-row.ce-file[data-op="intersect"] .ce-mod-op { color: #6d28d9; }
  .ce-detail { padding: 6px 8px 8px calc(8px + (var(--depth, 0) + 1) * 16px); background: #fff; border-left: 2px dashed #e2e8f0; margin: 2px 0 2px 14px; display: grid; gap: 3px; }
  .ce-detail-label { font: 600 10px Arial; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
  .ce-detail-code { margin: 0; padding: 6px 8px; font: 11px ui-monospace, monospace; color: #1f2937; background: #fafaf9; border: 1px solid #e5e7eb; border-radius: 3px; overflow: auto; max-height: 220px; }
  .ce-detail-row { display: grid; grid-template-columns: 130px 1fr; gap: 6px; font: 11px Arial; }
  .ce-detail-key { font: 11px ui-monospace, monospace; color: #6b7280; }
  .ce-detail-val { font: 11px ui-monospace, monospace; color: #0c4a6e; }
  .ce-result { margin: 4px 0 0 16px; padding: 3px 10px; font: 600 11px Arial; color: #14532d; background: #dcfce7; border: 1px solid #86efac; border-radius: 9999px; display: inline-block; }
  .block { margin-top: 2px; border: 1px solid #e5e7eb; border-radius: 4px; background: #fff; }
  .block summary { padding: 3px 10px; font: 600 12px Arial; color: #1f2937; cursor: pointer; user-select: none; }
  .block summary:hover { background: #f9fafb; }
  .block[open] summary { border-bottom: 1px solid #f1f5f9; }
  .code { padding: 10px 12px; margin: 0; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: #1f2937; overflow: auto; max-height: 320px; }
  .empty { color: #6b7280; font: 12px Arial; padding: 8px; }
  .error { color: #b91c1c; font: 11px ui-monospace, monospace; padding: 8px; }
  /* Status line for promote success/failure. */
  .promote-status {
    padding: 8px 12px; margin-top: 8px;
    background: #fffbeb; border: 1px solid #fbbf24; border-radius: 4px;
    font: 12px Arial; color: #78350f;
  }
</style>
