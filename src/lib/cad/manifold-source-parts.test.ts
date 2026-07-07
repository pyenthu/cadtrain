import { describe, it, expect } from 'vitest';
import { compilePrimitiveScript } from '$lib/server/primitive-loader';
import { analyzeParts, resolveDepColors } from '$lib/server/part-colors';
import { runCompiledManifold } from './bake-worker-core';

/**
 * #1 unify-transparency (docs/findings/manifold-vs-tf-audit.md §1 + fix #1) —
 * the Manifold baker must emit per-SOURCE-PART meshes (`ComponentResult.parts`,
 * serialized as `out.parts`) for an APPEARANCE-BEARING composite (≥1 subpart with
 * opacity < 1), so the shared scene renders each part as its own mesh + material
 * (the same per-part arm TF uses) instead of one combined mesh whose transparent
 * subpart clouds the opaque ones.
 *
 * GATE: an all-opaque composite (no per-part transparency) must NOT get `parts`
 * — it stays on the byte-identical single-mesh `full` path. This is the additive,
 * no-regression guarantee.
 *
 * Headless: runs the SAME compile → runCompiledManifold path the client bake uses
 * (Manifold in Node), on inline 2-part assemblies. No on-disk volume fixture.
 */

const alphaSources: Record<string, string> = {
  // opaque body — no meta.opacity
  sp_body: `export const meta = { id:'sp_body', name:'body', params:{ r:{value:2}, h:{value:4} }, colorOuter:'#cc0000', colorInner:'#661111' };\nexport function sp_body(r, h){ return cyl(h, r); }`,
  // transparent subpart — meta.opacity 0.15 (the open-hole analogue)
  sp_glass: `export const meta = { id:'sp_glass', name:'glass', opacity:0.15, params:{ r:{value:2}, h:{value:4} }, colorOuter:'#1133cc', colorInner:'#111166' };\nexport function sp_glass(r, h){ return cyl(h, r); }`,
  // union of the two disjoint cylinders — the transparency case (open-hole+stand)
  sp_asm: `export const meta = { id:'sp_asm', name:'asm', params:{}, uses:['sp_body','sp_glass'] };\nexport function sp_asm(){ const a = sp_body(2,4); const b = sp_glass(2,4); return a.add(mv(b, [6,0,0])); }`,
};

// all-opaque 2-part union (no meta.opacity anywhere) — the NO-appearance control
const opaqueSources: Record<string, string> = {
  sp_red: `export const meta = { id:'sp_red', name:'red', params:{ r:{value:2}, h:{value:4} }, colorOuter:'#cc0000', colorInner:'#661111' };\nexport function sp_red(r, h){ return cyl(h, r); }`,
  sp_blue: `export const meta = { id:'sp_blue', name:'blue', params:{ r:{value:2}, h:{value:4} }, colorOuter:'#1133cc', colorInner:'#111166' };\nexport function sp_blue(r, h){ return cyl(h, r); }`,
  sp_op_asm: `export const meta = { id:'sp_op_asm', name:'asm', params:{}, uses:['sp_red','sp_blue'] };\nexport function sp_op_asm(){ const a = sp_red(2,4); const b = sp_blue(2,4); return a.add(mv(b, [6,0,0])); }`,
};

function fetchFor(bank: Record<string, string>) {
  return (async (url: any) => {
    const name = new URL(String(url), 'http://x').searchParams.get('name') ?? '';
    const source = bank[name];
    if (source == null) return { ok: false, status: 404, json: async () => ({}) } as any;
    return { ok: true, status: 200, json: async () => ({ source }) } as any;
  }) as any;
}

/** '#rrggbb' → [r,g,b] 0..255. */
function hex(c?: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec((c ?? '').trim());
  if (!m) return [-1, -1, -1];
  const v = m[1];
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

const triCount = (g: { positions?: number[] } | undefined) => ((g?.positions?.length ?? 0) / 9) | 0;

describe('#1 unify-transparency — Manifold emits per-source-part meshes', () => {
  it('a transparent-subpart composite → parts.length === 2, tri sum == whole, per-part opacity+colour', async () => {
    const fetch = fetchFor(alphaSources);
    const { script } = await compilePrimitiveScript(alphaSources.sp_asm, 'sp_asm', fetch);
    const lut = analyzeParts(alphaSources.sp_asm, await resolveDepColors(alphaSources.sp_asm, fetch));
    // sanity: the LUT actually carries the transparent subpart (the gate trigger)
    expect(Object.values(lut.opacity).some((v) => v < 1)).toBe(true);

    const out = await runCompiledManifold(script, [], { parts: lut });
    expect(out.parts).toBeDefined();
    const parts = out.parts!;
    expect(parts.length).toBe(2);

    // Each part is a real geometry with position + normal.
    for (const p of parts) {
      expect((p.geo.positions?.length ?? 0)).toBeGreaterThan(0);
      expect((p.geo.normals?.length ?? 0)).toBe(p.geo.positions!.length); // per-corner normals
      expect(p.geo.positions!.length % 9).toBe(0);                        // non-indexed tris
    }

    // Triangle counts partition the whole mesh exactly (no dropped/duplicated tris).
    const whole = triCount(out.full);
    const sum = parts.reduce((n, p) => n + triCount(p.geo), 0);
    expect(sum).toBe(whole);

    // One part transparent (glass, α≈0.15), one opaque (body, α==1).
    const ops = parts.map((p) => p.appearance.opacity ?? 1).sort((a, b) => a - b);
    expect(ops[0]).toBeCloseTo(0.15, 2);
    expect(ops[1]).toBeCloseTo(1, 2);

    // Per-part outer colour: the transparent part reads blue-ish, the opaque red-ish.
    const glass = parts.find((p) => (p.appearance.opacity ?? 1) < 1)!;
    const body = parts.find((p) => (p.appearance.opacity ?? 1) >= 1)!;
    const [gr, gg, gb] = hex(glass.appearance.colorOuter);
    expect(gb).toBeGreaterThan(gr);   // blue dominant → glass carried its own colour
    const [br, bgc, bb] = hex(body.appearance.colorOuter);
    expect(br).toBeGreaterThan(bb);   // red dominant → body carried its own colour
    void gg; void bgc;
  });

  it('an all-opaque composite → parts ABSENT (single-mesh `full` path preserved)', async () => {
    const fetch = fetchFor(opaqueSources);
    const { script } = await compilePrimitiveScript(opaqueSources.sp_op_asm, 'sp_op_asm', fetch);
    const lut = analyzeParts(opaqueSources.sp_op_asm, await resolveDepColors(opaqueSources.sp_op_asm, fetch));
    expect(Object.keys(lut.opacity).length).toBe(0); // no transparent subpart → gate closed

    const out = await runCompiledManifold(script, [], { parts: lut });
    expect(out.parts).toBeUndefined();
    // and the single mesh is still there (byte-identical path)
    expect((out.full.positions?.length ?? 0)).toBeGreaterThan(0);
  });
});
