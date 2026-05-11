<div class="home">
  <div class="menu">
    <div class="menu-header">CAD Train</div>
    <a href="/library" class="menu-item">Library <span class="hint">generated 3D models</span></a>
    <a href="/author" class="menu-item">Author <span class="hint">compose new from primitives</span></a>
    <a href="/wells" class="menu-item">Wells <span class="hint">document extraction</span></a>
    <a href="/archive/tests" class="menu-item">Tests <span class="hint">recordings + cache stats</span></a>
    <a href="/plan" class="menu-item">Plan <span class="hint">Gantt roadmap</span></a>
    <a href="/archive" class="menu-item">Archive <span class="hint">legacy implementation</span></a>
  </div>
</div>

<style>
  .home {
    height: 100%;
    background: #1a1a2e;
    color: #eee;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 80px;
    overflow-y: auto;
  }
  .menu {
    width: 320px;
    background: #16213e;
    border: 1px solid #2a2f4a;
    border-radius: 8px;
    overflow: hidden;
  }
  .menu-header {
    background: #1b2845;
    border-bottom: 1px solid #2a2f4a;
    padding: 8px 14px;
    font-size: 11px;
    font-weight: 700;
    color: #cc2222;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .menu-item {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 10px 14px;
    color: #ddd;
    text-decoration: none;
    font-size: 14px;
    border-bottom: 1px solid #1f2440;
    transition: background 0.1s;
  }
  .menu-item:last-child { border-bottom: none; }
  .menu-item:hover { background: #1f2a52; color: #fff; }
  .hint { font-size: 11px; color: #666; font-weight: normal; }
</style>
