<!--
  RepeatEditorPane.svelte — the full-tab Repeat-pattern editor overlay (#7),
  extracted from GraphEditorPane (modularize K.65, mirrors the SketchEditorPane
  / PolyPreview carves).

  Renders ONLY when `repeatId` resolves to a node in `graph` (the {#if} guard
  lives inside this component, so GEP mounts it gated only on `editingRepeatId`).
  Owns: the iterators strip (count / op / loop var), the PARAMS section
  (per-iteration named bindings), the PARTS section (each repeated unit + its
  own mv/rot transform stack), and the LOOP BODY wired⇄code toggle.

  The deriveds (repeatNode / repeatParts / repeatHasBody / repeatBakeError /
  repeatScopeNames) are re-derived locally from `repeatId` + `graph`. The bake
  result is passed in (`bake`) because the bake-error surfaced in the code box
  depends on the live bake, not the graph. Graph mutations route through
  `setGraph()`; the Done tick calls `onClose()`.

  CSS (.ge-repeat-editor / .ge-rep-* + the shared .ge-sketch-done-tick) is
  duplicated here from GEP so Svelte's scoped CSS applies.
-->
<script lang="ts">
  import { argStr, argFrom } from './args';
  import {
    setRepeatCount,
    setRepeatOp,
    setRepeatLoopVar,
    addRepeatBinding,
    setRepeatBindingName,
    setRepeatBindingValue,
    removeRepeatBinding,
    addPartModifier,
    moveRepeatChild,
    removeRepeatChildAt,
    setPartModifierKind,
    setPartModifierAxis,
    movePartModifier,
    removePartModifier,
    setRepeatBodyExpr,
    clearRepeatBodyExpr,
    type Graph,
  } from '$lib/graph/composition-graph';

  let {
    repeatId,
    graph,
    setGraph,
    onClose,
    bake,
  }: {
    /** The Repeat node being edited (GEP's `editingRepeatId`). */
    repeatId: string;
    graph: Graph;
    setGraph: (g: Graph) => void;
    onClose: () => void;
    /** The live bake result — only its ok/message feed the in-box bake error. */
    bake?: { ok: boolean; message?: string } | 'loading' | null;
  } = $props();

  const repeatNode = $derived(graph.nodes[repeatId] as any);

  /** Short label for a node, shown in the Repeat PARTS list. */
  function nodeShortLabel(c: any): string {
    if (!c) return '(unwired)';
    return c.type === 'call' ? `${c.alias} · ${c.src}`
      : c.type === 'method' ? `${c.op}(…)`
      : c.type === 'repeat' ? `repeat × ${c.count?.kind === 'literal' ? c.count.value : '…'}`
      : c.type === 'sketch' ? '✐ sketch' : c.type;
  }
  /** The repeated PARTS of the node being edited, as {id,label} rows. */
  const repeatParts = $derived.by(() =>
    ((repeatNode?.children ?? []) as string[]).map((id) => ({ id, label: nodeShortLabel(graph.nodes[id]) })));
  /** The emitted var-name a part resolves to inside the loop body. Call nodes
   *  emit a const named by their alias (matches composition-emit); other node
   *  types fall back to their id. Used to seed the editable code box so the
   *  initial code references the same names that bake. */
  function partVarName(c: any): string {
    if (!c) return '__part';
    return c.type === 'call' && c.alias ? c.alias : c.id;
  }
  /** Seed code for the per-iteration body = the array of parts (place([...])),
   *  matching what the wired body emits. Shown when the user switches to code
   *  mode with no override yet. */
  function repeatBodySeed(): string {
    const names = ((repeatNode?.children ?? []) as string[]).map((id) => partVarName(graph.nodes[id]));
    if (names.length === 0) return 'place([\n  // wire parts on the canvas, or write the body here\n])';
    if (names.length === 1) return names[0];
    return `place([\n  ${names.join(',\n  ')},\n])`;
  }
  /** Whether the Repeat being edited has a raw code-body override. */
  const repeatHasBody = $derived(typeof repeatNode?.bodyExpr === 'string' && repeatNode.bodyExpr.trim().length > 0);
  /** Current bake error message (if the last bake failed) — surfaced INSIDE the
   *  code editor so a bad hand-written body isn't a silent no-op. */
  const repeatBakeError = $derived(
    typeof bake === 'object' && bake && bake.ok === false ? (bake.message ?? 'bake failed') : null);
  /** The identifiers a hand-written loop body may reference: the loop var, N,
   *  the PARAMS bindings, and the wired part var-names. (Helpers mv/rot/place
   *  are always in scope.) Engine primitives like r_cuboid are NOT — they must
   *  be wired as a part first. */
  const repeatScopeNames = $derived.by(() => {
    const lv = (repeatNode?.loopVar && /^[A-Za-z_$][\w$]*$/.test(repeatNode.loopVar)) ? repeatNode.loopVar : 'i';
    const binds = ((repeatNode?.bindings ?? []) as any[]).map((b) => b?.name).filter((n) => typeof n === 'string' && n);
    const parts = ((repeatNode?.children ?? []) as string[]).map((id) => partVarName(graph.nodes[id]));
    return { lv, binds, parts };
  });
  /** Switch the Loop-body tab into code mode — seed bodyExpr from the parts if
   *  not already set. Switching to wired clears the override. */
  function setRepeatBodyMode(mode: 'wired' | 'code') {
    if (!repeatId) return;
    if (mode === 'code') {
      if (!repeatHasBody) setGraph(setRepeatBodyExpr(graph, repeatId, repeatBodySeed()));
    } else {
      setGraph(clearRepeatBodyExpr(graph, repeatId));
    }
  }
</script>

<!-- Repeat pattern editor (#7) — full-tab overlay over the canvas pane,
     mirroring the sketch editor. Iterators on top, two tabs below. The
     3D pane re-bakes live on every `graph` reassignment. -->
{#if repeatId && repeatNode}
  {@const rid = repeatId}
  {@const rep = repeatNode}
  {@const lv = rep.loopVar && /^[A-Za-z_$][\w$]*$/.test(rep.loopVar) ? rep.loopVar : 'i'}
  <div class="ge-repeat-editor">
    <div class="ge-rep-head">
      <span class="ge-rep-title">↻ Repeat pattern</span>
      <button class="ge-sketch-done-tick" title="Done — back to the graph" onclick={onClose}>✓</button>
    </div>
    <!-- Iterators strip (always visible) -->
    <div class="ge-rep-iter">
      <label class="ge-rep-field">count
        <input class="ge-rep-in" type="text" value={argStr(rep.count)}
          onchange={(e) => { setGraph(setRepeatCount(graph, rid, argFrom((e.target as HTMLInputElement).value))); }}/>
      </label>
      <label class="ge-rep-field">op
        <select class="ge-rep-sel" value={rep.op ?? 'stack'}
          onchange={(e) => { setGraph(setRepeatOp(graph, rid, (e.target as HTMLSelectElement).value as any)); }}>
          <option value="stack">stack</option><option value="list">list</option><option value="place">place</option>
        </select>
      </label>
      <label class="ge-rep-field">loop var
        <input class="ge-rep-in narrow" type="text" value={rep.loopVar ?? ''} placeholder="i"
          onchange={(e) => { setGraph(setRepeatLoopVar(graph, rid, (e.target as HTMLInputElement).value)); }}/>
      </label>
      <span class="ge-rep-hint"><code>N</code> = count · <code>{lv}</code> = 0…N−1</span>
    </div>
    <!-- PARAMS — per-iteration named values (in scope as i/N + your names
         throughout the body AND every part modifier). Value is wireable. -->
    <div class="ge-rep-sec">
      <div class="ge-rep-sec-head">
        <span class="ge-rep-sec-lbl">PARAMS</span>
        <span class="ge-rep-sec-sub">ƒ({lv}) — values usable in part transforms</span>
        <button class="ge-rep-add sm" type="button" onclick={() => { setGraph(addRepeatBinding(graph, rid)); }}>+ param</button>
      </div>
      {#each (rep.bindings ?? []) as b, bi (bi)}
        <div class="ge-rep-prow">
          <input class="ge-rep-in narrow" type="text" value={b.name} placeholder="name"
            onchange={(e) => { setGraph(setRepeatBindingName(graph, rid, bi, (e.target as HTMLInputElement).value)); }}/>
          <span class="ge-rep-eq">=</span>
          <input class="ge-rep-in grow" type="text" value={argStr(b.value)} placeholder="expr / p.param"
            onchange={(e) => { setGraph(setRepeatBindingValue(graph, rid, bi, argFrom((e.target as HTMLInputElement).value))); }}/>
          <button class="ge-rep-x" type="button" title="Remove param" onclick={() => { setGraph(removeRepeatBinding(graph, rid, bi)); }}>×</button>
        </div>
      {/each}
    </div>

    <!-- PARTS — the repeated unit (combined per-iteration via place([…])).
         Each part has its OWN mv/rot transform stack (the ⊕ button). -->
    <div class="ge-rep-sec">
      <div class="ge-rep-sec-head">
        <span class="ge-rep-sec-lbl">PARTS</span>
        <span class="ge-rep-sec-sub">repeated {argStr(rep.count)}× · place([…]) · ⊕ adds a transform to that part</span>
      </div>
      {#if repeatParts.length === 0}
        <div class="ge-rep-note sm">No parts — drag a node's output onto the Repeat's <code>+ part</code> socket, or write the body as code below.</div>
      {/if}
      {#each repeatParts as p, pi (p.id + ':' + pi)}
        {@const pmods = (rep.partModifiers?.[p.id] ?? [])}
        <div class="ge-rep-part">
          <div class="ge-rep-part-row">
            <span class="ge-rep-part-idx">{pi}</span>
            <span class="ge-rep-part-name">{p.label}</span>
            <button class="ge-rep-round" type="button" title="Add a transform (mv/rot) to this part" onclick={() => { setGraph(addPartModifier(graph, rid, p.id, 'mv')); }}>⊕</button>
            <button class="ge-rep-mv" type="button" title="Move up" disabled={pi === 0} onclick={() => { setGraph(moveRepeatChild(graph, rid, pi, -1)); }}>▲</button>
            <button class="ge-rep-mv" type="button" title="Move down" disabled={pi === repeatParts.length - 1} onclick={() => { setGraph(moveRepeatChild(graph, rid, pi, 1)); }}>▼</button>
            <button class="ge-rep-x" type="button" title="Remove part" onclick={() => { setGraph(removeRepeatChildAt(graph, rid, pi)); }}>×</button>
          </div>
          {#each pmods as m, mi (mi)}
            <div class="ge-rep-pmod">
              <button class="ge-rep-kind" class:rot={m.kind === 'rot'} type="button" title="Toggle mv / rot"
                onclick={() => { setGraph(setPartModifierKind(graph, rid, p.id, mi, m.kind === 'mv' ? 'rot' : 'mv')); }}>{m.kind === 'mv' ? '⇄ mv' : '↻ rot'}</button>
              {#each [0, 1, 2] as ax (ax)}
                <input class="ge-rep-in axis" type="text" value={argStr(m.vec[ax])}
                  title={(m.kind === 'rot' ? 'r' : '') + ['x', 'y', 'z'][ax]}
                  onchange={(e) => { setGraph(setPartModifierAxis(graph, rid, p.id, mi, ax as 0 | 1 | 2, argFrom((e.target as HTMLInputElement).value))); }}/>
              {/each}
              <button class="ge-rep-mv" type="button" title="Move up" disabled={mi === 0} onclick={() => { setGraph(movePartModifier(graph, rid, p.id, mi, -1)); }}>▲</button>
              <button class="ge-rep-mv" type="button" title="Move down" disabled={mi === pmods.length - 1} onclick={() => { setGraph(movePartModifier(graph, rid, p.id, mi, 1)); }}>▼</button>
              <button class="ge-rep-x" type="button" title="Remove transform" onclick={() => { setGraph(removePartModifier(graph, rid, p.id, mi)); }}>×</button>
            </div>
          {/each}
        </div>
      {/each}
      {#if repeatParts.length}
        <div class="ge-rep-note sm">Transform axes may use <code>{lv}</code>, <code>N</code>, and PARAMS — e.g. <code>{lv}*2</code> or <code>{lv}*360/N</code>. Innermost row first.</div>
      {/if}
    </div>

    <!-- LOOP BODY — wired (generated) ⇄ code (editable override). -->
    <div class="ge-rep-sec">
      <div class="ge-rep-sec-head">
        <span class="ge-rep-sec-lbl">LOOP BODY</span>
        <button class="ge-rep-seg" class:on={!repeatHasBody} onclick={() => setRepeatBodyMode('wired')}>wired</button>
        <button class="ge-rep-seg" class:on={repeatHasBody} onclick={() => setRepeatBodyMode('code')}>code</button>
        {#if repeatHasBody}
          <button class="ge-rep-revert" type="button" title="Discard the code override, back to the wired parts" onclick={() => setRepeatBodyMode('wired')}>↺ revert</button>
        {/if}
      </div>
      {#if repeatHasBody}
        <textarea class="ge-rep-code" class:err={repeatBakeError} spellcheck="false" rows="5"
          value={rep.bodyExpr}
          oninput={(e) => { setGraph(setRepeatBodyExpr(graph, rid, (e.target as HTMLTextAreaElement).value)); }}></textarea>
        {#if repeatBakeError}
          <div class="ge-rep-bakeerr">⚠ bake failed: {repeatBakeError}</div>
        {/if}
        <div class="ge-rep-note sm">
          Raw per-iteration body, emitted verbatim. <strong>In scope:</strong> <code>mv</code> <code>rot</code> <code>place</code> · <code>{repeatScopeNames.lv}</code> · <code>N</code>{#if repeatScopeNames.binds.length} · {#each repeatScopeNames.binds as b}<code>{b}</code> {/each}{/if}{#if repeatScopeNames.parts.length} · parts {#each repeatScopeNames.parts as p}<code>{p}</code> {/each}{/if}. Engine primitives aren't callable — wire them as a part.
        </div>
      {:else}
        <pre class="ge-rep-code readonly">{repeatBodySeed()}</pre>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* Standalone Done tick — pinned top-right of the overlay editors. */
  .ge-sketch-done-tick {
    position: absolute; top: 10px; right: 14px; z-index: 10;
    width: 34px; height: 34px; padding: 0; display: flex; align-items: center; justify-content: center;
    background: #ecfdf5; color: #15803d; border: 1px solid #6ee7b7; border-radius: 9999px;
    font: 700 17px Arial; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.14);
  }
  .ge-sketch-done-tick:hover { background: #d1fae5; border-color: #34d399; }
  /* ─── Repeat pattern editor overlay (#7) ─────────────────────────────── */
  .ge-repeat-editor {
    position: absolute; inset: 0; z-index: 60; background: #fdf2f8;
    display: flex; flex-direction: column; gap: 0; overflow: auto;
    font: 12px ui-monospace, monospace; color: #1f2937;
  }
  .ge-rep-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; border-bottom: 1px solid #fbcfe8; background: #fff; }
  .ge-rep-title { font: 700 12px Arial; color: #9d174d; }
  .ge-rep-iter { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; padding: 6px 12px; border-bottom: 1px solid #fce7f3; }
  .ge-rep-field { display: flex; flex-direction: column; gap: 1px; font: 600 9px Arial; color: #9d174d; text-transform: uppercase; letter-spacing: 0.4px; }
  .ge-rep-in { font: 12px ui-monospace, monospace; padding: 3px 6px; border: 1px solid #f9a8d4; border-radius: 4px; width: 120px; box-sizing: border-box; }
  .ge-rep-in.narrow { width: 70px; }
  .ge-rep-in.axis { width: 86px; }
  .ge-rep-in:focus { outline: 1px solid #db2777; background: #fff; }
  .ge-rep-sel { font: 12px ui-monospace, monospace; padding: 3px 6px; border: 1px solid #f9a8d4; border-radius: 4px; }
  .ge-rep-hint { font: 11px Arial; color: #9ca3af; align-self: center; }
  .ge-rep-hint code, .ge-rep-note code { background: #fce7f3; color: #9d174d; padding: 0 4px; border-radius: 3px; }
  .ge-rep-eq { color: #9ca3af; }
  .ge-rep-add { font: 600 11px Arial; padding: 3px 9px; background: #fdf2f8; color: #9d174d; border: 1px dashed #f9a8d4; border-radius: 5px; cursor: pointer; }
  .ge-rep-add:hover { background: #fce7f3; border-style: solid; }
  .ge-rep-x { width: 20px; height: 20px; padding: 0; background: #fff; border: 1px solid #fca5a5; border-radius: 4px; color: #b91c1c; cursor: pointer; font: 11px Arial; }
  .ge-rep-x:hover { background: #fee2e2; }
  .ge-rep-note { font: 11px Arial; color: #6b7280; line-height: 1.5; max-width: 560px; }
  .ge-rep-kind { font: 600 11px ui-monospace, monospace; padding: 4px 8px; background: #ede9fe; color: #5b21b6; border: 1px solid #c4b5fd; border-radius: 5px; cursor: pointer; width: 64px; }
  .ge-rep-kind.rot { background: #fce7f3; color: #be185d; border-color: #f9a8d4; }
  .ge-rep-mv { width: 22px; height: 24px; padding: 0; background: #fff; border: 1px solid #d6d3d1; border-radius: 4px; font: 9px Arial; color: #57534e; cursor: pointer; }
  .ge-rep-mv:hover:not(:disabled) { background: #f3e8ff; }
  .ge-rep-mv:disabled { opacity: 0.35; cursor: default; }
  .ge-rep-part-row { display: flex; align-items: center; gap: 8px; }
  .ge-rep-part-idx { font: 600 10px ui-monospace, monospace; color: #f9a8d4; width: 14px; text-align: right; }
  .ge-rep-part-name { font: 12px ui-monospace, monospace; color: #1f2937; background: #fce7f3; border-radius: 4px; padding: 3px 8px; flex: 1; }
  .ge-rep-seg { font: 600 11px Arial; padding: 3px 12px; background: #fff; color: #9ca3af; border: 1px solid #f9a8d4; border-radius: 9999px; cursor: pointer; }
  .ge-rep-seg.on { background: #db2777; color: #fff; border-color: #db2777; }
  .ge-rep-revert { font: 600 11px Arial; padding: 3px 10px; background: #fff; color: #b91c1c; border: 1px solid #fca5a5; border-radius: 5px; cursor: pointer; margin-left: auto; }
  .ge-rep-revert:hover { background: #fee2e2; }
  .ge-rep-code { width: 100%; box-sizing: border-box; font: 12px ui-monospace, monospace; color: #1f2937; background: #fff; border: 1px solid #f9a8d4; border-radius: 6px; padding: 8px 10px; resize: vertical; }
  .ge-rep-code:focus { outline: 1px solid #db2777; }
  .ge-rep-code.readonly { background: #fdf2f8; color: #6b7280; white-space: pre; overflow: auto; margin: 0; }
  .ge-rep-code.err { border-color: #f87171; }
  .ge-rep-bakeerr { font: 600 11px ui-monospace, monospace; color: #b91c1c; background: #fee2e2; border: 1px solid #fca5a5; border-radius: 5px; padding: 6px 10px; margin-top: 6px; }
  /* Compact section layout (tab-less redesign) + per-part modifiers */
  .ge-rep-sec { display: flex; flex-direction: column; gap: 5px; padding: 7px 12px; border-bottom: 1px solid #fce7f3; }
  .ge-rep-sec-head { display: flex; align-items: center; gap: 8px; }
  .ge-rep-sec-lbl { font: 700 10px Arial; color: #9d174d; text-transform: uppercase; letter-spacing: 0.5px; }
  .ge-rep-sec-sub { font: 400 10px Arial; color: #9ca3af; flex: 1; }
  .ge-rep-prow { display: flex; align-items: center; gap: 6px; }
  .ge-rep-in.grow { width: auto; flex: 1; min-width: 90px; }
  .ge-rep-add.sm { padding: 2px 8px; font-size: 10px; }
  .ge-rep-note.sm { font-size: 10px; margin: 0; max-width: 620px; }
  .ge-rep-part { display: flex; flex-direction: column; gap: 4px; }
  .ge-rep-pmod { display: flex; align-items: center; gap: 5px; padding-left: 24px; }
  .ge-rep-round { width: 22px; height: 22px; border-radius: 9999px; padding: 0; background: #fce7f3; color: #9d174d; border: 1px solid #f9a8d4; cursor: pointer; font: 13px/1 Arial; }
  .ge-rep-round:hover { background: #fbcfe8; border-color: #db2777; }
</style>
