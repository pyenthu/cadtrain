<script lang="ts">
  // The bake3d panel — bakes the active doc via the `bake` verb (source → engine →
  // geometry stats). Shows real verts/tris. The interactive 3D canvas (mount a Threlte
  // scene over the GLB) is a follow-up needing browser verification.
  // BUNDLE component (app_components/Bake3d/) — render + meta.ts co-located. See src/lib/app_components/CLAUDE.md.
  import type { Panel, Binding } from '$lib/appkit/manifest/types';
  let {
    panel,
    run,
    active,
    preloaded,
  }: {
    panel: Panel;
    run: (b?: Binding, item?: unknown) => Promise<unknown>;
    active?: string;
    /** Server-resolved bake stats (SSR). When present, shown synchronously — no client bake. */
    preloaded?: unknown;
  } = $props();

  let fetched = $state<{ verts?: number; tris?: number } | null>(null);
  let note = $state('');
  let busy = $state(false);
  const stats = $derived(
    (preloaded && typeof preloaded === 'object' ? (preloaded as { verts?: number; tris?: number }) : fetched),
  );

  $effect(() => {
    if (preloaded !== undefined) return; // server already baked the stats
    const a = active; // re-bake when the active doc changes
    fetched = null;
    note = '';
    if (!a) { note = 'select a document'; return; }
    busy = true;
    run(panel.source)
      .then((r: any) => { if (r && typeof r === 'object') fetched = r; })
      .catch((e) => {
        const m = String(e);
        note = m.includes('not wired') || m.includes('needs an engine') || m.includes('no bake') ? 'bake pending' : m;
      })
      .finally(() => { busy = false; });
  });
</script>

<div class="bake3d">
  {#if busy}
    <div class="hint">baking…</div>
  {:else if stats}
    <div class="badge">baked ✓</div>
    <div class="stat">{stats.verts ?? '—'} <span>verts</span> · {stats.tris ?? '—'} <span>tris</span></div>
    <div class="hint">interactive 3D canvas — follow-up (needs a Threlte mount)</div>
  {:else}
    <div class="hint">{note || '—'}</div>
  {/if}
</div>

<style>
  .bake3d { height: 100%; min-height: 140px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; border: 1px dashed #cbd5e1; border-radius: 6px; background: #f8fafc; color: #64748b; }
  .badge { font: 700 12px system-ui; color: #16a34a; }
  .stat { font: 600 14px ui-monospace, monospace; color: #0f172a; }
  .stat span { color: #94a3b8; font-weight: 400; font-size: 12px; }
  .hint { font-size: 11px; font-style: italic; color: #94a3b8; text-align: center; max-width: 240px; }
</style>
