<script lang="ts">
  // LearnPanel — the studio's LEARN tab (#38 flywheel). Two halves:
  //  · Promotion QUEUE — ranked candidate builds worth turning into golden examples; one-click
  //    ★ Promote (human-gated — automation never promotes the model's own output unprompted).
  //  · ⚠ Report — flag the CURRENT app as a bad build (the negative signal → non-conformances).
  import type { AppManifest } from '$lib/appkit/manifest/types';
  let { app }: { app: AppManifest } = $props();

  type Candidate = { rec: { ts: number; prompt: string; app: unknown }; score: number; reasons: string[] };
  let candidates = $state<Candidate[]>([]);
  let loading = $state(true);
  let note = $state('');
  let status = $state('');
  let busy = $state(false);

  async function load() {
    loading = true;
    try {
      const r = await fetch('/api/app/learn');
      if (r.ok) candidates = (await r.json()).candidates ?? [];
    } catch {
      /* ignore */
    } finally {
      loading = false;
    }
  }
  load();

  const short = (p: string) => (p.length > 90 ? `${p.slice(0, 90)}…` : p);

  async function promote(c: Candidate) {
    busy = true;
    status = 'promoting…';
    try {
      const r = await fetch('/api/app/promote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: c.rec.prompt.slice(0, 48), md: c.rec.prompt, app: c.rec.app }),
      });
      if (!r.ok) throw new Error(await r.text());
      candidates = candidates.filter((x) => x !== c);
      status = '★ promoted to golden';
    } catch (e) {
      status = String(e);
    } finally {
      busy = false;
    }
  }

  async function report() {
    if (!note.trim()) return;
    busy = true;
    status = 'reporting…';
    try {
      const r = await fetch('/api/app/learn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note, app: $state.snapshot(app) }),
      });
      if (!r.ok) throw new Error(await r.text());
      note = '';
      status = '⚠ reported — thanks, it won’t teach the model';
    } catch (e) {
      status = String(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="lp">
  <div class="lp-h">Learn</div>
  <p class="lp-hint">Turn good builds into golden examples; flag bad ones. Only golden pairs teach the model — the raw log never does.</p>

  <div class="sec">Promotion queue <span class="cnt">{candidates.length}</span></div>
  {#if loading}
    <div class="empty">loading candidates…</div>
  {:else if !candidates.length}
    <div class="empty">no candidates yet — build a few apps, then the best clean ones surface here.</div>
  {:else}
    <ul class="cands">
      {#each candidates as c (c.rec.ts)}
        <li class="cand">
          <div class="cand-top">
            <span class="score" title="promotion score">{c.score}</span>
            <span class="prompt" title={c.rec.prompt}>{short(c.rec.prompt)}</span>
            <button class="star" disabled={busy} onclick={() => promote(c)} title="promote to a golden example">★</button>
          </div>
          <div class="reasons">{c.reasons.join(' · ')}</div>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="sec">⚠ Report this build</div>
  <p class="lp-hint">What did the AI get wrong on the current app? This captures the negative signal (never teaches).</p>
  <textarea bind:value={note} placeholder="e.g. it put the toolbar on the right, should be left" disabled={busy}></textarea>
  <button class="report" disabled={busy || !note.trim()} onclick={report}>⚠ Report</button>

  {#if status}<div class="status">{status}</div>{/if}
</div>

<style>
  .lp { display: flex; flex-direction: column; gap: 8px; padding: 12px; font: 13px system-ui, Arial, sans-serif; color: #0f172a; height: 100%; overflow: auto; box-sizing: border-box; }
  .lp-h { font: 700 13px system-ui; }
  .lp-hint { margin: 0; color: #64748b; font-size: 12px; line-height: 1.4; }
  .sec { margin-top: 6px; font: 600 10px system-ui; text-transform: uppercase; letter-spacing: .3px; color: #94a3b8; display: flex; align-items: center; gap: 6px; }
  .sec .cnt { background: #eff6ff; color: #0369a1; border-radius: 999px; padding: 0 6px; font-size: 10px; }
  .empty { color: #94a3b8; font-style: italic; font-size: 12px; padding: 4px 0; }
  .cands { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .cand { border: 1px solid #e5e7eb; border-radius: 8px; padding: 7px 9px; }
  .cand-top { display: flex; align-items: center; gap: 7px; }
  .cand .score { flex: 0 0 auto; width: 22px; height: 22px; display: grid; place-items: center; border-radius: 6px; background: #ecfdf5; color: #047857; font: 700 11px system-ui; }
  .cand .prompt { flex: 1; min-width: 0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cand .star { flex: 0 0 auto; width: 26px; height: 24px; border: 1px solid #fcd34d; border-radius: 6px; background: #fffbeb; color: #b45309; cursor: pointer; font-size: 13px; }
  .cand .star:hover:not(:disabled) { background: #fef3c7; }
  .cand .star:disabled { opacity: .5; cursor: default; }
  .cand .reasons { margin-top: 3px; color: #94a3b8; font-size: 11px; }
  .lp textarea { min-height: 64px; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font: 12px system-ui; resize: vertical; }
  .report { align-self: flex-start; padding: 6px 12px; border: 1px solid #f59e0b; border-radius: 7px; background: #fffbeb; color: #b45309; font: 600 12px system-ui; cursor: pointer; }
  .report:disabled { opacity: .5; cursor: default; }
  .status { font-size: 11px; color: #16a34a; }
</style>
