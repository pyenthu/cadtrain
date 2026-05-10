<div class="home">
  <div class="container">
    <header class="hero">
      <h1>CAD Train</h1>
      <p>Tools for downhole completion engineering — well-document extraction and parametric CAD.</p>
    </header>

    <section class="cards">
      <a class="card primary" href="/archive/wells">
        <div class="card-tag">Working</div>
        <h2>Wells extractor</h2>
        <p>Drag-drop a well-engineering PDF or image. Claude vision extracts a structured WSON document. 17/18 on the eval.</p>
        <div class="card-cta">Open →</div>
      </a>

      <a class="card" href="/plan">
        <div class="card-tag muted">Roadmap</div>
        <h2>Plan</h2>
        <p>Gantt across 6 bundles (primitives, retrieval, authoring, wells, infra, meta). Click any task for detail.</p>
        <div class="card-cta">View →</div>
      </a>
    </section>

    <section class="footer-note">
      <p>
        Component identification and authoring are being restructured — see
        <a href="/archive">/archive</a> for the legacy implementation
        (<a href="/archive/components">components</a>,
        <a href="/archive/reverse">reverse</a>,
        <a href="/archive/author">author</a>,
        <a href="/archive/library">library</a>,
        <a href="/archive/tools/bottom-sub">bottom-sub</a>,
        <a href="/archive/tools/ratch-latch">ratch-latch</a>)
        and <a href="/plan">/plan</a> bundle F for the rebuild status.
      </p>
    </section>
  </div>
</div>

<style>
  .home { height: 100%; overflow-y: auto; background: #1a1a2e; color: #eee; }
  .container { max-width: 880px; margin: 0 auto; padding: 56px 32px; }

  .hero { text-align: center; margin-bottom: 40px; }
  .hero h1 { font-size: 36px; color: #fff; margin: 0; font-weight: 600; }
  .hero p { color: #888; margin-top: 12px; font-size: 15px; }

  .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 48px; }
  @media (max-width: 600px) { .cards { grid-template-columns: 1fr; } }

  .card {
    display: block; background: #16213e; border: 1px solid #2a2f4a; border-radius: 8px;
    padding: 24px; text-decoration: none; color: inherit; transition: border-color 0.15s, transform 0.15s;
    position: relative;
  }
  .card:hover { border-color: #cc2222; transform: translateY(-1px); }
  .card.primary { border-color: #cc2222; background: linear-gradient(135deg, #16213e 0%, #1c1f3e 100%); }

  .card-tag {
    display: inline-block; font-size: 10px; padding: 3px 8px; border-radius: 10px;
    background: #1b4332; color: #52b788; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;
  }
  .card-tag.muted { background: #2a2f4a; color: #888; }

  .card h2 { font-size: 18px; color: #fff; margin: 12px 0 6px; font-weight: 600; }
  .card p { font-size: 13px; color: #aaa; line-height: 1.55; margin: 0 0 16px; }
  .card-cta { font-size: 13px; color: #cc2222; font-weight: 600; }

  .footer-note { padding-top: 24px; border-top: 1px solid #2a2f4a; }
  .footer-note p { font-size: 12px; color: #666; line-height: 1.7; margin: 0; text-align: center; }
  .footer-note a { color: #999; text-decoration: none; }
  .footer-note a:hover { color: #cc2222; }
</style>
