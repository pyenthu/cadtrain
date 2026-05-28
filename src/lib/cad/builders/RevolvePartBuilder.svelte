<script lang="ts">
  /**
   * RevolvePartBuilder — editor for `<id>.rev.ts` Profile (Revolve) Parts.
   *
   * Mirror of ExtrudePartBuilder for the revolve case. Same flex 2-pane
   * layout with drag-resizable splitter, embedded ProfileFnEditor in revolve
   * mode, 2D (r,z) SVG overlay anchored top-left of the 3D scene. Splitter
   * position persists in localStorage. Canvas pane defaults to 33% width.
   */
  import { onMount } from 'svelte';
  import ProfileFnEditor from '$lib/shared/ProfileFnEditor.svelte';
  import { findProfileSlots, spliceSlot } from '$lib/cad/inline-profile';
  import PrimitiveDualCanvas from '$lib/shared/PrimitiveDualCanvas.svelte';

  interface Props {
    id: string;
    name?: string;
    description?: string;
    source: string;
    args: (number | string)[];
    paramSchema?: Record<string, any>;
    onSourceChange?: (newSource: string) => void;
    dirty?: boolean;
    onSaveRequest?: () => void;
  }
  let { id, name = id, description = '', source = $bindable(), args, paramSchema = {}, onSourceChange, dirty = false, onSaveRequest }: Props = $props();

  const slots = $derived(findProfileSlots(source));
  const primary = $derived(slots[0] ?? null);

  function handleBodyChange(newBody: string) {
    if (!primary) return;
    const updated = spliceSlot(source, primary, newBody);
    if (updated === source) return;
    source = updated;
    onSourceChange?.(updated);
  }

  let view = $state<{ d: string; vb: string; axis: number | null; y0: number; y1: number }>({ d: '', vb: '0 0 100 100', axis: null, y0: 0, y1: 0 });

  const STORAGE_KEY = 'rev-builder-canvas-pct';
  let canvasPct = $state(33);
  onMount(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (saved >= 15 && saved <= 75) canvasPct = saved;
  });
  $effect(() => { try { localStorage.setItem(STORAGE_KEY, String(canvasPct)); } catch { /* ignore */ } });

  let root: HTMLDivElement | undefined = $state();
  let resizing = $state(false);
  function startResize(ev: PointerEvent) {
    if (!root) return;
    ev.preventDefault();
    resizing = true;
    const rect = root.getBoundingClientRect();
    const onMove = (e: PointerEvent) => {
      const fromRight = rect.right - e.clientX;
      const pct = Math.max(15, Math.min(75, (fromRight / rect.width) * 100));
      canvasPct = pct;
    };
    const onUp = () => {
      resizing = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }
</script>

<div class="rev-builder" class:resizing bind:this={root} style="--canvas-pct: {canvasPct}%;">
  <div class="rev-left">
    {#if primary}
      <ProfileFnEditor
        set="revolve"
        embedded
        seed={{ id, label: name, description, body: primary.body, params: paramSchema }}
        {id}
        label={name}
        {description}
        onSaved={() => {}}
        onClose={() => {}}
        onBodyChange={handleBodyChange}
        onSave={onSaveRequest}
        onView={(v) => (view = v)}
        {dirty}
        fill
      />
    {:else}
      <div class="rev-empty">
        <p>No inline <code>profile_pts</code> slot found in this part's source.</p>
      </div>
    {/if}
  </div>

  <div class="rev-split" role="separator" aria-orientation="vertical"
    title="Drag to resize · double-click to reset"
    onpointerdown={startResize}
    ondblclick={() => (canvasPct = 33)}
  ></div>

  <div class="rev-right">
    <PrimitiveDualCanvas {id} {name} {description} {args} {source} showControls={false} showLabels={false} />
    {#if view.d}
      <div class="rev-svg-overlay" aria-hidden="true">
        <svg viewBox={view.vb} preserveAspectRatio="xMidYMid meet">
          {#if view.axis !== null}<line x1={view.axis} y1={view.y0} x2={view.axis} y2={view.y1} class="rev-svg-axis" vector-effect="non-scaling-stroke" />{/if}
          <path d={view.d} class="rev-svg-path" vector-effect="non-scaling-stroke" />
        </svg>
      </div>
    {/if}
  </div>
</div>

<style>
  .rev-builder { display: grid; grid-template-columns: 1fr 6px var(--canvas-pct); gap: 0; height: 100%; min-height: 0; }
  .rev-builder.resizing { cursor: col-resize; user-select: none; }
  .rev-left { min-width: 0; min-height: 0; display: flex; }
  .rev-right { position: relative; min-width: 0; min-height: 0; display: flex; }
  .rev-split { cursor: col-resize; background: transparent; transition: background 0.15s; position: relative; }
  .rev-split::after { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; transform: translateX(-50%); background: #ddd; }
  .rev-split:hover { background: rgba(204, 34, 34, 0.08); }
  .rev-split:hover::after { background: #cc2222; width: 2px; }
  .rev-builder.resizing .rev-split::after { background: #cc2222; width: 2px; }
  .rev-empty { padding: 20px; color: #888; font: 12px Arial; }
  .rev-empty code { background: #f4f4f4; padding: 1px 4px; border-radius: 3px; font-family: ui-monospace, Menlo, monospace; }
  .rev-svg-overlay { position: absolute; left: 8px; top: 8px; width: 140px; height: 140px; background: rgba(255, 255, 255, 0.88); border: 1px solid #e8d5d2; border-radius: 6px; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08); padding: 6px; pointer-events: none; z-index: 10; }
  .rev-svg-overlay svg { width: 100%; height: 100%; display: block; }
  .rev-svg-path { fill: none; stroke: #cc2222; stroke-width: 1.4; }
  .rev-svg-axis { stroke: #999; stroke-width: 0.8; stroke-dasharray: 2 2; }
  @media (max-width: 720px) {
    .rev-builder { grid-template-columns: 1fr; grid-template-rows: 1fr 6px var(--canvas-pct); }
    .rev-split { cursor: row-resize; }
    .rev-split::after { left: 0; right: 0; top: 50%; bottom: auto; width: auto; height: 1px; transform: translateY(-50%); }
  }
</style>
