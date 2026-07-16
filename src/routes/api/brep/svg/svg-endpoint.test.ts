/**
 * svg-endpoint.test.ts — OFFLINE pins for the /api/brep/svg endpoint + the
 * brep-occt `solidFromSource` seam it stands on. No network, no volume: the
 * POST handler is driven directly with a real Request, and every case builds a
 * self-contained OCCT solid (an explicit revolve profile, or a CSG part whose
 * only deps are the injected stdlib engines — so dep resolution never fetches).
 *
 * The HTTP handler CAN run headless here because both request shapes reach the
 * OCCT kernel without the volume: `{ kind:'revolve', profile }` builds the
 * revolve directly, and a pure-engine `{ source }` needs no dep fetch. We assert
 * the endpoint returns { supported, svg, meta } with a well-formed boundary SVG
 * (starts with <svg, valid 4-number viewBox, ≥1 drawn path, finite coords).
 */
import { describe, it, expect } from 'vitest';
import { POST } from './+server';
import { solidFromSource } from '$lib/engines/brep/brep-occt';
import { brepSolidToSvg } from '$lib/engines/brep/svg/brep-to-svg';

const OCCT_TIMEOUT = 30_000; // OCCT WASM init + build can take a few seconds cold.

// A solid cylinder half-section (r 0.01→2, z 0→6) — same family the brep-occt +
// brep-to-svg tests use. Revolves to a plain cylinder.
const CYL: [number, number][] = [[0.01, 0], [2, 0], [2, 6], [0.01, 6]];

// A CSG part (box minus a smaller through-box) whose ONLY dep is the injected
// r_cuboid engine — collectDeps skips engines, so this resolves with no fetch.
const CSG_SRC = `export const meta = { id: 't_csg_svg', name: 't_csg_svg', kind: 'asm', uses: ['r_cuboid'], params: { a: { default: 4 }, b: { default: 2 } } };
export function t_csg_svg(p) {
  return r_cuboid(p.a, p.a, p.a).subtract(r_cuboid(p.b, p.b, p.a + 1));
}`;

/** A fetch stub that 404s everything — pure-engine sources never call it, but
 *  the handler + executor expect a callable `fetch`. */
const noFetch = (async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch;

/** Drive the endpoint's POST handler with a JSON body; return { status, data }. */
async function callPost(payload: unknown): Promise<{ status: number; data: any }> {
  const request = new Request('http://localhost/api/brep/svg', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const res: Response = await POST({ request, fetch: noFetch } as any);
  return { status: res.status, data: await res.json() };
}

/** Assert a string is a well-formed boundary SVG. */
function assertWellFormedSvg(svg: unknown): void {
  expect(typeof svg, 'svg must be a string').toBe('string');
  const s = svg as string;
  expect(s.startsWith('<svg'), 'svg must start with <svg').toBe(true);
  expect(s.trim().endsWith('</svg>'), 'svg must close with </svg>').toBe(true);

  // viewBox = exactly four finite numbers, positive width + height.
  const vb = /viewBox="([^"]+)"/.exec(s);
  expect(vb, 'svg must carry a viewBox').toBeTruthy();
  const nums = vb![1].trim().split(/\s+/).map(Number);
  expect(nums.length, 'viewBox must have 4 components').toBe(4);
  expect(nums.every(Number.isFinite), 'viewBox components must be finite').toBe(true);
  expect(nums[2], 'viewBox width > 0').toBeGreaterThan(0);
  expect(nums[3], 'viewBox height > 0').toBeGreaterThan(0);

  // Actual drawn content (boundary edges), and no NaN/Infinity leaking anywhere.
  const draws = (s.match(/<(path|line|polyline)\b/g) || []).length;
  expect(draws, 'svg must contain ≥1 drawn path/line (boundary content)').toBeGreaterThanOrEqual(1);
  const tokens = s.match(/-?\d+(\.\d+)?(e-?\d+)?/gi) || [];
  expect(tokens.length, 'svg must carry numeric coordinates').toBeGreaterThan(0);
  expect(tokens.every((n) => Number.isFinite(Number(n))), 'all svg numbers must be finite').toBe(true);
}

describe('/api/brep/svg — revolve input', () => {
  it('{ kind:"revolve", profile } → supported SVG with boundary paths', async () => {
    const { data } = await callPost({ kind: 'revolve', profile: CYL });
    expect(data.supported, `expected supported:true, got ${JSON.stringify(data)}`).toBe(true);
    assertWellFormedSvg(data.svg);
    // meta: timing + which projection path ran (hlr, or edges on HLR self-recover).
    expect(typeof data.meta?.ms, 'meta.ms must be a number').toBe('number');
    expect(['hlr', 'edges']).toContain(data.meta?.mode);
    // The <svg> itself records the mode marker.
    expect(data.svg).toMatch(/data-brep-svg-mode="(hlr|edges)"/);
  }, OCCT_TIMEOUT);

  it('threads mode:"edges" to the exporter (direct edge projection)', async () => {
    const { data } = await callPost({ kind: 'revolve', profile: CYL, mode: 'edges' });
    expect(data.supported).toBe(true);
    assertWellFormedSvg(data.svg);
    expect(data.svg, 'mode:"edges" must be honoured').toMatch(/data-brep-svg-mode="edges"/);
    expect(data.meta.mode).toBe('edges');
  }, OCCT_TIMEOUT);

  it('threads fill:"silhouette" to the exporter (HLR filled outline)', async () => {
    const { data } = await callPost({ kind: 'revolve', profile: CYL, fill: 'silhouette' });
    expect(data.supported).toBe(true);
    assertWellFormedSvg(data.svg);
    expect(data.svg, 'fill:"silhouette" adds the default body fill').toMatch(/fill="#c8ccd2"/);
  }, OCCT_TIMEOUT);

  it('a <3-point profile is rejected with supported:false + reason', async () => {
    const { data } = await callPost({ kind: 'revolve', profile: [[0, 0], [1, 1]] });
    expect(data.supported).toBe(false);
    expect(typeof data.reason).toBe('string');
    expect(data.reason).toMatch(/≥3/);
  });
});

describe('/api/brep/svg — part source input', () => {
  it('{ source, paramValues } → executes the graph→OCCT solid and projects it', async () => {
    const { data } = await callPost({ source: CSG_SRC, paramValues: { a: 4, b: 2 } });
    expect(data.supported, `expected supported:true, got ${JSON.stringify(data)}`).toBe(true);
    assertWellFormedSvg(data.svg);
    expect(typeof data.meta?.ms).toBe('number');
    expect(['hlr', 'edges']).toContain(data.meta?.mode);
  }, OCCT_TIMEOUT);

  it('fill:"lambert" + strokeVisible:"none" shades faces with NO edge grid', async () => {
    // The "shaded" B·SVG toggle: per-face Lambert fills, facet-edge grid suppressed.
    const { data } = await callPost({ source: CSG_SRC, paramValues: { a: 4, b: 2 }, fill: 'lambert', strokeVisible: 'none' });
    expect(data.supported, `expected supported:true, got ${JSON.stringify(data)}`).toBe(true);
    assertWellFormedSvg(data.svg);
    // Lambert always renders via the edge/ortho path.
    expect(data.svg).toMatch(/data-brep-svg-mode="edges"/);
    // Shaded face fills present (a hex colour on ≥1 path)…
    expect(data.svg, 'lambert must fill faces').toMatch(/fill="#[0-9a-f]{6}"/i);
    // …and the interior facet-edge grid is gone (no stroked boundary edges).
    expect(data.svg, 'strokeVisible:"none" must drop the edge grid').not.toMatch(/stroke="#111"/);
  }, OCCT_TIMEOUT);

  it('a non-BREP source (no OCCT solid) returns supported:false', async () => {
    // A body that produces nothing OCCT-buildable → runBody yields no solid.
    const src = `export const meta = { id: 't_empty', name: 't_empty', kind: 'asm', uses: [], params: {} };
export function t_empty(p) { return undefined; }`;
    const { data } = await callPost({ source: src, paramValues: {} });
    expect(data.supported).toBe(false);
    expect(data.reason).toMatch(/no OCCT-buildable solid/);
  }, OCCT_TIMEOUT);
});

describe('/api/brep/svg — request validation', () => {
  it('neither input shape → supported:false with guidance', async () => {
    const { data } = await callPost({});
    expect(data.supported).toBe(false);
    expect(data.reason).toMatch(/provide/);
  });

  it('invalid JSON body → throws 400', async () => {
    const request = new Request('http://localhost/api/brep/svg', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json{',
    });
    await expect(POST({ request, fetch: noFetch } as any)).rejects.toMatchObject({ status: 400 });
  });
});

describe('solidFromSource seam (brep-occt) → brepSolidToSvg', () => {
  it('returns a raw OCCT solid that projects to a well-formed SVG', async () => {
    const solid = await solidFromSource(CSG_SRC, { a: 4, b: 2 }, {}, noFetch);
    expect(solid, 'solidFromSource must return a solid for a CSG part').toBeTruthy();
    // A raw replicad Shape exposes faces/edges/mesh — the surface brepSolidToSvg reads.
    expect(typeof solid.mesh, 'returned value must be a meshable OCCT solid').toBe('function');
    const svg = await brepSolidToSvg(solid, {});
    assertWellFormedSvg(svg);
    try { solid.delete?.(); } catch { /* free the WASM heap */ }
  }, OCCT_TIMEOUT);

  it('returns null for a source with no OCCT-buildable solid', async () => {
    const src = `export const meta = { id: 't_none', name: 't_none', kind: 'asm', uses: [], params: {} };
export function t_none(p) { return null; }`;
    const solid = await solidFromSource(src, {}, {}, noFetch);
    expect(solid).toBeNull();
  }, OCCT_TIMEOUT);
});
