<script lang="ts">
  // The harness gallery — self-contained .app sub-apps. Rung 2 seeds one bundled
  // example; real .app files load via the AppStore (local/path) later.
  const APPS = [{ id: 'wells', title: 'Well Designer' }];
</script>

<div class="gallery">
  <h1>Apps</h1>
  <p class="sub">Self-contained <code>.app</code> sub-apps, rendered by the harness.</p>
  <ul>
    {#each APPS as a (a.id)}
      <li><a href={`/app/${a.id}`}>{a.title}<span>/{a.id}</span></a></li>
    {/each}
  </ul>
</div>

<style>
  .gallery { max-width: 640px; margin: 40px auto; font: 14px system-ui, Arial, sans-serif; padding: 0 20px; color: #0f172a; }
  h1 { margin: 0 0 4px; }
  .sub { color: #64748b; margin: 0 0 20px; }
  .sub code { font: 13px ui-monospace, monospace; background: #f1f5f9; padding: 1px 5px; border-radius: 4px; }
  ul { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  a { display: flex; justify-content: space-between; padding: 12px 14px; border: 1px solid #e5e7eb; border-radius: 8px; text-decoration: none; color: #0f172a; background: #fff; }
  a:hover { background: #f8fafc; }
  a span { color: #94a3b8; font: 12px ui-monospace, monospace; }
</style>
