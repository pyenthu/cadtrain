<script lang="ts">
  /**
   * ApiDocs.svelte — the /design "API" section. Renders the auto-generated
   * `apiDocs` snapshot (scripts/gen-api-docs.mjs → api-docs.ts): the HTTP
   * endpoint catalog under src/routes/api, the public declaration surface across
   * src/lib, and a per-module responsibility summary. One live search filters
   * both endpoints and exports. Pure client render (SSR off); data is a static
   * import so nothing is fetched. See docs: "verbs/routes = the API surface".
   */
  import { apiDocs } from './api-docs';

  let q = $state('');
  const ql = $derived(q.trim().toLowerCase());

  const methodColor: Record<string, string> = {
    GET: '#16a34a', POST: '#2563eb', PUT: '#d97706', PATCH: '#d97706',
    DELETE: '#dc2626', HEAD: '#64748b', OPTIONS: '#64748b',
  };

  // ── endpoints: filter by route/file/method, then group by the /api/<group> segment ──
  const endpointGroups = $derived.by(() => {
    const hit = apiDocs.endpoints.filter(
      (e) =>
        !ql ||
        e.route.toLowerCase().includes(ql) ||
        e.file.toLowerCase().includes(ql) ||
        e.methods.some((m) => m.toLowerCase().includes(ql)),
    );
    const map = new Map<string, typeof hit>();
    for (const e of hit) {
      const seg = e.route.split('/').filter(Boolean)[1] ?? '(root)'; // /api/<seg>/…
      const arr = map.get(seg) ?? [];
      arr.push(e);
      map.set(seg, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  });
  const endpointCount = $derived(endpointGroups.reduce((n, [, es]) => n + es.length, 0));

  // ── exports: filter by name/file, group by lib module, biggest first ──
  const exportGroups = $derived.by(() => {
    const map = new Map<string, typeof apiDocs.exports[number][]>();
    for (const e of apiDocs.exports) {
      if (ql && !(e.name.toLowerCase().includes(ql) || e.file.toLowerCase().includes(ql))) continue;
      const arr = map.get(e.module) ?? [];
      arr.push(e);
      map.set(e.module, arr);
    }
    return [...map.entries()]
      .map(([m, es]) => [m, es.slice().sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name))] as const)
      .sort((a, b) => b[1].length - a[1].length);
  });
  const exportCount = $derived(exportGroups.reduce((n, [, es]) => n + es.length, 0));

  // module summaries keyed for a quick lookup next to the export group header
  const summaryOf = $derived(new Map(apiDocs.modules.map((m) => [m.id, m])));

  let openModules = $state<Record<string, boolean>>({});
  // When searching, auto-expand groups so matches are visible; collapsed otherwise.
  const isOpen = (m: string) => openModules[m] ?? !!ql;
  function toggle(m: string) { openModules = { ...openModules, [m]: !isOpen(m) }; }
</script>

<div class="api">
  <p class="lead">
    The codebase's API surface, generated from the graphify knowledge graph
    (<code>bun scripts/gen-api-docs.mjs</code>) so it never drifts from the code —
    <strong>{apiDocs.meta.endpointCount}</strong> HTTP endpoints,
    <strong>{apiDocs.meta.exportCount}</strong> public exports across
    <strong>{apiDocs.meta.moduleCount}</strong> lib modules
    (from {apiDocs.meta.nodeCount.toLocaleString()} graph nodes).
  </p>

  <input
    class="search"
    type="search"
    placeholder="Filter endpoints & exports — route, symbol, file, method…"
    bind:value={q}
  />

  <!-- ── Modules ── -->
  <h3 class="grp">Modules <span class="grp-n">{apiDocs.modules.length}</span></h3>
  <div class="mods">
    {#each apiDocs.modules as m (m.id)}
      <article class="mod">
        <div class="mod-head">
          <span class="mod-id">{m.id}</span>
          <span class="mod-meta">{m.files} files · {m.exports} exports</span>
        </div>
        <code class="mod-path">{m.path}</code>
        <p class="mod-sum">{m.summary}</p>
      </article>
    {/each}
  </div>

  <!-- ── Endpoints ── -->
  <h3 class="grp">Endpoints <span class="grp-n">{endpointCount}</span></h3>
  {#if endpointCount === 0}
    <p class="empty">No endpoints match “{q}”.</p>
  {/if}
  {#each endpointGroups as [seg, eps] (seg)}
    <div class="ep-group">
      <div class="ep-group-head">/api/{seg} <span class="ep-group-n">{eps.length}</span></div>
      <table class="ep-table">
        <tbody>
          {#each eps as e (e.file)}
            <tr>
              <td class="ep-methods">
                {#each e.methods as m (m)}
                  <span class="method" style="--mc:{methodColor[m] ?? '#64748b'}">{m}</span>
                {/each}
                {#if e.methods.length === 0}<span class="method method-none">—</span>{/if}
              </td>
              <td class="ep-route"><code>{e.route}</code></td>
              <td class="ep-file">{e.file.replace(/^src\/routes/, '')}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/each}

  <!-- ── Exports (declaration surface) ── -->
  <h3 class="grp">Exports <span class="grp-n">{exportCount}</span></h3>
  {#if exportCount === 0}
    <p class="empty">No exports match “{q}”.</p>
  {/if}
  <div class="exp-acc">
    {#each exportGroups as [mod, es] (mod)}
      <div class="exp-mod">
        <button class="exp-mod-head" onclick={() => toggle(mod)} aria-expanded={isOpen(mod)}>
          <span class="caret" class:open={isOpen(mod)}>▸</span>
          <span class="exp-mod-id">{mod}</span>
          <span class="exp-mod-n">{es.length}</span>
          {#if summaryOf.get(mod)}<span class="exp-mod-sum">{summaryOf.get(mod)!.summary}</span>{/if}
        </button>
        {#if isOpen(mod)}
          <ul class="exp-list">
            {#each es as e (e.file + '::' + e.name)}
              <li><code class="exp-name">{e.name}</code><span class="exp-file">{e.file.replace(/^src\/lib\//, '')}</span></li>
            {/each}
          </ul>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .api { max-width: 68rem; }
  .lead { max-width: 52rem; color: var(--ink-soft, #555); margin: 0 0 1.3rem; }
  .lead strong { color: var(--ink, #1a1a1a); }
  .lead code { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 0.82rem; color: var(--accent, #cc2222); }

  .search {
    width: 100%; max-width: 40rem; display: block;
    padding: 0.6rem 0.85rem; margin: 0 0 1.8rem;
    font: inherit; font-size: 0.9rem;
    border: 1px solid var(--line, #e7e7e7); border-radius: 10px;
    background: var(--paper-alt, #fafafa); color: var(--ink, #1a1a1a);
  }
  .search:focus { outline: none; border-color: var(--accent, #cc2222); background: #fff; }

  .grp {
    display: flex; align-items: center; gap: 0.5rem;
    margin: 2rem 0 1rem; font-size: 1.15rem; font-weight: 700; letter-spacing: -0.01em;
  }
  .grp-n {
    font-size: 0.72rem; font-weight: 700; color: var(--accent, #cc2222);
    background: var(--accent-soft, #fbeaea); border-radius: 999px; padding: 0.1rem 0.55rem;
  }
  .empty { color: var(--ink-faint, #8a8a8a); font-style: italic; margin: 0 0 1rem; }

  /* modules */
  .mods { display: grid; grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr)); gap: 0.9rem; }
  .mod { padding: 1rem 1.1rem; border: 1px solid var(--line, #e7e7e7); border-radius: 12px; background: var(--paper, #fff); }
  .mod-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
  .mod-id { font-weight: 700; font-size: 1rem; }
  .mod-meta { font-size: 0.72rem; color: var(--ink-faint, #8a8a8a); font-variant-numeric: tabular-nums; }
  .mod-path { display: block; font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 0.76rem; color: var(--accent, #cc2222); margin: 0.15rem 0 0.5rem; }
  .mod-sum { margin: 0; font-size: 0.85rem; color: var(--ink-soft, #555); line-height: 1.45; }

  /* endpoints */
  .ep-group { margin: 0 0 1.1rem; }
  .ep-group-head { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 0.82rem; font-weight: 700; color: var(--ink, #1a1a1a); margin: 0 0 0.35rem; }
  .ep-group-n { color: var(--ink-faint, #8a8a8a); font-weight: 600; }
  .ep-table { width: 100%; border-collapse: collapse; }
  .ep-table td { padding: 0.32rem 0.5rem; border-bottom: 1px solid var(--line, #e7e7e7); vertical-align: top; }
  .ep-methods { width: 8.5rem; white-space: nowrap; }
  .method {
    display: inline-block; font-size: 0.64rem; font-weight: 800; letter-spacing: 0.03em;
    color: #fff; background: var(--mc); border-radius: 5px; padding: 0.08rem 0.34rem; margin-right: 0.22rem;
  }
  .method-none { background: none; color: var(--ink-faint, #8a8a8a); }
  .ep-route code { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 0.82rem; color: var(--ink, #1a1a1a); font-weight: 600; }
  .ep-file { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 0.72rem; color: var(--ink-faint, #8a8a8a); }

  /* exports accordion */
  .exp-acc { border: 1px solid var(--line, #e7e7e7); border-radius: 12px; overflow: hidden; }
  .exp-mod + .exp-mod { border-top: 1px solid var(--line, #e7e7e7); }
  .exp-mod-head {
    display: flex; align-items: center; gap: 0.6rem; width: 100%; text-align: left;
    padding: 0.7rem 0.9rem; border: none; background: var(--paper, #fff); color: var(--ink, #1a1a1a);
    font: inherit; cursor: pointer;
  }
  .exp-mod-head:hover { background: var(--paper-alt, #fafafa); }
  .caret { color: var(--accent, #cc2222); font-size: 0.8rem; transition: transform 0.15s ease; }
  .caret.open { transform: rotate(90deg); }
  .exp-mod-id { font-weight: 700; font-size: 0.92rem; }
  .exp-mod-n { font-size: 0.68rem; font-weight: 700; color: var(--accent, #cc2222); background: var(--accent-soft, #fbeaea); border-radius: 999px; padding: 0.08rem 0.5rem; }
  .exp-mod-sum { font-size: 0.76rem; color: var(--ink-faint, #8a8a8a); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .exp-list { margin: 0; padding: 0.2rem 0.9rem 0.8rem 2.1rem; list-style: none; columns: 2; column-gap: 1.5rem; }
  .exp-list li { break-inside: avoid; padding: 0.14rem 0; display: flex; align-items: baseline; gap: 0.5rem; }
  .exp-name { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 0.76rem; color: var(--ink, #1a1a1a); }
  .exp-file { font-size: 0.68rem; color: var(--ink-faint, #8a8a8a); font-family: 'SF Mono', Menlo, Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  @media (max-width: 640px) {
    .exp-list { columns: 1; }
    .ep-methods { width: 6rem; }
  }
</style>
