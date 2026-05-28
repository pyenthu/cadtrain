<script lang="ts">
  /**
   * ExtrudePartBuilder — the editor for a `<id>.exp.ts` Extrude Part.
   *
   * Dispatched from PrimitiveView when the part's file kind is `exp`. Embeds
   * ProfileFnEditor in CARTESIAN mode pointing at the part's inline
   * `profile_pts` slot, with the part's params + dual-canvas preview on the
   * side. Two-way binding: editor `onBodyChange` splices the new body back
   * into the part source, and the host saves on demand.
   *
   * Layout: a 2-column responsive grid — left half is the embedded editor
   * (expressions + 2D SVG), right half is the dual canvas (live mesh + GLB).
   * Below 720px the columns stack.
   */
  import ProfileFnEditor from '$lib/shared/ProfileFnEditor.svelte';
  import { findProfileSlots, spliceSlot } from '$lib/cad/inline-profile';
  import PrimitiveDualCanvas from '$lib/shared/PrimitiveDualCanvas.svelte';

  interface Props {
    id: string;
    name?: string;
    description?: string;
    /** Part's full source text — read for slots, written on profile-body edits. */
    source: string;
    /** Positional argument values for the part's function (in meta.params order). */
    args: (number | string)[];
    /** Called when the user edits the profile, with the updated full source. */
    onSourceChange?: (newSource: string) => void;
    /** Dirty signal from the host (PrimitiveView) — true when editedSource
     *  differs from the last server-saved source. Surfaces the save chip
     *  inside the embedded editor's tab strip. */
    dirty?: boolean;
    /** Save trigger — invoked when the user clicks the save chip. */
    onSaveRequest?: () => void;
  }
  let { id, name = id, description = '', source = $bindable(), args, onSourceChange, dirty = false, onSaveRequest }: Props = $props();

  // Resolve the FIRST inline-profile slot (most extrude parts have just one;
  // 2D-CSG parts like r_plate_with_bore can have two — extension follow-up).
  const slots = $derived(findProfileSlots(source));
  const primary = $derived(slots[0] ?? null);

  function handleBodyChange(newBody: string) {
    if (!primary) return;
    const updated = spliceSlot(source, primary, newBody);
    if (updated === source) return;
    source = updated;
    onSourceChange?.(updated);
  }
</script>

<div class="ext-builder">
  <div class="ext-left">
    {#if primary}
      <ProfileFnEditor
        set="cartesian"
        embedded
        seed={{ id, label: name, description, body: primary.body }}
        {id}
        label={name}
        {description}
        onSaved={() => {}}
        onClose={() => {}}
        onBodyChange={handleBodyChange}
        onSave={onSaveRequest}
        {dirty}
        fill
      />
    {:else}
      <div class="ext-empty">
        <p>No inline <code>profile_pts</code> slot found in this part's source.</p>
        <p class="hint">An Extrude Part needs a <code>const profile_pts = …</code> declaration the editor can two-way bind to.</p>
      </div>
    {/if}
  </div>

  <div class="ext-right">
    <PrimitiveDualCanvas {id} {name} {description} {args} {source} showControls={false} showLabels={false} />
  </div>
</div>

<style>
  .ext-builder {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
    height: 100%;
    min-height: 0;
  }
  .ext-left { min-width: 0; min-height: 0; display: flex; }
  .ext-right { min-width: 0; min-height: 0; display: flex; }
  .ext-empty { padding: 20px; color: #888; font: 12px Arial; }
  .ext-empty code { background: #f4f4f4; padding: 1px 4px; border-radius: 3px; font-family: ui-monospace, Menlo, monospace; }
  .ext-empty .hint { color: #aaa; font-size: 11px; margin-top: 4px; }
  /* Responsive stack — under 720px the two columns become two rows. Echoes
     K.53 (responsive editor layout). */
  @media (max-width: 720px) {
    .ext-builder { grid-template-columns: 1fr; grid-auto-rows: minmax(0, 1fr); }
  }
</style>
