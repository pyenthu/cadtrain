import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import {
  compilePrimitiveScript,
  buildPrimitiveGeom,
  _resetDepSourceCacheForTest,
} from '../primitive-loader';
import { SANDBOX_ARG_NAMES, sandboxArgValues } from '$lib/graph/primitive-sandbox';
import * as helpers from '$lib/engines/manifold/manifold-helpers';

// PR1 — /api/primitives/compile + script cache.
//
// The script compiler emits a SELF-CONTAINED Manifold script: every meta.uses
// dep INLINED as text, run in the SAME sandbox shape the server executor uses.
// These tests prove the two invariants the whole PR rests on:
//   (1) the script hash folds in dep source (deja-vu killer) + ignores meta churn;
//   (2) PARITY — the inlined-text path produces a mesh byte-identical to the
//       inject-functions path (buildPrimitiveGeom) for the same params.

// A tiny mock of SvelteKit's event.fetch that serves configurable sources from
// /api/primitives/source?name=<id>. Same pattern as bake-cache.test.ts.
function mockFetch(sources: Record<string, string>): typeof fetch {
  return (async (input: any) => {
    const u = String(typeof input === 'string' ? input : input.url);
    const m = /[?&]name=([^&]+)/.exec(u);
    const id = m ? decodeURIComponent(m[1]) : '';
    const src = sources[id];
    if (src === undefined) return { ok: false, status: 404, json: async () => ({}) } as any;
    return { ok: true, status: 200, json: async () => ({ source: src }) } as any;
  }) as any;
}

// ── A representative composing part (object-style parent + object-style dep,
//    like g_dp_joint / g_collar) ───────────────────────────────────────────
// g_widget composes TWO instances of g_block (a cylinder), one shifted in x.
const G_BLOCK = `export const meta = { id:'g_block', uses:[], params:{ dia:{default:2}, len:{default:3} } };
export function g_block(p) { return cyl(p.len, p.dia / 2); }`;

const G_WIDGET = `export const meta = { id:'g_widget', uses:['g_block'], params:{ od:{default:4}, h:{default:6} } };
export function g_widget(p) {
  const a = g_block({ dia: p.od, len: p.h });
  const b = mv(g_block({ dia: p.od / 2, len: p.h }), [3, 0, 0]);
  return a.add(b);
}`;

const SOURCES = { g_widget: G_WIDGET, g_block: G_BLOCK };

// Run a compiled script the SAME way the client worker / server executor will:
//   new Function(...SANDBOX_ARG_NAMES, script)(...sandboxArgValues()) → geomFn
function runCompiledScript(script: string): (...args: any[]) => any {
  const factory = new Function(...SANDBOX_ARG_NAMES, script);
  return factory(...sandboxArgValues());
}

// Stable structural fingerprint of a Manifold mesh: vert/tri counts + bbox +
// content checksums. Two byte-identical bakes match on ALL of these.
function meshStats(manifold: any) {
  const mesh = manifold.getMesh();
  const vp: Float32Array = mesh.vertProperties;
  const tv: Uint32Array = mesh.triVerts;
  const numProp: number = mesh.numProp;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vp.length; i += numProp) {
    for (let k = 0; k < 3; k++) {
      const v = vp[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  // FNV-1a over the raw vertex + triangle buffers — exact-equality detector.
  const fnv = (arr: Float32Array | Uint32Array, asInt: boolean) => {
    let h = 0x811c9dc5;
    const buf = asInt ? new Uint32Array(arr.buffer, arr.byteOffset, arr.length)
                      : new Uint32Array((arr as Float32Array).buffer, (arr as Float32Array).byteOffset, (arr as Float32Array).length);
    for (let i = 0; i < buf.length; i++) { h ^= buf[i]!; h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  };
  return {
    numVert: mesh.numVert,
    numTri: mesh.numTri,
    bbox: { min, max },
    vpHash: fnv(vp, false),
    tvHash: fnv(tv, true),
  };
}

describe('compilePrimitiveScript — hash sensitivity', () => {
  beforeEach(() => { _resetDepSourceCacheForTest(); });

  it('a DEP BODY edit changes the scriptHash', async () => {
    const a = await compilePrimitiveScript(G_WIDGET, 'g_widget', mockFetch(SOURCES));
    _resetDepSourceCacheForTest();
    const blockV2 = `export const meta = { id:'g_block', uses:[], params:{ dia:{default:2}, len:{default:3} } };
export function g_block(p) { return cyl(p.len * 2, p.dia / 2); }`; // body changed (len*2)
    const b = await compilePrimitiveScript(G_WIDGET, 'g_widget', mockFetch({ ...SOURCES, g_block: blockV2 }));
    expect(a.scriptHash).toBeTypeOf('string');
    expect(a.scriptHash).toHaveLength(64); // full sha256 hex
    expect(b.scriptHash).not.toBe(a.scriptHash);
  });

  it('a layout/whitespace-only META change does NOT change the scriptHash', async () => {
    const a = await compilePrimitiveScript(G_WIDGET, 'g_widget', mockFetch(SOURCES));
    _resetDepSourceCacheForTest();
    // Same geometry, but the meta block is reformatted + carries new presentation
    // fields (graph NodeIds / layout) — exactly the churn bake-cache ignores.
    const widgetMetaChurn = `export const meta = {
      id: 'g_widget',
      uses: [ 'g_block' ],
      params: { od: { default: 4 }, h: { default: 6 } },
      graph: { nodes: [ { id: 'n_abc123' }, { id: 'n_def456' } ], layout: { x: 99, y: 12 } }
    };
export function g_widget(p) {
  const a = g_block({ dia: p.od, len: p.h });
  const b = mv(g_block({ dia: p.od / 2, len: p.h }), [3, 0, 0]);
  return a.add(b);
}`;
    const b = await compilePrimitiveScript(widgetMetaChurn, 'g_widget', mockFetch(SOURCES));
    expect(b.scriptHash).toBe(a.scriptHash);
  });

  it('inlines the transitive dep source (no dep fetch left for the client)', async () => {
    const { script, depNames } = await compilePrimitiveScript(G_WIDGET, 'g_widget', mockFetch(SOURCES));
    expect(depNames).toEqual(['g_block']);
    // The dep body must be present as TEXT in the script (cyl call from g_block).
    expect(script).toContain('module.exports');
    expect(script.match(/cyl\(/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    // Self-contained: the script never references the source endpoint.
    expect(script).not.toContain('/api/primitives/source');
  });
});

describe('compilePrimitiveScript — PARITY with buildPrimitiveGeom (the whole point)', () => {
  beforeAll(async () => { await helpers.initManifold(); });
  beforeEach(() => { _resetDepSourceCacheForTest(); });

  it('inlined-text script bakes a mesh byte-identical to the inject-functions path', async () => {
    const params = [4, 6]; // [od, h]

    // Server executor path.
    const execFn = await buildPrimitiveGeom(G_WIDGET, 'g_widget', mockFetch(SOURCES));
    const execManifold = execFn(...params);
    const execStats = meshStats(execManifold);

    _resetDepSourceCacheForTest();

    // Compiled-script path (run in the identical sandbox).
    const { script } = await compilePrimitiveScript(G_WIDGET, 'g_widget', mockFetch(SOURCES));
    const compiledFn = runCompiledScript(script);
    const compiledManifold = compiledFn(...params);
    const compiledStats = meshStats(compiledManifold);

    // Byte-identical: same vert/tri counts, same bbox, same buffer checksums.
    expect(compiledStats.numVert).toBeGreaterThan(0);
    expect(compiledStats).toEqual(execStats);
  });

  it('parity holds when called with an OBJECT arg too (topology + bbox identical)', async () => {
    // The object-inbound CSG path lands ~1e-5 (Float32-epsilon) coordinate jitter
    // between the two pipelines after the boolean union — identical TOPOLOGY
    // (triVerts), counts, and bbox, positions equal to ~5 sig-figs. This is the
    // "vert/tri-count + bbox identical" parity bar the plan explicitly accepts
    // (the positional case above is the stricter byte-identical proof).
    const objArg = [{ od: 5, h: 8 }];

    const execFn = await buildPrimitiveGeom(G_WIDGET, 'g_widget', mockFetch(SOURCES));
    const execStats = meshStats(execFn(...objArg));

    _resetDepSourceCacheForTest();

    const { script } = await compilePrimitiveScript(G_WIDGET, 'g_widget', mockFetch(SOURCES));
    const compiledStats = meshStats(runCompiledScript(script)(...objArg));

    expect(compiledStats.numVert).toBe(execStats.numVert);
    expect(compiledStats.numTri).toBe(execStats.numTri);
    expect(compiledStats.tvHash).toBe(execStats.tvHash);     // identical triangle topology
    // bbox identical to Float32 precision (jitter is interior, never extends extents).
    for (let k = 0; k < 3; k++) {
      expect(compiledStats.bbox.min[k]).toBeCloseTo(execStats.bbox.min[k]!, 4);
      expect(compiledStats.bbox.max[k]).toBeCloseTo(execStats.bbox.max[k]!, 4);
    }
  });
});
