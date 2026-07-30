<script lang="ts">
  // MenuButton — a button that opens a dropdown MENU. Its children (the `kids` snippet from
  // PanelNode) are the menu items, rendered only while open. Clicking the button toggles the
  // dropdown; an outside-click (the fixed backdrop) or a click on any menu item closes it.
  // props: label · variant (solid default | ghost). If on.click is also bound it still fires,
  // but the primary behavior is the dropdown toggle.
  //
  // BUNDLE component (app_components/MenuButton/) — render + meta.ts co-located. See
  // src/lib/app_components/CLAUDE.md.
  import type { Panel, EventMap } from '$lib/appkit/manifest/types';
  import type { Snippet } from 'svelte';
  let {
    panel,
    kids,
    fire,
  }: {
    panel: Panel;
    kids?: Snippet;
    fire?: (n: { on?: EventMap } | undefined, event: string, item?: unknown) => Promise<void>;
  } = $props();
  const p = $derived((panel.props ?? {}) as Record<string, unknown>);
  const label = $derived((p.label ?? panel.title ?? 'Menu') as string);
  const ghost = $derived(p.variant === 'ghost');

  let open = $state(false);

  function toggle() {
    open = !open;
    fire?.(panel, 'click'); // optional — no-op unless on.click is bound
  }
</script>

<div class="mb">
  <button class="btn" class:ghost class:open onclick={toggle} aria-haspopup="menu" aria-expanded={open}>
    {label}<span class="caret" aria-hidden="true">▾</span>
  </button>
  {#if open}
    <!-- outside-click backdrop -->
    <div class="mb-backdrop" role="presentation" onclick={() => (open = false)}></div>
    <!-- dropdown; a click on any menu item bubbles here and closes the menu -->
    <div class="mb-menu" role="menu" onclick={() => (open = false)}>
      {@render kids?.()}
    </div>
  {/if}
</div>

<style>
  .mb { position: relative; display: inline-block; }
  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--h-accent, #0369a1); border-radius: 6px; background: var(--h-accent, #0369a1); color: #fff; font: 600 12px system-ui; cursor: pointer; }
  .btn:hover { filter: brightness(1.08); }
  .btn.ghost { background: transparent; color: var(--h-accent, #0369a1); }
  .caret { font-size: 10px; line-height: 1; }
  .mb-backdrop { position: fixed; inset: 0; z-index: 1000; background: transparent; }
  .mb-menu { position: absolute; top: calc(100% + 4px); left: 0; z-index: 1001; min-width: max(100%, 160px); display: flex; flex-direction: column; gap: 2px; padding: 4px; border: 1px solid var(--h-border, #cbd5e1); border-radius: 8px; background: var(--h-surface, #fff); color: var(--h-text, #0f172a); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16); }
</style>
