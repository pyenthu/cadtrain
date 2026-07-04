/**
 * material-textures — NAMED procedural material maps for the primitives render
 * (G-MAT2). Pure, dependency-free (NO image assets): each named texture is a
 * `THREE.DataTexture` whose RGBA pixels are computed procedurally, so the
 * schematic conventions (hatched cement, brushed steel, earthy rock face)
 * render without shipping any binary. Consumed by
 * `PrimitiveDualScene.makeLitMaterial` as a `material.map` — it TINTS with the
 * per-vertex colour-by-source and composes with the opacity path unchanged.
 *
 * Why DataTexture (not CanvasTexture): DataTexture needs no `document` /
 * `<canvas>`, so it is intrinsically SSR-safe AND buildable in the `node`
 * vitest environment (the whole point of the unit test). We still guard the
 * THREE construction in a try/catch and return `undefined` on any failure so a
 * missing/odd runtime never throws — an `undefined` map is byte-identical to
 * the pre-texture render.
 *
 * ONE instance is cached per name (built lazily on first request) — the same
 * texture object is shared by every mesh/pane that asks for it (the live mesh,
 * the baked GLB, and the GPU-instanced path all read the same GPU upload).
 */
import * as THREE from 'three';

/** The named textures this module can build. Anything else ⇒ `undefined`. */
export type MaterialTextureName = 'cement' | 'steel' | 'rock';
export const MATERIAL_TEXTURE_NAMES: readonly MaterialTextureName[] = ['cement', 'steel', 'rock'] as const;

/** Per-name default tiling. Cement/rock read as fine aggregate (denser tile);
 *  steel's brushed striations run ALONG the part (tall repeat on V) so the
 *  vertical grain reads on a long tool. The module has no part-size context, so
 *  these are sensible fixed defaults that tile cleanly at any scale (the caller
 *  may override `.repeat` on the returned texture if it wants size-relative
 *  tiling — the texture is shared, so treat that as a whole-part choice). */
const REPEAT: Record<MaterialTextureName, [number, number]> = {
  cement: [3, 6],
  steel: [1, 8],
  rock: [4, 4],
};

const TEX_SIZE = 256; // power-of-two → clean mipmaps + RepeatWrapping

const cache = new Map<MaterialTextureName, THREE.Texture | undefined>();

/** Cheap deterministic value-noise (no deps): hashes an (x,y) lattice, bilinear
 *  interpolates. Returns 0..1. Seeded so the pattern is stable across builds. */
function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695040) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}
function valueNoise(x: number, y: number, freq: number, seed: number): number {
  const fx = x * freq, fy = y * freq;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const n00 = hash2(x0, y0, seed), n10 = hash2(x0 + 1, y0, seed);
  const n01 = hash2(x0, y0 + 1, seed), n11 = hash2(x0 + 1, y0 + 1, seed);
  const a = n00 + (n10 - n00) * sx;
  const b = n01 + (n11 - n01) * sx;
  return a + (b - a) * sy;
}
/** 3-octave fractal value noise, 0..1. */
function fbm(x: number, y: number, baseFreq: number, seed: number): number {
  let amp = 0.6, freq = baseFreq, sum = 0, norm = 0;
  for (let o = 0; o < 3; o++) {
    sum += valueNoise(x, y, freq, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5; freq *= 2.1;
  }
  return sum / norm;
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/** cement — a pale grey base with darker aggregate speckle PLUS a faint
 *  diagonal hatch (the schematic cement convention). */
function paintCement(data: Uint8Array, size: number): void {
  const period = 18;      // diagonal hatch spacing (px)
  const lineHalf = 1.2;   // hatch line half-width (px)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Base pale concrete grey + coarse aggregate blobs + fine grain.
      const agg = fbm(x, y, 0.09, 11);        // coarse aggregate
      const grain = valueNoise(x, y, 0.9, 23); // fine speckle
      let g = 176 + (agg - 0.5) * 70 + (grain - 0.5) * 26;
      // Faint diagonal hatch: darken pixels near the (x+y) lattice lines.
      const d = ((x + y) % period);
      const dist = Math.min(d, period - d);
      if (dist < lineHalf) g -= 34 * (1 - dist / lineHalf);
      const v = clamp255(g);
      data[i] = v; data[i + 1] = v; data[i + 2] = clamp255(v - 4); data[i + 3] = 255;
    }
  }
}

/** steel — a cool blue-grey with subtle VERTICAL brushed striations (an
 *  anisotropic sheen fake): brightness modulated along X by fine banding +
 *  a little vertical-streak noise so it reads as machined/brushed metal. */
function paintSteel(data: Uint8Array, size: number): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Fine vertical bands (brushed grain) + long vertical streaks.
      const band = Math.sin(x * 0.9) * 10 + Math.sin(x * 0.23 + 1.3) * 6;
      const streak = (valueNoise(x, y * 0.12, 0.5, 7) - 0.5) * 18; // stretched in Y
      const base = 150 + band + streak;
      const r = clamp255(base - 6);
      const g = clamp255(base - 2);
      const b = clamp255(base + 12); // cool bluish tint
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
}

/** rock — an irregular earthy speckle for the open-hole wall: warm tan/brown
 *  fractal noise with scattered darker grit. */
function paintRock(data: Uint8Array, size: number): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = fbm(x, y, 0.05, 31);            // large earthy variation
      const grit = valueNoise(x, y, 1.3, 41);   // fine grit
      const t = n * 0.8 + grit * 0.2;
      // Warm sedimentary palette: tan → brown.
      const r = clamp255(150 + (t - 0.5) * 80);
      const g = clamp255(120 + (t - 0.5) * 70);
      const b = clamp255(88 + (t - 0.5) * 55);
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
}

function build(name: MaterialTextureName): THREE.Texture | undefined {
  try {
    const size = TEX_SIZE;
    const data = new Uint8Array(size * size * 4);
    if (name === 'cement') paintCement(data, size);
    else if (name === 'steel') paintSteel(data, size);
    else paintRock(data, size);
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    const [rx, ry] = REPEAT[name];
    tex.repeat.set(rx, ry);
    // Colour map → sRGB so the per-vertex tint composes correctly. `colorSpace`
    // is a no-op on runtimes that predate it; guarded by the try/catch.
    if ('colorSpace' in tex && (THREE as any).SRGBColorSpace) {
      (tex as any).colorSpace = (THREE as any).SRGBColorSpace;
    }
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  } catch {
    return undefined;
  }
}

/**
 * Return the cached procedural texture for a named material, building it on
 * first request. Unknown / empty / undefined name ⇒ `undefined` (the render
 * then has no `.map` → byte-identical to today). Never throws.
 */
export function getMaterialTexture(name?: string | null): THREE.Texture | undefined {
  if (!name || typeof name !== 'string') return undefined;
  const key = name.trim().toLowerCase();
  if (!MATERIAL_TEXTURE_NAMES.includes(key as MaterialTextureName)) return undefined;
  const k = key as MaterialTextureName;
  if (cache.has(k)) return cache.get(k);
  const tex = build(k);
  cache.set(k, tex); // cache even undefined so a broken runtime doesn't re-try per frame
  return tex;
}

/** Test-only: drop the cache so a fresh build can be asserted. */
export function _resetMaterialTextureCache(): void {
  for (const t of cache.values()) { try { t?.dispose?.(); } catch { /* noop */ } }
  cache.clear();
}
