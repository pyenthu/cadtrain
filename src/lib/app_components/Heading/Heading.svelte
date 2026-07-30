<script lang="ts">
  // Heading — an h1/h2/h3 (props.level) with props.text (a $vars/$params ref resolves).
  // BUNDLE component (app_components/Heading/) — render + meta.ts co-located. See src/lib/app_components/CLAUDE.md.
  import type { Panel } from '$lib/appkit/manifest/types';
  import { resolveRef } from '$lib/appkit/manifest/refs';
  let {
    panel,
    params,
    vars,
  }: { panel: Panel; params?: Record<string, unknown>; vars?: Record<string, unknown> } = $props();
  const p = $derived((panel.props ?? {}) as Record<string, unknown>);
  const level = $derived(Math.min(3, Math.max(1, Number(p.level ?? 2))));
  const text = $derived(String(resolveRef((p.text ?? panel.title ?? 'Heading') as string, { params, vars }) ?? ''));
</script>

{#if level === 1}
  <h1 class="hd">{text}</h1>
{:else if level === 2}
  <h2 class="hd">{text}</h2>
{:else}
  <h3 class="hd">{text}</h3>
{/if}

<style>
  .hd { margin: 0; color: var(--h-text, #0f172a); line-height: 1.2; font-family: system-ui, sans-serif; }
  h1.hd { font-size: 24px; font-weight: 680; }
  h2.hd { font-size: 18px; font-weight: 660; }
  h3.hd { font-size: 15px; font-weight: 640; }
</style>
