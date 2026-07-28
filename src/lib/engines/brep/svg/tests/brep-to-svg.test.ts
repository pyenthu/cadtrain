/**
 * brep-to-svg.test.ts — OFFLINE pins for the BREP→SVG boundary-projection
 * exporter. No network, no volume: bakes a self-contained OCCT solid via the
 * same `revolveBrep` helper `brep-occt.test.ts` uses, projects it, and asserts
 * the output encodes true BOUNDARY EDGES — far fewer path elements than the
 * solid's triangle count — proving it is edges, not a projected triangle soup.
 */
import { describe, it, expect } from 'vitest';
import { brepRevolveToSvg, brepSolidToSvg, brepRevolveToPolylines } from '../brep-to-svg';
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

// ── #998 — raw polyline accessor (WGPU GPU line-render feed) ──────────────────
describe('brep-to-svg: format:"polylines" raw accessor', () => {
  it('cylinder → non-empty polylines of finite [x,y] points + a finite bbox (minX<maxX)', async () => {
    const { polylines, bbox, meta } = await brepRevolveToPolylines(CYL);

    // A non-empty array of polylines, each a non-empty array of [x,y] pairs.
    expect(Array.isArray(polylines), 'polylines must be an array').toBe(true);
    expect(polylines.length, 'must project ≥1 boundary polyline').toBeGreaterThanOrEqual(1);
    let totalPts = 0;
    for (const pl of polylines) {
      expect(Array.isArray(pl) && pl.length >= 2, 'each polyline is ≥2 points').toBe(true);
      for (const p of pl) {
        expect(p.length, 'each point is [x,y]').toBe(2);
        expect(Number.isFinite(p[0]) && Number.isFinite(p[1]), 'point coords finite').toBe(true);
        totalPts++;
      }
    }

    // A finite, non-degenerate bbox — minX strictly < maxX (the fit source).
    expect(Number.isFinite(bbox.minX) && Number.isFinite(bbox.maxX), 'bbox x finite').toBe(true);
    expect(Number.isFinite(bbox.minY) && Number.isFinite(bbox.maxY), 'bbox y finite').toBe(true);
    expect(bbox.minX, 'bbox must have width (minX<maxX)').toBeLessThan(bbox.maxX);
    expect(bbox.minY, 'bbox must have height (minY<maxY)').toBeLessThan(bbox.maxY);

    // meta echoes the edge projection + point count.
    expect(meta.mode).toBe('edges');
    expect(meta.edges).toBe(polylines.length);
    expect(meta.points).toBe(totalPts);
  });

  it('polyline points lie inside the edge-mode SVG viewBox (same 2D frame, no re-projection)', async () => {
    const { polylines, bbox } = await brepRevolveToPolylines(CYL);
    // The edge-mode SVG's viewBox is the same bounds padded by the default margin (2),
    // proving the polylines share the SVG's projected space rather than a fresh one.
    const svg = await brepRevolveToSvg(CYL, { mode: 'edges' });
    const vb = /viewBox="([^"]+)"/.exec(svg)![1].trim().split(/\s+/).map(Number);
    const [vx, vy, vw, vh] = vb;
    expect(bbox.minX).toBeGreaterThanOrEqual(vx - 1e-3);
    expect(bbox.maxX).toBeLessThanOrEqual(vx + vw + 1e-3);
    expect(bbox.minY).toBeGreaterThanOrEqual(vy - 1e-3);
    expect(bbox.maxY).toBeLessThanOrEqual(vy + vh + 1e-3);
    void polylines;
  });
});

// ── #999 — fill polygon accessor (WGPU shading pass feed) ────────────────────
describe('brep-to-svg: format:"polylines" fills (silhouette shading feed)', () => {
  it('cylinder → non-empty fills of finite [x,y] triangle rings, each a valid triangle', async () => {
    const { fills, fillShades, bbox, meta } = await brepRevolveToPolylines(CYL);

    expect(Array.isArray(fills), 'fills must be an array').toBe(true);
    expect(fills.length, 'a meshable cylinder must project ≥1 fill region').toBeGreaterThanOrEqual(1);
    for (const ring of fills) {
      expect(Array.isArray(ring), 'each fill is a ring of points').toBe(true);
      expect(ring.length, 'each fill ring is a triangle (≥3 points)').toBeGreaterThanOrEqual(3);
      for (const p of ring) {
        expect(p.length, 'each fill point is [x,y]').toBe(2);
        expect(Number.isFinite(p[0]) && Number.isFinite(p[1]), 'fill point coords finite').toBe(true);
      }
    }
    // meta echoes the fill-region count.
    expect(meta.fills).toBe(fills.length);

    // Optional per-region shade — present, parallel to fills, in 0..1.
    expect(Array.isArray(fillShades), 'fillShades must be an array').toBe(true);
    expect(fillShades.length, 'fillShades parallel to fills').toBe(fills.length);
    for (const s of fillShades) expect(s >= 0 && s <= 1, `shade ${s} must be 0..1`).toBe(true);

    // bbox is a sanity guard for the fill containment test below.
    expect(bbox.minX).toBeLessThan(bbox.maxX);
    expect(bbox.minY).toBeLessThan(bbox.maxY);
  });

  it('every fill vertex lies INSIDE the same bbox as the polylines (one 2D frame)', async () => {
    const { polylines, fills, bbox } = await brepRevolveToPolylines(CYL);
    const eps = 1e-4;
    // Both the outline polylines AND the fills must be contained by the unioned bbox.
    const within = (x: number, y: number) =>
      x >= bbox.minX - eps && x <= bbox.maxX + eps && y >= bbox.minY - eps && y <= bbox.maxY + eps;
    for (const pl of polylines) for (const [x, y] of pl) expect(within(x, y), 'polyline vertex in bbox').toBe(true);
    for (const ring of fills) for (const [x, y] of ring) expect(within(x, y), 'fill vertex in bbox').toBe(true);
  });
});
