<script lang="ts">
  // BUNDLE component (app_components/Placeholder/) — render + meta.ts co-located. See src/lib/app_components/CLAUDE.md.
  import type { Panel } from '$lib/appkit/manifest/types';
  let { panel }: { panel: Panel } = $props();
</script>

<div class="ph">
  <div class="ph-kind">{panel.kind}</div>
  <div class="ph-src">{panel.source ? `source: ${panel.source.verb}()` : 'no source'}</div>
  <div class="ph-note">renders when the {panel.kind} panel + its data verb are wired (rung 3)</div>
</div>

<style>
  .ph { height: 100%; min-height: 140px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: #94a3b8; border: 1px dashed #cbd5e1; border-radius: 6px; background: #f8fafc; }
  .ph-kind { font: 700 13px system-ui; text-transform: uppercase; letter-spacing: 1px; color: #64748b; }
  .ph-src { font: 600 11px ui-monospace, monospace; color: #475569; }
  .ph-note { font-size: 11px; font-style: italic; max-width: 220px; text-align: center; }
</style>
