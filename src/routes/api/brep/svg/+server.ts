import { json, error } from '@sveltejs/kit';
import { solidFromSource } from '$lib/engines/brep/brep-occt';
import {
  brepSolidToSvg, brepRevolveToSvg,
  brepSolidToPolylines, brepRevolveToPolylines,
  type BrepSvgOpts, type BrepSvgMode, type BrepPolylinesResult,
} from '$lib/engines/brep/svg/brep-to-svg';

// POST /api/brep/svg — server-side OpenCascade (OCCT) BREP → SVG (or raw polylines).
//
// The boundary-projection sibling of /api/brep/preview: it resolves + executes
// the SAME graph→OCCT solid (via solidFromSource — the shared brep-occt executor
// + dependency resolution the preview endpoint uses), then projects that solid's
// TRUE boundary (silhouette + sharp edges, hidden-line removed) to an SVG string
// instead of tessellating it to a mesh. Same two input shapes as preview:
//   { kind:'revolve', profile:[[r,z],…] }   — explicit half-section, built + projected directly
//   { source, paramValues:{name:val} }        — a part body → full graph→OCCT executor → projected
// plus optional SVG projection options threaded straight to brepSolidToSvg:
//   { mode:'hlr'|'edges', fill:'none'|'silhouette'|'lambert', hiddenLines, margin,
//     strokeVisible, strokeHidden, strokeWidth, fillColor, background, camera }
//
// Default (absent `format`) → { supported:true, svg, meta:{ ms, mode } } — the
// byte-identical SVG string the B·SVG tab renders. With `format:'polylines'`
// (#998 — the WGPU GPU line-render tab) → { supported:true, polylines, bbox, meta }
// INSTEAD of the SVG: `polylines` is the RAW projected 2D boundary (an array of
// `[x,y]`-point arrays in the SAME 2D space the edge-mode SVG paths use), `bbox`
// the tight 2D bounds — ready to upload straight to a GPU vertex buffer. Parts
// with no OCCT-buildable solid return { supported:false, reason } — the SAME
// isolation contract as preview: every failure degrades to 200 + supported:false
// so the BREP-SVG surface never 500s or destabilises the app.
export const POST = async ({ request, fetch }) => {
  let body: any;
  try { body = await request.json(); }
  catch { throw error(400, 'invalid JSON body'); }

  const { kind, profile, source, paramValues } = body ?? {};
  // #998 — raw-polyline mode: return the projected 2D boundary point arrays for
  // the WebGPU line render instead of an SVG string. Absent/other = SVG (default).
  const wantPolylines = body?.format === 'polylines';

  // Validated + defaulted subset of BrepSvgOpts (JSON can only carry a camera
  // string, not a ProjectionCamera instance). Absent / malformed fields fall to
  // brepSolidToSvg's own defaults (mode:'hlr', outline-only, front elevation).
  const svgOpts: BrepSvgOpts = {
    mode: (body?.mode === 'edges' || body?.mode === 'hlr') ? (body.mode as BrepSvgMode) : undefined,
    fill: (body?.fill === 'silhouette' || body?.fill === 'lambert' || body?.fill === 'none') ? body.fill : undefined,
    hiddenLines: body?.hiddenLines === true,
    margin: typeof body?.margin === 'number' ? body.margin : undefined,
    strokeVisible: typeof body?.strokeVisible === 'string' ? body.strokeVisible : undefined,
    strokeHidden: typeof body?.strokeHidden === 'string' ? body.strokeHidden : undefined,
    strokeWidth: typeof body?.strokeWidth === 'number' ? body.strokeWidth : undefined,
    fillColor: typeof body?.fillColor === 'string' ? body.fillColor : undefined,
    background: typeof body?.background === 'string' ? body.background : undefined,
    camera: typeof body?.camera === 'string' ? body.camera : undefined,
  };

  // Pull the projection-path marker (`data-brep-svg-mode="hlr|edges"`) the
  // exporter stamps on the <svg>, so `meta.mode` reports which path ran (HLR can
  // self-recover to edges on an internal throw).
  const modeOf = (svg: string): BrepSvgMode | undefined => {
    const m = /data-brep-svg-mode="(hlr|edges)"/.exec(svg);
    return m ? (m[1] as BrepSvgMode) : undefined;
  };

  try {
    const t0 = Date.now();

    // Explicit half-section → build + project the revolve solid directly (pure
    // OCCT, no dep resolution). brepRevolve* ensures OCCT + self-frees.
    if (kind === 'revolve' && Array.isArray(profile)) {
      if (profile.length < 3) return json({ supported: false, reason: 'profile must be ≥3 [r,z] points' });
      if (wantPolylines) {
        const pl = await brepRevolveToPolylines(profile as [number, number][], svgOpts);
        return json({ supported: true, polylines: pl.polylines, bbox: pl.bbox, meta: { ms: Date.now() - t0, ...pl.meta } });
      }
      const svg = await brepRevolveToSvg(profile as [number, number][], svgOpts);
      return json({ supported: true, svg, meta: { ms: Date.now() - t0, mode: modeOf(svg) } });
    }

    // Part source → the SAME graph→OCCT executor the preview endpoint uses,
    // returning the composed solid, then project its boundary (to SVG, or raw
    // polylines when format:'polylines').
    if (typeof source === 'string' && source.trim()) {
      const params = (paramValues && typeof paramValues === 'object') ? paramValues : {};
      // Resolve + execute the composed solid, then project its boundary. A curved
      // hollow swept-boolean whose body bakes a half-section (sectionCut) can throw
      // in OCCT on the exact cut — mirror /api/brep/preview's `cut:false` retry:
      // rebuild WITHOUT the section (noSectionCut) so the SVG degrades to the uncut
      // solid instead of failing. Each attempt owns + frees its own solid.
      const buildAndProject = async (degrade: boolean): Promise<string | BrepPolylinesResult | null> => {
        const solid = await solidFromSource(source, params, degrade ? { noSectionCut: true } : {}, fetch);
        if (!solid) return null;
        try {
          return wantPolylines
            ? await brepSolidToPolylines(solid, svgOpts)
            : await brepSolidToSvg(solid, svgOpts);
        } finally {
          // We own the solid's lifetime (executeBrep kept it past its own sweep) —
          // free the WASM heap now that it is projected. Best-effort; never throws.
          try { if (typeof solid.delete === 'function') solid.delete(); } catch { /* already gone */ }
        }
      };
      let result: string | BrepPolylinesResult | null;
      try { result = await buildAndProject(false); }
      catch { result = await buildAndProject(true); }   // degrade: rebuild uncut, never 500
      if (result == null) return json({ supported: false, reason: 'no OCCT-buildable solid in this part (BREP covers revolve / extrude / loft / CSG)' });
      if (wantPolylines) {
        const pl = result as BrepPolylinesResult;
        return json({ supported: true, polylines: pl.polylines, bbox: pl.bbox, meta: { ms: Date.now() - t0, ...pl.meta } });
      }
      const svg = result as string;
      return json({ supported: true, svg, meta: { ms: Date.now() - t0, mode: modeOf(svg) } });
    }

    return json({ supported: false, reason: 'provide { kind:"revolve", profile } or { source, paramValues }' });
  } catch (e: any) {
    // OCCT/emscripten can throw a RAW NUMBER (a heap pointer) — don't surface that
    // as the reason (mirrors /api/brep/preview's error shaping).
    const reason = (e == null || typeof e === 'number' || typeof e === 'bigint')
      ? `OCCT/WASM internal error (${String(e)})`
      : String(e?.message ?? e).slice(0, 200);
    return json({ supported: false, reason });
  }
};
