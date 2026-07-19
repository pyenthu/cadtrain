import { json, error } from '@sveltejs/kit';
import { revolveBrep, brepFromSource } from '$lib/engines/brep/brep-occt';
import { analyzeParts, resolveDepColors, type PartColorLUT } from '$lib/server/part-colors';

/** #86 — the per-part color-by-source LUT for a composite BREP part. Same code
 *  the /api/primitives/compile endpoint uses (partColorsFor) so BREP colours
 *  MATCH the Manifold tab exactly. BREP bakes server-side, so we compute the LUT
 *  HERE (we have the source + fetch) rather than round-tripping it from the
 *  client the way MF must (its worker bakes on the client). Fully tolerant —
 *  any failure omits it → the legacy uniform BREP skin. */
async function partColorsFor(source: string, fetch: typeof globalThis.fetch): Promise<PartColorLUT | undefined> {
  try {
    const lut = analyzeParts(source, await resolveDepColors(source, fetch));
    return lut.active ? lut : undefined;
  } catch { return undefined; }
}

// POST /api/brep/preview — server-side OpenCascade (OCCT) BREP render.
// Two input shapes:
//   { kind:'revolve', profile:[[r,z],…] }          — explicit half-section
//   { source, paramValues:{name:val} }             — a part body; the revolve
//                                                     (r,z) profile is extracted
//                                                     and revolved
// Returns an adaptively-tessellated indexed mesh (+ OCCT exact-surface normals)
// for the editor's BREP tab. Parts with no top-level r_revolve return
// supported:false → the tab shows "no BREP path" instead of erroring.
export const POST = async ({ request, fetch }) => {
  let body: any;
  try { body = await request.json(); }
  catch { throw error(400, 'invalid JSON body'); }

  const { kind, profile, source, paramValues, tolerance, angularTolerance, cut, colorOuter, colorInner } = body ?? {};
  const opts = {
    tolerance: typeof tolerance === 'number' ? tolerance : undefined,
    angularTolerance: typeof angularTolerance === 'number' ? angularTolerance : undefined,
    cut: cut === true,   // half-section cutaway (inner / outer, coloured below)
    // The cut arm's outer/inner vertex colours = the part's real appearance
    // (#997). Absent → brep-occt falls back to the legacy red/grey.
    colorOuter: typeof colorOuter === 'string' ? colorOuter : undefined,
    colorInner: typeof colorInner === 'string' ? colorInner : undefined,
  };

  // ISOLATION CONTRACT: the BREP path is OPTIONAL/experimental. It must NEVER
  // 500 or otherwise destabilise the system — every failure (bad input, OCCT
  // build error, WASM hiccup) returns 200 + supported:false with a reason, so
  // the BREP tab degrades to a message and the rest of the app is untouched.
  try {
    // Explicit half-section → revolve directly.
    if (kind === 'revolve' && Array.isArray(profile)) {
      if (profile.length < 3) return json({ supported: false, reason: 'profile must be ≥3 [r,z] points' });
      const mesh = await revolveBrep(profile as [number, number][], opts);
      return json({ supported: true, ...mesh });
    }
    // Part source → full graph→OCCT executor (revolve · extrude · loft · CSG).
    if (typeof source === 'string' && source.trim()) {
      const params = (paramValues && typeof paramValues === 'object') ? paramValues : {};
      // Per-part colour LUT (color-by-source). The client MAY thread it in the
      // body (the compiled `partColors`, same shape MF ships); otherwise we
      // self-compute it from the source. Only the UNCUT full mesh uses it —
      // brep-occt keeps the cut arm's colorOuter/colorInner intact.
      const partColors = (body?.partColors && typeof body.partColors === 'object')
        ? (body.partColors as PartColorLUT)
        : await partColorsFor(source, fetch);
      // Non-persisted spline-aware VIEW scale (Problem 2) — threaded to the warp
      // executor so a warped BREP part fattens (radial) / lengthens (depth) pre-sweep.
      const warpViewScale = (body?.warpViewScale && typeof body.warpViewScale === 'object')
        ? (body.warpViewScale as { radial?: number; depth?: number }) : undefined;
      const meshOpts = { ...opts, partColors, ...(warpViewScale ? { warpViewScale } : {}) };
      let mesh;
      try {
        mesh = await brepFromSource(source, params, meshOpts, fetch);
      } catch (cutErr) {
        // The OCCT half-section CUT can throw a raw emscripten exception (a bare
        // numeric pointer) for some swept / boolean solids while the UNCUT solid
        // builds fine. Degrade gracefully: retry without the cut so BREP still
        // renders the solid (no half-section) instead of failing to a number.
        if (opts.cut) mesh = await brepFromSource(source, params, { ...meshOpts, cut: false }, fetch);
        else throw cutErr;
      }
      if (!mesh) return json({ supported: false, reason: 'no OCCT-buildable solid in this part (BREP covers revolve / extrude / loft / CSG)' });
      return json({ supported: true, ...mesh });
    }
    return json({ supported: false, reason: 'provide { kind:"revolve", profile } or { source, paramValues }' });
  } catch (e: any) {
    // OCCT/emscripten throws a RAW NUMBER (a heap pointer) as the exception — do
    // not surface that as the "reason" (it reads as a garbage count in the tab).
    const reason = (e == null || typeof e === 'number' || typeof e === 'bigint')
      ? `OCCT/WASM internal error (${String(e)})`
      : String(e?.message ?? e).slice(0, 200);
    return json({ supported: false, reason });
  }
};
