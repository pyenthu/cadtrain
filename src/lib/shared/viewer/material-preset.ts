/**
 * material-preset — maps the PROPERTIES-tab MATL preset name
 * ('none' | 'steel' | 'aluminum' | 'titanium' | 'brass') to PBR render params
 * for the THREE `MeshStandardMaterial`: `metalness`, `roughness`, and an
 * optional metallic tint `color`.
 *
 * WHY: `graph.material` (the "Phong preset" on MaterialNode / the graph) was
 * stored + emitted to `meta.material` but NEVER reached the live render — every
 * `MeshStandardMaterial` arm in `PrimitiveDualScene` hardcoded
 * `metalness={0} roughness={0.5}`, so picking "steel" changed nothing visible.
 * On the Manifold tab the part still read as its baked vertex colour; on the TF
 * tab (no baked vertex colours) it fell back to the `#cc2222` red default — the
 * "flat red" symptom. This table is the single source of truth so the preset
 * lands identically wherever a mesh is shaded.
 *
 * INVARIANT — 'none' / undefined / unknown MUST return { metalness: 0,
 * roughness: 0.5, color: undefined }, i.e. byte-identical to the pre-existing
 * hardcoded material. That keeps every part that does NOT set a preset (the
 * default — all current parts) rendering exactly as before, so threading this
 * in is purely additive (the Manifold/BREP paths, which never pass a preset,
 * are unchanged).
 *
 * `color` is a metallic tint used ONLY on the non-vertex-coloured fallback arm
 * (the TF single mesh, whose `tfMeshToGeo` emits position+normal only). A
 * vertex-coloured mesh (Manifold/BREP `full`) ignores it (keeps its baked
 * colour); an explicit `colorOuter` override always wins over the tint.
 */

export interface MaterialPreset {
  /** THREE MeshStandardMaterial.metalness (0..1). */
  metalness: number;
  /** THREE MeshStandardMaterial.roughness (0..1). */
  roughness: number;
  /** Metallic tint hex, applied only when there is no baked vertex colour and
   *  no explicit colorOuter override. undefined ⇒ keep the caller's fallback. */
  color?: string;
}

/** The neutral default — identical to the historical hardcoded material. */
const NONE: MaterialPreset = { metalness: 0, roughness: 0.5, color: undefined };

const PRESETS: Record<string, MaterialPreset> = {
  none: NONE,
  // ── metals (shiny, low roughness, metallic tint) ──
  // cool blue-grey brushed steel
  steel: { metalness: 0.85, roughness: 0.35, color: '#8a929c' },
  // light silver
  aluminum: { metalness: 0.9, roughness: 0.45, color: '#cbced2' },
  // warm grey
  titanium: { metalness: 0.72, roughness: 0.42, color: '#a9a5a0' },
  // brass yellow
  brass: { metalness: 0.82, roughness: 0.3, color: '#b08d2e' },
  // ── geology / downhole (non-metallic, HIGH roughness → matte) ──
  // sandy tan, very matte
  sandstone: { metalness: 0, roughness: 0.92, color: '#c9a877' },
  // pale buff limestone
  limestone: { metalness: 0, roughness: 0.86, color: '#ddd6c4' },
  // dark grey-green shale
  shale: { metalness: 0.05, roughness: 0.78, color: '#5f655f' },
  // light greyish-brown cement, chalky-matte (lighter · browner · greyer · rougher, user 2026-07-21)
  cement: { metalness: 0, roughness: 1, color: '#c8bfb0' },
  // brown drilling mud, slightly wet/glossy
  mud: { metalness: 0.12, roughness: 0.6, color: '#6e5b41' },
};

/** Resolve a preset name to its PBR params. Unknown / empty / 'none' /
 *  undefined ⇒ the neutral default (byte-identical to the old hardcoded
 *  material). */
export function materialPreset(name?: string | null): MaterialPreset {
  if (!name) return NONE;
  return PRESETS[name] ?? NONE;
}

/** The preset names offered in the UI (mirrors PropertiesCard / MaterialEditorPopover). */
export const MATERIAL_PRESET_NAMES = ['none', 'steel', 'aluminum', 'titanium', 'brass', 'sandstone', 'limestone', 'shale', 'cement', 'mud'] as const;
