import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  getMaterialTexture,
  MATERIAL_TEXTURE_NAMES,
  _resetMaterialTextureCache,
} from '../material-textures';

describe('material-textures', () => {
  beforeEach(() => _resetMaterialTextureCache());

  it('builds each named texture as a THREE.Texture with RepeatWrapping + a repeat', () => {
    for (const name of MATERIAL_TEXTURE_NAMES) {
      const tex = getMaterialTexture(name);
      expect(tex, `expected a texture for "${name}"`).toBeTruthy();
      expect(tex).toBeInstanceOf(THREE.Texture);
      expect(tex!.wrapS).toBe(THREE.RepeatWrapping);
      expect(tex!.wrapT).toBe(THREE.RepeatWrapping);
      // A non-degenerate repeat scale was set.
      expect(tex!.repeat.x).toBeGreaterThan(0);
      expect(tex!.repeat.y).toBeGreaterThan(0);
      // Procedurally generated RGBA pixels (no image asset).
      const img: any = (tex as any).image;
      expect(img?.data?.length).toBe(img.width * img.height * 4);
    }
  });

  it('caches ONE instance per name (same object on repeat calls)', () => {
    const a = getMaterialTexture('cement');
    const b = getMaterialTexture('cement');
    expect(a).toBe(b);
    // Different names → different instances.
    expect(getMaterialTexture('steel')).not.toBe(getMaterialTexture('rock'));
  });

  it('returns undefined for an unknown name', () => {
    expect(getMaterialTexture('marble')).toBeUndefined();
    expect(getMaterialTexture('CEMENTED')).toBeUndefined();
  });

  it('returns undefined for empty / nullish input, never throws', () => {
    expect(() => getMaterialTexture(undefined)).not.toThrow();
    expect(getMaterialTexture(undefined)).toBeUndefined();
    expect(getMaterialTexture(null)).toBeUndefined();
    expect(getMaterialTexture('')).toBeUndefined();
    expect(getMaterialTexture('   ')).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(getMaterialTexture(42 as any)).toBeUndefined();
  });

  it('is case-insensitive on known names', () => {
    expect(getMaterialTexture('Cement')).toBeTruthy();
    expect(getMaterialTexture(' STEEL ')).toBeTruthy();
  });

  it('is SSR-safe: building needs no document/canvas and does not throw', () => {
    // The `node` vitest env has no `document`; a texture still builds because
    // DataTexture is pure data (this is the SSR-safety guarantee).
    expect(typeof document).toBe('undefined');
    expect(() => getMaterialTexture('rock')).not.toThrow();
    expect(getMaterialTexture('rock')).toBeInstanceOf(THREE.Texture);
  });
});
