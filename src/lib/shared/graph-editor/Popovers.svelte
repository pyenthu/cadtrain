<!--
  Popovers.svelte — the anchored expr / profile / container popovers for the
  graph editor (modularize K.65, Phase A — docs/plans/graph-editor-pane.md).

  Owns 4 SELF-CONTAINED popovers carved out of GraphEditorPane.svelte:
    • containerPop   — ⚙ on a Stack/List/Group/Output card: reorder children,
                        per-child ×N count + z-offset override
    • argExprPop     — ƒ-expression editor for a Call arg (textarea + param chips)
    • profilePop     — profile-KIND picker (#119): curated kinds for the set
    • profileRefPop  — profile-NODE swap picker (wire a polygon/sketch)

  The sketch (sketchExprPop) + polygon/transform (polyExprPop) + param/wire
  (addParamPop, wirePop) popovers stay in GraphEditorPane for now — they're
  coupled to the sketch editor / node-card / params-card state that moves in
  later phases (E / F / D). The shared `.ge-wire-*` / `.ge-expr-*` / `.ge-param-add`
  / `.ge-empty` CSS is therefore DUPLICATED here (those rules also stay in GEP
  for the popovers that haven't moved); the duplication collapses once E/F/D land.

  Contract: `graph` is $bindable (every apply* mutates it); the open* fns are
  EXPORTED so GraphEditorPane drives them via `bind:this` from its node-render
  arms (`popovers.openX(...)`). `expectedProfileSet` / `expectedDefaults` /
  `paramEntries` are passed in (read-only) — they're GEP-derived state.
-->
<script lang="ts">
  import { clampToViewport } from './popover-clamp';
  import {
    setCallArg,
    asExpr,
    asLiteral,
    removeContainerChildAt,
    setStackChildCount,
    setStackChildRef,
    setMethodInput,
    removeNode,
    STACK_REF_PARAM,
    type Graph,
    type NodeId,
  } from '$lib/cad/composition-graph';
  import { PROFILE_REGISTRY, defaultsFor, type ProfileDef } from '$lib/shared/profile-presets';
  import { profileProducers, producerLabel, kindsForSet } from './args';

  let {
    graph = $bindable(),
    expectedProfileSet,
    expectedDefaults,
    paramEntries,
  }: {
    graph: Graph;
    /** primitive src → which profile set its profile arg expects (revolve vs cartesian). */
    expectedProfileSet: Record<string, 'revolve' | 'cartesian'>;
    /** primitive src → its meta param defaults (for the inherited stack_ref placeholder). */
    expectedDefaults: Record<string, Record<string, number>>;
    /** declared params (minus the reserved stack_ref) — the argExpr insert chips. */
    paramEntries: [string, any][];
  } = $props();

  // ─── stack/list reorder popover ─────────────────────────────────────────
  // ⚙ button on container cards (stack / list / group / root output) opens
  // a popover showing each child as a row with ▲ / ▼ to reorder. Mutates
  // container.children directly; the visible slots + wires re-derive.
  let containerPop = $state<{ containerId: NodeId; x: number; y: number } | null>(null);
  export function openContainerPop(ev: MouseEvent, containerId: NodeId) {
    ev.stopPropagation();
    containerPop = { containerId, x: ev.clientX, y: ev.clientY };
  }
  function closeContainerPop() { containerPop = null; }

  // ─── CSG operator (− / + / ×) popover ───────────────────────────────────
  // Click the compact CSG circle to open a tiny menu: delete the whole
  // operation, or clear an input (A/B) back to unwired ('').
  let csgPop = $state<{ nodeId: NodeId; op: string; x: number; y: number } | null>(null);
  export function openCsgPop(ev: MouseEvent, nodeId: NodeId, op: string) {
    ev.stopPropagation();
    csgPop = { nodeId, op, x: ev.clientX, y: ev.clientY };
  }
  function closeCsgPop() { csgPop = null; }
  function csgDeleteOp() { if (csgPop) { graph = removeNode(graph, csgPop.nodeId); csgPop = null; } }
  function csgClearInput(slot: 'obj' | 'arg') { if (csgPop) { graph = setMethodInput(graph, csgPop.nodeId, slot, ''); csgPop = null; } }
  export function moveChild(containerId: NodeId, index: number, delta: -1 | 1) {
    const node = graph.nodes[containerId] as any;
    if (!node || !Array.isArray(node.children)) return;
    const newIndex = index + delta;
    if (newIndex < 0 || newIndex >= node.children.length) return;
    const newChildren = [...node.children];
    [newChildren[index], newChildren[newIndex]] = [newChildren[newIndex]!, newChildren[index]!];
    graph = { ...graph, nodes: { ...graph.nodes, [containerId]: { ...node, children: newChildren } } };
  }

  // ─── multi-source ƒ-expression popup editor ─────────────────────────────
  // When an arg's kind === 'expr' AND the expression references 2+ distinct
  // params, the inline text input is too cramped to author cleanly. The
  // collapsed chip — "ƒ(p.od, p.wall)" — opens this popup with a bigger
  // text area + click-to-insert chips for every declared param. Applied
  // value commits back to the arg via setCallArg(asExpr(...)).
  let argExprPop = $state<{ callId: NodeId; key: string; draft: string; x: number; y: number } | null>(null);
  export function openArgExprPop(ev: MouseEvent, callId: NodeId, key: string, currentExpr: string) {
    ev.stopPropagation();
    argExprPop = { callId, key, draft: currentExpr, x: ev.clientX, y: ev.clientY };
  }
  function closeArgExprPop() { argExprPop = null; }
  function applyArgExprPop() {
    if (!argExprPop) return;
    graph = setCallArg(graph, argExprPop.callId, argExprPop.key, asExpr(argExprPop.draft));
    argExprPop = null;
  }
  function insertParamIntoDraft(name: string) {
    if (!argExprPop) return;
    const ref = `p.${name}`;
    const draft = argExprPop.draft;
    // Append with a space if there's existing text + the last char isn't whitespace.
    const sep = draft.length > 0 && !/\s$/.test(draft) ? ' ' : '';
    argExprPop = { ...argExprPop, draft: draft + sep + ref };
  }

  // ─── Profile picker popover (#119) ─────────────────────────────────────
  /** Open when the user clicks a profile chip on a Call card. Lists every
   *  curated kind from PROFILE_REGISTRY filtered by the primitive's `set`
   *  (revolve vs cartesian). Selecting a kind rewrites the arg's expr to
   *  a fresh `{kind, params}` JSON descriptor seeded with defaults. */
  let profilePop = $state<{ callId: NodeId; key: string; src: string; set: 'revolve' | 'cartesian'; currentKind: string; x: number; y: number } | null>(null);
  export function openProfilePop(ev: MouseEvent, callId: NodeId, key: string, src: string, currentKind: string) {
    ev.stopPropagation();
    const set = expectedProfileSet[src] ?? (src === 'r_revolve' ? 'revolve' : 'cartesian');
    profilePop = { callId, key, src, set, currentKind, x: ev.clientX, y: ev.clientY };
  }
  function closeProfilePop() { profilePop = null; }
  function selectProfileKind(kindId: string) {
    if (!profilePop) return;
    const def: ProfileDef | undefined = PROFILE_REGISTRY[kindId];
    if (!def) return;
    const desc = { kind: kindId, params: defaultsFor(def) };
    graph = setCallArg(graph, profilePop.callId, profilePop.key, asExpr(JSON.stringify(desc)));
    profilePop = null;
  }

  // ─── Node-ref profile (a wired polygon/sketch) — swap / detach ──────────
  // A revolve/extrude `profile` arg wired to a producer carries a
  // `__POLY__<id>` expr. This popover lets the user SWAP it to a different
  // polygon/sketch in the graph or DETACH it entirely (× on the chip).
  let profileRefPop = $state<{ callId: NodeId; key: string; x: number; y: number } | null>(null);
  export function openProfileRefPop(ev: MouseEvent, callId: NodeId, key: string) {
    ev.stopPropagation();
    profileRefPop = { callId, key, x: ev.clientX, y: ev.clientY };
  }
  function closeProfileRefPop() { profileRefPop = null; }
  function swapProfileRef(callId: NodeId, key: string, nodeId: NodeId) {
    graph = setCallArg(graph, callId, key, asExpr(`__POLY__${nodeId}`));
    profileRefPop = null;
  }
  /** Detach the profile — clears the arg to an empty slot the user re-fills. */
  export function detachProfile(callId: NodeId, key: string) {
    graph = setCallArg(graph, callId, key, asExpr(''));
  }
</script>

{#if profilePop}
  <!-- Profile-kind picker popover (#119). Lists curated kinds filtered
       by the primitive's `set` (revolve = r,z half-section; cartesian =
       x,y polygon). Click a kind → arg's expr is replaced with a fresh
       {kind, params} JSON descriptor seeded with defaults. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="ge-wire-shade" onclick={closeProfilePop}></div>
  <div class="ge-profile-pop"
    style="left: {Math.min(profilePop.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 280)}px; top: {Math.min(profilePop.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 360)}px">
    <div class="ge-profile-pop-head">
      <span class="ge-profile-pop-title">Profile · {profilePop.set}</span>
      <span class="ge-profile-pop-hint">{profilePop.key} · {profilePop.src}</span>
    </div>
    <div class="ge-profile-pop-list">
      {#each kindsForSet(profilePop.set) as def (def.id)}
        <button class="ge-profile-pop-item"
          class:active={def.id === profilePop.currentKind}
          type="button"
          onclick={() => selectProfileKind(def.id)}>
          <span class="ge-profile-pop-item-name">{def.label}</span>
          <span class="ge-profile-pop-item-id">{def.id}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}

{#if profileRefPop}
  <!-- Node-ref profile swap picker. Lists every polygon/sketch in the graph
       (the new sketch IS a profile producer — combining the 2D drawing
       program with the profile editor) + a shortcut to the built-in kinds. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="ge-wire-shade" onclick={closeProfileRefPop}></div>
  <div class="ge-profile-pop"
    style="left: {Math.min(profileRefPop.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 280)}px; top: {Math.min(profileRefPop.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 360)}px">
    <div class="ge-profile-pop-head">
      <span class="ge-profile-pop-title">Choose a profile</span>
      <span class="ge-profile-pop-hint">{profileRefPop.key} · wire a polygon / sketch</span>
    </div>
    <div class="ge-profile-pop-list">
      {#each profileProducers(graph) as prod (prod.id)}
        {@const curExpr = String((graph.nodes[profileRefPop.callId] as any)?.args?.[profileRefPop.key]?.expr ?? '')}
        <button class="ge-profile-pop-item"
          class:active={curExpr === `__POLY__${prod.id}`}
          type="button"
          onclick={() => swapProfileRef(profileRefPop!.callId, profileRefPop!.key, prod.id)}>
          <span class="ge-profile-pop-item-name">{prod.type === 'sketch' ? '✐ ' : '◇ '}{producerLabel(graph, prod.id)}</span>
          <span class="ge-profile-pop-item-id">{prod.id}</span>
        </button>
      {/each}
      {#if profileProducers(graph).length === 0}
        <div class="ge-profile-pop-empty">No polygon or sketch in this graph yet. Drop one (✎ → polygon / sketch) first.</div>
      {/if}
    </div>
  </div>
{/if}

{#if argExprPop}
  <!-- ƒ-expression editor popup — wider input + click-to-insert chips for
       every declared param. Used when an arg references 2+ params (the
       inline text box becomes too cramped to read). -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="ge-wire-shade" onclick={closeArgExprPop}></div>
  <div class="ge-wire-pop ge-expr-pop"
    use:clampToViewport={argExprPop}
    style="left: {Math.min(argExprPop.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 460)}px; top: {argExprPop.y}px">
    <div class="ge-wire-head">ƒ <code>{argExprPop.key}</code> expression</div>
    <textarea class="ge-expr-textarea" rows="3"
      placeholder="e.g. p.od / 2 - p.wall"
      value={argExprPop.draft}
      oninput={(e) => { if (argExprPop) argExprPop = { ...argExprPop, draft: (e.target as HTMLTextAreaElement).value }; }}></textarea>
    <div class="ge-expr-pop-row">
      <span class="ge-expr-pop-label">insert:</span>
      {#each paramEntries as [name, p] (name)}
        <button class="ge-expr-pop-chip" type="button"
          onclick={() => insertParamIntoDraft(name)}
          title={`Append p.${name} to the expression (default ${(p as any).default})`}>p.{name}</button>
      {/each}
      {#if paramEntries.length === 0}
        <span class="ge-empty">no params declared</span>
      {/if}
    </div>
    <div class="ge-expr-pop-row right">
      <button class="ge-param-add ghost" type="button" onclick={closeArgExprPop}>cancel</button>
      <button class="ge-param-add" type="button" onclick={applyArgExprPop}>apply</button>
    </div>
  </div>
{/if}

{#if csgPop}
  {@const glyph = csgPop.op === 'subtract' ? '−' : csgPop.op === 'add' ? '+' : '×'}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="ge-wire-shade" onclick={closeCsgPop}></div>
  <div class="ge-wire-pop ge-csg-pop"
    style="left: {Math.min(csgPop.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 200)}px; top: {csgPop.y}px">
    <div class="ge-wire-head">{glyph} {csgPop.op}</div>
    <button class="ge-csg-pop-btn" type="button" onclick={() => csgClearInput('obj')}>Clear input A</button>
    <button class="ge-csg-pop-btn" type="button" onclick={() => csgClearInput('arg')}>Clear input B</button>
    <button class="ge-csg-pop-btn danger" type="button" onclick={csgDeleteOp}>🗑 Delete operation</button>
  </div>
{/if}

{#if containerPop}
  {@const cnode = graph.nodes[containerPop.containerId] as any}
  {@const ctitle = cnode?.id === graph.root ? '▶ Output' : cnode?.type === 'stack' ? '↕ Stack' : cnode?.type === 'group' ? '{} Group' : '[ ] List'}
  {@const isStack = cnode?.type === 'stack'}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="ge-wire-shade" onclick={closeContainerPop}></div>
  <div class="ge-wire-pop ge-container-pop"
    style="left: {Math.min(containerPop.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 380)}px; top: {containerPop.y}px">
    <div class="ge-wire-head">{ctitle} · order</div>
    {#if (cnode?.children ?? []).length === 0}
      <div class="ge-empty">no children yet — drag-wire something into this card</div>
    {:else}
      <table class="ge-container-table">
        <thead>
          <tr><th>#</th><th>node</th>{#if isStack}<th title="Copies of this child, mated end-to-end (replaces a Repeat node): blank/1 = single · a number or a param expr like p.n">× N</th><th title="Per-child z-offset: blank = inherit the part's own stack_ref · 0 = end-to-end flush · negative = overlap into the next · positive = leave a gap">z-offset</th>{/if}<th>order</th><th></th></tr>
        </thead>
        <tbody>
          {#each cnode.children as childId, i (childId)}
            {@const cn = graph.nodes[childId]}
            {@const label = cn?.type === 'call' ? `${(cn as any).alias} · ${(cn as any).src}`
              : cn?.type === 'method' ? `${(cn as any).op}(…)`
              : cn?.type === 'mv' ? 'mv(…)'
              : cn?.type === 'rot' ? 'rot(…)'
              : cn?.type === 'stack' ? 'stack(…)'
              : cn?.type === 'repeat' ? `repeat × ${(cn as any).count?.kind === 'literal' ? (cn as any).count.value : '…'}`
              : '(missing)'}
            {@const inheritedRef = cn?.type === 'call' ? expectedDefaults[(cn as any).src]?.[STACK_REF_PARAM] : undefined}
            {@const overrideRef = (cnode.childRefs ?? {})[childId]}
            <tr>
              <td class="ge-cp-idx">{i + 1}</td>
              <td class="ge-cp-name">{label}</td>
              {#if isStack}
                {@const countVal = (cnode.childCounts ?? {})[childId]}
                {@const countDisplay = countVal == null ? ''
                  : countVal.kind === 'literal' ? String(countVal.value)
                  : countVal.kind === 'param' ? `p.${countVal.param}`
                  : countVal.expr}
                <td class="ge-cp-count">
                  <!-- Per-child COUNT (×N). Blank/1 = a single copy; a number
                       or a param expr (e.g. p.n) places N copies mated
                       end-to-end — no separate Repeat node. Commit on
                       Enter/blur; empty or ≤1 clears. -->
                  <input
                    class="ge-cp-count-input"
                    type="text"
                    value={countDisplay}
                    placeholder="1"
                    title={countVal != null
                      ? `Placing ${countDisplay} copies mated end-to-end (clear or set 1 for a single copy)`
                      : 'Single copy — type a number (or a param expr like p.n) to stack N copies'}
                    onkeydown={(e) => { if ((e as KeyboardEvent).key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    onchange={(e) => {
                      const raw = (e.target as HTMLInputElement).value.trim();
                      let next = null;
                      if (raw !== '') {
                        const n = Number(raw);
                        if (Number.isFinite(n)) next = n <= 1 ? null : asLiteral(Math.floor(n));
                        else next = asExpr(raw);
                      }
                      graph = setStackChildCount(graph, cnode.id, childId, next);
                    }} />
                </td>
                <td class="ge-cp-ref">
                  <!-- Per-child z-offset OVERRIDE. Blank value = inherit the
                       part's own stack_ref (shown as the placeholder when we
                       know it). Commit on Enter/blur (Apply-on-Enter convention);
                       empty clears the override → inherit. -->
                  <input
                    class="ge-cp-ref-input"
                    type="text"
                    inputmode="decimal"
                    value={overrideRef ?? ''}
                    placeholder={inheritedRef != null ? String(inheritedRef) : 'inherit'}
                    title={overrideRef != null
                      ? `Override for this stack: ${overrideRef} (clear to inherit ${inheritedRef ?? 0})`
                      : `Inheriting ${inheritedRef != null ? `the part's ${inheritedRef}` : '0 (no stack_ref on the part)'} — type a number to override here`}
                    onkeydown={(e) => { if ((e as KeyboardEvent).key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    onchange={(e) => {
                      const raw = (e.target as HTMLInputElement).value.trim();
                      const v = raw === '' ? null : Number(raw);
                      graph = setStackChildRef(graph, cnode.id, childId, v == null || Number.isNaN(v) ? null : v);
                    }} />
                </td>
              {/if}
              <td class="ge-cp-order">
                <button type="button" class="ge-cp-arrow" title="Move up" disabled={i === 0}
                  onclick={() => moveChild(containerPop!.containerId, i, -1)}>▲</button>
                <button type="button" class="ge-cp-arrow" title="Move down" disabled={i === cnode.children.length - 1}
                  onclick={() => moveChild(containerPop!.containerId, i, 1)}>▼</button>
              </td>
              <td class="ge-cp-del">
                <button type="button" class="ge-cp-remove" title="Remove from container"
                  onclick={() => { graph = removeContainerChildAt(graph, containerPop!.containerId, i); }}>×</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
    <div class="ge-expr-pop-row right">
      <button class="ge-param-add" type="button" onclick={closeContainerPop}>done</button>
    </div>
  </div>
{/if}

<style>
  /* ── Shared popover chrome (DUPLICATED from GraphEditorPane.svelte — those
        rules also serve the sketch/poly/wire popovers still living in GEP;
        this copy collapses when phases E/F/D move them out). ─────────────── */
  .ge-wire-shade { position: fixed; inset: 0; background: transparent; z-index: 200; }
  .ge-wire-pop { position: fixed; min-width: 200px; background: #fff; border: 1px solid #fbbf24; border-radius: 6px; box-shadow: 0 4px 14px rgba(0,0,0,0.18); padding: 4px 0; z-index: 210; }
  .ge-wire-head { padding: 6px 10px; font: 600 11px Arial; color: #78350f; border-bottom: 1px solid #fef3c7; }
  .ge-wire-head code { font: 11px ui-monospace, monospace; background: #fef3c7; padding: 1px 4px; border-radius: 2px; }
  .ge-empty { padding: 20px; text-align: center; color: #9ca3af; font: 12px Arial; }
  .ge-param-add { padding: 3px 12px; font: 600 11px Arial; background: #fbbf24; color: #78350f; border: 0; border-radius: 3px; cursor: pointer; }
  .ge-param-add:hover { background: #d97706; color: #fff; }
  .ge-param-add.ghost { background: #e5e7eb; color: #1f2937; }
  .ge-param-add.ghost:hover { background: #d1d5db; }

  /* ── ƒ-expression editor (argExpr) — shared base; the abs/rel tab + mode
        variants ride the sketch/poly popovers still in GEP. ──────────────── */
  .ge-expr-pop { min-width: 420px; max-width: 460px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .ge-expr-textarea { width: 100%; box-sizing: border-box; padding: 6px 8px; font: 12px ui-monospace, monospace; border: 1px solid #d6d3d1; border-radius: 4px; resize: vertical; background: #faf5ff; color: #5b21b6; }
  .ge-expr-textarea:focus { outline: 1px solid #6d28d9; background: #fff; }
  .ge-expr-pop-row { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 4px 6px; }
  .ge-expr-pop-row.right { justify-content: flex-end; gap: 8px; }
  .ge-expr-pop-label { font: 11px Arial; color: #6b7280; margin-right: 4px; }
  .ge-expr-pop-chip { font: 600 11px ui-monospace, monospace; color: #78350f; background: #fef3c7; border: 1px solid #fbbf24; border-radius: 4px; padding: 2px 7px; cursor: pointer; transition: background 0.1s; }
  .ge-expr-pop-chip:hover { background: #fde68a; }

  /* ── Profile picker (profilePop + profileRefPop) — RELOCATED from GEP. ─── */
  .ge-profile-pop {
    position: fixed; width: 280px; max-height: 360px;
    background: #fff; border: 1px solid #d6d3d1; border-radius: 8px;
    box-shadow: 0 6px 18px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06);
    z-index: 200; display: flex; flex-direction: column;
  }
  .ge-profile-pop-head {
    display: flex; flex-direction: column; gap: 1px;
    padding: 8px 12px; border-bottom: 1px solid #f1f5f9;
  }
  .ge-profile-pop-title { font: 600 11px Arial; color: #5b21b6; text-transform: uppercase; letter-spacing: 0.6px; }
  .ge-profile-pop-hint { font: 10px ui-monospace, monospace; color: #78716c; }
  .ge-profile-pop-list { flex: 1 1 auto; overflow-y: auto; padding: 4px 0; }
  .ge-profile-pop-item {
    display: flex; align-items: center; justify-content: space-between;
    width: 100%; padding: 6px 12px; box-sizing: border-box;
    background: transparent; border: 0; cursor: pointer;
    text-align: left; font: 12px Arial; color: #1f2937;
  }
  .ge-profile-pop-item:hover { background: #f3f4f6; color: #5b21b6; }
  .ge-profile-pop-item.active { background: #ede9fe; color: #4c1d95; font-weight: 600; }
  .ge-profile-pop-item-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ge-profile-pop-item-id { font: 10px ui-monospace, monospace; color: #a8a29e; }
  .ge-profile-pop-empty { padding: 10px; font: 11px Arial; color: #94a3b8; line-height: 1.4; }

  /* ── Container reorder popover (containerPop) — RELOCATED from GEP. ────── */
  .ge-container-pop { min-width: 340px; max-width: 480px; padding: 8px 6px 4px; }
  /* CSG operator menu */
  .ge-csg-pop { min-width: 180px; }
  .ge-csg-pop-btn { display: block; width: 100%; text-align: left; padding: 7px 12px; border: none; background: none; font: 500 12px Arial; color: #374151; cursor: pointer; }
  .ge-csg-pop-btn:hover { background: #fef3c7; }
  .ge-csg-pop-btn.danger { color: #b91c1c; border-top: 1px solid #fef3c7; }
  .ge-csg-pop-btn.danger:hover { background: #fee2e2; }
  .ge-container-table { width: 100%; border-collapse: collapse; font: 11px Arial; }
  .ge-container-table th { text-align: left; padding: 4px 6px; font: 600 10px Arial; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e5e7eb; }
  .ge-container-table td { padding: 4px 6px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
  .ge-cp-idx { width: 24px; color: #9ca3af; font: 600 11px ui-monospace, monospace; }
  .ge-cp-name { font: 600 11px ui-monospace, monospace; color: #0c4a6e; }
  .ge-cp-ref { width: 64px; }
  .ge-cp-ref-input { width: 56px; box-sizing: border-box; padding: 2px 4px; font: 11px ui-monospace, monospace; text-align: right; border: 1px solid #d1d5db; border-radius: 3px; color: #0c4a6e; background: #fff; }
  .ge-cp-ref-input::placeholder { color: #b0b7c0; font-style: italic; }
  .ge-cp-ref-input:focus { outline: none; border-color: #0ea5e9; }
  .ge-cp-count { width: 56px; }
  .ge-cp-count-input { width: 48px; box-sizing: border-box; padding: 2px 4px; font: 11px ui-monospace, monospace; text-align: right; border: 1px solid #d1d5db; border-radius: 3px; color: #166534; background: #fff; }
  .ge-cp-count-input::placeholder { color: #b0b7c0; font-style: italic; }
  .ge-cp-count-input:focus { outline: none; border-color: #22c55e; }
  .ge-cp-order { width: 56px; white-space: nowrap; }
  .ge-cp-arrow { background: transparent; border: 1px solid #d1d5db; color: #6b7280; padding: 1px 5px; font: 10px Arial; cursor: pointer; border-radius: 3px; margin-right: 2px; }
  .ge-cp-arrow:hover:not(:disabled) { background: #f3f4f6; color: #111827; }
  .ge-cp-arrow:disabled { opacity: 0.3; cursor: default; }
  .ge-cp-del { width: 24px; text-align: right; }
  .ge-cp-remove { background: transparent; border: 0; font: 14px Arial; color: #b91c1c; cursor: pointer; padding: 0 4px; }
  .ge-cp-remove:hover { color: #7f1d1d; }
</style>
