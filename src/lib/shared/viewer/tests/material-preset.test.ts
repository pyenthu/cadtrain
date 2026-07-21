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

  it('every named preset (except none) has valid PBR params + a tint', () => {
    // Presets are metals (steel/…) OR non-metallic downhole rock (sandstone/
    // cement/…): metalness ∈ [0,1] (rock can be 0), roughness ∈ (0,1], all tinted.
    for (const name of MATERIAL_PRESET_NAMES) {
      const p = materialPreset(name);
      expect(p.metalness).toBeGreaterThanOrEqual(0);
      expect(p.metalness).toBeLessThanOrEqual(1);
      expect(p.roughness).toBeGreaterThan(0);
      expect(p.roughness).toBeLessThanOrEqual(1);
      if (name !== 'none') expect(p.color).toBeTruthy();
    }
  });

  it('metals are low-roughness/metallic; rock presets are matte/non-metallic', () => {
    for (const m of ['steel', 'aluminum', 'titanium', 'brass']) {
      expect(materialPreset(m).metalness).toBeGreaterThan(0.5);
    }
    for (const r of ['sandstone', 'limestone', 'cement']) {
      expect(materialPreset(r).metalness).toBeLessThan(0.2);
      expect(materialPreset(r).roughness).toBeGreaterThan(0.7);
    }
  });
});
