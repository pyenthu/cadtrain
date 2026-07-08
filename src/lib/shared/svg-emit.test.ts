// svg-emit.test.ts — headless coverage for the project/shade split (Phase 0)
// + the per-part transparency contract (Phase 2).
//
// `projectScene` is DOM-free (THREE + typed arrays only) so it runs natively in
// the node vitest env. `shadeAndEmit` builds SVG DOM via document.createElementNS
// — the project uses `environment: 'node'` (no jsdom), so we install a MINIMAL
// element stub (the emitter only ever calls createElementNS / setAttribute /
// appendChild / .style), enough to assert the emitted tree.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import {
  projectScene, shadeAndEmit, type ProjectedScene, type ProjTri,
} from './svg-emit';

// --- a THREE camera looking at the origin (deterministic project()) ----------
function orthoCam(): THREE.Camera {
  const cam = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  cam.position.set(0, 0, -5);
  cam.up.set(0, -1, 0); // Z-down convention (matches PrimitiveDualScene)
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

describe('projectScene — pure projection (Phase 0)', () => {
  const geo = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(); // 12 tris, has normals
  const base: [number, number, number] = [0.8, 0.13, 0.13];
  const cam = orthoCam();
  const opts = { sX: 1, sZ: 1, backfaceCull: false, HIGH_TRI: 4000 };

  it('projects all triangles + a crease edge path, DOM-free', () => {
    const s = projectScene([{ geo, pi: 0, base }], cam, 200, 200, false, opts);
    expect(s.triCount).toBe(12);
    expect(s.tris.length).toBeGreaterThan(0);
    expect(s.edgePath.length).toBeGreaterThan(0); // cube → crease edges present
    expect(s.viewDir).toHaveLength(3);
  });

  it('is DETERMINISTIC — identical inputs → identical screen coords + normals', () => {
    const a = projectScene([{ geo, pi: 0, base }], cam, 200, 200, false, opts);
    const b = projectScene([{ geo, pi: 0, base }], cam, 200, 200, false, opts);
    expect(a.tris.length).toBe(b.tris.length);
    for (let i = 0; i < a.tris.length; i++) {
      expect(a.tris[i].ax).toBeCloseTo(b.tris[i].ax, 6);
      expect(a.tris[i].ay).toBeCloseTo(b.tris[i].ay, 6);
      expect(a.tris[i].z).toBeCloseTo(b.tris[i].z, 6);
      expect(a.tris[i].n).toEqual(b.tris[i].n);
    }
  });

  it('stores CAMERA-FACING normals (n·V ≥ 0 after the two-sided flip)', () => {
    const s = projectScene([{ geo, pi: 0, base }], cam, 200, 200, false, opts);
    const [vx, vy, vz] = s.viewDir;
    // V = −viewDir (surface → lens). Every stored corner normal must face it.
    for (const t of s.tris) {
      for (let k = 0; k < 3; k++) {
        const nv = -(t.n[k * 3] * vx + t.n[k * 3 + 1] * vy + t.n[k * 3 + 2] * vz);
        expect(nv).toBeGreaterThanOrEqual(-1e-6);
      }
    }
  });

  it('carries the entry part index onto every emitted triangle (per-part)', () => {
    const geo2 = new THREE.BoxGeometry(0.5, 0.5, 0.5).toNonIndexed();
    const s = projectScene(
      [{ geo, pi: 0, base }, { geo: geo2, pi: 1, base }],
      cam, 200, 200, false, opts,
    );
    const pis = new Set(s.tris.map((t) => t.pi));
    expect(pis.has(0)).toBe(true);
    expect(pis.has(1)).toBe(true);
  });
});

// --- minimal SVG-element stub for shadeAndEmit (node env has no DOM) ----------
class FakeEl {
  tagName: string;
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  style: Record<string, string> = {};
  constructor(tag: string) { this.tagName = tag; }
  setAttribute(k: string, v: unknown) { this.attrs[k] = String(v); }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  appendChild(c: FakeEl) { this.children.push(c); return c; }
}

describe('shadeAndEmit — per-part transparency (Phase 2)', () => {
  const savedDoc = (globalThis as any).document;
  beforeAll(() => {
    (globalThis as any).document = { createElementNS: (_ns: string, tag: string) => new FakeEl(tag) };
  });
  afterAll(() => { (globalThis as any).document = savedDoc; });

  // A hand-built scene: one OPAQUE part (pi 0, varied normals → a gradient) +
  // two TRANSPARENT triangles (pi 1) at different depths.
  function scene(): ProjectedScene {
    const mk = (
      pts: number[], normals: number[], z: number, pi: number,
    ): ProjTri => ({
      ax: pts[0], ay: pts[1], bx: pts[2], by: pts[3], cx: pts[4], cy: pts[5],
      n: normals, z, r: 0.8, g: 0.13, b: 0.13, pi, flat: false,
    });
    return {
      tris: [
        // opaque, spread normals so appendTri emits a linearGradient
        mk([0, 0, 100, 0, 0, 100],
           [0.9, 0, -0.436, -0.9, 0, -0.436, 0, 0, -1], 0.5, 0),
        // transparent, FAR
        mk([10, 10, 90, 10, 10, 90], [0, 0, -1, 0, 0, -1, 0, 0, -1], 0.9, 1),
        // transparent, NEAR
        mk([20, 20, 80, 20, 20, 80], [0, 0, -1, 0, 0, -1, 0, 0, -1], 0.1, 1),
      ],
      edgePath: '', viewDir: [0, 0, 1],
      renderW: 200, renderH: 200, fitToContainer: false,
      triCount: 3, culledCount: 0, flatFill: false,
    };
  }

  const shadeOpts = {
    idPrefix: 'TESTPFX-', lightAngle: 0, showEdges: false,
    AMBIENT: 0.25, KEY: 0.55, FILL: 0.28, DESAT: 0.45, BRIGHT: 0.82,
    partAlpha: [1, 0.4], partTrans: [false, true],
  };

  it('paints OPAQUE polys before TRANSPARENT polys (document order)', () => {
    const out = shadeAndEmit(scene(), shadeOpts) as any;
    const polys = out.svg.children.filter((c: FakeEl) => c.tagName === 'polygon');
    expect(polys.length).toBe(3);
    // First poly = the opaque part (no fill-opacity). The remaining two carry it.
    expect(polys[0].getAttribute('fill-opacity')).toBeNull();
    expect(polys[1].getAttribute('fill-opacity')).toBe('0.4');
    expect(polys[2].getAttribute('fill-opacity')).toBe('0.4');
  });

  it('sorts the transparent bucket back-to-front (far → near)', () => {
    const out = shadeAndEmit(scene(), shadeOpts) as any;
    const polys = out.svg.children.filter((c: FakeEl) => c.tagName === 'polygon');
    // Transparent bucket: FAR (z0.9, points start "10.00,10.00") before
    // NEAR (z0.1, points start "20.00,20.00").
    expect(polys[1].getAttribute('points')).toContain('10.00,10.00');
    expect(polys[2].getAttribute('points')).toContain('20.00,20.00');
  });

  it('namespaces every gradient id with idPrefix (collision guard)', () => {
    const out = shadeAndEmit(scene(), shadeOpts) as any;
    const defs = out.svg.children.find((c: FakeEl) => c.tagName === 'defs');
    const grads = defs.children.filter((c: FakeEl) => c.tagName === 'linearGradient');
    expect(grads.length).toBeGreaterThanOrEqual(1); // opaque tri → a gradient
    for (const g of grads) expect(g.getAttribute('id')!.startsWith('TESTPFX-')).toBe(true);
  });

  it('all-opaque scene emits NO fill-opacity (byte-compatible with pre-transparency)', () => {
    const s = scene();
    const out = shadeAndEmit(s, { ...shadeOpts, partAlpha: [1, 1], partTrans: [false, false] }) as any;
    const polys = out.svg.children.filter((c: FakeEl) => c.tagName === 'polygon');
    for (const p of polys) expect(p.getAttribute('fill-opacity')).toBeNull();
  });
});
