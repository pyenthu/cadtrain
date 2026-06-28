/**
 * r_helical_surface — KEYSTONE thread engine (Option 2, displacement surface).
 *
 * A helical THREAD as ONE welded `gridPatch` over the cylinder's OWN
 * coordinates (θ, z) — NOT over the helix. The helix lives ONLY in the
 * radial-displacement FUNCTION `r(θ, z)`; the mesh traversal never follows
 * the coil, so "the previous turn" is just earlier rows of the SAME grid —
 * already welded. The result is manifold BY CONSTRUCTION: no separate band,
 * no inter-turn weld, no CSG. Only the two z-ends need caps.
 *
 * The contract (the whole point — see docs/plans/sweep-thread-engine.md §Option 2):
 *   gridPatch(Nθ, Nz, fn):  u = i/Nθ → θ = u·2π,   v = j/Nz → z = v·length
 *     phase = frac(z·tpi − u)                  // position within ONE pitch
 *     amp   = runout(z)                        // taper amplitude→0 at both ends
 *     bump  = amp · tooth(phase, profile, depth, halfFrac)   // 0 in the valley
 *     r     = baseR + (external ? +bump : −bump)
 *     return [r·cosθ, r·sinθ, z]
 *   • Azimuthal wrap-weld: row Nθ (u=1, θ=2π) is byte-identical to row 0
 *     because frac(z·tpi − 1) == frac(z·tpi − 0); weldAndBuild merges the seam
 *     → it closes EXACTLY (no crack).
 *   • Two end caps (triangle fans over the wall's end rings) close the solid.
 *   • RUNOUT: amplitude tapers to 0 over the first/last `1/tpi` of z so the
 *     thread fades in/out cleanly (no abrupt wall at the ends).
 *
 * `side` flips the bump sign:
 *   • EXTERNAL (pin)     → r = baseR + bump : a solid threaded ROD whose OD
 *     undulates OUTWARD. Union with a shoulder → a pin. Use directly.
 *   • INTERNAL (box bore)→ r = baseR − bump : a solid plug of radius baseR
 *     with ridges pointing INWARD. SUBTRACT it from a sketched tube (bore <
 *     baseR−depth) → carves a helical thread into the bore wall (the box).
 * For an internal thread `od` is therefore the nominal BORE diameter.
 *
 * Single limitation (inherent to a single-valued r(θ,z)): NO undercut /
 * overhanging flanks — that's Option 4's swept-band-+-CSG job.
 *
 * Z-DOWN: z=0 is the TOP, larger z is DEEPER (down-hole). Default = a coarse,
 * legible demo thread (chunky pitch, deep V60 tooth).
 *
 * DELEGATES TO r_surface (the converged engine — docs/plans/sweep-thread-engine.md
 * "⭐ THE CONVERGENCE"): this engine is now literally `r_surface(threadFn, Nθ,
 * Nz, wrapU=true, capLo=true, capHi=true)` — it builds the radial-displacement
 * surface fn `[r·cosθ, r·sinθ, z]` and hands it to r_surface, which welds the
 * one gridPatch + caps. r_helical_surface === r_surface(threadFn). The thread's
 * IDENTITY (tooth / runout / seam / taper) lives in the fn below; r_surface owns
 * the (manifold-by-construction) meshing. The two end caps stay watertight
 * because runout zeros the amplitude at z=0 and z=L → the end rings are exact
 * baseR circles whose centroid is the axis (what the old hand-rolled cap fanned
 * to), so the geometry is byte-identical to the pre-delegation engine.
 *
 * STANDARD-LIBRARY PRIMITIVE — git-tracked, read-only in the GUI. `r_surface`
 * is resolved + injected by name via `meta.uses` (primitive-loader.ts); it is a
 * free runtime identifier here (no import — the source ships as raw text and is
 * transpiled in the sandbox, never type-checked as a module).
 */

export const meta = {
  id: 'r_helical_surface',
  name: 'r_helical_surface',
  uses: ['r_surface'],
  description:
    'Helical thread as ONE welded displacement surface r(θ,z) — manifold by construction (no band, no CSG, no inter-turn weld). The sweep axis is the cylinder\'s own (θ,z); the helix lives only in the radius function. profile 0=Square/1=V60/2=ACME; side 0=external (pin rod) / 1=internal (bore plug, SUBTRACT from a tube). Runout fades the thread in/out at both ends.',
  tags: ['welded', 'helix', 'thread', 'displacement', 'surface', 'sweep', 'stdlib'],
  params: {
    od:              { label: 'od (Ø)',            min: 0.5,  max: 12,  step: 0.125, default: 3.2 },
    length:          { label: 'length',            min: 0.5,  max: 30,  step: 0.5,   default: 5 },
    tpi:             { label: 'tpi (1/pitch)',     min: 0.2,  max: 32,  step: 0.1,   default: 1 },
    threadDepth:     { label: 'thread depth',      min: 0.01, max: 1.0, step: 0.01,  default: 0.25 },
    axialHalf:       { label: 'tooth axial 1/2 (z)',min: 0.01,max: 0.5, step: 0.005, default: 0.2 },
    profile:         { label: 'profile', type: 'enum',
                       options: ['Square', 'V60 (triangular)', 'ACME (trapezoid)'],
                       default: 1 },
    segmentsPerTurn: { label: 'segments / circle', min: 8,   max: 256, step: 1,     default: 96 },
    side:            { label: 'side', type: 'enum',
                       options: ['External (pin)', 'Internal (bore)'],
                       default: 0 },
    taper:           { label: 'taper (radial)',    min: -0.5, max: 0.5, step: 0.01,  default: 0 },
  },
  material: {
    outer: { color: '#7a8a3f', metallic: 0.5, roughness: 0.4 },
    inner: { color: '#3a3a3a', metallic: 0.1, roughness: 0.9 },
  },
};

export function r_helical_surface(
  od: number,
  length: number,
  tpi: number,
  threadDepth: number,
  axialHalf: number,
  profile: number,
  segmentsPerTurn: number,
  side: number,
  taper: number,
): any {
  // ─── clamp params ────────────────────────────────────────────────────
  const baseR = Math.max(0.1, od) / 2;
  const L = Math.max(0.1, length);
  const T = Math.max(0.05, tpi);
  const dep = Math.max(0.001, Math.min(threadDepth, baseR * 0.9));
  const hAxZ = Math.max(0.001, axialHalf);               // tooth half-width in Z
  const profCode = Math.max(0, Math.min(2, Math.round(profile)));
  const ext = Math.round(side || 0) === 0;               // 0 = external (default)
  const dir = ext ? +1 : -1;
  const taperFrac = Math.max(-0.5, Math.min(0.5, taper || 0));

  // Circumferential resolution: one full circle (single-start thread → exactly
  // ONE tooth crossing per revolution). The wrap row at i=Nθ is coincident with
  // row 0 and welds away.
  const Nth = Math.max(8, Math.floor(segmentsPerTurn));

  // Axial resolution: enough Z-samples to resolve the tooth ridge (z-span
  // 2·hAxZ) AND the pitch (1/T). Aim ≈ 24 samples / pitch, and ≥ 8 across the
  // ridge; cap so a long/fine thread can't explode the vertex count (Rule 25 —
  // segmentation belongs at BUILD time).
  const turns = T * L;
  const perPitch = Math.max(24, Math.ceil((2 * hAxZ) > 0 ? (3 / (2 * hAxZ * T)) * 8 : 24));
  let Nz = Math.ceil(turns * perPitch);
  Nz = Math.max(8, Math.min(900, Nz));

  // Tooth half-width as a fraction of one pitch. pitch length in Z = 1/T, so
  // halfFrac = hAxZ / (1/T) = hAxZ·T. Clamp < 0.49 so the ridge never fills the
  // whole pitch (always a valley between turns).
  const halfFrac = Math.min(0.49, hAxZ * T);

  // Runout length = one pitch (1/T) at each end.
  const runout = 1 / T;

  // ─── tooth profile: radial height as a fn of fractional pitch position ────
  // phase ∈ [0,1); tooth centred at phase = 0.5 so the seam (phase 0/1, the
  // valley) is well clear of the ridge. Returns 0 in the valley.
  function tooth(phase: number): number {
    const d = Math.abs(phase - 0.5);          // distance from tooth centre
    if (d >= halfFrac) return 0;              // valley → base radius
    const x = d / halfFrac;                   // 0 at centre … 1 at flank
    if (profCode === 1) {
      // V60 — triangular: full depth at centre, linear ramp to 0 at the flanks.
      return dep * (1 - x);
    } else if (profCode === 2) {
      // ACME — trapezoid: flat crest over the inner 40%, ramp on the outer 60%.
      const crest = 0.4;
      if (x <= crest) return dep;
      return dep * (1 - (x - crest) / (1 - crest));
    }
    // Square — step: full depth across the whole tooth.
    return dep;
  }

  // Runout amplitude factor: 0 at z=0 and z=L, ramping to 1 over `runout`.
  function ampAt(z: number): number {
    const a = Math.min(1, z / runout);
    const b = Math.min(1, (L - z) / runout);
    return Math.max(0, Math.min(a, b));
  }

  // Radius at (θ-fraction u, z). The whole thread lives here.
  function radius(u: number, z: number): number {
    const phase = ((z * T - u) % 1 + 1) % 1;            // frac(z·tpi − u)
    const bump = ampAt(z) * tooth(phase);
    // Optional linear radial taper of the BASE radius along z (NPT-ish). 0 = none.
    const rb = baseR * (1 - taperFrac * (z / L));
    return rb + dir * bump;
  }

  // ─── the thread surface fn: r(θ,z) → [x,y,z] ─────────────────────────────
  // The whole thread IDENTITY (tooth/runout/seam/taper) is in `radius()` above;
  // here it just becomes the converged engine's fn(u,v). u = θ/2π (wraps), v =
  // z/L (the open axis the caps close).
  const threadFn = (u: number, v: number): [number, number, number] => {
    const z = v * L;
    const theta = u * 2 * Math.PI;
    const r = radius(u, z);
    return [r * Math.cos(theta), r * Math.sin(theta), z];
  };

  // ─── DELEGATE: r_helical_surface === r_surface(threadFn) ─────────────────
  // wrapU closes the θ-seam (frac(z·tpi − 1) == frac(z·tpi − 0) → coincident →
  // welded); capLo/capHi fan the two z-ends shut. Because runout zeros the
  // amplitude at z=0 and z=L, those end rings are exact baseR circles whose
  // centroid is the axis — identical to the old hand-rolled axis-apex cap fan.
  return r_surface(threadFn, Nth, Nz, true, true, true);
}

// r_surface is resolved + injected by name via meta.uses (primitive-loader.ts).
// Declared here only so a type-check of this file as a module wouldn't flag the
// free identifier; at runtime the sandbox provides the real engine.
declare const r_surface: (
  fn: (u: number, v: number) => [number, number, number],
  Nu: number, Nv: number, wrapU: boolean, capLo: boolean, capHi: boolean,
) => any;
