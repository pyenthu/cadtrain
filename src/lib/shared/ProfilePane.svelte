<script lang="ts">
  /**
   * /primitives — PROFILES tab body (Phase 1).
   *
   * Browse + open profiles from `<volume>/primitives/profiles/<id>.{prvl,prex}.ts`
   * as their own tabs alongside parts. This pane is INTENTIONALLY minimal
   * for now — it surfaces the profile's metadata + the build() source +
   * a 2D preview of the resolved points so the user can browse what's on
   * the volume without leaving the editor.
   *
   * Phase 2 will replace this with a 2D-mode `GraphEditorPane` variant:
   * polygon-output sockets, profile-specific node types (Polygon, Mirror,
   * Array, Translate-2D), a 2D (r,z) canvas instead of the 3D bake. The
   * profile chip on a Call arg then becomes a "drill down into this
   * profile's graph" — same editor, different output kind.
   */
  import { onMount } from 'svelte';

  let { id }: { id: string } = $props();

  type Meta = {
    id: string; label?: string; description?: string;
    set: 'revolve' | 'cartesian';
    tags?: string[];
    params?: Record<string, { default?: number; min?: number; max?: number; step?: number }>;
  };

  let meta = $state<Meta | null>(null);
  let source = $state<string>('');
  let loadErr = $state<string | null>(null);
  let loading = $state(true);

  // Resolved [r, z] (revolve) or [x, y] (cartesian) points — what the
  // build() function returns when invoked with the meta's defaults.
  let points = $state<[number, number][]>([]);
  let resolveErr = $state<string | null>(null);

  async function load() {
    loading = true; loadErr = null;
    try {
      const r = await fetch(`/api/primitives/profiles/source?id=${encodeURIComponent(id)}`);
      if (!r.ok) { loadErr = `Source ${r.status}: ${(await r.text()).slice(0, 200)}`; return; }
      const d = await r.json();
      meta = d as Meta;
      source = d.source ?? '';
      await resolvePoints();
    } catch (e: any) {
      loadErr = e?.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  function defaultsOf(params: Meta['params']): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(params ?? {})) out[k] = Number(v?.default ?? 0);
    return out;
  }

  async function resolvePoints() {
    if (!meta) return;
    resolveErr = null;
    try {
      const r = await fetch('/api/primitives/profiles/resolve', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source, params: defaultsOf(meta.params) }),
      });
      if (!r.ok) { resolveErr = `Resolve ${r.status}: ${(await r.text()).slice(0, 200)}`; return; }
      const d = await r.json();
      points = Array.isArray(d.points) ? d.points : [];
    } catch (e: any) { resolveErr = e?.message ?? String(e); }
  }

  onMount(() => { void load(); });

  // Polygon SVG — bbox-fit with 6 % padding. Revolve profiles render the
  // r ≥ 0 half (axis at r=0); cartesian profiles render the centred
  // cross-section. Y flips so positive points up (cartesian) or so z
  // grows downward (revolve, drilling convention).
  const view = $derived.by(() => {
    if (points.length === 0) return null;
    let xs = points.map((p) => p[0]);
    let ys = points.map((p) => p[1]);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const w = Math.max(0.001, xMax - xMin), h = Math.max(0.001, yMax - yMin);
    const pad = Math.max(w, h) * 0.06;
    return {
      vb: `${xMin - pad} ${yMin - pad} ${w + 2 * pad} ${h + 2 * pad}`,
      d: points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z',
      // Y flip rule: revolve uses Z-down (positive y points down on screen,
      // unchanged), cartesian flips so positive Y points up.
      yFlip: meta?.set === 'cartesian',
      axis: meta?.set === 'revolve',
      xMin, yMin, w, h, pad,
    };
  });
</script>

<div class="profile-pane">
  <header class="pp-head">
    <div class="pp-title">
      <span class="pp-glyph">◊</span>
      <h2>{meta?.label || id}</h2>
      <span class="pp-tag">.{meta?.set === 'revolve' ? 'prvl' : 'prex'}</span>
    </div>
    {#if meta?.description}<p class="pp-desc">{meta.description}</p>{/if}
    <div class="pp-phase">
      Phase 1 preview · the 2D-mode graph editor is coming in Phase 2
    </div>
  </header>

  {#if loading}
    <div class="pp-empty">loading…</div>
  {:else if loadErr}
    <div class="pp-err">{loadErr}</div>
  {:else}
    <div class="pp-grid">
      <section class="pp-canvas">
        <div class="pp-canvas-head">2D preview · {points.length} points</div>
        {#if view}
          <svg viewBox={view.vb} preserveAspectRatio="xMidYMid meet"
            xmlns="http://www.w3.org/2000/svg">
            <g transform={view.yFlip ? `scale(1, -1) translate(0, ${-(2 * view.yMin + view.h)})` : ''}>
              {#if view.axis}
                <line x1="0" y1={view.yMin - view.pad} x2="0" y2={view.yMin + view.h + view.pad}
                  stroke="#cbd5e1" stroke-width={Math.max(view.w, view.h) * 0.004}
                  stroke-dasharray={`${Math.max(view.w, view.h) * 0.02} ${Math.max(view.w, view.h) * 0.02}`} />
              {/if}
              <path d={view.d}
                fill="rgba(204, 34, 34, 0.18)"
                stroke="#991b1b"
                stroke-width={Math.max(view.w, view.h) * 0.008}
                stroke-linejoin="round" />
              {#each points as p}
                <circle cx={p[0]} cy={p[1]} r={Math.max(view.w, view.h) * 0.012}
                  fill="#991b1b" />
              {/each}
            </g>
          </svg>
        {:else if resolveErr}
          <div class="pp-err inline">resolve failed: {resolveErr}</div>
        {:else}
          <div class="pp-empty">no points</div>
        {/if}
      </section>

      <section class="pp-meta">
        <div class="pp-meta-head">Metadata</div>
        <dl>
          <dt>id</dt><dd><code>{meta?.id}</code></dd>
          <dt>set</dt><dd>{meta?.set}</dd>
          {#if meta?.tags && meta.tags.length > 0}
            <dt>tags</dt><dd>{meta.tags.join(' · ')}</dd>
          {/if}
          {#if meta?.params && Object.keys(meta.params).length > 0}
            <dt>params</dt>
            <dd class="pp-params">
              {#each Object.entries(meta.params) as [k, v]}
                <div class="pp-param-row">
                  <span class="pp-param-name">{k}</span>
                  <span class="pp-param-default">{v.default ?? 0}</span>
                </div>
              {/each}
            </dd>
          {/if}
        </dl>

        <div class="pp-meta-head">build() source</div>
        <pre class="pp-source">{source || '(no source — built-in profile)'}</pre>
      </section>
    </div>
  {/if}
</div>

<style>
  .profile-pane { display: flex; flex-direction: column; height: 100%; min-height: 0; background: #fafaf9; }
  .pp-head { padding: 12px 18px 8px; border-bottom: 1px solid #e5e7eb; background: #fff; flex: 0 0 auto; }
  .pp-title { display: flex; align-items: center; gap: 8px; }
  .pp-title h2 { margin: 0; font: 700 16px Arial; color: #0c4a6e; }
  .pp-glyph { font: 700 18px Arial; color: #cc2222; }
  .pp-tag { padding: 1px 6px; font: 10px ui-monospace, monospace; background: #fef3c7; color: #92400e; border-radius: 3px; }
  .pp-desc { margin: 4px 0 0; color: #57534e; font: 12px Arial; }
  .pp-phase { margin-top: 6px; font: 11px Arial; color: #78716c; font-style: italic; }
  .pp-grid {
    flex: 1 1 auto; min-height: 0;
    display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 14px; padding: 14px 18px; overflow: auto;
  }
  .pp-canvas {
    display: flex; flex-direction: column; min-height: 0;
    background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px;
  }
  .pp-canvas-head, .pp-meta-head { font: 600 11px Arial; color: #57534e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
  .pp-canvas svg { width: 100%; height: 100%; min-height: 240px; }
  .pp-meta {
    background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px;
    overflow-y: auto;
    display: flex; flex-direction: column; gap: 4px;
  }
  .pp-meta dl { margin: 0 0 12px; display: grid; grid-template-columns: 70px 1fr; gap: 4px 10px; font: 12px Arial; }
  .pp-meta dt { color: #78716c; font-weight: 600; }
  .pp-meta dd { margin: 0; color: #1f2937; }
  .pp-meta code { font: 12px ui-monospace, monospace; }
  .pp-params { display: flex; flex-direction: column; gap: 2px; }
  .pp-param-row { display: flex; justify-content: space-between; padding: 2px 6px; background: #f5f5f4; border-radius: 3px; }
  .pp-param-name { font: 12px ui-monospace, monospace; color: #1f2937; }
  .pp-param-default { font: 12px ui-monospace, monospace; color: #57534e; }
  .pp-source {
    margin: 0; padding: 10px; background: #1e293b; color: #e2e8f0;
    border-radius: 4px; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap; line-height: 1.45;
  }
  .pp-empty { padding: 40px; text-align: center; color: #a8a29e; font: 12px Arial; }
  .pp-err { padding: 12px; background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; border-radius: 4px; font: 12px Arial; margin: 8px 18px; }
  .pp-err.inline { margin: 12px; }
</style>
