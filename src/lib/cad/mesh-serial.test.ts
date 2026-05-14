import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { serializeComponentResult, deserializeComponentResult } from './mesh-serial';

function sampleGeo(withColor: boolean): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (withColor) {
    const colors = new Float32Array([0.8, 0.06, 0.06, 0.8, 0.06, 0.06, 0.45, 0.45, 0.45]);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  geo.computeVertexNormals();
  return geo;
}

describe('mesh-serial round-trip', () => {
  it('preserves positions, normals and colors losslessly', () => {
    const result = { full: sampleGeo(false), cutVC: sampleGeo(true) };
    const restored = deserializeComponentResult(
      JSON.parse(JSON.stringify(serializeComponentResult(result))),
    );

    expect(Array.from(restored.full.getAttribute('position').array)).toEqual(
      Array.from(result.full.getAttribute('position').array),
    );
    expect(Array.from(restored.full.getAttribute('normal').array)).toEqual(
      Array.from(result.full.getAttribute('normal').array),
    );
    expect(restored.cutVC.getAttribute('color')).toBeTruthy();
    expect(Array.from(restored.cutVC.getAttribute('color').array)).toEqual(
      Array.from(result.cutVC.getAttribute('color').array),
    );
  });

  it('full geometry has no color attribute', () => {
    const result = { full: sampleGeo(false), cutVC: sampleGeo(true) };
    const restored = deserializeComponentResult(serializeComponentResult(result));
    expect(restored.full.getAttribute('color')).toBeUndefined();
  });
});
