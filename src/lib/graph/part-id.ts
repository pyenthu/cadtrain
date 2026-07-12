/**
 * part-id — deterministic per-part Manifold ids for color-by-source.
 *
 * Each named part instance (`const body = r_tube(…)`) is stamped with a
 * `hashId` derived from its NAME. Manifold's mesh relation
 * (`runOriginalID` / `runIndex`) carries that hashId per output triangle
 * through every `.add` / `.subtract` / `.intersect`, so after CSG we can
 * map each triangle back to the part it came from and color it.
 *
 * Why a HASH and not a counter: the id is stable across bakes and needs no
 * client↔server coordination — the same part name always yields the same
 * id. (`id` would collide with "internal diameter" in our part params, so
 * this is `hashId` throughout.)
 *
 * Two constraints on the integer (verified against manifold-3d in
 * scripts/spike_csg_originalid.ts):
 *   1. `runOriginalID` is a Uint32. A product manifold reports
 *      `originalID() === -1` (= 0xFFFFFFFF); never collide with it.
 *   2. Manifold has its own low, auto-incrementing original-id counter
 *      (seen handing out 2,4,11,…). Bias our hashes into a high band the
 *      counter never reaches in a bake, so we need no `reserveIDs`.
 *
 * Layout (uint32):
 *   [0 .. 0x3FFFFFFF]        — Manifold's auto-counter lives down here
 *   [0x40000000 .. 0x7FFFFFFF] — PART hash band (this file)
 *   0xC0000000                — SECTION_ID (the half-cutaway cross-section)
 *   0xFFFFFFFF                — Manifold's "product" sentinel (-1)
 */

/** Reserved id for the half-cutaway cross-section plane (the cut-box tool).
 *  Outside the part-hash band so it's always distinguishable from a part. */
export const SECTION_ID = 0xc0000000;

/** FNV-1a 32-bit hash. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable Manifold originalID for a part NAME, biased into the part band
 *  [0x40000000, 0x7FFFFFFF] (30 bits of hash + the band's high bit). */
export function partHashId(name: string): number {
  return ((fnv1a(name) & 0x3fffffff) | 0x40000000) >>> 0;
}

/**
 * Per-triangle source hashId from a Manifold mesh's relation
 * (`runOriginalID` + `runIndex`). Triangle t belongs to run r where
 * runIndex[r] ≤ 3t < runIndex[r+1], and carries runOriginalID[r].
 * Triangles outside any run (no relation) map to 0. Pure — operates on
 * the plain Mesh object, no Manifold/THREE dependency — so both the live
 * renderer (builder.ts) and the GLB bake (manifold-bake.ts) share it.
 */
export function triSourceIds(mesh: { triVerts: ArrayLike<number>; runOriginalID?: ArrayLike<number>; runIndex?: ArrayLike<number> }): Uint32Array {
  const nt = mesh.triVerts.length / 3;
  const out = new Uint32Array(nt);
  const ro = mesh.runOriginalID;
  const ri = mesh.runIndex;
  if (!ro || !ri) return out;
  for (let r = 0; r < ro.length; r++) {
    const t0 = ri[r] / 3;
    const t1 = (r + 1 < ri.length ? ri[r + 1] : mesh.triVerts.length) / 3;
    for (let t = t0; t < t1; t++) out[t] = ro[r];
  }
  return out;
}
