<script lang="ts">
  /**
   * ExprLoopBlocks — BUILD + edit a `list<point>` formula as visual FOR blocks
   * (#11 loop readability). `map(range(s,e), f(i)=body)` shows as
   *   ↻ for i = s … e   →  [ body ]
   * Add loops from a few starter choices (circle / spiral / row / blank), edit
   * the iterator / range / body, remove or join them — edits re-serialize to the
   * formula. Parser/serializer: $lib/cad/expr-loops.
   */
  import { parseLoops, serializeLoops, type LoopBlock } from '$lib/cad/expr-loops';

  let { formula = $bindable() }: { formula: string } = $props();

  let loops = $state<LoopBlock[]>([]);
  let lastSerialized = '';
  let addOpen = $state(false);

  // text → blocks (only when the formula changed EXTERNALLY, not from my commit).
  $effect(() => {
    if (formula === lastSerialized) return;
    const f = parseLoops(formula);
    loops = f ? f.loops.map((l) => ({ ...l })) : [];
  });

  function commit() {
    const s = loops.length ? serializeLoops({ loops: $state.snapshot(loops) as LoopBlock[] }) : '';
    lastSerialized = s;
    formula = s;
  }

  // ── loop STRUCTURES (generic skeletons — fill in the range + body) ──
  // Bodies are minimal valid placeholders ([i,0]) so it bakes immediately; you
  // replace the range bound + the [r,z] body with your own.
  const TEMPLATES: { label: string; hint: string; make: () => LoopBlock[] }[] = [
    { label: 'For loop', hint: 'one loop over a range — fill in the body',
      make: () => [{ varName: 'i', start: '0', stop: 'N', body: '[i, 0]' }] },
    { label: 'Reverse loop', hint: 'count the index backward (N-1 → 0)',
      make: () => [{ varName: 'i', start: '0', stop: 'N', body: '[N - 1 - i, 0]' }] },
    { label: 'Two loops, joined', hint: 'out + back — e.g. a closed profile',
      make: () => [
        { varName: 'i', start: '0', stop: 'N', body: '[i, 0]' },
        { varName: 'j', start: '0', stop: 'N', body: '[N - 1 - j, 0]' },
      ] },
  ];
  function addLoop(make: () => LoopBlock[]) { loops = [...loops, ...make()]; addOpen = false; commit(); }
  function removeLoop(k: number) { loops = loops.filter((_, j) => j !== k); commit(); }
</script>

<div class="lb-root">
  {#each loops as l, k (k)}
    {#if k > 0}<div class="lb-join">⊕ then join (concat)</div>{/if}
    <div class="lb-loop">
      <div class="lb-head">
        <span class="lb-icon" title="loop — runs once per index">↻</span>
        <span class="lb-kw">for</span>
        <input class="lb-var" bind:value={l.varName} onchange={commit} spellcheck="false"
          title="iterator — the index, runs 0, 1, 2, …" />
        <span class="lb-eq">=</span>
        <input class="lb-bound" bind:value={l.start} onchange={commit} spellcheck="false" title="start" />
        <span class="lb-dots">…</span>
        <input class="lb-bound" bind:value={l.stop} onchange={commit} spellcheck="false" title="stop (exclusive)" />
        <button class="lb-del" type="button" title="Remove this loop" onclick={() => removeLoop(k)}>×</button>
      </div>
      <div class="lb-body">
        <span class="lb-arrow" title="each {l.varName} produces…">→</span>
        <textarea class="lb-bodytext" bind:value={l.body} onchange={commit}
          spellcheck="false" rows="2" placeholder="[ r , z ]"></textarea>
      </div>
    </div>
  {/each}

  {#if !loops.length}
    <p class="lb-empty">No loop yet — pick a starting point:</p>
  {/if}

  <!-- + for loop builder -->
  <div class="lb-addwrap">
    <button class="lb-add" type="button" class:on={addOpen} onclick={() => (addOpen = !addOpen)}>
      ↻ + for loop</button>
    {#if addOpen}
      <div class="lb-menu">
        {#each TEMPLATES as t}
          <button class="lb-tpl" type="button" onclick={() => addLoop(t.make)} title={t.hint}>
            <span class="lb-tpl-lbl">{t.label}</span>
            <span class="lb-tpl-hint">{t.hint}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if loops.length}
    <p class="lb-hint">Each <code>for</code> runs its body for every index in the range, collecting the
      <code>[r,z]</code> points; loops are joined end-to-end. Edit the range or body; switch to
      <em>text</em> for the raw formula.</p>
  {/if}
</div>

<style>
  .lb-root { display: flex; flex-direction: column; gap: 8px; }
  .lb-join { font: 600 11px Arial; color: #6d28d9; text-align: center; }
  .lb-loop { border: 1.5px solid #c4b5fd; border-radius: 8px; background: #faf8ff; overflow: hidden; }
  .lb-head { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: #f0e9ff; border-bottom: 1px solid #ddd6fe; }
  .lb-icon { font-size: 15px; color: #7c3aed; }
  .lb-kw { font: 700 12px ui-monospace, monospace; color: #6d28d9; }
  .lb-var { width: 34px; text-align: center; font: 700 13px ui-monospace, monospace; color: #4338ca; border: 1px solid #c4b5fd; border-radius: 5px; padding: 3px 4px; background: #fff; }
  .lb-eq, .lb-dots { color: #94a3b8; font: 13px ui-monospace, monospace; }
  .lb-bound { width: 70px; font: 12px ui-monospace, monospace; color: #334155; border: 1px solid #cbd5e1; border-radius: 5px; padding: 3px 6px; background: #fff; }
  .lb-bound:focus, .lb-var:focus { outline: none; border-color: #a855f7; }
  .lb-del { margin-left: auto; font: 700 14px Arial; color: #cbd5e1; background: none; border: none; cursor: pointer; padding: 0 2px; }
  .lb-del:hover { color: #ef4444; }
  .lb-body { display: flex; align-items: flex-start; gap: 6px; padding: 8px 10px; }
  .lb-arrow { color: #7c3aed; font-size: 14px; padding-top: 6px; }
  .lb-bodytext { flex: 1 1 auto; font: 12px/1.45 ui-monospace, monospace; color: #1e293b; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; resize: vertical; background: #fff; }
  .lb-bodytext:focus { outline: none; border-color: #a855f7; }
  .lb-empty { font-size: 12px; color: #64748b; margin: 2px; }
  .lb-addwrap { position: relative; }
  .lb-add { font: 700 12px Arial; color: #6d28d9; background: #f5f3ff; border: 1.5px dashed #c4b5fd; border-radius: 7px; padding: 7px 14px; cursor: pointer; width: 100%; }
  .lb-add:hover, .lb-add.on { background: #ede9fe; border-style: solid; border-color: #a78bfa; }
  .lb-menu { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; padding: 5px; border: 1px solid #ddd6fe; border-radius: 8px; background: #fff; box-shadow: 0 6px 20px rgba(0,0,0,.1); }
  .lb-tpl { display: flex; align-items: baseline; gap: 8px; text-align: left; background: none; border: none; border-radius: 5px; padding: 6px 8px; cursor: pointer; }
  .lb-tpl:hover { background: #f5f3ff; }
  .lb-tpl-lbl { font: 700 12px Arial; color: #4338ca; min-width: 78px; }
  .lb-tpl-hint { font-size: 11px; color: #94a3b8; }
  .lb-hint { font-size: 11px; color: #94a3b8; margin: 2px 2px 0; }
  .lb-hint code { background: #ede9fe; color: #5b21b6; padding: 0 4px; border-radius: 3px; }
</style>
