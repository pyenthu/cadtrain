<script lang="ts">
  // Browse pipe component families — full-route version of the family-
  // taxonomy view that also lives compressed inside /author's Components
  // panel. Same data (src/lib/components/pipe/families.ts), more space, so
  // here we render the full archetype description + family notes + KB
  // connection-string members rather than just the row counts.
  import { onMount } from 'svelte';
  import { ARCHETYPES, type Archetype } from '$lib/components/pipe/archetypes';
  import { FAMILIES, familyByConnection, familiesByArchetype } from '$lib/components/pipe/families';

  interface FamilyStat { family_id: string; family_name: string; row_count: number; archetype: Archetype; }
  interface ArchetypeStat { id: Archetype; name: string; description: string; total_rows: number; families: (FamilyStat & typeof FAMILIES[number])[]; }

  let archetypes = $state<ArchetypeStat[]>([]);
  let unmapped = $state<{ name: string; count: number }[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      const r = await fetch('/kb/api/casing-tubing-data.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${r.status}`);
      const data = await r.json();

      const connCounts = new Map<string, number>();
      for (const row of data.rows) {
        const c = row.connection ?? '(unknown)';
        connCounts.set(c, (connCounts.get(c) ?? 0) + 1);
      }
      const famTotals = new Map<string, number>();
      const um: { name: string; count: number }[] = [];
      for (const [n, c] of connCounts) {
        const f = familyByConnection(n);
        if (f) famTotals.set(f.id, (famTotals.get(f.id) ?? 0) + c);
        else um.push({ name: n || '(empty)', count: c });
      }
      unmapped = um.sort((a, b) => b.count - a.count);

      const byA = familiesByArchetype();
      archetypes = Object.values(ARCHETYPES).map((arch) => {
        const fams = (byA[arch.id] ?? []).map((f) => ({
          ...f,
          family_id: f.id,
          family_name: f.name,
          row_count: famTotals.get(f.id) ?? 0,
          archetype: arch.id,
        }));
        return {
          id: arch.id,
          name: arch.name,
          description: arch.description,
          total_rows: fams.reduce((s, x) => s + x.row_count, 0),
          families: fams.sort((a, b) => b.row_count - a.row_count),
        };
      }).sort((a, b) => b.total_rows - a.total_rows);
    } catch (e: any) {
      error = e?.message ?? String(e);
    } finally {
      loading = false;
    }
  });
</script>

<div class="page">
  <div class="hdr">
    <h1>Component Families</h1>
    <p class="sub">Pipe families grouped by their geometric archetype. Each archetype is one "abstract primitive class"; every family in it shares that primitive and differs only by parameters. Row counts come from <code>static/kb/api/casing-tubing-data.json</code>.</p>
  </div>

  {#if loading}
    <div class="empty">Loading KB coverage…</div>
  {:else if error}
    <div class="err">{error}</div>
  {:else}
    {#each archetypes as arch (arch.id)}
      <section class="arch">
        <header class="arch-h">
          <h2>{arch.name}</h2>
          <span class="meta">{arch.total_rows.toLocaleString()} KB rows · {arch.families.length} families</span>
        </header>
        <p class="desc">{arch.description}</p>
        <div class="fam-grid">
          {#each arch.families as f (f.family_id)}
            <a class="fam" href="/author?family={f.family_id}">
              <div class="fam-hdr">
                <span class="fam-name">{f.family_name}</span>
                <span class="fam-count" class:zero={f.row_count === 0}>{f.row_count}</span>
              </div>
              <div class="fam-id">{f.family_id}</div>
              {#if f.notes}<div class="fam-notes">{f.notes}</div>{/if}
              {#if f.kb_connection_names?.length}
                <div class="fam-conns">{f.kb_connection_names.join(' · ')}</div>
              {/if}
            </a>
          {/each}
        </div>
      </section>
    {/each}

    {#if unmapped.length > 0}
      <section class="arch unmapped">
        <header class="arch-h">
          <h2>Unmapped</h2>
          <span class="meta">{unmapped.reduce((s, x) => s + x.count, 0)} rows · {unmapped.length} names</span>
        </header>
        <p class="desc">KB connection strings not yet assigned to a family. Add them to FAMILIES in <code>src/lib/components/pipe/families.ts</code> as we work through them.</p>
        <div class="unmapped-grid">
          {#each unmapped as u (u.name)}
            <div class="unmapped-row">
              <span class="u-count">{u.count}</span>
              <span class="u-name">{u.name}</span>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .page { padding: 22px 28px; font-family: Arial, sans-serif; height: 100%; overflow-y: auto; box-sizing: border-box; }
  .hdr h1 { margin: 0 0 4px; font-size: 22px; color: #cc2222; }
  .sub { margin: 0 0 24px; font: 12px Arial; color: #666; max-width: 760px; line-height: 1.55; }
  .sub code { font: 11px monospace; background: #f0f0f0; padding: 1px 5px; border-radius: 3px; color: #333; }
  .arch { background: #fafafa; border: 1px solid #ececec; border-radius: 6px; padding: 14px 18px; margin-bottom: 14px; }
  .arch.unmapped { background: #fff8e6; border-color: #f0e0a0; }
  .arch-h { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
  .arch-h h2 { margin: 0; font: bold 13px Arial; color: #cc2222; text-transform: uppercase; letter-spacing: 0.5px; }
  .meta { font: 10px monospace; color: #888; }
  .desc { font: 11px Arial; color: #555; line-height: 1.55; margin: 0 0 12px; max-width: 780px; }
  .fam-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; }
  .fam {
    display: block; text-decoration: none; color: inherit;
    background: #fff; border: 1px solid #e8e8e8; border-radius: 4px; padding: 8px 10px;
    transition: border-color 100ms, transform 100ms;
  }
  .fam:hover { border-color: #cc2222; transform: translateY(-1px); }
  .fam-hdr { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2px; }
  .fam-name { font: bold 12px Arial; color: #222; }
  .fam-count { font: bold 11px monospace; color: #cc2222; }
  .fam-count.zero { color: #ccc; }
  .fam-id { font: 9px monospace; color: #888; margin-bottom: 4px; }
  .fam-notes { font: 11px Arial; color: #555; line-height: 1.45; margin-bottom: 4px; }
  .fam-conns { font: 10px monospace; color: #888; line-height: 1.4; }
  .unmapped-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 4px; }
  .unmapped-row { display: flex; gap: 8px; align-items: baseline; font: 11px Arial; }
  .u-count { font: bold 11px monospace; color: #cc7722; min-width: 28px; text-align: right; }
  .u-name { color: #333; }
  .empty { font: 12px Arial; color: #888; padding: 40px; text-align: center; }
  .err { font: 11px monospace; color: #721c24; background: #f8d7da; padding: 12px; border-radius: 4px; }
</style>
