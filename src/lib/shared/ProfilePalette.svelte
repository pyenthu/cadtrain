<script lang="ts">
  /**
   * ProfilePalette — searchable grid of profile thumbnails for the profile
   * popup (profile-system.md P2). Merges the built-in PROFILE_REGISTRY with
   * volume-saved profiles (volume shadows built-in on id collision); each card
   * is an SVG silhouette + label + origin badge. Filters by label/tag/id.
   */
  import { PROFILE_REGISTRY, defaultsFor, type ProfileDef, type Pt } from './profile-presets';

  export interface VolProfile {
    id: string; label: string; set: 'cartesian' | 'revolve'; tags?: string[];
    points?: Pt[]; kind?: string; params?: Record<string, number>; hasSource?: boolean;
  }
  interface Entry { id: string; label: string; set: string; tags: string[]; origin: 'builtin' | 'volume'; pts: Pt[]; fn?: boolean; }

  interface Props {
    set: 'cartesian' | 'revolve';
    current?: string;
    volume?: VolProfile[];
    onPick: (id: string, origin: 'builtin' | 'volume') => void;
    /** Edit a volume FUNCTION profile (ƒ) in place — opens ProfileFnEditor
     *  seeded from it (K.22 D edit-existing). Only shown on ƒ entries. */
    onEdit?: (id: string) => void;
    /** 'grid' = always-visible thumbnail grid; 'dropdown' = a searchable
     *  combobox whose menu shows the shape thumbnail next to each option. */
    layout?: 'grid' | 'dropdown';
    /** Fill the host container height (uncapped grid) — for the full-page
     *  profiles route rail, vs the small popup grid. */
    fill?: boolean;
  }
  let { set, current, volume = [], onPick, onEdit, layout = 'grid', fill = false }: Props = $props();
  let filter = $state('');
  let open = $state(false);
  // The menu is body-relative (position:fixed, measured from the combo) so it
  // escapes any overflow:hidden ancestor — e.g. a FloatingPanel title bar.
  let comboEl: HTMLElement | undefined = $state();
  let menuPos = $state({ x: 0, y: 0, w: 0 });
  function openMenu() {
    open = true;
    const r = comboEl?.getBoundingClientRect();
    if (r) menuPos = { x: r.left, y: r.bottom + 2, w: r.width };
  }

  function builtinPts(d: ProfileDef): Pt[] { try { return d.build(defaultsFor(d)); } catch { return []; } }
  function volPts(v: VolProfile): Pt[] {
    if (Array.isArray(v.points)) return v.points;
    if (v.kind && PROFILE_REGISTRY[v.kind]) {
      try { return PROFILE_REGISTRY[v.kind].build({ ...defaultsFor(PROFILE_REGISTRY[v.kind]), ...(v.params ?? {}) }); } catch { return []; }
    }
    return [];
  }

  // Volume shadows built-in on id collision (mirrors primitives shadowing bundles).
  let entries = $derived.by<Entry[]>(() => {
    const volIds = new Set(volume.filter((v) => v.set === set).map((v) => v.id));
    const builtins: Entry[] = Object.values(PROFILE_REGISTRY)
      .filter((d) => d.set === set && !volIds.has(d.id))
      .map((d) => ({ id: d.id, label: d.label, set: d.set, tags: d.tags, origin: 'builtin' as const, pts: builtinPts(d) }));
    const vols: Entry[] = volume.filter((v) => v.set === set)
      .map((v) => ({ id: v.id, label: v.label, set: v.set, tags: v.tags ?? [], origin: 'volume' as const, pts: volPts(v), fn: v.hasSource }));
    return [...vols, ...builtins];
  });
  let shown = $derived.by<Entry[]>(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.id.toLowerCase().includes(q) || e.label.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q)));
  });

  // Polygon → fitted SVG path in a `size`×`size` box. MUST match
  // PrimitiveView.pathFor(). REVOLVE halves are MIRRORED across the r=0 axis
  // (plot +r and −r, r=0 anchored at the icon's horizontal center) so a tube
  // shows its hollow ID gap and a solid fills the bar. Z-DOWN: z increases
  // downward (part top = lower z) → NO vertical flip, so the profile is
  // right-side-up (top at the icon top). Cartesian keeps the +y-up screen flip.
  function thumb(pts: Pt[], revolve: boolean): { d: string; axis: number | null } {
    if (!pts.length) return { d: '', axis: null };
    let poly = pts;
    if (revolve) poly = [...pts, ...[...pts].reverse().map((p) => [-p[0], p[1]] as Pt)];
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = (maxX - minX) || 1, h = (maxY - minY) || 1, size = 40, pad = 4;
    const s = (size - 2 * pad) / Math.max(w, h);
    const ox = pad + (size - 2 * pad - w * s) / 2, oy = pad + (size - 2 * pad - h * s) / 2;
    const sx = (x: number) => ox + (x - minX) * s;
    // Z-down (revolve): no flip. Cartesian: flip y so +y points up on screen.
    const sy = (y: number) => revolve ? oy + (y - minY) * s : size - (oy + (y - minY) * s);
    const d = poly.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`).join(' ') + ' Z';
    return { d, axis: revolve ? sx(0) : null };
  }

  let currentEntry = $derived(entries.find((e) => e.id === current));
  let currentLabel = $derived(currentEntry?.label ?? '');
</script>

{#if layout === 'dropdown'}
  <!-- Searchable combobox: one input; the menu shows each shape's thumbnail as
       you type. Replaces the preset "tabs" + plain <select>. -->
  <div class="pp-combo" bind:this={comboEl}>
    <div class="pp-combo-input" class:sel={!!currentEntry}>
      {#if currentEntry}
        {@const ct = thumb(currentEntry.pts, currentEntry.set === 'revolve')}
        <svg viewBox="0 0 40 40" class="pp-mini">
          {#if ct.axis !== null}<line x1={ct.axis} y1="2" x2={ct.axis} y2="38" class="pp-axis" />{/if}
          <path d={ct.d} class="pp-path" class:vol={currentEntry.origin === 'volume'} />
        </svg>
      {:else}<span class="pp-mini pp-mini-empty">▦</span>{/if}
      <input class="pp-search" placeholder={currentLabel || 'Search profiles…'} bind:value={filter} spellcheck="false"
        onfocus={openMenu} onblur={() => setTimeout(() => (open = false), 150)} />
      <span class="pp-caret">▾</span>
    </div>
    {#if open}
      <div class="pp-menu" style={`left:${menuPos.x}px; top:${menuPos.y}px; width:${menuPos.w}px;`}>
        {#each shown as e (e.origin + ':' + e.id)}
          {@const t = thumb(e.pts, e.set === 'revolve')}
          <div class="pp-optrow" class:sel={e.id === current}>
            <button class="pp-opt" type="button"
              title={`${e.label}${e.tags.length ? ' · ' + e.tags.join(', ') : ''}`}
              onclick={() => { onPick(e.id, e.origin); filter = ''; open = false; }}>
              <svg viewBox="0 0 40 40" class="pp-mini">
                {#if t.axis !== null}<line x1={t.axis} y1="2" x2={t.axis} y2="38" class="pp-axis" />{/if}
                <path d={t.d} class="pp-path" class:vol={e.origin === 'volume'} />
              </svg>
              <span class="pp-opt-lbl">{e.label}</span>
              <span class="pp-badge" class:vol={e.origin === 'volume'}>{e.fn ? 'ƒ' : e.origin === 'volume' ? '◆' : '·'}</span>
            </button>
            {#if e.fn && onEdit}
              <button class="pp-edit" type="button" title="Edit this function profile" onclick={() => { onEdit?.(e.id); filter = ''; open = false; }}>✎</button>
            {/if}
          </div>
        {/each}
        {#if shown.length === 0}<div class="pp-empty">no profiles match “{filter}”</div>{/if}
      </div>
    {/if}
  </div>
{:else}
  <div class="pp-wrap" class:fill>
    <input class="pp-search" placeholder="Search profiles… (label / tag / id)" bind:value={filter} spellcheck="false" />
    <div class="pp-grid" class:fill>
      {#each shown as e (e.origin + ':' + e.id)}
        {@const t = thumb(e.pts, e.set === 'revolve')}
        <button class="pp-card" class:sel={e.id === current} type="button" title={`${e.label}${e.tags.length ? ' · ' + e.tags.join(', ') : ''}`} onclick={() => onPick(e.id, e.origin)}>
          <svg viewBox="0 0 40 40" class="pp-svg">
            {#if t.axis !== null}<line x1={t.axis} y1="2" x2={t.axis} y2="38" class="pp-axis" />{/if}
            <path d={t.d} class="pp-path" class:vol={e.origin === 'volume'} />
          </svg>
          <span class="pp-lbl">{e.label}</span>
          <span class="pp-badge" class:vol={e.origin === 'volume'}>{e.fn ? 'ƒ' : e.origin === 'volume' ? '◆' : '·'}</span>
        </button>
      {/each}
      {#if shown.length === 0}<div class="pp-empty">no profiles match “{filter}”</div>{/if}
    </div>
  </div>
{/if}

<style>
  .pp-wrap { display: flex; flex-direction: column; gap: 6px; }
  .pp-wrap.fill { height: 100%; min-height: 0; }
  .pp-search { font: 11px Arial; padding: 4px 6px; border: 1px solid #d4d4dc; border-radius: 4px; }
  .pp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(60px, 1fr)); gap: 6px; max-height: 168px; overflow-y: auto; padding: 2px; }
  .pp-grid.fill { max-height: none; flex: 1 1 auto; min-height: 0; align-content: start; }
  .pp-card { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px 2px; border: 1px solid #e2e2ea; border-radius: 6px; background: #fff; cursor: pointer; }
  .pp-card:hover { border-color: #2266cc; background: #f5f8fe; }
  .pp-card.sel { border-color: #2266cc; box-shadow: 0 0 0 1px #2266cc inset; }
  .pp-svg { width: 40px; height: 40px; }
  .pp-path { fill: rgba(204,34,34,0.14); stroke: #cc2222; stroke-width: 1.2; stroke-linejoin: round; }
  .pp-path.vol { fill: rgba(106,90,205,0.14); stroke: #6a5acd; }
  .pp-axis { stroke: #bbb; stroke-width: 0.6; stroke-dasharray: 2 2; }
  .pp-lbl { font: 9px Arial; color: #444; text-align: center; line-height: 1.1; max-width: 58px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pp-badge { position: absolute; top: 2px; right: 3px; font: 8px Arial; color: #bbb; }
  .pp-badge.vol { color: #6a5acd; }
  .pp-empty { grid-column: 1 / -1; font: 11px Arial; color: #999; padding: 10px; text-align: center; }

  /* ── Dropdown (combobox) layout ─────────────────────────────────────── */
  .pp-combo { position: relative; }
  .pp-combo-input { display: flex; align-items: center; gap: 4px; border: 1px solid #d4d4dc; border-radius: 5px; padding: 2px 6px 2px 3px; background: #fff; }
  .pp-combo-input.sel { border-color: #c8c8e0; }
  .pp-combo-input .pp-search { flex: 1; min-width: 0; border: 0; padding: 3px 2px; font: 11px Arial; outline: none; }
  .pp-mini { width: 22px; height: 22px; flex: 0 0 auto; }
  .pp-mini-empty { display: inline-flex; align-items: center; justify-content: center; color: #ccc; font-size: 14px; }
  .pp-caret { color: #aaa; font-size: 10px; flex: 0 0 auto; }
  .pp-menu { position: fixed; z-index: 1300; max-height: 240px; overflow-y: auto; background: #fff; border: 1px solid #d0d0da; border-radius: 6px; box-shadow: 0 6px 18px rgba(0,0,0,0.14); padding: 3px; }
  .pp-optrow { display: flex; align-items: center; border-radius: 5px; }
  .pp-optrow:hover { background: #f0f4fb; }
  .pp-optrow.sel { background: #e8effb; box-shadow: 0 0 0 1px #2266cc inset; }
  .pp-opt { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; text-align: left; border: 0; background: transparent; border-radius: 5px; padding: 3px 6px; cursor: pointer; position: relative; }
  .pp-opt-lbl { flex: 1; min-width: 0; font: 11px Arial; color: #333; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pp-opt .pp-badge { position: static; }
  .pp-edit { flex: 0 0 auto; border: 0; background: transparent; cursor: pointer; color: #6a5acd; padding: 2px 7px; font-size: 12px; border-radius: 4px; }
  .pp-edit:hover { color: #4838b0; background: #e3def7; }
</style>
