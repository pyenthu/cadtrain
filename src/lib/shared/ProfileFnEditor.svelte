<script lang="ts">
  /**
   * ProfileFnEditor — author a VOLUME *function* profile in-GUI (K.22 P3b,
   * docs/plans/profiles-directory.md). You define a params SCHEMA + a `build(p)`
   * body that returns an (r,z) half-section; a live preview round-trips the body
   * through /api/primitives/profiles/resolve (the points-only server sandbox —
   * `build` can't run client-side), then Save writes profile.json + source.ts to
   * the volume so it joins the palette with a `ƒ` badge. This is the structured
   * authoring path that replaces hand-pasting baked point lists.
   */
  import type { Pt } from './profile-presets';
  import { dragNumber } from './dragNumber';

  interface ParamRow { key: string; label: string; def: number; min: number; max: number; step: number; unit: string; }
  interface Seed { id?: string; label?: string; tags?: string[]; params?: Record<string, any>; body?: string; }
  interface Props {
    set: 'revolve' | 'cartesian';
    seed?: Seed | null;
    onSaved: (id: string) => void;
    onClose: () => void;
  }
  let { set, seed = null, onSaved, onClose }: Props = $props();

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
  // Robust to how the source is formatted: extract the t.mv/line calls, then
  // STRIP the path bits (moves, the `t = pen()` assignment — which compilers may
  // merge into a `const …, t = pen()`, and the `return t.pts()`) to leave expr.
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
  let id = $state(seed?.id ?? '');
  let label = $state(seed?.label ?? '');
  let tags = $state((seed?.tags ?? []).join(', '));
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

  const slug = $derived(id.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, ''));
  // Reassemble the build: expressions, then the pen path from the move list.
  // No moves (a raw `return […]` profile) → just the expressions verbatim.
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
  // downward (Z-down) — same as the leaf ProfileEditor. Cartesian shows the
  // centered cross-section (y up, no axis).
  const view = $derived.by(() => {
    const poly = previewPts;
    if (!poly.length) return { d: '', axis: null as number | null };
    const revolve = set === 'revolve';
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const minX = revolve ? Math.min(0, ...xs) : Math.min(...xs);
    const maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = (maxX - minX) || 1, h = (maxY - minY) || 1, size = 180, pad = 12;
    const s = (size - 2 * pad) / Math.max(w, h);
    const ox = pad + (size - 2 * pad - w * s) / 2, oy = pad + (size - 2 * pad - h * s) / 2;
    const sx = (x: number) => ox + (x - minX) * s;
    const sy = (y: number) => (revolve ? oy + (y - minY) * s : size - (oy + (y - minY) * s));
    const d = poly.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`).join(' ') + ' Z';
    return { d, axis: revolve ? sx(0) : null };
  });

  // The id this editor opened on (when editing/forking an existing profile).
  const seedId = seed?.id ?? '';
  // Save under `slug` (Save), or fork to a new id (Save as new — appends _copy
  // when the id still matches the one we opened, so the original is never
  // clobbered; rename in the id field for a specific name).
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
          id: targetId, label: label.trim() || targetId, set,
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

<div class="fn-ed">
  <div class="fn-head">
    <strong>ƒ Function profile</strong>
    <span class="fn-set">{set}</span>
    <button class="fn-x" type="button" onclick={onClose} title="Close">✕</button>
  </div>

  <div class="fn-grid">
    <!-- left: metadata + params + body -->
    <div class="fn-col">
      <!-- id · name · tags inline; titles act as tooltips when truncated -->
      <div class="fn-meta">
        <label class="fn-fld" title="Profile id (slug) — how it's saved & referenced">
          <span>id</span><input bind:value={id} title={id || 'profile id'} placeholder="casing_coupling" spellcheck="false" />
        </label>
        <label class="fn-fld" title="Display name / description">
          <span>name</span><input bind:value={label} title={label || 'display name'} placeholder="Casing coupling" />
        </label>
        <label class="fn-fld fn-fld-tags" title="Comma-separated tags">
          <span>tags</span><input bind:value={tags} title={tags || 'tags'} placeholder="coupling, casing" />
        </label>
      </div>
      <div class="fn-slug">
        {#if seedId && slug === seedId}editing <code>{seedId}</code> — change the id (or use “Save as new”) to fork a copy{:else if slug}saves as <code>{slug}</code> (new profile){/if}
      </div>

      <button type="button" class="fn-acc" onclick={() => (paramsOpen = !paramsOpen)}>
        <span class="fn-acc-caret">{paramsOpen ? '▾' : '▸'}</span> params <span class="fn-acc-n">{rows.length}</span>
      </button>
      {#if paramsOpen}
        <div class="fn-params">
          <div class="fn-prow fn-prow-h"><span>key</span><span>default</span><span>min</span><span>max</span><span>step</span><span>unit</span><span></span></div>
          {#each rows as row, i (i)}
            <div class="fn-prow">
              <input class="k" bind:value={row.key} placeholder="r" spellcheck="false" title="param name" />
              <input class="num" type="text" inputmode="decimal" value={row.def} oninput={(e) => (row.def = +(e.currentTarget as HTMLInputElement).value)} use:dragNumber={{ step: row.step || 1, get: () => row.def, set: (v) => (row.def = v) }} title="default — drag or type" />
              <input class="num" type="text" inputmode="decimal" value={row.min} oninput={(e) => (row.min = +(e.currentTarget as HTMLInputElement).value)} use:dragNumber={{ step: row.step || 1, get: () => row.min, set: (v) => (row.min = v) }} title="min — drag or type" />
              <input class="num" type="text" inputmode="decimal" value={row.max} oninput={(e) => (row.max = +(e.currentTarget as HTMLInputElement).value)} use:dragNumber={{ step: row.step || 1, get: () => row.max, set: (v) => (row.max = v) }} title="max — drag or type" />
              <input class="num" type="text" inputmode="decimal" value={row.step} oninput={(e) => (row.step = +(e.currentTarget as HTMLInputElement).value)} use:dragNumber={{ step: 0.1, get: () => row.step, set: (v) => (row.step = v) }} title="step — drag or type" />
              <input class="u" bind:value={row.unit} placeholder="mm" title="unit" />
              <button type="button" class="fn-del" onclick={() => delRow(i)} title="Remove param" aria-label="Remove param">
                <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M6 2h4l.5 1H13v1.4H3V3h2.5L6 2zm-1.6 3.4h7.2l-.6 8.1a1.1 1.1 0 0 1-1.1 1H6.1a1.1 1.1 0 0 1-1.1-1l-.6-8.1zM7 7v5h1V7H7zm2 0v5h1V7H9z"/></svg>
              </button>
            </div>
          {/each}
          <button type="button" class="fn-add" onclick={addRow}>+ param</button>
        </div>
      {/if}

      <!-- calculated expressions (derived values from the params) -->
      <button type="button" class="fn-acc" onclick={() => (exprOpen = !exprOpen)}>
        <span class="fn-acc-caret">{exprOpen ? '▾' : '▸'}</span> calculated expressions
      </button>
      {#if exprOpen}
        <textarea class="fn-expr" bind:value={exprBody} spellcheck="false" rows="4"
          placeholder="const ri = p.bore / 2;  // derived values used by the path"></textarea>
      {/if}

      <!-- path: visual list of pen moves (mv / line) — r,z are expressions -->
      <button type="button" class="fn-acc" onclick={() => (movesOpen = !movesOpen)}>
        <span class="fn-acc-caret">{movesOpen ? '▾' : '▸'}</span> path
        <span class="fn-acc-n">{moves.length}</span>
        <span class="fn-acc-hint">({set === 'revolve' ? 'r ≥ 0 half-section, Z-down' : 'centered'})</span>
      </button>
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
          <button type="button" class="fn-add" onclick={addMove}>+ move</button>
        </div>
      {/if}
    </div>

    <!-- right: live preview -->
    <div class="fn-col fn-prev">
      <div class="fn-sec">preview</div>
      <svg viewBox="0 0 180 180" class="fn-svg" class:bad={!!err}>
        {#if view.axis !== null}<line x1={view.axis} y1="6" x2={view.axis} y2="174" class="fn-axis" />{/if}
        {#if view.d}<path d={view.d} class="fn-path" />{/if}
      </svg>
      {#if err}<div class="fn-err" title={err}>{err}</div>{:else}<div class="fn-ok">{previewPts.length} pts</div>{/if}
    </div>
  </div>

  <div class="fn-foot">
    {#if saveErr}<span class="fn-saveerr">{saveErr}</span>{/if}
    <button type="button" class="fn-cancel" onclick={onClose}>Cancel</button>
    {#if seedId}
      <button type="button" class="fn-saveas" disabled={busy || !!err || !slug} onclick={() => save(true)} title="Save under a new id (fork a copy)">Save as new</button>
    {/if}
    <button type="button" class="fn-save" disabled={busy || !!err || !slug} onclick={() => save(false)}>{busy ? 'Saving…' : seedId ? 'Save' : 'Save profile'}</button>
  </div>
</div>

<style>
  .fn-ed { width: 560px; font: 11px Arial; color: #222; }
  .fn-head { display: flex; align-items: center; gap: 8px; padding-bottom: 6px; border-bottom: 1px solid #ececf2; margin-bottom: 8px; }
  .fn-head strong { font-size: 12px; }
  .fn-set { font-size: 9px; color: #6a5acd; background: #efecfb; border-radius: 3px; padding: 1px 5px; text-transform: uppercase; letter-spacing: .04em; }
  .fn-x { margin-left: auto; border: 0; background: transparent; cursor: pointer; color: #999; font-size: 12px; }
  .fn-grid { display: grid; grid-template-columns: 1fr 196px; gap: 12px; }
  .fn-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  /* id · name · tags — single inline row */
  .fn-meta { display: flex; align-items: center; gap: 8px; }
  .fn-fld { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; }
  .fn-fld-tags { flex: 1.4; }
  .fn-fld span { font-size: 8px; text-transform: uppercase; letter-spacing: .04em; color: #aaa; }
  .fn-fld input { flex: 1; min-width: 0; font: 11px Arial; padding: 4px 7px; border: 1px solid #d8d8e2; border-radius: 6px; background: #fff; }
  .fn-fld input:focus { outline: none; border-color: #6a5acd; box-shadow: 0 0 0 2px rgba(106,90,205,.14); }
  .fn-slug { font-size: 9px; color: #999; }
  .fn-slug code { color: #6a5acd; }
  .fn-sec { font-size: 9px; color: #999; text-transform: uppercase; letter-spacing: .04em; margin-top: 2px; }
  /* collapsible section header */
  .fn-acc { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; border: 0; background: transparent; cursor: pointer; font: 9px Arial; text-transform: uppercase; letter-spacing: .05em; color: #888; padding: 4px 0; margin-top: 2px; }
  .fn-acc:hover { color: #6a5acd; }
  .fn-acc-caret { color: #bbb; font-size: 8px; width: 9px; }
  .fn-acc-n { background: #eeeef5; color: #888; border-radius: 8px; padding: 0 6px; font-size: 8px; }
  .fn-params { display: flex; flex-direction: column; gap: 2px; }
  .fn-prow { display: grid; grid-template-columns: 1.3fr 1fr 1fr 1fr 1fr 0.9fr 20px; gap: 3px; align-items: center; }
  .fn-prow-h { font-size: 8px; color: #bbb; }
  .fn-prow-h span { padding-left: 3px; }
  .fn-prow input { font: 10px Arial; padding: 3px 5px; border: 1px solid #dcdce4; border-radius: 4px; min-width: 0; width: 100%; }
  .fn-prow input:focus { outline: none; border-color: #6a5acd; }
  .fn-prow input.k { font-family: 'SF Mono', Menlo, monospace; }
  /* draggable numeric cells (no spinner — type=text) */
  .fn-prow input.num { font-family: 'SF Mono', Menlo, monospace; text-align: right; cursor: ew-resize; background: #fafaff; }
  .fn-del { display: inline-flex; align-items: center; justify-content: center; border: 0; background: transparent; cursor: pointer; color: #c4c4d0; padding: 0; }
  .fn-del:hover { color: #cc2222; }
  .fn-add { align-self: flex-start; margin-top: 2px; border: 1px dashed #cfcfe0; background: #fafaff; border-radius: 4px; padding: 2px 8px; cursor: pointer; color: #6a5acd; font: 10px Arial; }
  .fn-acc-hint { font-size: 8px; color: #bbb; text-transform: none; letter-spacing: 0; }
  .fn-expr { font: 11px 'SF Mono', Menlo, monospace; padding: 6px; border: 1px solid #d4d4dc; border-radius: 5px; resize: vertical; line-height: 1.4; width: 100%; box-sizing: border-box; }
  .fn-expr:focus { outline: none; border-color: #6a5acd; }
  /* visual move list */
  .fn-moves { display: flex; flex-direction: column; gap: 2px; }
  .fn-mrow { display: grid; grid-template-columns: 16px 64px 1fr 1fr 20px; gap: 4px; align-items: center; }
  .fn-mrow-h { font-size: 8px; color: #bbb; }
  .fn-mrow-h span { padding-left: 3px; }
  .fn-mnum { font: 9px 'SF Mono', Menlo, monospace; color: #bbb; text-align: right; }
  .fn-mcmd { font: 10px 'SF Mono', Menlo, monospace; padding: 2px 3px; border: 1px solid #dcdce4; border-radius: 4px; background: #fafaff; color: #6a5acd; }
  .fn-marg { font: 10px 'SF Mono', Menlo, monospace; padding: 3px 5px; border: 1px solid #dcdce4; border-radius: 4px; min-width: 0; width: 100%; box-sizing: border-box; }
  .fn-marg:focus { outline: none; border-color: #6a5acd; }
  .fn-marg-na { color: #ccc; text-align: center; }
  .fn-prev { align-items: center; }
  .fn-svg { width: 180px; height: 180px; border: 1px solid #ececf2; border-radius: 6px; background: #fcfcfe; }
  .fn-svg.bad { background: #fff6f6; border-color: #f0caca; }
  .fn-path { fill: rgba(106,90,205,0.16); stroke: #6a5acd; stroke-width: 1.4; stroke-linejoin: round; }
  .fn-axis { stroke: #ccc; stroke-width: 0.7; stroke-dasharray: 3 3; }
  .fn-ok { font-size: 9px; color: #999; }
  .fn-err { font-size: 9px; color: #cc2222; max-width: 180px; max-height: 48px; overflow: hidden; line-height: 1.3; }
  .fn-foot { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding-top: 8px; border-top: 1px solid #ececf2; }
  .fn-saveerr { font-size: 10px; color: #cc2222; flex: 1; }
  .fn-cancel { margin-left: auto; border: 1px solid #d4d4dc; background: #fff; border-radius: 4px; padding: 4px 12px; cursor: pointer; font: 11px Arial; }
  .fn-save { border: 1px solid #5848c2; background: #6a5acd; color: #fff; border-radius: 4px; padding: 4px 14px; cursor: pointer; font: 11px Arial; }
  .fn-save:disabled { opacity: .5; cursor: not-allowed; }
  .fn-saveas { border: 1px solid #c8c2e8; background: #fff; color: #6a5acd; border-radius: 4px; padding: 4px 12px; cursor: pointer; font: 11px Arial; }
  .fn-saveas:disabled { opacity: .5; cursor: not-allowed; }
</style>
