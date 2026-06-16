<script lang="ts">
  import { docs } from './docs';

  // Group the docs for sectioned rendering (Findings first, then Research).
  const groups = [
    { name: 'Findings', items: docs.filter((d) => d.group === 'Findings') },
    { name: 'Research', items: docs.filter((d) => d.group === 'Research') },
  ].filter((g) => g.items.length > 0);
</script>

<div class="research">
  <div class="panel">
    <div class="head">
      <a href="/" class="back">← Home</a>
      <div class="title">Research</div>
      <div class="sub">parked notes · findings</div>
    </div>

    {#each groups as group (group.name)}
      <div class="group-label">{group.name}</div>
      {#each group.items as doc (doc.slug)}
        <a href={`/research/${doc.slug}`} class="row">
          <div class="row-title">{doc.title}</div>
          {#if doc.excerpt}<div class="row-hint">{doc.excerpt}</div>{/if}
        </a>
      {/each}
    {/each}

    {#if docs.length === 0}
      <div class="empty">No research docs found.</div>
    {/if}
  </div>
</div>

<style>
  .research {
    height: 100%;
    background: #1a1a2e;
    color: #eee;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 80px 16px;
    overflow-y: auto;
  }
  .panel {
    width: 560px;
    max-width: 100%;
    background: #16213e;
    border: 1px solid #2a2f4a;
    border-radius: 8px;
    overflow: hidden;
  }
  .head {
    background: #1b2845;
    border-bottom: 1px solid #2a2f4a;
    padding: 10px 14px;
  }
  .back {
    color: #888;
    text-decoration: none;
    font-size: 11px;
  }
  .back:hover { color: #fff; }
  .title {
    font-size: 13px;
    font-weight: 700;
    color: #cc2222;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    margin-top: 4px;
  }
  .sub { font-size: 11px; color: #666; }
  .group-label {
    padding: 8px 14px 4px;
    font-size: 10px;
    font-weight: 700;
    color: #6677aa;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    background: #182039;
    border-bottom: 1px solid #1f2440;
  }
  .row {
    display: block;
    padding: 10px 14px;
    color: #ddd;
    text-decoration: none;
    border-bottom: 1px solid #1f2440;
    transition: background 0.1s;
  }
  .row:hover { background: #1f2a52; color: #fff; }
  .row-title { font-size: 14px; }
  .row-hint { font-size: 11px; color: #777; margin-top: 2px; }
  .empty { padding: 16px; font-size: 13px; color: #777; }
</style>
