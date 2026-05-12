<script lang="ts">
  /**
   * Renders a Markdown string to HTML via `marked`. Used by the Inspector
   * popup's MD tab to display auto-generated docs from runes-class specs.
   *
   * Marked is configured for safe defaults — gfm + breaks, no raw HTML
   * passthrough — since the input is always content WE generate (see
   * src/lib/components/runes/docs.ts), not user-supplied.
   */
  import { marked } from 'marked';

  let { value = '' }: { value: string } = $props();

  marked.setOptions({ gfm: true, breaks: false });

  let html = $derived(marked.parse(value) as string);
</script>

<div class="md-host">
  {@html html}
</div>

<style>
  .md-host {
    height: 100%;
    overflow-y: auto;
    padding: 14px 18px;
    background: #fafafa;
    border: 1px solid #e2e2e8;
    border-radius: 4px;
    font: 13px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    color: #1f1f24;
  }
  .md-host :global(h1) { font-size: 18px; margin: 0 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e2e2e8; }
  .md-host :global(h2) { font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #555; margin: 20px 0 6px; }
  .md-host :global(h3) { font-size: 12px; color: #666; margin: 14px 0 4px; }
  .md-host :global(p)  { margin: 0 0 8px; }
  .md-host :global(ul), .md-host :global(ol) { margin: 0 0 10px; padding-left: 22px; }
  .md-host :global(li) { margin: 2px 0; }
  .md-host :global(code) {
    font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
    background: #ececf2;
    color: #c0322a;
    padding: 1px 5px;
    border-radius: 3px;
  }
  .md-host :global(table) { border-collapse: collapse; margin: 6px 0 12px; font-size: 12px; }
  .md-host :global(th), .md-host :global(td) {
    text-align: left; padding: 5px 10px; border-bottom: 1px solid #e2e2e8;
  }
  .md-host :global(th) { background: #f0f0f5; font-weight: 600; color: #444; }
  .md-host :global(strong) { color: #111; }
  .md-host :global(em) { color: #555; }
  .md-host :global(hr) { border: 0; border-top: 1px solid #e2e2e8; margin: 16px 0; }
</style>
