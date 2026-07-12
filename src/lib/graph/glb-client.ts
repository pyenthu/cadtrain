/**
 * glb-client.ts — export baked geometry to GLB **in the browser**.
 *
 * Replaces the `/api/primitives/bake-preview` round-trip for the GLB tab. That
 * endpoint ran a second, independent Manifold bake on the server: Manifold's
 * API is synchronous and Node has one thread, so opening the GLB tab on a big
 * part stalled every route until it finished — the same wedge the main canvas
 * just stopped causing. The mesh is already sitting in the client after the
 * MF_CLIENT worker bake, so there is nothing to ask the server for.
 *
 * WHAT CHANGED vs the server GLB. The server split the mesh by vertex colour
 * into an `outer` + `inner` mesh and gave each a PBR material (gltf-transform).
 * Here we already have `parts[]` — the real per-subpart meshes with their own
 * `PartAppearance` — so each becomes its own named glTF mesh. That is strictly
 * closer to the source model: a downloaded well opens in Blender as 16 named
 * elements, not one merged blob split by colour.
 *
 * VERTEX COLOURS — emitted only when the part actually HAS a colour source (an
 * explicit colorOuter/colorInner, or a color-by-source LUT). This matches what
 * the server did: for a plain uncoloured part it wrote positions+normals only,
 * and `PrimitiveDualScene` then dressed the loaded GLB in one uniform lit
 * material (it keys on `geometry.attributes.color`). Emitting COLOR_0
 * unconditionally would repaint every plain part red-outer/grey-bore — a
 * visible change to a downloadable artifact, for no gain.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { PartAppearance } from '$lib/shared/viewer/part-appearance';

/** MATL presets → PBR constants. Mirrors the scene's own material table so a
 *  downloaded GLB shades like the viewport did. Unknown/absent → plain steel-ish
 *  defaults, which is what the untextured viewport shows. */
const MATL: Record<string, { metalness: number; roughness: number }> = {
  steel: { metalness: 0.85, roughness: 0.35 },
  aluminum: { metalness: 0.9, roughness: 0.25 },
  titanium: { metalness: 0.8, roughness: 0.45 },
  brass: { metalness: 0.95, roughness: 0.3 },
};

function materialFor(a: PartAppearance | undefined, hasVertexColors: boolean): THREE.Material {
  const pbr = MATL[a?.material ?? ''] ?? { metalness: 0.6, roughness: 0.4 };
  const opacity = typeof a?.opacity === 'number' ? a.opacity : 1;
  return new THREE.MeshStandardMaterial({
    // With COLOR_0 present, `color` multiplies it — white keeps the baked
    // vertex colours exact. Without it, fall back to the part's outer colour.
    color: hasVertexColors ? 0xffffff : new THREE.Color(a?.colorOuter ?? '#cc2222'),
    vertexColors: hasVertexColors,
    metalness: pbr.metalness,
    roughness: pbr.roughness,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
  });
}

export interface GlbExportInput {
  /** The merged mesh. Used when `parts` is absent or empty. */
  full?: THREE.BufferGeometry | null;
  /** Per-subpart meshes + appearance — preferred; each becomes a named node. */
  parts?: { geo: THREE.BufferGeometry; appearance?: PartAppearance; id?: string }[] | null;
  /** Root node name — becomes the scene/object name in the .glb. */
  name: string;
  /** Does the part have a real colour source (explicit colours / a color-by-
   *  source LUT)? False ⇒ strip COLOR_0 so the viewer dresses it uniformly,
   *  reproducing the old server GLB. See the module header. */
  coloured?: boolean;
}

/** A view of `g` without its `color` attribute. Never mutates `g` — the same
 *  BufferGeometry is live in the scene and in the bake cache. */
function withoutVertexColors(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!g.getAttribute('color')) return g;
  const c = g.clone();
  c.deleteAttribute('color');
  return c;
}

/** Build the GLB bytes for the given baked geometry. Throws if there is nothing
 *  to export, so the caller surfaces a real error rather than a 0-byte download. */
export async function exportGlbClient(input: GlbExportInput): Promise<ArrayBuffer> {
  const root = new THREE.Group();
  root.name = input.name;

  const keepVC = input.coloured === true;
  const prep = (g: THREE.BufferGeometry) => (keepVC ? g : withoutVertexColors(g));

  // Explode into named per-part meshes ONLY when every part actually carries its
  // own vertex colours. `finalizeManifold`'s `parts[]` sometimes ships geometry
  // with no `color` attribute (the colour lives only on the merged `full`), and
  // the viewer keys its material purely on `geometry.attributes.color` — it
  // ignores the glTF material we write. Exporting colourless parts therefore
  // painted a steel-blue collar bright red. When in doubt, ship `full`: that is
  // one mesh with the right colours, exactly what the server GLB was.
  const allParts = (input.parts ?? []).filter((p) => p?.geo);
  const partsCarryColour = allParts.length > 0 && allParts.every((p) => !!p.geo.getAttribute('color'));
  const parts = (keepVC && !partsCarryColour) ? [] : allParts;

  if (parts.length > 0) {
    parts.forEach((p, i) => {
      const g = prep(p.geo);
      const mesh = new THREE.Mesh(g, materialFor(p.appearance, !!g.getAttribute('color')));
      mesh.name = p.id || `${input.name}_part_${i}`;
      root.add(mesh);
    });
  } else if (input.full && input.full.getAttribute('position')) {
    const g = prep(input.full);
    const mesh = new THREE.Mesh(g, materialFor(undefined, !!g.getAttribute('color')));
    mesh.name = input.name;
    root.add(mesh);
  } else {
    throw new Error('nothing to export — bake the part first');
  }

  const exporter = new GLTFExporter();
  const out = await exporter.parseAsync(root, { binary: true });
  if (!(out instanceof ArrayBuffer)) throw new Error('GLTFExporter did not return binary GLB');
  return out;
}
