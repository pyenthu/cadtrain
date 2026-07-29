<script lang="ts">
  // Text — honors typed props: text · size · weight · align · color · muted.
  // Props live on panel.props (component model); panel.text is the legacy shorthand.
  import type { Panel } from '$lib/appkit/manifest/types';
  let { panel }: { panel: Panel } = $props();
  const p = $derived((panel.props ?? {}) as Record<string, unknown>);
  const text = $derived((p.text ?? panel.text ?? '(text)') as string);
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
