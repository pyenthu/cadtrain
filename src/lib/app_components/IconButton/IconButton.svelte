<script lang="ts">
  // IconButton — a button with an ICON + text, fires on.click. The icon is a named glyph
  // (props.icon) from the built-in set (icons.ts) — the editor searches it; a server icon
  // library is the follow-up. BUNDLE component.
  import type { Panel, EventMap } from '$lib/appkit/manifest/types';
  import { iconGlyph } from './icons';
  let {
    panel,
    fire,
  }: {
    panel: Panel;
    fire?: (n: { on?: EventMap } | undefined, event: string, item?: unknown) => Promise<void>;
  } = $props();
  const icon = $derived(iconGlyph(panel.props?.icon as string | undefined));
  const label = $derived((panel.props?.label as string) ?? '');
  const ghost = $derived(panel.props?.variant === 'ghost');
</script>

<button class="ib" class:ghost onclick={() => fire?.(panel, 'click')}>
  {#if icon}<span class="ib-ic">{icon}</span>{/if}{#if label}<span class="ib-label">{label}</span>{/if}
</button>

<style>
  .ib { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--h-accent, #0369a1); border-radius: 6px; background: var(--h-accent, #0369a1); color: #fff; font: 600 12px system-ui; cursor: pointer; }
  .ib:hover { filter: brightness(1.08); }
  .ib.ghost { background: transparent; color: var(--h-accent, #0369a1); }
  .ib-ic { font-size: 14px; line-height: 1; }
</style>
