import { describe, it, expect } from 'vitest';
import { materialPreset, MATERIAL_PRESET_NAMES } from '../material-preset';

describe('materialPreset', () => {
  it('none/undefined/unknown → neutral default identical to the old hardcoded material', () => {
    const neutral = { metalness: 0, roughness: 0.5, color: undefined };
    expect(materialPreset(undefined)).toEqual(neutral);
    expect(materialPreset(null)).toEqual(neutral);
    expect(materialPreset('')).toEqual(neutral);
    expect(materialPreset('none')).toEqual(neutral);
    expect(materialPreset('unobtanium')).toEqual(neutral);
  });

  it('steel is metallic with a cool-grey tint', () => {
    const s = materialPreset('steel');
    expect(s.metalness).toBeGreaterThan(0.5);
    expect(s.roughness).toBeLessThan(0.5);
    expect(s.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('every named preset (except none) is metallic and tinted', () => {
    for (const name of MATERIAL_PRESET_NAMES) {
      const p = materialPreset(name);
      expect(p.metalness).toBeGreaterThanOrEqual(0);
      expect(p.roughness).toBeGreaterThan(0);
      expect(p.roughness).toBeLessThanOrEqual(1);
      if (name !== 'none') {
        expect(p.metalness).toBeGreaterThan(0);
        expect(p.color).toBeTruthy();
      }
    }
  });
});
