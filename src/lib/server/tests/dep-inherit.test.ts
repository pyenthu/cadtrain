import { describe, expect, it } from 'vitest';
import { resolveDepColors, analyzeParts } from '../part-colors';
import { partHashId } from '$lib/graph/part-id';

const SRC: Record<string, string> = {
  r_revolve: `export const meta = { id:'r_revolve', kind:'prim' };\nexport function r_revolve(p){ return null; }`,
  g_shaft: `export const meta = { id:'g_shaft', kind:'asm', uses:['r_revolve'], colorOuter:'#2ecd23' };\nexport function g_shaft(p){ const A = r_revolve({}); return A; }`,
  bw_open_hole: `export const meta = { id:'bw_open_hole', kind:'asm', uses:['g_shaft'], colorOuter:'#b71515', instanceColors:{ A:{ outer:'#0f89e6', opacity:0.15 } } };\nexport function bw_open_hole(p){ const A = g_shaft({r:1}); return A; }`,
  w1_oh_vert: `export const meta = { id:'w1_oh_vert', kind:'asm', uses:['bw_open_hole'] };\nexport function w1_oh_vert(){ const A = bw_open_hole({}); return A; }`,
};
const mockFetch = (async (url: string) => {
  const m = String(url).match(/name=([a-z0-9_]+)/i);
  const s = m ? SRC[m[1]] : undefined;
  return { ok: !!s, json: async () => ({ source: s }) } as any;
}) as any;

describe('effective-appearance inheritance', () => {
  it('a leaf material carries UP to the parent (bw_open_hole blue → w1_oh_vert)', async () => {
    const dep = await resolveDepColors(SRC.w1_oh_vert, mockFetch);
    // w1 inherits bw_open_hole's EFFECTIVE colour = its part A's blue (not red default) + opacity.
    expect(dep.bw_open_hole).toEqual({ outer: '#0f89e6', opacity: 0.15 });
    // And w1's LUT renders its instance A blue.
    const lut = analyzeParts(SRC.w1_oh_vert, dep);
    expect(lut.active).toBe(true);
    expect(lut.outer[partHashId('A')]).toBe('#0f89e6');
    expect(lut.opacity[partHashId('A')]).toBe(0.15);
  });

  it('a parent OVERRIDE beats the inherited material', async () => {
    const parent = SRC.w1_oh_vert.replace("uses:['bw_open_hole'] }", "uses:['bw_open_hole'], instanceColors:{ A:{ outer:'#ff0000' } } }");
    const dep = await resolveDepColors(parent, mockFetch);
    const lut = analyzeParts(parent, dep);
    expect(lut.outer[partHashId('A')]).toBe('#ff0000'); // parent's pick wins over inherited blue
  });

  it('a plain part with only a top-level Default exports that default (g_shaft green)', async () => {
    const dep = await resolveDepColors(SRC.bw_open_hole, mockFetch);
    expect(dep.g_shaft).toEqual({ outer: '#2ecd23' });
  });
});
