/**
 * brep-part-colors.test.ts — the BREP color-by-source ASSIGNMENT seam (#86
 * "Phase B" for BREP). Exercises the pure per-part colour assembler WITHOUT
 * OCCT: feed it independently-"meshed" sub-solids (single triangles) carrying
 * distinct source hashIds + a PartColorLUT, and assert each part's triangles
 * take that part's LUT colour — so a multi-part BREP solid renders each part in
 * its own colour (matching the Manifold tab) instead of one uniform skin.
 *
 * The full OCCT executor path (tagInstanceSources → __tag → carryTag → mesh
 * each sub-solid) is covered by the offline parity suite (brep-occt.test.ts);
 * this pins the colour lookup + concatenation that the visual bug was in.
 */
import { describe, it, expect } from 'vitest';
import { assemblePartColorMesh, type BrepSubMesh } from '../brep-occt';
import { brepResponseToGeo } from '../brep-adapter';
import type { PartColorLUT } from '$lib/graph/part-lut-types';

/** '#rrggbb' → [r,g,b] in 0..1 — mirrors brep-occt's cutHexToRgb so the test
 *  computes expected colours the same way the code does (no hardcoded floats). */
function rgb(hex: string): [number, number, number] {
  const v = hex.replace('#', '');
  return [
    parseInt(v.slice(0, 2), 16) / 255,
    parseInt(v.slice(2, 4), 16) / 255,
    parseInt(v.slice(4, 6), 16) / 255,
  ];
}

/** Minimal active PartColorLUT with the given hashId→outer colour map. */
function lutOf(outer: Record<number, string>, bodyColor = '#112233'): PartColorLUT {
  return {
    outer,
    inner: {},
    opacity: {},
    subtractive: [],
    bodyId: null,
    bodyInner: '#888888',
    bodyColor,
    bodyName: null,
    bodyCall: null,
    active: true,
  };
}

/** One unit triangle at height z, tagged with a source hashId. */
function tri(z: number, hashId: number): BrepSubMesh {
  return { vertices: [0, 0, z, 1, 0, z, 0, 1, z], triangles: [0, 1, 2], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], hashId };
}

/** Collect the set of DISTINCT per-vertex RGB triples (rounded) in a colours array. */
function distinctColors(colors: number[]): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i + 2 < colors.length; i += 3) {
    s.add([colors[i], colors[i + 1], colors[i + 2]].map((n) => n.toFixed(4)).join(','));
  }
  return s;
}

const HA = 0x40000001; // two distinct part-band hashIds (see part-id.ts layout)
const HB = 0x4abcdef0;

describe('BREP per-part colour (color-by-source) assembler', () => {
  it('tints EACH sub-solid with its own LUT outer colour → >1 distinct region', () => {
    const lut = lutOf({ [HA]: '#3399ff', [HB]: '#ff9933' });
    const mesh = assemblePartColorMesh([tri(0, HA), tri(2, HB)], lut, 0.05, 7);

    // Two non-indexed triangles → 18 position + 18 colour floats.
    expect(mesh.positions.length).toBe(18);
    expect(mesh.colors!.length).toBe(18);
    expect(mesh.cut).toBe(false);            // uncut → adapter routes to `full`
    expect(mesh.meta.tris).toBe(2);

    // Two distinct colour regions, each == the LUT entry for its part.
    const regions = distinctColors(mesh.colors!);
    expect(regions.size).toBe(2);

    const [ar, ag, ab] = rgb('#3399ff');
    const [br, bg, bb] = rgb('#ff9933');
    // Part A occupies the first triangle (verts 0..8), part B the second (9..17).
    expect(mesh.colors!.slice(0, 3)).toEqual([ar, ag, ab]);
    expect(mesh.colors!.slice(9, 12)).toEqual([br, bg, bb]);
    // Every vertex of a part carries that part's colour (uniform within a part).
    for (let i = 0; i < 9; i += 3) expect(mesh.colors!.slice(i, i + 3)).toEqual([ar, ag, ab]);
    for (let i = 9; i < 18; i += 3) expect(mesh.colors!.slice(i, i + 3)).toEqual([br, bg, bb]);
  });

  it('matches the MF LUT hex EXACTLY (same part → same colour across tabs)', () => {
    // The colour a part gets in BREP is cutHexToRgb(lut.outer[hashId]) — the SAME
    // value the Manifold render-helpers.hexToRgb produces for that hex.
    const hex = '#7ac943';
    const lut = lutOf({ [HA]: hex });
    const mesh = assemblePartColorMesh([tri(0, HA)], lut);
    expect(mesh.colors!.slice(0, 3)).toEqual(rgb(hex));
  });

  it('falls back to the body colour when a part is not in the LUT (uniform)', () => {
    // hashId present but not keyed in `outer` → bodyColor, so an un-keyed part
    // is not left uncoloured.
    const lut = lutOf({}, '#445566');
    const mesh = assemblePartColorMesh([tri(0, HA), tri(2, HB)], lut);
    const regions = distinctColors(mesh.colors!);
    expect(regions.size).toBe(1);                       // one uniform region
    expect(mesh.colors!.slice(0, 3)).toEqual(rgb('#445566'));
  });

  it('empty / colourless LUT → uniform legacy fallback, unchanged', () => {
    // No outer entries AND no bodyColor → the legacy BREP red on every vertex
    // (byte-identical to the pre-#86 uniform look). bodyColor '' forces the
    // legacy branch in partColorRgb.
    const lut = lutOf({}, '');
    const mesh = assemblePartColorMesh([tri(0, HA), tri(2, HB)], lut);
    const regions = distinctColors(mesh.colors!);
    expect(regions.size).toBe(1);
    expect(mesh.colors!.slice(0, 3)).toEqual([0.8, 0.06, 0.06]); // LEGACY_CUT_OUTER
  });

  it('routes an UNCUT coloured per-part mesh to { full } (not cutVC)', () => {
    // The bug: keying the adapter on colour-presence sent the coloured full mesh
    // to cutVC (shown only under cross-section). It must route on data.cut.
    const lut = lutOf({ [HA]: '#3399ff', [HB]: '#ff9933' });
    const mesh = assemblePartColorMesh([tri(0, HA), tri(2, HB)], lut);
    const geo = brepResponseToGeo({ supported: true, ...mesh });
    expect(geo.full).toBeTruthy();
    expect(geo.cutVC).toBeUndefined();
    expect(geo.full!.getAttribute('color')).toBeTruthy();   // vertex colours survive into `full`
  });

  it('carries normals only when EVERY sub-solid supplies them', () => {
    const lut = lutOf({ [HA]: '#3399ff', [HB]: '#ff9933' });
    const withN = assemblePartColorMesh([tri(0, HA), tri(2, HB)], lut);
    expect(withN.normals!.length).toBe(18);
    const a = tri(0, HA); const b = tri(2, HB); delete b.normals;
    const mixed = assemblePartColorMesh([a, b], lut);
    expect(mixed.normals).toBeUndefined();              // one part lacks normals → drop all (adapter recomputes)
  });
});
