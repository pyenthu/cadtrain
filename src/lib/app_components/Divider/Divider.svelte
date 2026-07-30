<script lang="ts">
  // Divider — a horizontal rule (<hr>). props.label optionally centers a caption on the line.
  // BUNDLE component (app_components/Divider/) — render + meta.ts co-located. See src/lib/app_components/CLAUDE.md.
  import type { Panel } from '$lib/appkit/manifest/types';
  let { panel }: { panel: Panel } = $props();
  const label = $derived(panel.props?.label as string | undefined);
</script>

{#if label}
  <div class="dv-labeled"><span>{label}</span></div>
{:else}
  <hr class="dv" />
{/if}

<style>
  .dv { border: 0; border-top: 1px solid var(--h-border, #e5e7eb); margin: 8px 0; }
  .dv-labeled { display: flex; align-items: center; gap: 10px; color: var(--h-muted, #94a3b8); font: 11px system-ui; text-transform: uppercase; letter-spacing: .5px; margin: 8px 0; }
  .dv-labeled::before, .dv-labeled::after { content: ''; flex: 1; border-top: 1px solid var(--h-border, #e5e7eb); }
</style>
