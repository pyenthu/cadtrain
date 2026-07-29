<script lang="ts">
  import type { Panel, Binding } from '$lib/appkit/manifest/types';
  let { panel, run }: { panel: Panel; run: (b?: Binding, item?: unknown) => Promise<unknown> } = $props();

  let note = $state('');
  $effect(() => {
    note = '';
    run(panel.source).catch((e) => {
      const m = String(e);
      note = m.includes('not wired') ? `awaiting data — ${panel.source?.verb}() pending (rung 3)` : m;
    });
  });
</script>

<div class="form">
  {#if note}<div class="note">{note}</div>{/if}
  {#each panel.controls ?? [] as ctl (ctl.id ?? ctl.kind)}
    <div class="control">
      <div class="ctl-head">{ctl.id ?? ctl.kind}<span class="ck">{ctl.kind}</span></div>
      {#if ctl.kind === 'table'}
        <table class="tbl">
          <thead><tr>{#each ctl.cols ?? [] as c}<th>{c}</th>{/each}</tr></thead>
          <tbody><tr><td colspan={(ctl.cols ?? []).length || 1} class="empty">rows via {panel.source?.verb}() (pending)</td></tr></tbody>
        </table>
        {#if ctl.add}<button class="add" onclick={() => run(ctl.add).catch(() => {})}>＋ add row</button>{/if}
      {:else}
        <div class="note">control: {ctl.kind}{ctl.bind ? ` · ${ctl.bind}` : ''}</div>
      {/if}
    </div>
  {/each}
  {#if !(panel.controls?.length)}<div class="note">no controls</div>{/if}
</div>

<style>
  .form { display: flex; flex-direction: column; gap: 10px; }
  .control { border: 1px solid #eef2f6; border-radius: 6px; padding: 8px; }
  .ctl-head { display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 6px; }
  .ck { font: 600 10px system-ui; text-transform: uppercase; color: #94a3b8; }
  .tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
  .tbl th { text-align: left; border-bottom: 1px solid #e5e7eb; padding: 3px 5px; color: #475569; }
  .empty { color: #94a3b8; font-style: italic; padding: 6px 5px; }
  .add { margin-top: 6px; font: 600 11px system-ui; padding: 4px 9px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; cursor: pointer; }
  .note { color: #94a3b8; font-size: 12px; font-style: italic; }
</style>
