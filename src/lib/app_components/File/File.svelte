<script lang="ts">
  // File — assigns a DATA file to a slot at runtime (§0.5). Open (File System Access
  // picker) → parse → fill the slot; Save / Save As write it back. Components wire their
  // source to the slot via loadData. props: slot · label · type (a picker hint).
  // BUNDLE component (app_components/File/) — render + meta.ts co-located. See src/lib/app_components/CLAUDE.md.
  import type { Panel, SlotApi, SlotValue } from '$lib/appkit/manifest/types';
  let {
    panel,
    slots,
    slotApi,
  }: {
    panel: Panel;
    slots?: Record<string, SlotValue>;
    slotApi?: SlotApi;
  } = $props();
  const slot = $derived((panel.props?.slot as string) ?? 'data');
  const label = $derived((panel.props?.label as string) ?? slot);
  const type = $derived(panel.props?.type as string | undefined);
  const cur = $derived(slots?.[slot]);
  let busy = $state('');

  async function act(fn: () => Promise<void>, name: string) {
    busy = name;
    try {
      await fn();
    } catch (e) {
      /* user cancelled the picker, or FSA blocked — no-op */
    } finally {
      busy = '';
    }
  }
</script>

<div class="file">
  <span class="lbl">{label}</span>
  <div class="btns">
    <button onclick={() => act(() => slotApi?.openInto(slot, type) ?? Promise.resolve(), 'open')}>📂 Open</button>
    <button disabled={!cur} onclick={() => act(() => slotApi?.save(slot) ?? Promise.resolve(), 'save')}>💾 Save</button>
    <button disabled={!cur} onclick={() => act(() => slotApi?.saveAs(slot) ?? Promise.resolve(), 'saveas')}>⤓ Save As</button>
  </div>
  <span class="name" class:has={!!cur}>{busy ? '…' : (cur?.name ?? '(no file)')}</span>
</div>

<style>
  .file { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .lbl { font-weight: 600; }
  .btns { display: flex; gap: 4px; }
  .file button { padding: 4px 9px; border: 1px solid var(--h-border, #cbd5e1); border-radius: 6px; background: var(--h-surface, #fff); color: var(--h-text, #0f172a); font: 500 12px system-ui; cursor: pointer; }
  .file button:hover:not(:disabled) { border-color: var(--h-accent, #0369a1); }
  .file button:disabled { opacity: 0.45; cursor: default; }
  .name { color: var(--h-muted, #94a3b8); font-size: 12px; font-style: italic; }
  .name.has { color: var(--h-text, #334155); font-style: normal; }
</style>
