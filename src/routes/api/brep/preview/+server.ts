import { json, error } from '@sveltejs/kit';
import { revolveBrep, extractRevolveProfile } from '$lib/server/brep-occt';

// POST /api/brep/preview — server-side OpenCascade (OCCT) BREP render.
// Two input shapes:
//   { kind:'revolve', profile:[[r,z],…] }          — explicit half-section
//   { source, paramValues:{name:val} }             — a part body; the revolve
//                                                     (r,z) profile is extracted
//                                                     and revolved
// Returns an adaptively-tessellated indexed mesh (+ OCCT exact-surface normals)
// for the editor's BREP tab. Parts with no top-level r_revolve return
// supported:false → the tab shows "no BREP path" instead of erroring.
export const POST = async ({ request }) => {
  let body: any;
  try { body = await request.json(); }
  catch { throw error(400, 'invalid JSON body'); }

  const { kind, profile, source, paramValues, tolerance, angularTolerance } = body ?? {};
  const opts = {
    tolerance: typeof tolerance === 'number' ? tolerance : undefined,
    angularTolerance: typeof angularTolerance === 'number' ? angularTolerance : undefined,
  };

  // Resolve the (r,z) profile from either an explicit array or a part source.
  let prof: [number, number][] | null = null;
  if (kind === 'revolve' && Array.isArray(profile)) {
    prof = profile;
  } else if (typeof source === 'string' && source.trim()) {
    prof = await extractRevolveProfile(source, (paramValues && typeof paramValues === 'object') ? paramValues : {});
    if (!prof) {
      return json({ supported: false, reason: 'no top-level r_revolve in this part — BREP path is revolve-only for now' });
    }
  } else {
    throw error(400, 'provide { kind:"revolve", profile } or { source, paramValues }');
  }

  if (!Array.isArray(prof) || prof.length < 3) {
    throw error(400, 'profile must resolve to ≥3 [r,z] points');
  }
  for (const p of prof) {
    if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number') {
      throw error(400, 'each profile point must be [r:number, z:number]');
    }
  }

  try {
    const mesh = await revolveBrep(prof, opts);
    return json({ supported: true, ...mesh });
  } catch (e: any) {
    throw error(500, `OCCT revolve failed: ${e?.message ?? e}`);
  }
};
