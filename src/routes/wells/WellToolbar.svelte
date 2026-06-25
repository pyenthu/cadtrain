<script lang="ts">
  /**
   * Well-schematic EDITOR toolbar — a thin vertical icon rail on the far-left
   * edge, mimicking SVTC's `WsonToolbar.svelte` (icon buttons + active
   * highlight + hover tooltip), re-skinned for cadtrain's dark rail.
   *
   * SCAFFOLD (W1): each button only sets the active placement tool (`active`,
   * a bindable prop) and highlights it. Actual placement logic — dropping a
   * component onto the survey by depth + baking its `g_*` part — is future
   * work (see docs/plans/well-schematic.md, registry.ts). The tool ids line up
   * with `WellCompCategory` so the future placer can dispatch straight off them.
   *
   * Z-down convention applies downstream: a placed component's `top` is the
   * LOWER z (memory: top = lower z).
   */
  let { active = $bindable('select') }: { active?: string } = $props();

  type Tool = { id: string; label: string; tip: string; icon: string };

  // Placement tools — grouped: pointer · tubulars · completion components ·
  // perforation · survey/measure. Icons are inline 16×16 stroke paths.
  const SELECT: Tool[] = [
    { id: 'select', label: 'Select', tip: 'Select / move (V)',
      icon: 'M3 2l10 5-4 1.6L7.7 13z' },
  ];
  const TUBULARS: Tool[] = [
    { id: 'casing', label: 'Casing', tip: 'Casing string',
      icon: 'M5 2v12M11 2v12' },
    { id: 'liner', label: 'Liner', tip: 'Liner (hung string)',
      icon: 'M5 6v8M11 6v8M4 6h3M9 6h3' },
    { id: 'tubing', label: 'Tubing', tip: 'Production tubing',
      icon: 'M6.5 2v12M9.5 2v12' },
  ];
  const COMPONENTS: Tool[] = [
    { id: 'packer', label: 'Packer', tip: 'Packer (sets/isolates)',
      icon: 'M6 2v12M10 2v12M3 6.5h3M3 9.5h3M10 6.5h3M10 9.5h3' },
    { id: 'nipple', label: 'Nipple / SSD', tip: 'Landing nipple / sliding sleeve',
      icon: 'M6 2v12M10 2v12M6 6h4M6 10h4' },
    { id: 'plug', label: 'Plug', tip: 'Plug / bridge plug',
      icon: 'M4 6h8v4H4zM6 6V4M10 6V4' },
  ];
  const SUBSURF: Tool[] = [
    { id: 'perforation', label: 'Perforation', tip: 'Perforation interval',
      icon: 'M6 2v12M10 2v12M3 5h3M3 8h3M3 11h3M10 5h3M10 8h3M10 11h3' },
    { id: 'survey', label: 'Survey', tip: 'Survey / deviation station',
      icon: 'M8 1.5v3M8 11.5v3 M2.5 8h3M10.5 8h3 M8 8L4 4' },
    { id: 'measure', label: 'Measure', tip: 'Measure depth (MD)',
      icon: 'M3 3v10h2M3 5h2M3 7h3M3 9h2M3 11h2' },
  ];
  const GROUPS = [SELECT, TUBULARS, COMPONENTS, SUBSURF];

  function pick(id: string) {
    active = id;
    // TODO (W1): dispatch placement mode — drop the resolved g_* part onto the
    // survey by depth + bake. For now this is a no-op scaffold.
  }
</script>

<div class="well-toolbar" role="toolbar" aria-label="Well-schematic tools" aria-orientation="vertical">
  {#each GROUPS as group, gi}
    {#if gi > 0}<div class="tb-sep"></div>{/if}
    {#each group as t (t.id)}
      <div class="tb-item">
        <button
          class="tb-btn"
          class:tb-active={active === t.id}
          aria-pressed={active === t.id}
          aria-label={t.label}
          onclick={() => pick(t.id)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d={t.icon} />
          </svg>
        </button>
        <span class="tb-tip">{t.tip}</span>
      </div>
    {/each}
  {/each}
</div>

<style>
  .well-toolbar {
    width: 38px;
    flex: none;
    background: #16161f;
    border-right: 1px solid #2a2a3e;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 2px;
    overflow: visible;
  }
  .tb-item { position: relative; display: flex; }
  .tb-btn {
    background: none;
    border: 1px solid transparent;
    color: #8a8aa0;
    width: 30px;
    height: 30px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }
  .tb-btn:hover { background: #24243a; color: #d8d8ef; }
  .tb-btn.tb-active {
    background: #2a2a48;
    border-color: #cc2222;
    color: #ff6a6a;
  }
  .tb-sep { width: 22px; height: 1px; background: #2a2a3e; margin: 3px 0; }

  /* Tooltip — appears to the right on hover (SVTC-style). */
  .tb-tip {
    position: absolute;
    left: calc(100% + 8px);
    top: 50%;
    transform: translate(-4px, -50%);
    padding: 5px 9px;
    background: rgba(10, 10, 18, 0.95);
    border: 1px solid #2a2a3e;
    color: #e8e8ef;
    border-radius: 5px;
    white-space: nowrap;
    font: 11px ui-monospace, monospace;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: opacity 0.12s ease, transform 0.12s ease;
    z-index: 100;
  }
  .tb-item:hover .tb-tip {
    opacity: 1;
    visibility: visible;
    transform: translate(0, -50%);
  }
</style>
