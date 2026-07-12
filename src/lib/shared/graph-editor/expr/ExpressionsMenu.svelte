<script lang="ts">
  /*
    B.7 v3 (PR-3) — the Σ Expressions MENU.

    The Σ rail button opens this popover (replacing the old "open the editor on
    the first def" shortcut). It lists `graph.exprDefs` and is the home of the
    define → instance → wire flow:

      ┌ Expressions                      [+] ┐
      │ wall   (od, id) → wall       ✎   ⦻ × │   ✎ = edit def
      │ taper  (a, i)   → r          ✎   ⦻ × │   ⦻ = drop an instance
      └──────────────────────────────────────┘   × = delete def

    • +  → create a new def AND open the editor on it (define params/outputs now).
    • ✎  → open the four-section editor bound to that def.
    • ⦻  → drop an ExprNode instance of THAT def (its params/outputs become the
           instance card's input/output sockets) and close the menu.
    • ×  → delete the def. If any instances reference it, an INLINE confirm
           ("N instance(s) use this — delete them too?") gates it (NOT
           window.confirm — that blocks the browser extension).

    Pure-presentational: all graph mutation lives in the parent (GraphEditorPane)
    via the callbacks. State here (`confirmId`) is per-instance `$state`.
  */
  import type { ExprDef } from '$lib/graph/composition-graph';

  let {
    defs,
    instanceCounts,
    anchor,
    onAdd,
    onEdit,
    onDrop,
    onDelete,
    onClose,
  }: {
    /** graph.exprDefs — the defs to list. */
    defs: ExprDef[];
    /** defId → number of ExprNode instances referencing it (for the delete guard). */
    instanceCounts: Record<string, number>;
    /** Anchor point (the Σ button's right edge) to position the popover. */
    anchor: { x: number; y: number };
    /** + → create a new def and open the editor on it (event anchors the editor). */
    onAdd: (ev: MouseEvent) => void;
    /** ✎ → open the editor on this def. The event anchors the editor popover. */
    onEdit: (ev: MouseEvent, defId: string) => void;
    /** ⦻ → drop an instance of this def (then the menu closes). */
    onDrop: (defId: string) => void;
    /** × (confirmed) → remove the def AND its instances. */
    onDelete: (defId: string) => void;
    /** Backdrop / Esc → close the menu. */
    onClose: () => void;
  } = $props();

  // Which row is awaiting an inline delete-confirm (null = none). Per-instance.
  let confirmId = $state<string | null>(null);

  function summary(def: ExprDef): string {
    const ins = def.params.map((p) => p.name).join(', ');
    const outs = def.outputs.map((o) => o.name).join(', ');
    return `(${ins}) → ${outs || '—'}`;
  }

  function dropInstance(defId: string) {
    onDrop(defId);
    onClose();
  }

  function requestDelete(defId: string) {
    const n = instanceCounts[defId] ?? 0;
    if (n > 0) {
      confirmId = defId; // need confirmation — instances reference this def
    } else {
      onDelete(defId);
    }
  }

  function confirmDelete(defId: string) {
    confirmId = null;
    onDelete(defId);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="ge-exprmenu-shade" onclick={onClose}></div>

<div class="ge-exprmenu" style="left: {anchor.x}px; top: {anchor.y}px"
  role="menu" tabindex="-1"
  onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}>
  <div class="ge-exprmenu-head">
    <span class="ge-exprmenu-title">Expressions</span>
    <button class="ge-exprmenu-add" type="button" title="New expression"
      onclick={(ev) => onAdd(ev)}>+</button>
  </div>

  {#if defs.length === 0}
    <div class="ge-exprmenu-empty">No expressions yet — <b>+</b> to add one.</div>
  {:else}
    <ul class="ge-exprmenu-list">
      {#each defs as def (def.id)}
        <li class="ge-exprmenu-row">
          {#if confirmId === def.id}
            <div class="ge-exprmenu-confirm">
              <span class="ge-exprmenu-confirm-msg">
                {instanceCounts[def.id] ?? 0} instance{(instanceCounts[def.id] ?? 0) === 1 ? '' : 's'}
                use this — delete them too?
              </span>
              <button class="ge-exprmenu-confirm-yes" type="button"
                onclick={() => confirmDelete(def.id)}>Delete all</button>
              <button class="ge-exprmenu-confirm-no" type="button"
                onclick={() => (confirmId = null)}>Cancel</button>
            </div>
          {:else}
            <span class="ge-exprmenu-name" title={def.name}>{def.name}</span>
            <span class="ge-exprmenu-sig" title={summary(def)}>{summary(def)}</span>
            <span class="ge-exprmenu-acts">
              <button class="ge-exprmenu-act edit" type="button" title="Edit this expression"
                onclick={(ev) => onEdit(ev, def.id)}>✎</button>
              <button class="ge-exprmenu-act drop" type="button" title="Drop an instance on the canvas"
                onclick={() => dropInstance(def.id)}>⦻</button>
              <button class="ge-exprmenu-act del" type="button" title="Delete this expression"
                onclick={() => requestDelete(def.id)}>×</button>
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .ge-exprmenu-shade {
    position: fixed;
    inset: 0;
    z-index: 999;
  }
  .ge-exprmenu {
    position: fixed;
    z-index: 1000;
    min-width: 240px;
    max-width: 360px;
    background: #1b1d22;
    border: 1px solid #3a3d44;
    border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
    color: #e6e8ec;
    font-size: 12px;
    overflow: hidden;
  }
  .ge-exprmenu-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px 6px 10px;
    border-bottom: 1px solid #2c2f36;
    background: #21242a;
  }
  .ge-exprmenu-title {
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .ge-exprmenu-add {
    width: 22px;
    height: 22px;
    line-height: 1;
    font-size: 16px;
    border: 1px solid #3a3d44;
    border-radius: 5px;
    background: #2a2d34;
    color: #cfe;
    cursor: pointer;
  }
  .ge-exprmenu-add:hover { background: #343842; }
  .ge-exprmenu-empty {
    padding: 14px 12px;
    color: #9aa0a8;
    line-height: 1.4;
  }
  .ge-exprmenu-empty b { color: #cfe; }
  .ge-exprmenu-list {
    list-style: none;
    margin: 0;
    padding: 4px;
    max-height: 320px;
    overflow-y: auto;
  }
  .ge-exprmenu-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 5px;
  }
  .ge-exprmenu-row:hover { background: #24272e; }
  .ge-exprmenu-name {
    font-weight: 600;
    color: #d7ecff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 96px;
  }
  .ge-exprmenu-sig {
    flex: 1;
    color: #9aa0a8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
  }
  .ge-exprmenu-acts {
    display: flex;
    gap: 2px;
    flex: 0 0 auto;
  }
  .ge-exprmenu-act {
    width: 22px;
    height: 22px;
    line-height: 1;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: #cdd2d8;
    cursor: pointer;
    font-size: 13px;
  }
  .ge-exprmenu-act:hover { background: #343842; border-color: #3a3d44; }
  .ge-exprmenu-act.drop:hover { color: #9fe0a0; }
  .ge-exprmenu-act.del:hover { color: #ff8d8d; }
  .ge-exprmenu-confirm {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    width: 100%;
  }
  .ge-exprmenu-confirm-msg {
    flex: 1;
    color: #ffd7a8;
    min-width: 120px;
  }
  .ge-exprmenu-confirm-yes,
  .ge-exprmenu-confirm-no {
    padding: 2px 8px;
    border-radius: 5px;
    border: 1px solid #3a3d44;
    cursor: pointer;
    font-size: 11px;
  }
  .ge-exprmenu-confirm-yes {
    background: #5a1f1f;
    color: #ffb3b3;
    border-color: #7a2a2a;
  }
  .ge-exprmenu-confirm-yes:hover { background: #6e2626; }
  .ge-exprmenu-confirm-no {
    background: #2a2d34;
    color: #cdd2d8;
  }
  .ge-exprmenu-confirm-no:hover { background: #343842; }
</style>
