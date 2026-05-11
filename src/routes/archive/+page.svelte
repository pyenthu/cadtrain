<div class="archive">
  <div class="inner">
    <h1>Archive</h1>
    <p class="lead">
      Previous implementation, preserved as a reference. Not actively maintained but
      everything still works — APIs are unchanged.
    </p>

    <section>
      <h2>CAD components</h2>
      <ul>
        <li><a href="/archive/components">/archive/components</a> — 18-primitive parametric library viewer</li>
        <li><a href="/archive/reverse">/archive/reverse</a> — image upload → identify (RAG + Claude vision) → refine loop</li>
        <li><a href="/archive/training">/archive/training</a> — training data gallery (35+ tools, original vs 3D)</li>
      </ul>
    </section>

    <section>
      <h2>Dedicated tool viewers</h2>
      <ul>
        <li><a href="/archive/tools/bottom-sub">/archive/tools/bottom-sub</a> — Bottom Sub (HAL10408)</li>
        <li><a href="/archive/tools/ratch-latch">/archive/tools/ratch-latch</a> — Ratch-Latch Receiving Head</li>
      </ul>
    </section>

    <section>
      <h2>Wells</h2>
      <ul>
        <li><a href="/archive/wells">/archive/wells</a> — PDF/image → WSON extraction (working — likely ported wholesale to /wells)</li>
      </ul>
    </section>

    <section>
      <h2>Tests &amp; eval</h2>
      <ul>
        <li><a href="/archive/tests">/archive/tests</a> — Playwright recordings + cache stats</li>
        <li><a href="/archive/tests/wells">/archive/tests/wells</a> — wells extraction eval (8 cases × 2 backends × 3 models)</li>
        <li><a href="/archive/tests/components">/archive/tests/components</a> — components recognition eval (17/18 cold-classification baseline)</li>
      </ul>
    </section>

    <p class="note">
      Why archived? See <a href="/plan">/plan</a> bundle F (tasks 110-114). Short version:
      the repo is being split into two cleanly-separated products (CAD + Wells) on top
      of shared infrastructure (<code>src/lib/shared/</code>). Old work moves here
      so the new work has a clean canvas.
    </p>
  </div>
</div>

<style>
  .archive { height: 100%; overflow-y: auto; background: #1a1a2e; color: #eee; }
  .inner { max-width: 720px; margin: 0 auto; padding: 40px 32px; }
  h1 { font-size: 28px; color: #fff; margin: 0 0 8px; }
  .lead { color: #aaa; font-size: 14px; margin: 0 0 32px; }
  section { margin-bottom: 24px; }
  h2 { font-size: 13px; color: #cc2222; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 8px; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 6px 0; color: #888; font-size: 13px; line-height: 1.5; }
  a { color: #ccc; text-decoration: none; }
  a:hover { color: #cc2222; }
  code { background: #16213e; padding: 1px 6px; border-radius: 3px; font: 12px ui-monospace, monospace; color: #aaa; }
  .note { margin-top: 32px; padding: 14px 18px; background: #16213e; border-left: 3px solid #555; border-radius: 4px; color: #888; font-size: 12px; line-height: 1.6; }
  .note a { color: #cc2222; }
</style>
