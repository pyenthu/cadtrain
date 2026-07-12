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
} from '../svg-emit';
import {
  buildWelded, classifyOutlineEdges, chainEdges, mergeCollinearPolyline,
  type SilhouetteInput,
} from '../svg-silhouette';

// Extract a SilhouetteInput (pos + non-indexed a/b/c) from a THREE geometry.
function silInput(geo: THREE.BufferGeometry): SilhouetteInput {
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const idx = geo.index;
  const triN = idx ? idx.count / 3 : posAttr.count / 3;
  const a = new Int32Array(triN), b = new Int32Array(triN), c = new Int32Array(triN);
  for (let t = 0; t < triN; t++) {
    if (idx) { a[t] = idx.getX(3 * t); b[t] = idx.getX(3 * t + 1); c[t] = idx.getX(3 * t + 2); }
    else { a[t] = 3 * t; b[t] = 3 * t + 1; c[t] = 3 * t + 2; }
  }
  return { triN, a, b, c, pos: posAttr.array as ArrayLike<number> };
}
const cosDeg = (deg: number) => Math.cos((deg * Math.PI) / 180);

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

// ── Phase 1: silhouette / crease outline extraction (svg-silhouette, PURE) ────
describe('svg-silhouette — outline extraction (Phase 1)', () => {
  it('welds a non-indexed cube to 8 corners + 12 unique box edges', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const adj = buildWelded(silInput(geo));
    expect(adj.vpos.length / 3).toBe(8);          // 36 duped verts → 8 welded corners
    expect(adj.fn.length).toBe(12 * 3);           // 12 face normals
    // 12 box edges (2 faces each) + 6 face diagonals (1 per square face, 2 tris).
    const interior = adj.edges.filter((e) => e.f1 >= 0);
    expect(interior.length).toBe(18);
  });

  it('classifies all 12 cube edges as CREASE (90° ≫ 20°), 0 boundary', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const adj = buildWelded(silInput(geo));
    // View direction is irrelevant here — every box edge is a hard crease.
    const cls = classifyOutlineEdges(adj, [0, 0, 1], cosDeg(20));
    const creases = cls.filter((e) => e.kind === 'crease');
    const boundary = cls.filter((e) => e.kind === 'boundary');
    expect(creases.length).toBe(12);              // the cube's 12 hard edges
    expect(boundary.length).toBe(0);              // closed solid → no rim
    // face diagonals are coplanar → neither crease nor silhouette → excluded.
    expect(cls.length).toBe(12);
  });

  it('a lone triangle → 3 BOUNDARY edges', () => {
    const input: SilhouetteInput = {
      triN: 1, a: [0], b: [1], c: [2],
      pos: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    };
    const adj = buildWelded(input);
    const cls = classifyOutlineEdges(adj, [0, 0, 1], cosDeg(20));
    expect(cls.every((e) => e.kind === 'boundary')).toBe(true);
    expect(cls.length).toBe(3);
  });

  it('an open 13-seg cylinder viewed side-on → exactly 2 SILHOUETTE edges', () => {
    // radialSegments 13 (odd → no facet exactly edge-on), openEnded (no caps).
    const geo = new THREE.CylinderGeometry(1, 1, 2, 13, 1, true).toNonIndexed();
    const adj = buildWelded(silInput(geo));
    // crease threshold 40° > the 27.7° facet step, so facets are NOT creases —
    // only the true front/back-facing boundary shows. View along +Z (side-on to
    // the Y axis). The two vertical lines where the surface turns away = 2 edges.
    const cls = classifyOutlineEdges(adj, [0, 0, 1], cosDeg(40));
    const sil = cls.filter((e) => e.kind === 'silhouette');
    expect(sil.length).toBe(2);
  });

  it('buildWelded is deterministic (same input → identical adjacency)', () => {
    const geo = new THREE.BoxGeometry(2, 1, 3).toNonIndexed();
    const a = buildWelded(silInput(geo));
    const b = buildWelded(silInput(geo));
    expect(a.vpos).toEqual(b.vpos);
    expect(Array.from(a.fn)).toEqual(Array.from(b.fn));
    expect(a.edges).toEqual(b.edges);
  });

  it('chainEdges links contiguous edges + splits disjoint runs', () => {
    // one open run
    const c1 = chainEdges([[0, 1], [1, 2], [2, 3]]);
    expect(c1.length).toBe(1);
    expect(c1[0].length).toBe(4);                 // 0-1-2-3 (some direction)
    // one closed loop (3 edges → 4 vertices incl. the repeat)
    const c2 = chainEdges([[0, 1], [1, 2], [2, 0]]);
    expect(c2.length).toBe(1);
    expect(c2[0].length).toBe(4);
    // two disjoint segments → two chains
    const c3 = chainEdges([[0, 1], [5, 6]]);
    expect(c3.length).toBe(2);
  });

  it('mergeCollinearPolyline collapses a straight run to ONE segment, keeps corners', () => {
    const tol = (6 * Math.PI) / 180;
    // 4 collinear points → 2 endpoints
    expect(mergeCollinearPolyline([0, 0, 1, 0, 2, 0, 3, 0], tol)).toEqual([0, 0, 3, 0]);
    // near-collinear (0.57° jitter) also collapses
    expect(mergeCollinearPolyline([0, 0, 1, 0, 2, 0.01, 3, 0], tol)).toEqual([0, 0, 3, 0]);
    // a 90° corner is preserved (all 3 points kept)
    expect(mergeCollinearPolyline([0, 0, 1, 0, 1, 1], tol)).toEqual([0, 0, 1, 0, 1, 1]);
  });
});

// ── Phase 1: stroke quality + #63c pattern textures (shadeAndEmit) ────────────
describe('shadeAndEmit — stroke quality + texture patterns (Phase 1 / #63c)', () => {
  const savedDoc = (globalThis as any).document;
  beforeAll(() => {
    (globalThis as any).document = { createElementNS: (_ns: string, tag: string) => new FakeEl(tag) };
  });
  afterAll(() => { (globalThis as any).document = savedDoc; });

  const baseScene = (): ProjectedScene => ({
    tris: [{
      ax: 0, ay: 0, bx: 100, by: 0, cx: 0, cy: 100,
      n: [0, 0, -1, 0, 0, -1, 0, 0, -1], z: 0.5, r: 0.6, g: 0.6, b: 0.6, pi: 0, flat: false,
    }],
    edgePath: 'M0,0L100,0L100,100',
    viewDir: [0, 0, 1], renderW: 200, renderH: 200, fitToContainer: false,
    triCount: 1, culledCount: 0, flatFill: false,
  });
  const opts = {
    idPrefix: 'PFX-', lightAngle: 0, showEdges: true,
    AMBIENT: 0.25, KEY: 0.55, FILL: 0.28, DESAT: 0.45, BRIGHT: 0.82,
  };

  it('outline path carries round joins + non-scaling AA stroke', () => {
    const out = shadeAndEmit(baseScene(), opts) as any;
    const path = out.svg.children.find((c: FakeEl) => c.tagName === 'path');
    expect(path).toBeTruthy();
    expect(path.getAttribute('stroke-linejoin')).toBe('round');
    expect(path.getAttribute('stroke-linecap')).toBe('round');
    expect(path.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    expect(path.getAttribute('shape-rendering')).toBe('geometricPrecision');
  });

  it('a textured part fills with a <pattern> (namespaced), NOT a gradient', () => {
    const out = shadeAndEmit(baseScene(), { ...opts, partTexture: ['rock'] }) as any;
    const defs = out.svg.children.find((c: FakeEl) => c.tagName === 'defs');
    const patterns = defs.children.filter((c: FakeEl) => c.tagName === 'pattern');
    expect(patterns.length).toBe(1);                          // ONE pattern per textured part
    expect(patterns[0].getAttribute('id').startsWith('PFX-')).toBe(true); // collision guard
    const poly = out.svg.children.find((c: FakeEl) => c.tagName === 'polygon');
    expect(poly.getAttribute('fill')).toBe(`url(#${patterns[0].getAttribute('id')})`);
  });

  it('an unknown texture name falls back to the normal shaded fill', () => {
    const out = shadeAndEmit(baseScene(), { ...opts, partTexture: ['plaid'] }) as any;
    const defs = out.svg.children.find((c: FakeEl) => c.tagName === 'defs');
    const patterns = defs.children.filter((c: FakeEl) => c.tagName === 'pattern');
    expect(patterns.length).toBe(0);
    const poly = out.svg.children.find((c: FakeEl) => c.tagName === 'polygon');
    expect(poly.getAttribute('fill').startsWith('#')).toBe(true); // flat/gradient, not a pattern
  });

  it('no partTexture → byte-identical (no patterns emitted)', () => {
    const out = shadeAndEmit(baseScene(), opts) as any;
    const defs = out.svg.children.find((c: FakeEl) => c.tagName === 'defs');
    expect(defs.children.filter((c: FakeEl) => c.tagName === 'pattern').length).toBe(0);
  });
});
