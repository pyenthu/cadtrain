<script lang="ts">
  // Placeholder eval page for /api/identify CLI backend.
  // The full side-by-side viewer (deferred item #2 in
  // ~/.claude/plans/components-cli-recognition.md) hasn't been built yet.
</script>

<svelte:head><title>Components Eval — CAD Train</title></svelte:head>

<div class="layout">
  <main class="content">
    <header class="page-head">
      <h1>Components Recognition — CLI Eval</h1>
      <p>
        The component recognition pipeline (<code>/api/identify</code>) now supports a
        CLI backend that bills against your Pro/Max subscription instead of the API
        account. Toggle with <code>IDENTIFY_BACKEND=cli|api</code> in your dev env.
      </p>
    </header>

    <section class="card">
      <h2>What's wired</h2>
      <ul>
        <li><code>IDENTIFY_BACKEND=api</code> (default) — current behavior. Sonnet + RAG (top-5 neighbors from <code>cache.jsonl</code>).</li>
        <li><code>IDENTIFY_BACKEND=cli</code> — Opus via <code>claude --print</code> subprocess. Cold classification, no RAG (step-1 cut).</li>
      </ul>
      <p class="hint">Smoke-tested on <code>hollow_cylinder</code>, <code>packer_element</code>, <code>thread_nc</code> — all 3 classified correctly cold.</p>
    </section>

    <section class="card">
      <h2>Try it</h2>
      <p>
        The existing <a href="/reverse">/reverse</a> page works against either backend
        based on the env var. Upload an image and the response will tag <code>_backend</code>
        so you can confirm which path ran.
      </p>
      <div class="cta">
        <a href="/reverse" class="btn">Open /reverse →</a>
      </div>
    </section>

    <section class="card">
      <h2>Deferred (in the plan, not built yet)</h2>
      <ol>
        <li><strong>RAG-via-file-paths for CLI</strong> — write neighbor thumbnails to a tmp dir, let the CLI agent <code>Read</code> them. Reproduces few-shot examples through the agent's tool loop.</li>
        <li><strong>Batch eval + side-by-side viewer</strong> — synthetic test set, top-1 / top-3 / top-5 accuracy, a grid like <a href="/tests/wells">/tests/wells</a>.</li>
        <li><strong>Backend × model matrix</strong> — replicate the wells comparison: API/CLI × Opus/Sonnet/Haiku.</li>
        <li><strong>±RAG ablation</strong> — is retrieval earning its keep on classification?</li>
        <li><strong>K = 0 / 3 / 5 / 10 ablation</strong> — accuracy vs neighbor count curve.</li>
        <li><strong>Embedding type ablation</strong> — pHash / CLIP / hybrid; might justify ripping CLIP per the existing collapse memory.</li>
        <li><strong>CLI for <code>/api/refine</code></strong> — rate-window risky; tighter loops.</li>
        <li><strong>Engineering-drawing eval set</strong> — 2D dimensioned views, different domain.</li>
        <li><strong>Per-class confusion matrix</strong> — when classification fails, which primitive does it confuse for which?</li>
      </ol>
      <p class="hint">Plan: <code>~/.claude/plans/components-cli-recognition.md</code></p>
    </section>
  </main>

  <aside class="navigator">
    <div class="nav-back"><a href="/tests">← back to /tests</a></div>
  </aside>
</div>

<style>
  .layout { display: flex; height: 100%; font-family: Arial, sans-serif; background: #fafafa; }
  .content { flex: 1; overflow-y: auto; padding: 24px 28px; max-width: 920px; }
  .page-head h1 { margin: 0 0 6px; font-size: 20px; color: #333; }
  .page-head p { margin: 0; color: #666; font-size: 13px; line-height: 1.6; }
  .page-head code, .card code { background: #f0f0f0; padding: 1px 6px; border-radius: 3px; font: 11px monospace; color: #444; }

  .card { background: white; border: 1px solid #e0e0e0; border-radius: 6px; padding: 18px 22px; margin: 18px 0; }
  .card h2 { margin: 0 0 10px; font-size: 14px; color: #333; text-transform: uppercase; letter-spacing: 1px; }
  .card p { margin: 6px 0; font-size: 13px; line-height: 1.6; color: #444; }
  .card ul, .card ol { margin: 6px 0 6px 18px; padding: 0; font-size: 13px; line-height: 1.6; color: #444; }
  .card li { margin: 6px 0; }
  .card a { color: #16213e; text-decoration: none; font-weight: bold; }
  .card a:hover { text-decoration: underline; }
  .hint { font-size: 12px; color: #888; }

  .cta { margin-top: 12px; }
  .btn { display: inline-block; padding: 10px 18px; background: #16213e; color: white !important; border-radius: 6px; font-size: 13px; font-weight: bold; text-decoration: none; }
  .btn:hover { background: #1e3556; }

  .navigator { width: 220px; min-width: 220px; background: white; border-left: 1px solid #e0e0e0; padding: 16px 12px; }
  .nav-back { font-size: 12px; }
  .nav-back a { color: #16213e; text-decoration: none; }
  .nav-back a:hover { text-decoration: underline; }
</style>
