import { json, error } from '@sveltejs/kit';
import { solidFromSource } from '$lib/engines/brep/brep-occt';
import { brepSolidToSvg, brepRevolveToSvg, type BrepSvgOpts, type BrepSvgMode } from '$lib/engines/brep/svg/brep-to-svg';

// POST /api/brep/svg — server-side OpenCascade (OCCT) BREP → SVG.
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
// Returns { supported:true, svg, meta:{ ms, mode } } on success. Parts with no
// OCCT-buildable solid return { supported:false, reason } — the SAME isolation
// contract as preview: every failure degrades to 200 + supported:false so the
// BREP-SVG surface never 500s or destabilises the app.
export const POST = async ({ request, fetch }) => {
  let body: any;
  try { body = await request.json(); }
  catch { throw error(400, 'invalid JSON body'); }

  const { kind, profile, source, paramValues } = body ?? {};

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
    // OCCT, no dep resolution). brepRevolveToSvg ensures OCCT + self-frees.
    if (kind === 'revolve' && Array.isArray(profile)) {
      if (profile.length < 3) return json({ supported: false, reason: 'profile must be ≥3 [r,z] points' });
      const svg = await brepRevolveToSvg(profile as [number, number][], svgOpts);
      return json({ supported: true, svg, meta: { ms: Date.now() - t0, mode: modeOf(svg) } });
    }

    // Part source → the SAME graph→OCCT executor the preview endpoint uses,
    // returning the composed solid, then project its boundary to SVG.
    if (typeof source === 'string' && source.trim()) {
      const params = (paramValues && typeof paramValues === 'object') ? paramValues : {};
      const solid = await solidFromSource(source, params, {}, fetch);
      if (!solid) return json({ supported: false, reason: 'no OCCT-buildable solid in this part (BREP covers revolve / extrude / loft / CSG)' });
      try {
        const svg = await brepSolidToSvg(solid, svgOpts);
        return json({ supported: true, svg, meta: { ms: Date.now() - t0, mode: modeOf(svg) } });
      } finally {
        // We own the solid's lifetime (executeBrep kept it past its own sweep) —
        // free the WASM heap now that it is projected. Best-effort; never throws.
        try { if (solid && typeof solid.delete === 'function') solid.delete(); } catch { /* already gone */ }
      }
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
