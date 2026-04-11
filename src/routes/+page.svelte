<div class="home">
  <div class="hero">
    <h1>CAD Train</h1>
    <p>Parametric 3D tool modeling pipeline — ManifoldCAD + VLM comparison + training data</p>
  </div>
  <div class="grid">
    <a class="card" href="/tools/bottom-sub">
      <h2>Bottom Sub (HAL10408)</h2>
      <p>Housing + Slips + Sleeve — full parametric with wall thickness constraints</p>
      <span class="badge">Dedicated Viewer</span>
    </a>
    <a class="card" href="/tools/ratch-latch">
      <h2>Ratch-Latch Receiving Head</h2>
      <p>Body + Mandrel + Seal — threaded neck, shoulder, seal grooves</p>
      <span class="badge">Dedicated Viewer</span>
    </a>
    <a class="card" href="/components">
      <h2>Component Library</h2>
      <p>18 primitives — threads (REG/IF/FH/NC/EUE/LTC), tapers, slips, J-latch, packer elements</p>
      <span class="badge">18 components</span>
    </a>
    <a class="card" href="/training">
      <h2>Training Data</h2>
      <p>35+ completion tools — original vs 3D model with VLM analysis</p>
      <span class="badge">35+ tools</span>
    </a>
  </div>
  <div class="stats">
    <div class="stat"><strong>39</strong><span>Tools Analyzed</span></div>
    <div class="stat"><strong>90+</strong><span>Training Pairs</span></div>
    <div class="stat"><strong>18</strong><span>Primitives</span></div>
    <div class="stat"><strong>20+</strong><span>Thread Types</span></div>
  </div>
</div>

<style>
  .home { height: 100%; overflow-y: auto; background: #1a1a2e; color: #eee; }
  .hero { padding: 40px; text-align: center; }
  .hero h1 { font-size: 36px; color: #fff; }
  .hero p { color: #888; margin-top: 8px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; padding: 0 40px; }
  .card { background: #16213e; border: 1px solid #333; border-radius: 8px; padding: 20px; text-decoration: none; color: inherit; transition: border-color 0.2s; }
  .card:hover { border-color: #cc2222; }
  .card h2 { font-size: 15px; color: #fff; margin-bottom: 6px; }
  .card p { font-size: 12px; color: #888; line-height: 1.5; }
  .badge { display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: 10px; margin-top: 8px; background: #1b4332; color: #52b788; }
  .stats { display: flex; justify-content: center; gap: 40px; padding: 40px; }
  .stat { text-align: center; }
  .stat strong { display: block; font-size: 28px; color: #cc2222; }
  .stat span { font-size: 11px; color: #888; }
</style>
