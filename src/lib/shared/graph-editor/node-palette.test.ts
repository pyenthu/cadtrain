import { describe, it, expect } from 'vitest';
import { newGraph } from '$lib/cad/composition-graph-hydrate';
import { buildSolidDrop, POLY_EXTRUDE_DEFAULT } from './node-palette';

const nodesArr = (g: ReturnType<typeof newGraph>) => Object.values(g.nodes) as any[];
const callsOf = (g: ReturnType<typeof newGraph>, src: string) => nodesArr(g).filter((n) => n.type === 'call' && n.src === src);

describe('buildSolidDrop', () => {
  it('revolve → creates a SKETCH producer + an r_revolve call wired via __POLY__', () => {
    const { graph, bakeBump } = buildSolidDrop(newGraph(), 'revolve');
    expect(bakeBump).toBe(false);
    const sketch = nodesArr(graph).find((n) => n.type === 'sketch');
    expect(sketch).toBeTruthy();
    const rev = callsOf(graph, 'r_revolve');
    expect(rev).toHaveLength(1);
    expect((rev[0].args.profile as any).expr).toBe('__POLY__' + sketch.id);
  });

  it('extrude → creates a POLYGON producer + an r_weld_extrude call', () => {
    const { graph } = buildSolidDrop(newGraph(), 'extrude');
    const poly = nodesArr(graph).find((n) => n.type === 'polygon');
    expect(poly).toBeTruthy();
    const ext = callsOf(graph, 'r_weld_extrude');
    expect(ext).toHaveLength(1);
    expect((ext[0].args.profile as any).expr).toBe('__POLY__' + poly.id);
    // r_weld_extrude carries the meta.params sig (length/divs/twist/taper/segments)
    expect(ext[0].args.length).toBeDefined();
    expect(ext[0].args.taper).toBeDefined();
  });

  it('loft → r_loft with a barrel bulge default', () => {
    const { graph } = buildSolidDrop(newGraph(), 'loft');
    const loft = callsOf(graph, 'r_loft');
    expect(loft).toHaveLength(1);
    expect((loft[0].args.shape as any).value).toBe('barrel');
    expect((loft[0].args.bulge as any).value).toBe(0.4);
  });

  it('sweep → r_sweep with round section + L-bend path, and asks for a bake bump', () => {
    const { graph, bakeBump } = buildSolidDrop(newGraph(), 'sweep');
    expect(bakeBump).toBe(true);
    const sweep = callsOf(graph, 'r_sweep');
    expect(sweep).toHaveLength(1);
    expect((sweep[0].args.path as any).expr).toContain('[[0, 0, 0]');
    expect((sweep[0].args.section as any).expr).toContain('Math.cos');
    // sweep seeds NO profile producer (it carries both inputs inline)
    expect(nodesArr(graph).some((n) => n.type === 'sketch' || n.type === 'polygon')).toBe(false);
  });

  it('reuses an EXISTING polygon rather than creating a second one', () => {
    const first = buildSolidDrop(newGraph(), 'extrude').graph;
    const polyCount1 = nodesArr(first).filter((n) => n.type === 'polygon').length;
    const second = buildSolidDrop(first, 'extrude').graph;
    const polyCount2 = nodesArr(second).filter((n) => n.type === 'polygon').length;
    expect(polyCount1).toBe(1);
    expect(polyCount2).toBe(1); // shared producer, not duplicated
  });

  it('POLY_EXTRUDE_DEFAULT is a unit square (4 literal r,z verts)', () => {
    expect(POLY_EXTRUDE_DEFAULT).toHaveLength(4);
    expect((POLY_EXTRUDE_DEFAULT[0].r as any).value).toBe(-1);
  });
});
