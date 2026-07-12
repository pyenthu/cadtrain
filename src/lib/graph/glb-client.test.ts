import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { exportGlbClient } from './glb-client';

// three's GLTFExporter reads its assembled Blob back through FileReader, which
// Node lacks. Node HAS Blob, so a 6-line shim is enough — no jsdom needed.
class FileReaderShim {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); });
  }
}
(globalThis as any).FileReader ??= FileReaderShim;

function coloredBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i*3] = 0.37; col[i*3+1] = 0.49; col[i*3+2] = 0.54; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function parseGlb(buf: ArrayBuffer) {
  const dv = new DataView(buf);
  const jsonLen = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
}

describe('exportGlbClient', () => {
  it('KEEPS vertex colours when the part is coloured', async () => {
    const buf = await exportGlbClient({ full: coloredBox(), name: 'x', coloured: true });
    const g = parseGlb(buf);
    const prims = g.meshes.flatMap((m: any) => m.primitives);
    expect(prims.some((p: any) => 'COLOR_0' in p.attributes)).toBe(true);
  });
  it('STRIPS vertex colours when the part is not coloured', async () => {
    const geo = coloredBox();
    const buf = await exportGlbClient({ full: geo, name: 'x', coloured: false });
    const g = parseGlb(buf);
    const prims = g.meshes.flatMap((m: any) => m.primitives);
    expect(prims.some((p: any) => 'COLOR_0' in p.attributes)).toBe(false);
    // and must NOT mutate the caller's geometry (it is live in the scene)
    expect(geo.getAttribute('color')).toBeTruthy();
  });
  it('falls back to `full` when parts carry no colour (viewer keys on COLOR_0)', async () => {
    const bare = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(); // no color attribute
    const buf = await exportGlbClient({ full: coloredBox(), parts: [{ geo: bare, id: 'a' }], name: 'x', coloured: true });
    const g = parseGlb(buf);
    const prims = g.meshes.flatMap((m: any) => m.primitives);
    expect(prims.length).toBe(1);
    expect(prims.some((p: any) => 'COLOR_0' in p.attributes)).toBe(true);
  });

  it('emits one named mesh per part', async () => {
    const buf = await exportGlbClient({
      parts: [{ geo: coloredBox(), id: 'casing' }, { geo: coloredBox(), id: 'tubing' }],
      name: 'well', coloured: true,
    });
    const g = parseGlb(buf);
    expect(g.nodes.filter((n: any) => n.mesh !== undefined).length).toBe(2);
    expect(g.nodes.map((n: any) => n.name)).toEqual(expect.arrayContaining(['casing', 'tubing']));
  });
});
