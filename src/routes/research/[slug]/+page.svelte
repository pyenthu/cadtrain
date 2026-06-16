<script lang="ts">
  import { page } from '$app/state';
  import { marked } from 'marked';
  import { getDoc } from '../docs';

  // GitHub-flavored markdown (tables/lists) as used across our docs.
  marked.setOptions({ gfm: true, breaks: false });

  const doc = $derived(getDoc(page.params.slug));

  // XSS note: bodies are our own repo docs, bundled at build time via the
  // ?raw glob in docs.ts — fully trusted, no user input — so raw {@html} is
  // acceptable. If this path ever surfaces user-authored markdown, add
  // DOMPurify (not a dependency today) before rendering.
  const html = $derived(doc ? marked.parse(doc.body) : '');
</script>

<div class="viewer">
  <div class="topbar">
    <a href="/research" class="back">← Research</a>
    {#if doc}<span class="crumb">{doc.title}</span>{/if}
  </div>

  {#if doc}
    <article class="prose">{@html html}</article>
  {:else}
    <div class="notfound">
      <div class="nf-title">Doc not found</div>
      <div class="nf-sub">No research doc matches “{page.params.slug}”.</div>
      <a href="/research" class="nf-link">← Back to Research</a>
    </div>
  {/if}
</div>

<style>
  .viewer {
    height: 100%;
    background: #1a1a2e;
    color: #eee;
    overflow-y: auto;
  }
  .topbar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: baseline;
    gap: 12px;
    background: #1b2845;
    border-bottom: 1px solid #2a2f4a;
    padding: 10px 16px;
  }
  .back { color: #cc4444; text-decoration: none; font-size: 12px; font-weight: 700; }
  .back:hover { color: #ff6666; }
  .crumb { font-size: 12px; color: #889; }

  .prose {
    max-width: 820px;
    margin: 0 auto;
    padding: 28px 24px 80px;
    line-height: 1.6;
    font-size: 14px;
  }
  .notfound {
    max-width: 820px;
    margin: 0 auto;
    padding: 60px 24px;
  }
  .nf-title { font-size: 18px; font-weight: 700; color: #cc2222; }
  .nf-sub { font-size: 13px; color: #888; margin: 8px 0 16px; }
  .nf-link { color: #cc4444; text-decoration: none; font-size: 13px; }
  .nf-link:hover { color: #ff6666; }

  /* Markdown styling — dark, consistent with the landing palette. */
  .prose :global(h1),
  .prose :global(h2),
  .prose :global(h3),
  .prose :global(h4) {
    color: #fff;
    line-height: 1.3;
    margin: 1.4em 0 0.5em;
  }
  .prose :global(h1) { font-size: 24px; color: #cc4444; border-bottom: 1px solid #2a2f4a; padding-bottom: 8px; }
  .prose :global(h2) { font-size: 19px; }
  .prose :global(h3) { font-size: 16px; }
  .prose :global(h4) { font-size: 14px; color: #ddd; }
  .prose :global(p) { margin: 0.7em 0; }
  .prose :global(a) { color: #6aa3ff; text-decoration: none; }
  .prose :global(a:hover) { text-decoration: underline; }
  .prose :global(ul),
  .prose :global(ol) { padding-left: 1.4em; margin: 0.6em 0; }
  .prose :global(li) { margin: 0.25em 0; }
  .prose :global(blockquote) {
    border-left: 3px solid #2a3f6a;
    margin: 0.8em 0;
    padding: 0.1em 0 0.1em 14px;
    color: #aab;
  }
  .prose :global(code) {
    background: #16213e;
    border: 1px solid #2a2f4a;
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 12.5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .prose :global(pre) {
    background: #16213e;
    border: 1px solid #2a2f4a;
    border-radius: 6px;
    padding: 12px 14px;
    overflow-x: auto;
    margin: 0.9em 0;
  }
  .prose :global(pre code) {
    background: none;
    border: none;
    padding: 0;
    font-size: 12.5px;
  }
  .prose :global(table) {
    border-collapse: collapse;
    margin: 0.9em 0;
    width: 100%;
    font-size: 13px;
  }
  .prose :global(th),
  .prose :global(td) {
    border: 1px solid #2a2f4a;
    padding: 6px 10px;
    text-align: left;
  }
  .prose :global(th) { background: #1b2845; color: #fff; }
  .prose :global(hr) { border: none; border-top: 1px solid #2a2f4a; margin: 1.6em 0; }
  .prose :global(img) { max-width: 100%; }
</style>
