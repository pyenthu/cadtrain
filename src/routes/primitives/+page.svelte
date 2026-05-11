<script lang="ts">
  // Browse the 18 base primitives. Pure catalog view — no editing — driven
  // by src/lib/components/library.ts COMPONENTS. Click a card → opens the
  // primitive in /author with its default params so you can poke at it
  // live. Thumbnails come from training_data/prim_<id>/images/default.png
  // (the seed renders, URL-accessible via the static/ symlink).
  import { COMPONENTS } from '$lib/components/library';

  // The 3 pipe-domain primitives currently in COMPONENTS (hollow_cylinder
  // + thread_eue + thread_ltc) are flagged so the user can see at a glance
  // what's pipe-applicable vs drill-string / completion-tool primitives.
  // The expanded pipe primitive set comes in Phase B (one per archetype).
  const PIPE_PRIMS = new Set(['hollow_cylinder', 'thread_eue', 'thread_ltc']);
</script>

<div class="page">
  <div class="hdr">
    <h1>Primitives</h1>
    <p class="sub">{COMPONENTS.length} base shapes — ManifoldCAD recipes the composition interpreter executes. Pipe-applicable primitives marked; the rest are drill-string / completion-tool shapes (kept available even though Bundle H focuses on pipe).</p>
  </div>

  <div class="grid">
    {#each COMPONENTS as c (c.id)}
      <a class="card" href="/author?prim={c.id}">
        <div class="thumb">
          <img src="/training_data/prim_{c.id}/images/default.png" alt={c.name}
               loading="lazy" onerror={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }} />
        </div>
        <div class="info">
          <div class="name">
            {c.name}
            {#if PIPE_PRIMS.has(c.id)}<span class="badge pipe">pipe</span>{/if}
          </div>
          <div class="id">{c.id}</div>
          {#if c.tags?.length}
            <div class="tags">{c.tags.slice(0, 4).join(' · ')}</div>
          {/if}
        </div>
      </a>
    {/each}
  </div>
</div>

<style>
  .page { padding: 22px 28px; max-width: 1200px; margin: 0 auto; font-family: Arial, sans-serif; height: 100%; overflow-y: auto; box-sizing: border-box; }
  .hdr h1 { margin: 0 0 4px; font-size: 22px; color: #cc2222; }
  .sub { margin: 0 0 22px; font: 12px Arial; color: #666; max-width: 700px; line-height: 1.5; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
  .card {
    display: flex; flex-direction: column;
    text-decoration: none; color: inherit;
    background: #fff; border: 1px solid #e0e0e0; border-radius: 6px;
    overflow: hidden;
    transition: border-color 100ms, transform 100ms;
  }
  .card:hover { border-color: #cc2222; transform: translateY(-1px); }
  .thumb {
    aspect-ratio: 1 / 1;
    background: #f8f8f8;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }
  .thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .info { padding: 8px 10px; }
  .name { font: bold 12px Arial; color: #222; margin-bottom: 2px; display: flex; align-items: center; gap: 6px; }
  .badge { font: 8px Arial; padding: 1px 6px; border-radius: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
  .badge.pipe { background: #cc2222; color: #fff; }
  .id { font: 9px monospace; color: #888; margin-bottom: 4px; }
  .tags { font: 9px Arial; color: #aaa; }
</style>
