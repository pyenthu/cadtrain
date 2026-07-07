/** Per-subpart render appearance — shared by Manifold parts[], TF recipe, and the scene. */
export interface PartAppearance {
  colorOuter?: string;
  colorInner?: string;
  texture?: string;
  opacity?: number;
  /** MATL preset: 'none' | 'steel' | 'aluminum' | 'titanium' | 'brass' */
  material?: string;
}

/** One part mesh + appearance — the normalized scene contract (TF + Manifold). */
export interface PartMesh {
  geo: import('three').BufferGeometry;
  appearance?: PartAppearance;
  /** Instance name when known (debug / future UI). */
  id?: string;
}
