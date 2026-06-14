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

  const { kind, profile, source, paramValues, tolerance, angularTolerance } = body ?? {};
  const opts = {
    tolerance: typeof tolerance === 'number' ? tolerance : undefined,
    angularTolerance: typeof angularTolerance === 'number' ? angularTolerance : undefined,
  };

  // Explicit half-section → revolve directly.
  if (kind === 'revolve' && Array.isArray(profile)) {
    if (profile.length < 3) throw error(400, 'profile must be ≥3 [r,z] points');
    try {
      const mesh = await revolveBrep(profile as [number, number][], opts);
      return json({ supported: true, ...mesh });
    } catch (e: any) { throw error(500, `OCCT revolve failed: ${e?.message ?? e}`); }
  }

  // Part source → full graph→OCCT executor (revolve · extrude · loft · CSG).
  if (typeof source === 'string' && source.trim()) {
    try {
      const mesh = await brepFromSource(source, (paramValues && typeof paramValues === 'object') ? paramValues : {}, opts, fetch);
      if (!mesh) {
        return json({ supported: false, reason: 'no OCCT-buildable solid in this part (BREP covers revolve / extrude / loft / CSG)' });
      }
      return json({ supported: true, ...mesh });
    } catch (e: any) {
      // OCCT couldn't build/mesh it (unmapped op, bad profile, boolean failure)
      // → report gracefully so the tab shows the reason, not a 500.
      return json({ supported: false, reason: String(e?.message ?? e).slice(0, 200) });
    }
  }

  throw error(400, 'provide { kind:"revolve", profile } or { source, paramValues }');
};
