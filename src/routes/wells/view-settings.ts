/**
 * view-settings.ts — the SINGLE source of truth for the /wells display state.
 *
 * The control bar (`WellViewControls`), the 3D view (`WellSchematic3D`), the
 * depth ruler (`WellDepthRuler`) and — later — the 2D derived track all read
 * ONE `WellViewSettings` object created in `+page.svelte` and threaded down.
 * Mutating a field (e.g. `settings.diaScale = 8`) propagates via Svelte 5 deep
 * reactivity to every consumer, so nothing drifts out of sync.
 *
 * These map 1:1 onto `WellSchematic3D`'s props (`docs/plans/wells-interface.md`
 * §A) plus a couple of shell-level display flags (`whiteBg`).
 */

export interface WellLayerFlags {
  showOpenHole: boolean;
  showCasing: boolean;
  showCement: boolean;
  showTubing: boolean;
  showCompletions: boolean;
  showPerforations: boolean;
}

export interface WellViewSettings {
  /** Which surface renders. `'2d'` = fast pure-SVG track schematic (DEFAULT —
   *  the #1 perf lever: opening a tab does NO Manifold CSG); `'3d'` = the
   *  Manifold half-section cutaway (lazy-mounted only when first selected). The
   *  3D view embeds the full node-graph editor via the ✎ "edit graph" popover. */
  viewMode: '2d' | '3d';
  /** Per-layer show/hide. */
  layers: WellLayerFlags;
  /** Half-section CSG cutaway. */
  cutaway: boolean;
  /** Cutaway plane rotation (degrees around the wellbore axis). */
  cutAzimuth: number;
  /** Follow the deviation survey (false → straight vertical). */
  directional: boolean;
  /** DTX depth emphasis (expand cluttered zones). */
  dtx: boolean;
  /** Radial exaggeration (inches → scene units). */
  diaScale: number;
  /** Depth stretch applied after DTX. */
  zScale: number;
  /** White schematic background (schematics read best on white). W-D 2D view
   *  will honour this too; today it flags the 3D stage backdrop. */
  whiteBg: boolean;
  /** Side depth ruler + component leader labels. */
  showRuler: boolean;
}

/** Fresh default settings (all layers on, cutaway + survey + DTX on). */
export function defaultViewSettings(): WellViewSettings {
  return {
    viewMode: '2d',
    layers: {
      showOpenHole: true,
      showCasing: true,
      showCement: true,
      showTubing: true,
      showCompletions: true,
      showPerforations: true,
    },
    cutaway: true,
    cutAzimuth: 0,
    directional: true,
    dtx: true,
    diaScale: 6,
    zScale: 1,
    // Schematics read best on white — and the 2D view already forced white
    // regardless of this flag, so a dark 3D stage was the odd one out. The ◻ White
    // pill still toggles it back.
    whiteBg: true,
    showRuler: true,
  };
}
