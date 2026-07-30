<script lang="ts">
  import type { Panel, Binding } from '$lib/appkit/manifest/types';
  let {
    panel,
    run,
    select,
    active,
    dataRev,
    preloaded,
  }: {
    panel: Panel;
    run: (b?: Binding, item?: unknown) => Promise<unknown>;
    select?: (item: unknown) => void;
    active?: string;
    /** Bumps on slot changes → re-fetch. */
    dataRev?: number;
    /** Server-resolved rows (SSR). When present, used synchronously — no client fetch. */
    preloaded?: unknown;
  } = $props();

  let fetched = $state<any[]>([]);
  let note = $state('');
  // Prefer server-resolved rows (present in SSR first paint); else the client-fetched rows.
  const items = $derived(Array.isArray(preloaded) ? (preloaded as any[]) : fetched);

  function pending(e: unknown, verb?: string): string {
    const m = String(e);
    return m.includes('not wired') || m.includes('needs an engine')
      ? `awaiting data — ${verb}() pending`
      : m;
  }

  $effect(() => {
    if (preloaded !== undefined) return; // server already resolved it
    void dataRev; // re-fetch when a slot changes
    note = '';
    fetched = [];
    run(panel.source)
      .then((r) => { if (Array.isArray(r)) fetched = r; })
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
