<script lang="ts">
  import { Canvas } from '@threlte/core';
  import { sampleWells, type WellSample } from '$lib/wells/samples';
  import { isDeviated, completionExtents } from '$lib/wells/wson';
  import { assembleWell } from '$lib/wells/assemble';
  import WellScene from '$lib/wells/WellScene.svelte';

  // W0 model + W1 3D assembler (docs/plans/well-schematic.md): the canonical 3D
  // well (parts placed along the survey by depth) is the hero; the breakdown is
  // a derived view of the same model.
  let activeSlug = $state(sampleWells[0]?.slug ?? '');
  const active = $derived<WellSample | undefined>(sampleWells.find((w) => w.slug === activeSlug) ?? sampleWells[0]);
  const wson = $derived(active?.wson);
  const deviated = $derived(wson ? isDeviated(wson) : false);
  // W1 — assemble the 3D well from the WSON.
  const assembled = $derived(wson ? assembleWell(wson) : null);
  let radialExag = $state(48);
  // Completion stack with resolved absolute extents (handles cumulative length).
  const comps = $derived.by(() => {
    const cs = wson?.completions ?? [];
    const ext = completionExtents(cs);
    return cs.map((c, i) => ({ ...c, _top: ext[i].top, _bot: ext[i].bot }));
  });
  const fmtM = (v: number | undefined) => (v == null ? '—' : `${v} m`);
</script>

<div class="wells">
  <aside class="rail">
    <a href="/" class="back">← Home</a>
    <div class="rail-title">WELLS</div>
    <div class="rail-sub">3D-first well schematic · W0</div>
    {#each sampleWells as w (w.slug)}
      <button class="well-btn" class:on={w.slug === activeSlug} onclick={() => (activeSlug = w.slug)}>
        <span class="wb-name">{w.name}</span>
        <span class="wb-slug">{w.slug}{#if w.issues.length} · {w.issues.length} issue{w.issues.length > 1 ? 's' : ''}{/if}</span>
      </button>
    {/each}
  </aside>

  {#if wson}
    <main class="pane">
      <header class="whead">
        <h1>{wson.meta.wellName}</h1>
        <div class="chips">
          <span class="chip">{deviated ? '⟋ deviated' : '│ vertical'}</span>
          {#if wson.meta._wellType}<span class="chip">{wson.meta._wellType}</span>{/if}
          <span class="chip">TD {fmtM(wson.meta.td)}</span>
          <span class="chip">PBTD {fmtM(wson.meta.pbtd)}</span>
          {#if wson.meta.rkbToGl != null}<span class="chip">RKB→GL {wson.meta.rkbToGl} m</span>{/if}
        </div>
      </header>

      <!-- W1 — the canonical 3D well (hero). -->
      <section class="scene3d">
        {#if assembled}
          <Canvas>
            <WellScene {assembled} {radialExag} />
          </Canvas>
        {/if}
        <div class="scene-ctl">
          <span class="sc-lbl">radial ×{radialExag}</span>
          <input class="sc-range" type="range" min="6" max="80" step="2" bind:value={radialExag} />
          <span class="sc-tag">3D well · z-down · drag to orbit</span>
        </div>
      </section>

      <section class="cols">
        <!-- Casing / tubular strings -->
        <div class="card">
          <h2>Casing strings <span class="n">{wson.ch?.length ?? 0}</span></h2>
          {#each wson.ch ?? [] as c}
            <div class="row"><span class="tag">{c.type ?? 'casing'}</span><b>{c.od}"</b> <span class="dim">id {c.id ?? '—'}"</span><span class="depth">{c.top}–{c.bot} m</span><span class="dim">{c.grade ?? ''} {c.weight ? `${c.weight}#` : ''}</span></div>
          {/each}
        </div>

        <!-- Open hole -->
        <div class="card">
          <h2>Open hole <span class="n">{wson.oh?.length ?? 0}</span></h2>
          {#each wson.oh ?? [] as o}
            <div class="row"><b>{o.bitSize}"</b> bit<span class="depth">{o.top}–{o.bot} m</span></div>
          {/each}
        </div>

        <!-- Completion stack — the component layer (SVTC's gap, cadtrain fills it) -->
        <div class="card wide">
          <h2>Completion stack <span class="n">{comps.length}</span></h2>
          {#each comps as c}
            <div class="row"><code class="tc">{c.tool_comp}</code><span class="desc">{c.description ?? ''}</span>{#if c.od}<span class="dim">{c.od}"</span>{/if}<span class="depth">{c._top}–{c._bot} m</span></div>
          {/each}
          {#if !comps.length}<div class="empty">no completion components</div>{/if}
        </div>

        <!-- Perforations -->
        <div class="card">
          <h2>Perforations <span class="n">{wson.perforations?.length ?? 0}</span></h2>
          {#each wson.perforations ?? [] as p}
            <div class="row"><span class="perf">⋮⋮</span>{p.label ?? 'perf'}<span class="depth">{p.top}–{p.bot} m</span></div>
          {/each}
        </div>

        <!-- Survey -->
        {#if wson.profile?.length}
          <div class="card">
            <h2>Survey <span class="n">{wson.profile.length}</span></h2>
            {#each wson.profile as s}
              <div class="row"><span class="dim">md</span><b>{s.md}</b><span class="dim">dev {s.dev}°</span><span class="dim">az {s.az}°</span></div>
            {/each}
          </div>
        {/if}
      </section>

      {#if active?.issues.length}
        <section class="issues">
          <h2>Lint <span class="n">{active.issues.length}</span></h2>
          {#each active.issues as i}
            <div class="issue {i.level}">{i.level === 'error' ? '✗' : '⚠'} <code>{i.path || '—'}</code> {i.message}</div>
          {/each}
        </section>
      {/if}

      <footer class="next">Next: <b>W1</b> — place each component along the survey by depth + bake its cadtrain part → the 3D well. (docs/plans/well-schematic.md)</footer>
    </main>
  {/if}
</div>

<style>
  .wells { height: 100%; display: flex; background: #14141f; color: #e8e8ef; overflow: hidden; }
  .rail { width: 250px; flex: none; background: #1a1a2a; border-right: 1px solid #2a2a3e; padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
  .back { color: #cc4444; text-decoration: none; font-size: 12px; font-weight: 700; }
  .back:hover { color: #ff6666; }
  .rail-title { font: 700 13px Arial; color: #cc2222; letter-spacing: 0.5px; margin-top: 6px; }
  .rail-sub { font-size: 10px; color: #777; margin-bottom: 8px; }
  .well-btn { text-align: left; background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 7px 9px; cursor: pointer; color: #ccd; display: flex; flex-direction: column; gap: 2px; }
  .well-btn:hover { background: #24243a; }
  .well-btn.on { background: #2a2a48; border-color: #cc2222; }
  .wb-name { font-size: 12px; font-weight: 600; }
  .wb-slug { font: 10px ui-monospace, monospace; color: #889; }

  .pane { flex: 1; overflow-y: auto; padding: 22px 26px 60px; }
  .whead h1 { font-size: 22px; margin: 0 0 8px; color: #fff; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font: 600 11px ui-monospace, monospace; background: #232340; border: 1px solid #34345a; border-radius: 9999px; padding: 2px 10px; color: #aab; }

  .scene3d { position: relative; height: 460px; margin-top: 16px; border: 1px solid #2a2a3e; border-radius: 10px; overflow: hidden; background: radial-gradient(circle at 50% 30%, #20203a 0%, #10101a 80%); }
  .scene-ctl { position: absolute; left: 12px; bottom: 12px; display: flex; align-items: center; gap: 10px; background: rgba(16,16,26,0.8); border: 1px solid #2a2a3e; border-radius: 8px; padding: 6px 12px; }
  .sc-lbl { font: 600 11px ui-monospace, monospace; color: #aab; min-width: 64px; }
  .sc-range { width: 140px; accent-color: #cc2222; }
  .sc-tag { font: 10px ui-monospace, monospace; color: #667; }
  .cols { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; margin-top: 18px; }
  .card { background: #1b1b2c; border: 1px solid #2a2a3e; border-radius: 8px; padding: 12px 14px; }
  .card.wide { grid-column: 1 / -1; }
  .card h2 { font-size: 13px; margin: 0 0 8px; color: #dde; display: flex; align-items: center; gap: 8px; }
  .card .n { font: 700 10px ui-monospace, monospace; background: #2a2a48; border-radius: 9999px; padding: 1px 7px; color: #99a; }
  .row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; font: 12px ui-monospace, monospace; padding: 4px 0; }
  .row + .row { border-top: 1px solid #232338; }
  .row b { color: #fff; }
  .tag { font-size: 9px; text-transform: uppercase; letter-spacing: 0.4px; background: #2a2a48; border-radius: 3px; padding: 1px 6px; color: #99b; }
  .tc { color: #6aa3ff; background: #1f2a44; border-radius: 3px; padding: 1px 5px; }
  .desc { color: #bbc; }
  .dim { color: #778; }
  .depth { margin-left: auto; color: #c9a; }
  .perf { color: #e53e3e; }
  .empty { font-size: 12px; color: #667; font-style: italic; }

  .issues { margin-top: 18px; }
  .issues h2 { font-size: 13px; color: #dde; display: flex; gap: 8px; align-items: center; }
  .issue { font: 11px ui-monospace, monospace; padding: 3px 0; }
  .issue.error { color: #f87171; }
  .issue.warn { color: #fbbf24; }
  .issue code { background: #232340; border-radius: 3px; padding: 0 4px; }

  .next { margin-top: 24px; font-size: 12px; color: #889; border-top: 1px solid #2a2a3e; padding-top: 12px; }
  .next b { color: #cc4444; }
</style>
