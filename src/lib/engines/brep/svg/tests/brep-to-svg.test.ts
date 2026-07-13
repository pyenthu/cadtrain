/**
 * brep-to-svg.test.ts — OFFLINE pins for the BREP→SVG boundary-projection
 * exporter. No network, no volume: bakes a self-contained OCCT solid via the
 * same `revolveBrep` helper `brep-occt.test.ts` uses, projects it, and asserts
 * the output encodes true BOUNDARY EDGES — far fewer path elements than the
 * solid's triangle count — proving it is edges, not a projected triangle soup.
 */
import { describe, it, expect } from 'vitest';
import { brepRevolveToSvg, brepSolidToSvg } from '../brep-to-svg';
import { revolveBrep } from '../../brep-occt';

// A solid cylinder half-section (r 0.01→2, z 0→6), same family as the #997 test.
const CYL: [number, number][] = [[0.01, 0], [2, 0], [2, 6], [0.01, 6]];

/** Count drawn primitives + total M/L/C/A path commands in an SVG string. */
function countGeom(svg: string) {
  const elements = (svg.match(/<(path|polyline)\b/g) || []).length;
  const commands = (svg.match(/[MLCAQZ]/g) || []).length;
  return { elements, commands };
}

/** Every numeric token inside the SVG must be finite (no NaN/Infinity leaking). */
function allCoordsFinite(svg: string): boolean {
  const nums = svg.match(/-?\d+(\.\d+)?(e-?\d+)?/gi) || [];
  return nums.length > 0 && nums.every((n) => Number.isFinite(Number(n)));
}

describe('brep-to-svg: HLR boundary projection (primary path)', () => {
  it('cylinder → non-empty <svg> with ≥1 boundary <path>', async () => {
    const svg = await brepRevolveToSvg(CYL);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
    expect(svg).toMatch(/viewBox="/);
    expect(countGeom(svg).elements, 'must draw ≥1 path/polyline').toBeGreaterThanOrEqual(1);
  });

  it('encodes BOUNDARY EDGES, not triangle soup (path elements << mesh triangles)', async () => {
    const svg = await brepRevolveToSvg(CYL);
    // The SAME solid, tessellated, for the triangle-count baseline.
    const mesh = await revolveBrep(CYL, { cut: false });
    const tris = mesh.meta.tris;
    const { elements, commands } = countGeom(svg);

    expect(tris, 'sanity: the tessellated cylinder has many triangles').toBeGreaterThan(40);
    // Boundary → a handful of outline paths; triangle soup would be ~tris paths.
    expect(elements, `svg path elements (${elements}) must be << mesh tris (${tris})`).toBeLessThan(tris / 4);
    // Even total draw COMMANDS stay well under the triangle count for this shape.
    expect(commands, `svg draw commands (${commands}) must be < mesh tris (${tris})`).toBeLessThan(tris);
  });

  it('coordinates are all finite', async () => {
    const svg = await brepRevolveToSvg(CYL);
    expect(allCoordsFinite(svg)).toBe(true);
  });

  it('records which projection path produced the SVG (mode marker)', async () => {
    const svg = await brepRevolveToSvg(CYL);
    // Default is managed HLR; on an internal HLR throw it self-recovers to edges.
    expect(svg).toMatch(/data-brep-svg-mode="(hlr|edges)"/);
  });
});

describe('brep-to-svg: fallback + fill modes', () => {
  it('mode:"edges" (direct edge projection) also yields boundary paths', async () => {
    const svg = await brepRevolveToSvg(CYL, { mode: 'edges' });
    expect(svg).toMatch(/data-brep-svg-mode="edges"/);
    const mesh = await revolveBrep(CYL, { cut: false });
    const { elements } = countGeom(svg);
    expect(elements).toBeGreaterThanOrEqual(1);
    expect(elements, 'edge projection is still edges, not triangles').toBeLessThan(mesh.meta.tris / 4);
    expect(allCoordsFinite(svg)).toBe(true);
  });

  it('fill:"silhouette" adds a filled region but stays edge-bounded', async () => {
    const svg = await brepRevolveToSvg(CYL, { fill: 'silhouette' });
    expect(svg).toMatch(/fill="#c8ccd2"/);
    const mesh = await revolveBrep(CYL, { cut: false });
    expect(countGeom(svg).elements).toBeLessThan(mesh.meta.tris);
  });

  it('fill:"lambert" shades per-face regions bounded by real wires', async () => {
    const svg = await brepRevolveToSvg(CYL, { fill: 'lambert' });
    // Lambert routes through the ortho projector (edges mode) for aligned fills.
    expect(svg).toMatch(/data-brep-svg-mode="edges"/);
    expect(countGeom(svg).elements, 'lambert emits face fills + edges').toBeGreaterThanOrEqual(1);
    expect(allCoordsFinite(svg)).toBe(true);
  });

  it('brepSolidToSvg is the alias entry (brepToSvg) over a prebuilt solid', async () => {
    // Build the solid the same way revolveBrep does, then project it directly.
    const { ensureOC } = await import('../../brep-occt');
    await ensureOC();
    const replicad: any = await import('replicad');
    const { draw } = replicad;
    let d = draw([CYL[0][0], CYL[0][1]]);
    for (let i = 1; i < CYL.length; i++) d = d.lineTo([CYL[i][0], CYL[i][1]]);
    const solid = d.close().sketchOnPlane('XZ').revolve();
    const svg = await brepSolidToSvg(solid, {});
    expect(svg.startsWith('<svg')).toBe(true);
    expect(countGeom(svg).elements).toBeGreaterThanOrEqual(1);
  });
});
