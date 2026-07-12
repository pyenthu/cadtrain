/**
 * Per-triangle alpha partition for the "opaque + transparent in ONE mesh" trap.
 *
 * A composed assembly (e.g. a well) bakes ONE vertex-coloured mesh via the
 * colour-by-source path (`colorBySourceGeo` in `render-helpers.ts`). When any
 * subpart is transparent the colour attribute is RGBA (itemSize 4) and carries
 * a per-triangle alpha. If the WHOLE mesh then wears one `transparent:true` +
 * `depthWrite:false` material, the OPAQUE subparts (casing/cement/tubing, alpha
 * ≈ 1) also render with depth-writes off → they stop occluding → they look
 * see-through.
 *
 * The fix is to split the draw into two groups by per-triangle alpha and give
 * the mesh a 2-material array (0 = opaque/depthWrite, 1 = transparent/blend).
 * This pure helper does the classification + index reorder; the THREE wiring
 * lives in `PrimitiveDualScene.svelte`.
 *
 * The colour-by-source bake writes ONE alpha per triangle (all three corners
 * identical), so the "all 3 corners ≥ threshold" test is exact; the threshold
 * still guards against float drift and near-opaque (≈0.996) subparts.
 */

/** A corner alpha at or above this counts as opaque (guards float drift). */
export const OPAQUE_ALPHA_EPS = 0.996;

export interface TriAlphaPartition {
  /** true ONLY when BOTH opaque and transparent triangles exist (the mixed
   *  case that needs the 2-group split). A fully-opaque or fully-transparent
   *  mesh returns false → the caller keeps its single-material path. */
  mixed: boolean;
  /** Reordered vertex-index buffer: all opaque triangles first, then all
   *  transparent ones. Use it as the geometry index; group 0 = [0,opaqueCount),
   *  group 1 = [opaqueCount, opaqueCount+transparentCount). */
  order: Uint32Array;
  /** Number of vertex-INDICES in the opaque group (opaque-tri-count × 3). */
  opaqueCount: number;
  /** Number of vertex-INDICES in the transparent group (transparent-tri × 3). */
  transparentCount: number;
}

/**
 * Partition a mesh's triangles into opaque (all 3 corner alphas ≥ threshold)
 * and transparent (any corner alpha < threshold) sets, returning a reordered
 * index buffer (opaque first) plus the two group lengths.
 *
 * @param colors      RGBA vertex-colour array, itemSize 4 (length = vertexCount*4).
 * @param index       existing geometry index (length = triCount*3), or `null`
 *                    for a NON-INDEXED mesh (triangle t uses verts 3t,3t+1,3t+2 —
 *                    which is how `colorBySourceGeo` emits it).
 * @param vertexCount vertex count (= colors.length / 4).
 * @param threshold   opaque cutoff (default {@link OPAQUE_ALPHA_EPS}).
 */
export function partitionTrianglesByAlpha(
  colors: ArrayLike<number>,
  index: ArrayLike<number> | null,
  vertexCount: number,
  threshold: number = OPAQUE_ALPHA_EPS,
): TriAlphaPartition {
  const triCount = index ? Math.floor(index.length / 3) : Math.floor(vertexCount / 3);
  const cornerAlpha = (vi: number): number => colors[vi * 4 + 3] ?? 0;
  const vertOf = (t: number, c: number): number => (index ? index[t * 3 + c] ?? 0 : t * 3 + c);

  const opaque: number[] = []; // triangle indices
  const transparent: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const isOpaque =
      cornerAlpha(vertOf(t, 0)) >= threshold &&
      cornerAlpha(vertOf(t, 1)) >= threshold &&
      cornerAlpha(vertOf(t, 2)) >= threshold;
    (isOpaque ? opaque : transparent).push(t);
  }

  const order = new Uint32Array(triCount * 3);
  let w = 0;
  const emit = (t: number) => {
    order[w++] = vertOf(t, 0);
    order[w++] = vertOf(t, 1);
    order[w++] = vertOf(t, 2);
  };
  for (const t of opaque) emit(t);
  for (const t of transparent) emit(t);

  return {
    mixed: opaque.length > 0 && transparent.length > 0,
    order,
    opaqueCount: opaque.length * 3,
    transparentCount: transparent.length * 3,
  };
}
