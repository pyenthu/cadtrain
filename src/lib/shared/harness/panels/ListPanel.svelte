<script lang="ts">
  import type { Panel, Binding } from '$lib/appkit/manifest/types';
  let {
    panel,
    run,
    select,
    active,
  }: {
    panel: Panel;
    run: (b?: Binding, item?: unknown) => Promise<unknown>;
    select?: (item: unknown) => void;
    active?: string;
  } = $props();

  let items = $state<any[]>([]);
  let note = $state('');

  function pending(e: unknown, verb?: string): string {
    const m = String(e);
    return m.includes('not wired') || m.includes('needs an engine')
      ? `awaiting data — ${verb}() pending`
      : m;
  }

  $effect(() => {
    note = '';
    items = [];
    run(panel.source)
      .then((r) => { if (Array.isArray(r)) items = r; })
      .catch((e) => { note = pending(e, panel.source?.verb); });
  });
</script>

{#if items.length}
  <ul class="list">
    {#each items as it (it.id ?? JSON.stringify(it))}
      <li>
        <button class:on={active === it.id} onclick={() => select?.(it)}>
          {it.title ?? it.id ?? JSON.stringify(it)}
        </button>
      </li>
    {/each}
  </ul>
{:else}
  <div class="note">{note || 'no items'}</div>
{/if}

<style>
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .list button { width: 100%; text-align: left; padding: 6px 8px; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; cursor: pointer; }
  .list button:hover { background: #f8fafc; }
  .list button.on { border-color: #0369a1; background: #eff6ff; color: #0c4a6e; font-weight: 600; }
  .note { color: #94a3b8; font-size: 12px; font-style: italic; }
</style>
