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
  const DEFAULT_BODY = `const r = p.r ?? 40;\nconst len = p.len ?? 120;\nreturn [[0, 0], [r, 0], [r, len], [0, len]];`;
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

  let id = $state(seed?.id ?? '');
  let label = $state(seed?.label ?? '');
  let tags = $state((seed?.tags ?? []).join(', '));
  let rows = $state<ParamRow[]>(seedRows(seed));
  let body = $state(seed?.body ?? DEFAULT_BODY);
  let previewPts = $state<Pt[]>([]);
  let err = $state<string | null>(null);
  let busy = $state(false);
  let saveErr = $state<string | null>(null);

  const slug = $derived(id.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, ''));
  function composeSource(): string { return `export function build(p) {\n${body}\n}`; }
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

  async function save() {
    saveErr = null;
    if (!slug) { saveErr = 'id required'; return; }
    if (Object.keys(schema()).length === 0) { saveErr = 'add at least one param'; return; }
    busy = true;
    try {
      const r = await fetch('/api/primitives/profiles/save', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: slug, label: label.trim() || slug, set,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
          params: schema(), source: composeSource(),
        }),
      });
      if (r.ok) onSaved(slug);
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
      <div class="fn-meta">
        <label>id <input bind:value={id} placeholder="casing_coupling" spellcheck="false" /></label>
        <label>label <input bind:value={label} placeholder="Casing coupling" /></label>
        <label>tags <input bind:value={tags} placeholder="coupling, casing" /></label>
      </div>
      {#if slug && slug !== id}<div class="fn-slug">saves as <code>{slug}</code></div>{/if}

      <div class="fn-sec">params</div>
      <div class="fn-params">
        <div class="fn-prow fn-prow-h"><span>key</span><span>default</span><span>min</span><span>max</span><span>step</span><span>unit</span><span></span></div>
        {#each rows as row, i (i)}
          <div class="fn-prow">
            <input class="k" bind:value={row.key} placeholder="r" spellcheck="false" />
            <input type="number" bind:value={row.def} />
            <input type="number" bind:value={row.min} />
            <input type="number" bind:value={row.max} />
            <input type="number" bind:value={row.step} />
            <input class="u" bind:value={row.unit} placeholder="mm" />
            <button type="button" class="fn-del" onclick={() => delRow(i)} title="Remove param">✕</button>
          </div>
        {/each}
        <button type="button" class="fn-add" onclick={addRow}>+ param</button>
      </div>

      <div class="fn-sec">build(p) — return [[r, z], …]  ({set === 'revolve' ? 'r ≥ 0 half-section, Z-down' : 'centered cross-section'})</div>
      <textarea class="fn-body" bind:value={body} spellcheck="false" rows="7"></textarea>
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
    <button type="button" class="fn-save" disabled={busy || !!err || !slug} onclick={save}>{busy ? 'Saving…' : 'Save profile'}</button>
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
  .fn-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; }
  .fn-meta label { display: flex; align-items: center; gap: 4px; color: #777; }
  .fn-meta input { flex: 1; min-width: 0; font: 11px Arial; padding: 3px 5px; border: 1px solid #d4d4dc; border-radius: 4px; }
  .fn-slug { font-size: 9px; color: #999; }
  .fn-slug code { color: #6a5acd; }
  .fn-sec { font-size: 9px; color: #999; text-transform: uppercase; letter-spacing: .04em; margin-top: 2px; }
  .fn-params { display: flex; flex-direction: column; gap: 2px; }
  .fn-prow { display: grid; grid-template-columns: 1.3fr 1fr 1fr 1fr 1fr 0.9fr 18px; gap: 3px; align-items: center; }
  .fn-prow-h { font-size: 8px; color: #bbb; }
  .fn-prow-h span { padding-left: 3px; }
  .fn-prow input { font: 10px Arial; padding: 2px 4px; border: 1px solid #dcdce4; border-radius: 3px; min-width: 0; width: 100%; }
  .fn-prow input.k { font-family: 'SF Mono', Menlo, monospace; }
  .fn-del { border: 0; background: transparent; cursor: pointer; color: #ccc; font-size: 10px; padding: 0; }
  .fn-del:hover { color: #cc2222; }
  .fn-add { align-self: flex-start; margin-top: 2px; border: 1px dashed #cfcfe0; background: #fafaff; border-radius: 4px; padding: 2px 8px; cursor: pointer; color: #6a5acd; font: 10px Arial; }
  .fn-body { font: 11px 'SF Mono', Menlo, monospace; padding: 6px; border: 1px solid #d4d4dc; border-radius: 5px; resize: vertical; line-height: 1.4; }
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
</style>
