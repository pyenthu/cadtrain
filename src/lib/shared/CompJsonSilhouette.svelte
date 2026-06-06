<!--
  CompJsonSilhouette — render a SVTC compjson (DrawingML polyline JSON)
  as an inline SVG silhouette.

  Used by /vocab to show the 2D vendor reference next to a 3D bake.
  Port of SVTC's TdgApp.svelte::getThumb (lines 154-180), trimmed to
  the path-only renderer (no gradient defs gymnastics beyond what the
  file declares). The compjson schema is:

    { width, height, elements: [{ type:'freeform', fill:{type,color|gstops}, stroke, strokeWidth, points: [{x,y,directive}] }] }

  ref prop is the URL path: "/svtc-compjson/PACKERS.PACKER_BAKER_PERMANENT.json"
-->
<script lang="ts">
  interface Props {
    ref: string;       // /svtc-compjson/<id>.json
    title?: string;    // optional caption above the SVG
    height?: number;   // pixel height of the rendered svg (defaults 240)
  }
  const { ref, title, height = 240 }: Props = $props();

  let svgMarkup = $state<string | null>(null);
  let viewBox   = $state<string | null>(null);
  let error     = $state<string | null>(null);

  $effect(() => {
    if (!ref) { svgMarkup = null; return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(ref);
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const data = await res.json() as { width: number; height: number; elements: any[] };
        if (cancelled) return;
        if (!data?.elements?.length || !data.width || !data.height) {
          throw new Error('empty / malformed compjson');
        }
        const defs: string[] = [];
        const paths: string[] = [];
        let gc = 0;
        for (const el of data.elements) {
          if (el.type !== 'freeform' || !el.points?.length) continue;
          const segs: string[] = [];
          for (const pt of el.points) {
            if (pt.directive === 'close') { segs.push('Z'); continue; }
            segs.push(`${pt.directive === 'moveTo' ? 'M' : 'L'}${pt.x} ${pt.y}`);
          }
          if (!segs.length) continue;

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
          paths.push(`<path d="${segs.join(' ')}" fill="${fillAttr}" stroke="${el.stroke ?? 'none'}" stroke-width="${sw}"/>`);
        }
        viewBox = `0 0 ${data.width} ${data.height}`;
        svgMarkup = (defs.length ? `<defs>${defs.join('')}</defs>` : '') + paths.join('');
      } catch (e: any) {
        if (!cancelled) error = e?.message ?? String(e);
      }
    })();
    return () => { cancelled = true; };
  });
</script>

<div class="silhouette" style:--svg-height="{height}px">
  {#if title}<div class="caption">{title}</div>{/if}
  {#if error}
    <div class="error">silhouette: {error}</div>
  {:else if !svgMarkup}
    <div class="loading">loading…</div>
  {:else}
    <svg viewBox={viewBox} xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      {@html svgMarkup}
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
  .caption {
    font: 600 11px Arial; color: #57534e;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .silhouette svg {
    width: 100%; height: var(--svg-height); display: block;
  }
  .loading, .error { font: 11px Arial; color: #a8a29e; padding: 12px; text-align: center; }
  .error { color: #b91c1c; }
</style>
