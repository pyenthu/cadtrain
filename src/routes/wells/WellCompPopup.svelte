<script lang="ts">
  /**
   * WellCompPopup — the completion quick-editor. Opens on DOUBLE-CLICK of a
   * completion in the 2D schematic (`WellSchematic2D`), anchored beside it via
   * the shared dark `WellPopover`. Mirrors SVTC's `CanvasCompPopup`:
   *
   *   • Description (text) + OD (in) edit through directly.
   *   • Length (m) + Top (m) use LOCAL DRAFT state so re-rendering the numeric
   *     value (a re-derived scene, `.toFixed()`) doesn't kick the caret to the
   *     end mid-edit; bottom stays LINKED (`bot = top + length`), SVTC-style.
   *   • Apply → the `onSave(patch)` callback (→ the page's `updateComponent`,
   *     which mutates the in-memory `$state` doc → the 2D scene re-renders).
   *   • Delete → `onDelete()`; Close → `onClose()`.
   *
   * The component is DUMB: it holds only its own drafts and emits a patch. The
   * doc mutation + re-render live in `+page.svelte` (the mutation layer).
   */
  import WellPopover from './WellPopover.svelte';
  import type { CompletionPatch } from '$lib/wells/wson-mutate';

  let {
    anchor,
    comp,
    onSave,
    onDelete,
    onClose,
  }: {
    /** Trigger rect (the clicked completion `<rect>`/`<path>`), client coords. */
    anchor: DOMRect;
    /** Resolved values of the completion under edit (from the 2D scene seg). */
    comp: { description: string; od: number; top: number; bot: number };
    onSave: (patch: CompletionPatch) => void;
    onDelete: () => void;
    onClose: () => void;
  } = $props();

  // Local drafts (strings while editing so the caret is stable). Seeded from the
  // seg the first time each field is focused; `null` = "show the live value".
  let descDraft = $state<string | null>(null);
  let odDraft = $state<string | null>(null);
  let lenDraft = $state<string | null>(null);
  let topDraft = $state<string | null>(null);

  const liveLen = $derived(Math.max(0, (comp.bot ?? 0) - (comp.top ?? 0)));

  function apply() {
    // Resolve drafts → numbers, keeping bottom linked to top + length.
    const top = topDraft != null && topDraft !== '' ? Number(topDraft) : comp.top;
    const len = lenDraft != null && lenDraft !== '' ? Number(lenDraft) : liveLen;
    const od = odDraft != null && odDraft !== '' ? Number(odDraft) : comp.od;
    const description = descDraft != null ? descDraft : comp.description;
    const patch: CompletionPatch = {
      description,
      od,
      top,
      bot: Number.isFinite(top) && Number.isFinite(len) ? top + len : comp.bot,
    };
    onSave(patch);
    onClose();
  }
</script>

<WellPopover {anchor} title={comp.description || 'Edit completion'} {onClose} width={230}>
  {#snippet children()}
    <div class="wcp">
      <label class="wcp-row">
        <span class="wcp-k">Description</span>
        <input
          type="text"
          value={descDraft ?? comp.description ?? ''}
          oninput={(e) => (descDraft = (e.currentTarget as HTMLInputElement).value)}
          onkeydown={(e) => { if (e.key === 'Enter') apply(); }}
        />
      </label>

      <div class="wcp-grid">
        <label class="wcp-row">
          <span class="wcp-k">OD (in)</span>
          <input
            type="number" step="0.001"
            value={odDraft ?? (comp.od ?? 0)}
            oninput={(e) => (odDraft = (e.currentTarget as HTMLInputElement).value)}
            onfocus={(e) => (odDraft = (e.currentTarget as HTMLInputElement).value)}
            onblur={() => (odDraft = null)}
            onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
          />
        </label>
        <label class="wcp-row">
          <span class="wcp-k">Length (m)</span>
          <input
            type="number" step="0.1"
            value={lenDraft ?? liveLen.toFixed(2)}
            oninput={(e) => (lenDraft = (e.currentTarget as HTMLInputElement).value)}
            onfocus={(e) => (lenDraft = (e.currentTarget as HTMLInputElement).value)}
            onblur={() => (lenDraft = null)}
            onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
          />
        </label>
      </div>

      <label class="wcp-row">
        <span class="wcp-k">Top (m)</span>
        <input
          type="number" step="0.1"
          value={topDraft ?? (comp.top ?? 0)}
          oninput={(e) => (topDraft = (e.currentTarget as HTMLInputElement).value)}
          onfocus={(e) => (topDraft = (e.currentTarget as HTMLInputElement).value)}
          onblur={() => (topDraft = null)}
          onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
        />
      </label>

      <div class="wcp-actions">
        <button class="wcp-apply" type="button" onclick={apply}>Apply</button>
        <button class="wcp-del" type="button" onclick={() => { onDelete(); onClose(); }}>Delete</button>
      </div>
    </div>
  {/snippet}
</WellPopover>

<style>
  .wcp {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .wcp-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .wcp-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .wcp-k {
    font: 600 10px ui-monospace, monospace;
    color: #889;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .wcp input {
    width: 100%;
    box-sizing: border-box;
    background: #10101a;
    border: 1px solid #34345a;
    border-radius: 5px;
    color: #e8e8ef;
    font: 12px ui-monospace, monospace;
    padding: 4px 6px;
  }
  .wcp input:focus {
    outline: none;
    border-color: #cc3333;
  }
  .wcp-actions {
    display: flex;
    gap: 6px;
    padding-top: 2px;
  }
  .wcp-apply {
    flex: 1;
    background: #cc3333;
    border: none;
    border-radius: 5px;
    color: #fff;
    cursor: pointer;
    font: 700 12px Arial;
    padding: 6px 8px;
  }
  .wcp-apply:hover { background: #e04444; }
  .wcp-del {
    flex: none;
    background: transparent;
    border: 1px solid #6a3a3a;
    border-radius: 5px;
    color: #e08a8a;
    cursor: pointer;
    font: 600 12px Arial;
    padding: 6px 10px;
  }
  .wcp-del:hover {
    background: #2a1620;
    color: #ff6666;
  }
</style>
