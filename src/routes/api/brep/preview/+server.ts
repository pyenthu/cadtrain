import { json, error } from '@sveltejs/kit';
import { revolveBrep, brepFromSource } from '$lib/server/brep-occt';

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

  const { kind, profile, source, paramValues, tolerance, angularTolerance, cut } = body ?? {};
  const opts = {
    tolerance: typeof tolerance === 'number' ? tolerance : undefined,
    angularTolerance: typeof angularTolerance === 'number' ? angularTolerance : undefined,
    cut: cut === true,   // half-section cutaway (inner-grey / outer-red)
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
      let mesh;
      try {
        mesh = await brepFromSource(source, params, opts, fetch);
      } catch (cutErr) {
        // The OCCT half-section CUT can throw a raw emscripten exception (a bare
        // numeric pointer) for some swept / boolean solids while the UNCUT solid
        // builds fine. Degrade gracefully: retry without the cut so BREP still
        // renders the solid (no half-section) instead of failing to a number.
        if (opts.cut) mesh = await brepFromSource(source, params, { ...opts, cut: false }, fetch);
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
