<script lang="ts">
  /**
   * RevolvePartBuilder — the editor for a `<id>.rev.ts` Profile (Revolve) Part.
   *
   * Mirror of ExtrudePartBuilder for the revolve case. ProfileFnEditor runs in
   * REVOLVE mode (axis-on-left half-section). Two-way bound to the part's
   * inline `profile_pts` slot.
   */
  import ProfileFnEditor from '$lib/shared/ProfileFnEditor.svelte';
  import { findProfileSlots, spliceSlot } from '$lib/cad/inline-profile';
  import PrimitiveDualCanvas from '$lib/shared/PrimitiveDualCanvas.svelte';

  interface Props {
    id: string;
    name?: string;
    description?: string;
    source: string;
    args: (number | string)[];
    onSourceChange?: (newSource: string) => void;
    dirty?: boolean;
    onSaveRequest?: () => void;
  }
  let { id, name = id, description = '', source = $bindable(), args, onSourceChange, dirty = false, onSaveRequest }: Props = $props();

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

<div class="rev-builder">
  <div class="rev-left">
    {#if primary}
      <ProfileFnEditor
        set="revolve"
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
      <div class="rev-empty">
        <p>No inline <code>profile_pts</code> slot found in this part's source.</p>
        <p class="hint">A Profile (Revolve) Part needs a <code>const profile_pts = …</code> declaration the editor can two-way bind to.</p>
      </div>
    {/if}
  </div>

  <div class="rev-right">
    <PrimitiveDualCanvas {id} {name} {description} {args} {source} showControls={false} showLabels={false} />
  </div>
</div>

<style>
  .rev-builder {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
    height: 100%;
    min-height: 0;
  }
  .rev-left { min-width: 0; min-height: 0; display: flex; }
  .rev-right { min-width: 0; min-height: 0; display: flex; }
  .rev-empty { padding: 20px; color: #888; font: 12px Arial; }
  .rev-empty code { background: #f4f4f4; padding: 1px 4px; border-radius: 3px; font-family: ui-monospace, Menlo, monospace; }
  .rev-empty .hint { color: #aaa; font-size: 11px; margin-top: 4px; }
  @media (max-width: 720px) {
    .rev-builder { grid-template-columns: 1fr; grid-auto-rows: minmax(0, 1fr); }
  }
</style>
