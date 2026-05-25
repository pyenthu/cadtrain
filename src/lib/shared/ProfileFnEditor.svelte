<script lang="ts">
  /**
   * ProfileFnEditor — author a VOLUME *function* profile in-GUI (K.22 P3b,
   * docs/plans/profiles-directory.md). You define a params SCHEMA + a `build(p)`
   * body that returns an (r,z) half-section; a live preview round-trips the body
   * through /api/primitives/profiles/resolve (the points-only server sandbox —
   * `build` can't run client-side), then Save writes profile.json + source.ts to
   * the volume so it joins the palette with a `ƒ` badge.
   *
   * Identity (id / name / description / tags) is OWNED BY THE PARENT and edited
   * via the title-bar ⚙ popover — this editor only reads those props (for save +
   * the slug). The body is two columns: a scrollable LEFT (params · expressions ·
   * path) and a fixed RIGHT (actions + preview).
   */
  import type { Pt } from './profile-presets';
  import { dragNumber } from './dragNumber';

  interface ParamRow { key: string; label: string; def: number; min: number; max: number; step: number; unit: string; }
  interface Seed { id?: string; label?: string; description?: string; tags?: string[]; params?: Record<string, any>; body?: string; }
  interface Props {
    set: 'revolve' | 'cartesian';
    seed?: Seed | null;
    /** Parent-owned identity (edited via the title-bar ⚙). Read here for save. */
    id?: string;
    label?: string;
    description?: string;
    tags?: string; // comma-separated
    onSaved: (id: string) => void;
    onClose: () => void;
  }
  let { set, seed = null, id = '', label = '', description = '', tags = '', onSaved, onClose }: Props = $props();

  // Seed an editable cylinder so a fresh editor previews immediately.
  // Trace the profile with the pen (mv/line) — readable + editable (insert/
  // delete a move). `pen` is injected into the profile sandbox.
  const DEFAULT_BODY = `const r = p.r ?? 40;\nconst len = p.len ?? 120;\nconst t = pen();\nt.mv(0, 0);    // axis, top\nt.line(r, 0);  // → out to radius\nt.line(r, len);// ↓ down the side\nt.line(0, len);// → back to axis\nreturn t.pts();`;
  function seedRows(s: Seed | null): ParamRow[] {
    if (s?.params && typeof s.params === 'object' && Object.keys(s.params).length) {
      return Object.entries<any>(s.params).map(([key, d]) => ({
        key, label: d?.label ?? key, def: +(d?.default ?? 0), min: +(d?.min ?? 0), max: +(d?.max ?? 100), step: +(d?.step ?? 1), unit: d?.unit ?? '',
      }));
    }
    return [
      { key: 'r', label: 'Radius', def: 40, min: 1, max: 300, step: 0.5, unit: 'mm' },
      { key: 'len', label: 'Length', def: 120, min: 1, max: 600, step: 1, unit: 'mm' },
    ];
  }

  // ── Build = calculated EXPRESSIONS + a visual MOVE list (the pen path) ──────
  interface Move { cmd: 'mv' | 'line' | 'lineR' | 'lineZ'; a: string; b: string; }
  // Split call args on top-level commas (so `Math.max(a, b), z` → two args).
  function splitArgs(s: string): string[] {
    const out: string[] = []; let depth = 0, cur = '';
    for (const ch of s) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  // Parse a build body into { expr (calculated values), moves (the pen path) }.
  function parseBody(b: string): { expr: string; moves: Move[] } {
    const moves: Move[] = [];
    const re = /\bt\.(mv|line|lineR|lineZ)\s*\(((?:[^()]|\([^()]*\))*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(b))) {
      const a = splitArgs(m[2]);
      moves.push({ cmd: m[1] as Move['cmd'], a: a[0] ?? '0', b: a[1] ?? '0' });
    }
    const expr = b
      .replace(/\bt\.(?:mv|line|lineR|lineZ)\s*\((?:[^()]|\([^()]*\))*\)\s*;?/g, '')
      .replace(/\breturn\s+t\s*\.\s*pts\s*\(\s*\)\s*;?/g, '')
      .replace(/,?\s*\bt\s*=\s*pen\s*\(\s*\)\s*;?/g, ';')
      .replace(/^\s*(?:const|let|var)\s*;\s*$/gm, '')
      .replace(/;\s*;/g, ';')
      .replace(/\n{2,}/g, '\n')
      .trim();
    return { expr, moves };
  }

  const _parsed = parseBody(seed?.body ?? DEFAULT_BODY);
  let rows = $state<ParamRow[]>(seedRows(seed));
  let exprBody = $state(_parsed.expr);
  let moves = $state<Move[]>(_parsed.moves);
  let exprOpen = $state(true);
  let movesOpen = $state(true);
  let previewPts = $state<Pt[]>([]);
  let err = $state<string | null>(null);
  let busy = $state(false);
  let saveErr = $state<string | null>(null);
  let paramsOpen = $state(true);
  // Per-param range/label callout — a Flowbite-style popover anchored to the
  // row's ⚙. Holds the metadata you rarely touch (label / min / max / step) so
  // the param row itself stays compact (key · default · unit).
  let paramPop = $state<{ i: number; x: number; y: number } | null>(null);
  function openParamPop(i: number, ev: MouseEvent) {
    if (paramPop?.i === i) { paramPop = null; return; }
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    paramPop = { i, x: Math.max(8, Math.min(r.right - 172, window.innerWidth - 196)), y: r.bottom + 9 };
  }

  // Auto description (shown / persisted when the parent hasn't typed one).
  const autoDesc = $derived(set === 'revolve' ? 'revolve half-section (r, z)' : 'cross-section profile');
  const slug = $derived(id.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, ''));
  // Reassemble the build: expressions, then the pen path from the move list.
  function composeSource(): string {
    if (!moves.length) return `export function build(p) {\n${exprBody}\n}`;
    const lines = moves.map((mv) =>
      mv.cmd === 'lineR' || mv.cmd === 'lineZ' ? `  t.${mv.cmd}(${mv.a});` : `  t.${mv.cmd}(${mv.a}, ${mv.b});`,
    ).join('\n');
    return `export function build(p) {\n${exprBody}\n  const t = pen();\n${lines}\n  return t.pts();\n}`;
  }
  function schema(): Record<string, any> {
    const out: Record<string, any> = {};
    for (const r of rows) {
      const k = r.key.trim();
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) continue;
      out[k] = { label: r.label || k, min: +r.min, max: +r.max, step: +r.step, default: +r.def, ...(r.unit ? { unit: r.unit } : {}) };
    }
    return out;
  }
  function previewParams(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of rows) { const k = r.key.trim(); if (k) out[k] = +r.def; }
    return out;
  }

  function addRow() { rows = [...rows, { key: '', label: '', def: 0, min: 0, max: 100, step: 1, unit: '' }]; }
  function delRow(i: number) { rows = rows.filter((_, j) => j !== i); }
  function addMove() { moves = [...moves, { cmd: 'line', a: '0', b: '0' }]; }
  function delMove(i: number) { moves = moves.filter((_, j) => j !== i); }

  // Live preview: debounce → resolve build(defaults) on the server sandbox.
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const src = composeSource(); const pp = previewParams(); // track body + rows
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const r = await fetch('/api/primitives/profiles/resolve', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source: src, params: pp }),
        });
        if (r.ok) { previewPts = (await r.json()).points ?? []; err = null; }
        else { err = (await r.text()).slice(0, 160); }
      } catch (e: any) { err = e?.message ?? String(e); }
    }, 250);
    return () => clearTimeout(timer);
  });

  // Preview matches the app's half-section convention: a revolve shows the r≥0
  // HALF only (NOT mirrored) with the rotation axis at r=0 and z increasing
  // downward (Z-down). Cartesian shows the centered cross-section (y up, no axis).
  // Resolution-independent: the viewBox follows the polygon's OWN bounds (+pad);
  // the <svg> fills its CSS box and preserveAspectRatio centers/scales. No pixel
  // measuring → no ResizeObserver, so the box can't feed back and grow.
  const view = $derived.by(() => {
    const poly = previewPts;
    if (!poly.length) return { d: '', axis: null as number | null, vb: '0 0 100 100', y0: 0, y1: 100 };
    const revolve = set === 'revolve';
    // svg y grows downward → revolve z (Z-down) maps as-is; cartesian y-up flips.
    const pts = poly.map((p) => [p[0], revolve ? p[1] : -p[1]] as [number, number]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const minX = revolve ? Math.min(0, ...xs) : Math.min(...xs);
    const maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = (maxX - minX) || 1, h = (maxY - minY) || 1;
    const pad = 0.06 * Math.max(w, h); // ~6% margin → shape ~88% of the box
    const vbX = minX - pad, vbY = minY - pad, vbW = w + 2 * pad, vbH = h + 2 * pad;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(3)} ${p[1].toFixed(3)}`).join(' ') + ' Z';
    return { d, axis: revolve ? 0 : null, vb: `${vbX} ${vbY} ${vbW} ${vbH}`, y0: vbY, y1: vbY + vbH };
  });

  // The id this editor opened on (when editing/forking an existing profile).
  const seedId = seed?.id ?? '';
  // Save under `slug` (Save), or fork to a new id (Save as new — appends _copy
  // when the id still matches the one we opened, so the original is never clobbered).
  async function save(asNew = false) {
    saveErr = null;
    let targetId = slug;
    if (asNew && seedId && targetId === seedId) targetId = `${targetId}_copy`;
    if (!targetId) { saveErr = 'id required'; return; }
    if (Object.keys(schema()).length === 0) { saveErr = 'add at least one param'; return; }
    busy = true;
    try {
      const r = await fetch('/api/primitives/profiles/save', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: targetId, label: label.trim() || targetId, description: description.trim() || autoDesc, set,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
          params: schema(), source: composeSource(),
        }),
      });
      if (r.ok) onSaved(targetId);
      else saveErr = `save failed: ${(await r.text()).slice(0, 200)}`;
    } catch (e: any) { saveErr = `error: ${e?.message ?? e}`; }
    finally { busy = false; }
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && paramPop) paramPop = null; }} />

<div class="fn-ed">
  <!-- LEFT (scrolls): params · expressions · path -->
  <div class="fn-left">
    <div class="fn-acc">
      <button type="button" class="fn-acc-tog" onclick={() => (paramsOpen = !paramsOpen)}>
        <span class="fn-acc-caret">{paramsOpen ? '▾' : '▸'}</span> params <span class="fn-acc-n">{rows.length}</span>
      </button>
      <button type="button" class="fn-acc-add" onclick={() => { paramsOpen = true; addRow(); }} title="Add a parameter">+ param</button>
    </div>
    {#if paramsOpen}
      <div class="fn-params">
        {#each rows as row, i (i)}
          <div class="fn-prow">
            <input class="k" bind:value={row.key} placeholder="r" spellcheck="false" title={row.label || 'param name'} />
            <input class="num" type="text" inputmode="decimal" value={row.def} oninput={(e) => (row.def = +(e.currentTarget as HTMLInputElement).value)} use:dragNumber={{ step: row.step || 1, get: () => row.def, set: (v) => (row.def = v) }} title="default — drag or type" />
            <input class="u" bind:value={row.unit} placeholder="mm" title="unit" />
            <button type="button" class="fn-gear" class:on={paramPop?.i === i} onclick={(e) => openParamPop(i, e)} title="Range & label — min / max / step" aria-label="Edit param range">
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <g stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none"><path d="M2.5 4h5.5M11.5 4h2M2.5 8h2M7 8h6.5M2.5 12h7M12.5 12h1"/></g>
                <g fill="currentColor"><circle cx="9.5" cy="4" r="1.7"/><circle cx="5.5" cy="8" r="1.7"/><circle cx="11" cy="12" r="1.7"/></g>
              </svg>
            </button>
            <button type="button" class="fn-del" onclick={() => delRow(i)} title="Remove param" aria-label="Remove param">
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M6 2h4l.5 1H13v1.4H3V3h2.5L6 2zm-1.6 3.4h7.2l-.6 8.1a1.1 1.1 0 0 1-1.1 1H6.1a1.1 1.1 0 0 1-1.1-1l-.6-8.1zM7 7v5h1V7H7zm2 0v5h1V7H9z"/></svg>
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <!-- calculated expressions (derived values from the params) -->
    <div class="fn-acc">
      <button type="button" class="fn-acc-tog" onclick={() => (exprOpen = !exprOpen)}>
        <span class="fn-acc-caret">{exprOpen ? '▾' : '▸'}</span> calculated expressions
      </button>
    </div>
    {#if exprOpen}
      <textarea class="fn-expr" bind:value={exprBody} spellcheck="false" rows="4"
        placeholder="const ri = p.bore / 2;  // derived values used by the path"></textarea>
    {/if}

    <!-- path: visual list of pen moves (mv / line) — r,z are expressions -->
    <div class="fn-acc">
      <button type="button" class="fn-acc-tog" onclick={() => (movesOpen = !movesOpen)}>
        <span class="fn-acc-caret">{movesOpen ? '▾' : '▸'}</span> path
        <span class="fn-acc-n">{moves.length}</span>
        <span class="fn-acc-hint">({set === 'revolve' ? 'r ≥ 0 half-section, Z-down' : 'centered'})</span>
      </button>
      <button type="button" class="fn-acc-add" onclick={() => { movesOpen = true; addMove(); }} title="Add a move">+ move</button>
    </div>
    {#if movesOpen}
      <div class="fn-moves">
        <div class="fn-mrow fn-mrow-h"><span></span><span>cmd</span><span>r</span><span>z</span><span></span></div>
        {#each moves as mv, i (i)}
          <div class="fn-mrow">
            <span class="fn-mnum">{i}</span>
            <select class="fn-mcmd" bind:value={mv.cmd}>
              <option value="mv">mv</option><option value="line">line</option>
              <option value="lineR">lineR</option><option value="lineZ">lineZ</option>
            </select>
            <input class="fn-marg" bind:value={mv.a} placeholder={mv.cmd === 'lineZ' ? 'z' : 'r'} spellcheck="false" title="r / expression" />
            {#if mv.cmd === 'mv' || mv.cmd === 'line'}
              <input class="fn-marg" bind:value={mv.b} placeholder="z" spellcheck="false" title="z / expression" />
            {:else}<span class="fn-marg fn-marg-na">—</span>{/if}
            <button type="button" class="fn-del" onclick={() => delMove(i)} title="Remove move" aria-label="Remove move">
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M6 2h4l.5 1H13v1.4H3V3h2.5L6 2zm-1.6 3.4h7.2l-.6 8.1a1.1 1.1 0 0 1-1.1 1H6.1a1.1 1.1 0 0 1-1.1-1l-.6-8.1zM7 7v5h1V7H7zm2 0v5h1V7H9z"/></svg>
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- RIGHT (fixed): actions on top, then the capped preview -->
  <div class="fn-right">
    <div class="fn-actions">
      <button type="button" class="fn-cancel" onclick={onClose}>Cancel</button>
      {#if seedId}
        <button type="button" class="fn-saveas" disabled={busy || !!err || !slug} onclick={() => save(true)} title="Save under a new id (fork a copy)">Save as new</button>
      {/if}
      <button type="button" class="fn-save" disabled={busy || !!err || !slug} onclick={() => save(false)}>{busy ? 'Saving…' : seedId ? 'Save' : 'Save profile'}</button>
    </div>
    {#if saveErr}<div class="fn-saveerr" title={saveErr}>{saveErr}</div>{/if}
    <div class="fn-prev">
      <svg viewBox={view.vb} preserveAspectRatio="xMidYMid meet" class="fn-svg" class:bad={!!err}>
        {#if view.axis !== null}<line x1={view.axis} y1={view.y0} x2={view.axis} y2={view.y1} class="fn-axis" vector-effect="non-scaling-stroke" />{/if}
        {#if view.d}<path d={view.d} class="fn-path" vector-effect="non-scaling-stroke" />{/if}
      </svg>
      {#if err}<div class="fn-err" title={err}>{err}</div>{/if}
    </div>
  </div>
</div>

{#if paramPop}
  {@const prow = rows[paramPop.i]}
  {#if prow}
    <div class="fn-pop-back" role="presentation" onclick={() => (paramPop = null)}></div>
    <div class="fn-pop" style={`left:${paramPop.x}px; top:${paramPop.y}px`}>
      <div class="fn-pop-ttl"><code>{prow.key || 'param'}</code> · range &amp; label</div>
      <label class="fn-pp-row"><span>label</span><input value={prow.label} oninput={(e) => (prow.label = (e.currentTarget as HTMLInputElement).value)} placeholder="Bore ID" /></label>
      <label class="fn-pp-row"><span>min</span><input class="num" type="text" inputmode="decimal" value={prow.min} oninput={(e) => (prow.min = +(e.currentTarget as HTMLInputElement).value)} use:dragNumber={{ step: prow.step || 1, get: () => prow.min, set: (v) => (prow.min = v) }} /></label>
      <label class="fn-pp-row"><span>max</span><input class="num" type="text" inputmode="decimal" value={prow.max} oninput={(e) => (prow.max = +(e.currentTarget as HTMLInputElement).value)} use:dragNumber={{ step: prow.step || 1, get: () => prow.max, set: (v) => (prow.max = v) }} /></label>
      <label class="fn-pp-row"><span>step</span><input class="num" type="text" inputmode="decimal" value={prow.step} oninput={(e) => (prow.step = +(e.currentTarget as HTMLInputElement).value)} use:dragNumber={{ step: 0.1, get: () => prow.step, set: (v) => (prow.step = v) }} /></label>
    </div>
  {/if}
{/if}

<style>
  /* two columns; LEFT scrolls, RIGHT is fixed. height:100% lets the popup's
     own max-height cap the panel and confine scrolling to the left column. */
  .fn-ed { width: 580px; max-width: 92vw; height: 100%; min-height: 0; overflow: hidden; display: grid; grid-template-columns: 1fr 196px; gap: 12px; align-items: stretch; font: 11px Arial; color: #222; }
  .fn-left { min-width: 0; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; padding-right: 5px; }
  .fn-right { min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: 7px; }
  /* actions — Cancel + Save-as-new share a row; Save takes its own full-width row */
  .fn-actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .fn-cancel { flex: 0 0 auto; border: 1px solid #d4d4dc; background: #fff; border-radius: 5px; padding: 4px 12px; cursor: pointer; font: 11px Arial; }
  .fn-cancel:hover { background: #f6f6f8; }
  .fn-saveas { flex: 1 1 0; min-width: 0; border: 1px solid #e8c6c1; background: #fff; color: #c4392f; border-radius: 5px; padding: 4px 10px; cursor: pointer; font: 11px Arial; }
  .fn-saveas:hover:not(:disabled) { background: #fceeec; }
  .fn-saveas:disabled { opacity: .5; cursor: not-allowed; }
  .fn-save { flex: 1 1 100%; border: 1px solid #a8302a; background: #c4392f; color: #fff; border-radius: 5px; padding: 5px 14px; cursor: pointer; font: 11px Arial; }
  .fn-save:hover:not(:disabled) { background: #b23329; }
  .fn-save:disabled { opacity: .5; cursor: not-allowed; }
  .fn-saveerr { font-size: 10px; color: #cc2222; line-height: 1.3; }
  /* collapsible section header — distinct bordered chip (toggle | + add),
     slightly rounded, tight. The + action lives inside the title chip. */
  .fn-acc { display: flex; align-items: stretch; border: 1px solid #e3c4bf; background: #fbf4f3; border-radius: 4px; margin-top: 2px; overflow: hidden; }
  .fn-acc:hover { border-color: #e0b4ad; }
  .fn-acc-tog { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; text-align: left; border: 0; background: transparent; cursor: pointer; font: 600 9px/1.3 Arial; text-transform: uppercase; letter-spacing: .055em; color: #7a6f6d; padding: 4px 8px; }
  .fn-acc-tog:hover { background: #fceeec; color: #b23329; }
  .fn-acc-add { flex: 0 0 auto; border: 0; border-left: 1px solid #efd3ce; background: transparent; cursor: pointer; color: #c4392f; font: 700 9px Arial; text-transform: uppercase; letter-spacing: .04em; padding: 0 9px; }
  .fn-acc-add:hover { background: #fceeec; }
  .fn-acc-caret { color: #cf9b94; font-size: 8px; width: 9px; }
  .fn-acc-n { background: #f6ddd9; color: #c4392f; border-radius: 8px; padding: 1px 7px; font-size: 8px; font-weight: 700; }
  .fn-acc-hint { margin-left: auto; font-size: 8px; color: #aaa; text-transform: none; letter-spacing: 0; font-weight: 400; }
  /* params — two-column compact grid (one param per cell) */
  .fn-params { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 10px; padding: 3px 2px 0; }
  .fn-prow { display: grid; grid-template-columns: minmax(0,1.2fr) minmax(0,0.75fr) minmax(0,0.45fr) 22px 18px; gap: 3px; align-items: center; }
  .fn-prow input { font: 10px Arial; padding: 3px 4px; border: 1px solid #dcdce4; border-radius: 4px; min-width: 0; width: 100%; box-sizing: border-box; }
  .fn-prow input:focus { outline: none; border-color: #c4392f; }
  .fn-prow input.k { font-family: 'SF Mono', Menlo, monospace; }
  .fn-prow input.num { font-family: 'SF Mono', Menlo, monospace; text-align: right; cursor: ew-resize; background: #fdf8f7; }
  .fn-gear { display: inline-flex; align-items: center; justify-content: center; height: 22px; border: 1px solid transparent; background: transparent; cursor: pointer; color: #c79a95; padding: 0; border-radius: 4px; }
  .fn-gear:hover { color: #c4392f; background: #fceeec; }
  .fn-gear.on { color: #c4392f; background: #f6ddd9; border-color: #e8c6c1; }
  .fn-del { display: inline-flex; align-items: center; justify-content: center; border: 0; background: transparent; cursor: pointer; color: #c4c4d0; padding: 0; }
  .fn-del:hover { color: #cc2222; }
  .fn-expr { font: 11px 'SF Mono', Menlo, monospace; padding: 6px; border: 1px solid #d4d4dc; border-radius: 5px; resize: vertical; line-height: 1.4; width: 100%; box-sizing: border-box; }
  .fn-expr:focus { outline: none; border-color: #c4392f; }
  /* visual move list */
  .fn-moves { display: flex; flex-direction: column; gap: 2px; padding: 2px 2px 0; }
  .fn-mrow { display: grid; grid-template-columns: 16px 64px 1fr 1fr 20px; gap: 4px; align-items: center; }
  .fn-mrow-h { font-size: 8px; color: #bbb; }
  .fn-mrow-h span { padding-left: 3px; }
  .fn-mnum { font: 9px 'SF Mono', Menlo, monospace; color: #bbb; text-align: right; }
  .fn-mcmd { font: 10px 'SF Mono', Menlo, monospace; padding: 2px 3px; border: 1px solid #dcdce4; border-radius: 4px; background: #fdf8f7; color: #c4392f; }
  .fn-marg { font: 10px 'SF Mono', Menlo, monospace; padding: 3px 5px; border: 1px solid #dcdce4; border-radius: 4px; min-width: 0; width: 100%; box-sizing: border-box; }
  .fn-marg:focus { outline: none; border-color: #c4392f; }
  .fn-marg-na { color: #ccc; text-align: center; }
  /* preview — fills the right column (capped to popup viewport); shape ~90% */
  .fn-prev { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 4px; }
  .fn-svg { flex: 1; width: 100%; min-height: 170px; min-width: 0; border: 1px solid #ececf2; border-radius: 6px; background: #fffdfc; }
  .fn-svg.bad { background: #fff6f6; border-color: #f0caca; }
  .fn-path { fill: rgba(196,57,47,0.13); stroke: #c4392f; stroke-width: 1.4; stroke-linejoin: round; }
  .fn-axis { stroke: #d08b84; stroke-width: 1.4; stroke-dasharray: 6 4; opacity: .9; }
  .fn-err { font-size: 9px; color: #cc2222; max-height: 48px; overflow: hidden; line-height: 1.3; }
  /* Flowbite-style range/label callout (body-portaled, never clipped) */
  .fn-pop-back { position: fixed; inset: 0; z-index: 1190; background: transparent; }
  .fn-pop { position: fixed; z-index: 1200; width: 176px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 4px 18px rgba(17,24,39,.14); padding: 9px 10px; font: 11px Arial; color: #222; display: flex; flex-direction: column; gap: 5px; }
  .fn-pop::before { content: ''; position: absolute; top: -6px; right: 18px; width: 10px; height: 10px; background: #fff; border-left: 1px solid #e5e7eb; border-top: 1px solid #e5e7eb; transform: rotate(45deg); }
  .fn-pop-ttl { font: 8px Arial; text-transform: uppercase; letter-spacing: .05em; color: #9a9aa8; margin-bottom: 1px; }
  .fn-pop-ttl code { font-family: 'SF Mono', Menlo, monospace; color: #c4392f; text-transform: none; letter-spacing: 0; }
  .fn-pp-row { display: grid; grid-template-columns: 38px 1fr; align-items: center; gap: 6px; }
  .fn-pp-row span { font-size: 9px; color: #888; }
  .fn-pp-row input { font: 10px Arial; padding: 3px 6px; border: 1px solid #dcdce4; border-radius: 4px; width: 100%; min-width: 0; box-sizing: border-box; }
  .fn-pp-row input:focus { outline: none; border-color: #c4392f; }
  .fn-pp-row input.num { font-family: 'SF Mono', Menlo, monospace; text-align: right; cursor: ew-resize; background: #fdf8f7; }
</style>
