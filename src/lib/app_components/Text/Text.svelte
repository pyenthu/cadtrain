<script lang="ts">
  // Text — honors typed props: text · size · weight · align · color · muted.
  // Props live on panel.props (component model); panel.text is the legacy shorthand.
  // A text of "$vars.x" / "$params.y" shows the live computed/param value.
  // BUNDLE component (app_components/Text/) — render + meta.ts co-located. See src/lib/app_components/CLAUDE.md.
  import type { Panel } from '$lib/appkit/manifest/types';
  import { resolveRef } from '$lib/appkit/manifest/refs';
  let {
    panel,
    params,
    vars,
  }: { panel: Panel; params?: Record<string, unknown>; vars?: Record<string, unknown> } = $props();
  const p = $derived((panel.props ?? {}) as Record<string, unknown>);
  const raw = $derived((p.text ?? panel.text ?? '(text)') as string);
  const text = $derived(String(resolveRef(raw, { params, vars }) ?? ''));
  const style = $derived(
    [
      p.size ? `font-size:${sizePx(p.size as string)}` : '',
      p.weight ? `font-weight:${p.weight}` : '',
      p.align ? `text-align:${p.align}` : '',
      p.color ? `color:${p.color}` : p.muted ? 'color:var(--h-muted,#64748b)' : '',
    ]
      .filter(Boolean)
      .join(';'),
  );
  function sizePx(s: string): string {
    return { xs: '11px', sm: '12px', md: '14px', lg: '18px', xl: '24px', '2xl': '32px' }[s] ?? s;
  }
</script>

<p class="text" {style}>{text}</p>

<style>
  .text { margin: 0; color: var(--h-text, #334155); }
</style>
