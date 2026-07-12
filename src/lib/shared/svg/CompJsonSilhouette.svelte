<!--
  CompJsonSilhouette — render a SVTC compjson (DrawingML polyline JSON)
  as an inline SVG silhouette.

  The compjson drawings are half-section views: the LEFT half (x < width/2)
  is the section cut showing bore + internal seats/grooves; the RIGHT
  half (x > width/2) is the outer silhouette. Centerline gap sits in
  the middle. We classify each element by its x-bbox midpoint and
  expose a view-toggle (Both · Section · Outer) so seeds can be reviewed
  with the inner data the original drawing carries — not just the
  outline.

  Spanning elements (rare — usually a bounding box or label line) are
  treated as background and rendered in all modes.

  ref prop is the URL path: "/svtc-compjson/PACKERS.PACKER_BAKER_PERMANENT.json"
-->
<script lang="ts">
  interface Props {
    ref: string;        // /svtc-compjson/<id>.json
    title?: string;     // optional caption above the SVG
    height?: number;    // pixel height (defaults 240)
    initialView?: 'both' | 'section' | 'outer';  // default 'both'
  }
  const { ref, title, height = 240, initialView = 'both' }: Props = $props();

  type View = 'both' | 'section' | 'outer';
  let view: View = $state(initialView);

  interface Doc {
    width: number;
    height: number;
    elements: Array<{ class: 'section' | 'outer' | 'span'; svg: string }>;
    defs: string;
    counts: { section: number; outer: number; span: number };
  }

  let doc   = $state<Doc | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    if (!ref) { doc = null; return; }
    let cancelled = false;
    error = null;
    doc = null;
    (async () => {
      try {
        const res = await fetch(ref);
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const raw = await res.json() as { width: number; height: number; elements: any[] };
        if (cancelled) return;
        if (!raw?.elements?.length || !raw.width || !raw.height) {
          throw new Error('empty / malformed compjson');
        }
        doc = parseDoc(raw);
      } catch (e: any) {
        if (!cancelled) error = e?.message ?? String(e);
      }
    })();
    return () => { cancelled = true; };
  });

  function parseDoc(raw: { width: number; height: number; elements: any[] }): Doc {
    const half = raw.width / 2;
    const defs: string[] = [];
    const elements: Doc['elements'] = [];
    const counts = { section: 0, outer: 0, span: 0 };
    let gc = 0;

    for (const el of raw.elements) {
      if (el.type !== 'freeform' || !Array.isArray(el.points) || !el.points.length) continue;

      // Compute x-bbox to classify.
      let xMin = Infinity, xMax = -Infinity;
      const segs: string[] = [];
      for (const pt of el.points) {
        if (pt.directive === 'close') { segs.push('Z'); continue; }
        const x = pt.x ?? 0, y = pt.y ?? 0;
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        segs.push(`${pt.directive === 'moveTo' ? 'M' : 'L'}${x} ${y}`);
      }
      if (!segs.length || !Number.isFinite(xMin)) continue;

      const midX = (xMin + xMax) / 2;
      const fullSpan = (xMax - xMin) > raw.width * 0.7;   // element covers most of the width
      let cls: 'section' | 'outer' | 'span';
      if (fullSpan)         { cls = 'span'; counts.span++; }
      else if (midX < half) { cls = 'section'; counts.section++; }
      else                  { cls = 'outer'; counts.outer++; }

      // Fill resolution (incl. gradient defs).
      let fillAttr = 'none';
      const fill = el.fill;
      if (fill) {
        if (typeof fill === 'string') fillAttr = fill;
        else if (fill.type === 'solid') fillAttr = fill.color ?? 'none';
        else if (fill.type === 'gradient' && Array.isArray(fill.gstops) && fill.gstops.length) {
          const uid = `cjs_${gc++}`;
          fillAttr = `url(#${uid})`;
          const stops = fill.gstops.map((s: any) =>
            `<stop offset="${s.offset ?? '0%'}" stop-color="${s['stop-color'] ?? '#000'}"/>`,
          ).join('');
          defs.push(`<linearGradient id="${uid}" x1="0%" y1="0%" x2="100%" y2="0%">${stops}</linearGradient>`);
        }
      }
      const sw = Array.isArray(el.strokeWidth) ? el.strokeWidth[0] : (el.strokeWidth ?? 0);
      const stroke = el.stroke ?? 'none';
      const svg = `<path d="${segs.join(' ')}" fill="${fillAttr}" stroke="${stroke}" stroke-width="${sw}" data-cls="${cls}"/>`;
      elements.push({ class: cls, svg });
    }

    return { width: raw.width, height: raw.height, elements, defs: defs.join(''), counts };
  }

  // Build the SVG body for the current view, filtering elements by class.
  let svgBody = $derived(() => {
    if (!doc) return '';
    const paths = doc.elements
      .filter((el) => view === 'both' || el.class === view || el.class === 'span')
      .map((el) => el.svg)
      .join('');
    const guide = view === 'both'
      ? `<line x1="${doc.width / 2}" y1="0" x2="${doc.width / 2}" y2="${doc.height}" stroke="#a8a29e" stroke-width="${doc.width * 0.002}" stroke-dasharray="${doc.width * 0.012} ${doc.width * 0.008}" opacity="0.6"/>`
      : '';
    const defs = doc.defs ? `<defs>${doc.defs}</defs>` : '';
    return defs + paths + guide;
  });
  let viewBox = $derived(doc ? `0 0 ${doc.width} ${doc.height}` : null);
</script>

<div class="silhouette" style:--svg-height="{height}px">
  {#if title || doc}
    <div class="cap-row">
      {#if title}<div class="caption">{title}</div>{/if}
      <span class="spacer"></span>
      {#if doc}
        <div class="counts" title="elements per half — section (left of centerline) · outer (right) · spanning (background)">
          <span class="cnt section">section {doc.counts.section}</span>
          <span class="cnt outer">outer {doc.counts.outer}</span>
          {#if doc.counts.span}<span class="cnt span">span {doc.counts.span}</span>{/if}
        </div>
        <div class="view-toggle" role="tablist" aria-label="view mode">
          <button class="vt-btn" class:active={view === 'both'} type="button" onclick={() => (view = 'both')}>Both</button>
          <button class="vt-btn" class:active={view === 'section'} type="button" onclick={() => (view = 'section')}>Section</button>
          <button class="vt-btn" class:active={view === 'outer'} type="button" onclick={() => (view = 'outer')}>Outer</button>
        </div>
      {/if}
    </div>
  {/if}
  {#if error}
    <div class="error">silhouette: {error}</div>
  {:else if !doc}
    <div class="loading">loading…</div>
  {:else}
    <svg viewBox={viewBox} xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      {@html svgBody()}
    </svg>
  {/if}
</div>

<style>
  .silhouette {
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 4px;
    background: #fafaf9;
    border: 1px solid #e7e5e4;
    border-radius: 6px;
    padding: 8px;
    overflow: hidden;
  }
  .cap-row { display: flex; align-items: center; gap: 8px; }
  .caption {
    font: 600 11px Arial; color: #57534e;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .spacer { flex: 1; }
  .counts { display: flex; gap: 4px; }
  .cnt { padding: 1px 6px; border-radius: 9999px; font: 600 10px Arial; }
  .cnt.section { background: #dbeafe; color: #1e40af; }
  .cnt.outer   { background: #e7e5e4; color: #44403c; }
  .cnt.span    { background: #fef3c7; color: #78350f; }
  .view-toggle { display: inline-flex; border: 1px solid #d6d3d1; border-radius: 4px; overflow: hidden; }
  .vt-btn {
    background: #fafaf9; border: 0; border-right: 1px solid #d6d3d1;
    padding: 2px 8px; font: 600 10px Arial; color: #57534e; cursor: pointer;
  }
  .vt-btn:last-child { border-right: 0; }
  .vt-btn:hover { background: #f5f5f4; }
  .vt-btn.active { background: #1e40af; color: #fff; }
  .silhouette svg {
    width: 100%; height: var(--svg-height); display: block;
  }
  .loading, .error { font: 11px Arial; color: #a8a29e; padding: 12px; text-align: center; }
  .error { color: #b91c1c; }
</style>
