<script lang="ts">
  // Button — the canonical declarative-event component. Click fires on.click
  // (a verb binding or a sequence), run by the harness. props: label · variant.
  //
  // BUNDLE component (app_components/Button/) — render + meta.ts co-located. See
  // src/lib/app_components/CLAUDE.md.
  import type { Panel, EventMap } from '$lib/appkit/manifest/types';
  let {
    panel,
    fire,
  }: {
    panel: Panel;
    fire?: (n: { on?: EventMap } | undefined, event: string, item?: unknown) => Promise<void>;
  } = $props();
  const p = $derived((panel.props ?? {}) as Record<string, unknown>);
  const label = $derived((p.label ?? panel.title ?? 'Button') as string);
  const ghost = $derived(p.variant === 'ghost');
</script>

<button class="btn" class:ghost onclick={() => fire?.(panel, 'click')}>{label}</button>

<style>
  .btn { padding: 6px 12px; border: 1px solid var(--h-accent, #0369a1); border-radius: 6px; background: var(--h-accent, #0369a1); color: #fff; font: 600 12px system-ui; cursor: pointer; }
  .btn:hover { filter: brightness(1.08); }
  .btn.ghost { background: transparent; color: var(--h-accent, #0369a1); }
</style>
