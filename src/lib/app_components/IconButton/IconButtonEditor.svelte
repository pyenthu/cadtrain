<script lang="ts">
  // IconButtonEditor — the per-component editor: a searchable ICON PICKER (over the built-in
  // set) + label + variant. Rendered in the tree settings popover (Props tab). The icon-search
  // grows to a server icon library later (docs/plans/app-studio-enhancements.md).
  import type { Panel } from '$lib/appkit/manifest/types';
  import { ICONS, ICON_NAMES, iconGlyph } from './icons';
  let { panel, onProp }: { panel: Panel; onProp: (name: string, value: unknown) => void } = $props();
  let q = $state('');
  const results = $derived(q.trim() ? ICON_NAMES.filter((n) => n.includes(q.trim().toLowerCase())) : ICON_NAMES);
  const current = $derived((panel.props?.icon as string) ?? '');
</script>

<div class="ibe">
  <label class="prop"><span class="pl">label</span>
    <input value={(panel.props?.label as string) ?? ''} onchange={(e) => onProp('label', (e.currentTarget as HTMLInputElement).value)} />
  </label>
  <label class="prop"><span class="pl">variant</span>
    <select value={(panel.props?.variant as string) ?? 'solid'} onchange={(e) => onProp('variant', (e.currentTarget as HTMLSelectElement).value)}>
      <option value="solid">solid</option><option value="ghost">ghost</option>
    </select>
  </label>
  <div class="ibe-cur">icon: <span class="g">{iconGlyph(current) || '—'}</span> <code>{current || 'none'}</code></div>
  <input class="ibe-q" placeholder="search icons — save, edit, star…" bind:value={q} />
  <div class="ibe-grid">
    {#each results as name (name)}
      <button class="ibe-ic" class:on={current === name} title={name} onclick={() => onProp('icon', name)}>{ICONS[name]}</button>
    {/each}
    {#if !results.length}<div class="ibe-none">no match</div>{/if}
  </div>
</div>

<style>
  .ibe { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
  .prop { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .prop .pl { color: #64748b; font-size: 12px; }
  .prop input, .prop select { width: 60%; padding: 3px 6px; border: 1px solid #cbd5e1; border-radius: 5px; font: 12px system-ui; }
  .ibe-cur { font-size: 12px; color: #64748b; }
  .ibe-cur .g { font-size: 15px; }
  .ibe-q { padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 6px; font: 12px system-ui; }
  .ibe-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 3px; max-height: 140px; overflow: auto; }
  .ibe-ic { padding: 4px; border: 1px solid transparent; border-radius: 5px; background: #f8fafc; cursor: pointer; font-size: 15px; line-height: 1; }
  .ibe-ic:hover { background: #eef2f6; }
  .ibe-ic.on { border-color: #0369a1; background: #eff6ff; }
  .ibe-none { grid-column: 1/-1; color: #94a3b8; font-style: italic; font-size: 12px; padding: 4px; }
</style>
