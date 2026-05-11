<div class="stub">
  <div class="inner">
    <h1>CAD</h1>
    <p class="lead">Parametric assemblies + visual identification — under construction.</p>

    <p>
      The previous CAD implementation (component library viewer, image → identify pipeline,
      authoring tool) is preserved at
      <a href="/archive/components">/archive/components</a>,
      <a href="/archive/reverse">/archive/reverse</a>,
      <a href="/author">/author</a>,
      <a href="/library">/library</a>.
    </p>

    <p>
      The new CAD product is being rebuilt around a multi-aspect primitive library
      (3D, SVG, technical drawings) with modality-aware retrieval. See
      <a href="/plan">/plan</a> bundle F for the current roadmap.
    </p>

    <p class="note">
      Open question being resolved before any retrieval rebuild: the cold-classification
      baseline (CLI/Opus + 18-primitive catalog, no RAG) hit 17/18 on synthetic renders.
      The library-first architecture may be solving a problem already solved by prompting.
    </p>
  </div>
</div>

<style>
  .stub { height: 100%; overflow-y: auto; background: #1a1a2e; color: #eee; }
  .inner { max-width: 720px; margin: 0 auto; padding: 48px 32px; }
  h1 { font-size: 32px; color: #fff; margin: 0 0 8px; }
  .lead { color: #aaa; font-size: 15px; margin: 0 0 32px; }
  p { color: #999; line-height: 1.7; margin: 0 0 16px; font-size: 14px; }
  a { color: #cc2222; text-decoration: none; }
  a:hover { color: #fff; }
  .note { margin-top: 32px; padding: 16px 20px; background: #16213e; border-left: 3px solid #cc2222; border-radius: 4px; color: #888; font-size: 13px; }
</style>
