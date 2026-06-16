/**
 * Stage 2 (Track B / closed-form layer) — uniaxial-tension stress &
 * strain on a tubular shaft loaded by equal forces F at each end.
 *
 * Free-body diagram:
 *
 *     ←—— F ——————————◯═════════════════◯—————— F ——→
 *
 * Equal F pulls both ends → internal axial force = F (constant along
 * length) → uniform σ_axial everywhere on the section AND along z.
 * No torsion, no bending, no mesh, no solver.
 *
 *   σ_axial = F / A,   A = π · (OD² − ID²) / 4
 *   ε_axial = σ_axial / E
 *   ΔL      = ε_axial · L
 *   σ_vm    = |σ_axial|        (uniaxial)
 *   SF      = σ_y / σ_vm
 *
 * This module is the engine half of `/fem/[id]/tension` — the UI layer
 * imports `computeTensionStress` + the LUT helpers and feeds the
 * results straight into a Threlte scene.
 *
 * Units = oilfield (lbf in / out, psi internally, ksi for the panel).
 * Young's modulus default = 30 × 10⁶ psi (AISI 4130/4140 steel; the
 * full 4135-Mod / API-5DP family is ~29-30 Msi — flat 30 Msi is the
 * convention drill engineers compute against).
 */

import { MATERIAL_GRADES, DEFAULT_YIELD_KSI } from './closed-form-stress';

// Re-export so the UI doesn't have to import from two engine files.
export { MATERIAL_GRADES, DEFAULT_YIELD_KSI };

/** Young's modulus default — AISI 4130/4140 steel, ~30 Msi (= 30e6 psi). */
export const DEFAULT_E_PSI = 30e6;

export interface TensionInputs {
  /** Axial pull at EACH end, lbf (positive = tension). The internal
   *  axial force is also F — both ends pull equally → balanced. */
  F_lbf: number;
  /** Outer diameter, inches */
  OD_in: number;
  /** Inner diameter (bore), inches */
  ID_in: number;
  /** Length of the shaft, inches */
  L_in: number;
  /** Material yield stress, ksi */
  sigma_y_ksi: number;
  /** Young's modulus, psi (default 30 Msi for AISI 4130/4140). */
  E_psi?: number;
}

export interface TensionResults {
  /** Cross-section area, in² */
  A_in2: number;
  /** Axial stress, ksi */
  sigma_a_ksi: number;
  /** Axial strain, dimensionless (in/in) */
  epsilon: number;
  /** Total elongation under load, inches */
  deltaL_in: number;
  /** Stretched length under load, inches */
  L_prime_in: number;
  /** Von Mises stress (= |σ_a| for uniaxial), ksi */
  sigma_vm_ksi: number;
  /** Safety factor = σ_y / σ_vm */
  safety_factor: number;
  /** API design-check verdict */
  verdict: 'OK' | 'Marginal' | 'Yields';
}

/**
 * Compute uniform axial stress + strain + von Mises + safety factor
 * for a tubular shaft loaded by equal forces F at each end.
 *
 * Pure function — same inputs → same outputs. No side effects.
 */
export function computeTensionStress(input: TensionInputs): TensionResults {
  const { F_lbf, OD_in, ID_in, L_in, sigma_y_ksi } = input;
  const E_psi = input.E_psi ?? DEFAULT_E_PSI;

  const A_in2 = Math.PI * (OD_in * OD_in - ID_in * ID_in) / 4;
  const safeA = A_in2 > 1e-9 ? A_in2 : 1e-9;

  // Stress (psi) → ksi for the result.
  const sigma_a_psi = F_lbf / safeA;
  const sigma_a_ksi = sigma_a_psi / 1000;

  // Strain dimensionless; ΔL in inches; L' is the deformed length.
  // Use absolute axial stress so the deformation lookup never flips
  // sign (a compressive F should still color the bar AND shorten the
  // shaft — but Stage 2 spec is tension-only, so we keep the sign).
  const epsilon = sigma_a_psi / E_psi;
  const deltaL_in = epsilon * L_in;
  const L_prime_in = L_in + deltaL_in;

  // For pure uniaxial: σ_vm = |σ_a|. (3D von Mises collapses since
  // σ_2 = σ_3 = 0 + no shear.)
  const sigma_vm_ksi = Math.abs(sigma_a_ksi);

  const safety_factor = sigma_vm_ksi > 1e-9 ? sigma_y_ksi / sigma_vm_ksi : Infinity;
  const verdict: 'OK' | 'Marginal' | 'Yields' =
    safety_factor >= 1.5 ? 'OK'
    : safety_factor >= 1.0 ? 'Marginal'
    : 'Yields';

  return {
    A_in2,
    sigma_a_ksi,
    epsilon,
    deltaL_in,
    L_prime_in,
    sigma_vm_ksi,
    safety_factor,
    verdict,
  };
}

/**
 * Tri-stop traffic-light LUT (green < 0.5σ_y, amber 0.5-0.8, red > 0.8).
 * Returns `{r, g, b}` in [0, 1] — ready to push into a Three.js
 * BufferAttribute as per-vertex `color` data. Mirrors the CSS-string
 * stressColor() in closed-form-stress.ts but returns numbers (the
 * three.js geometry needs floats, not strings).
 */
export function stressColorRGB(
  sigma_vm_ksi: number,
  sigma_y_ksi: number,
): { r: number; g: number; b: number } {
  if (sigma_y_ksi <= 0) return { r: 0.4, g: 0.4, b: 0.4 };
  const r = sigma_vm_ksi / sigma_y_ksi;
  if (r < 0.5) return { r: 0x22 / 255, g: 0xaa / 255, b: 0x44 / 255 };    // green
  if (r < 0.8) return { r: 0xe0 / 255, g: 0xb0 / 255, b: 0x20 / 255 };    // amber
  return { r: 0xcc / 255, g: 0x22 / 255, b: 0x22 / 255 };                  // red
}

/**
 * Viridis-like 5-stop interpolated LUT keyed on σ_vm / σ_y (0..1+).
 * Smooth gradient — the alternative when you want gradient over
 * traffic-light. Both LUTs are valid "methods" the user can compare.
 */
export function viridisRGB(ratio: number): { r: number; g: number; b: number } {
  // Clamp 0..1; the colorbar's "near yield" cliff lives in stressColorRGB.
  const t = Math.max(0, Math.min(1, ratio));
  // 5-stop palette plucked from matplotlib's viridis at 0/0.25/0.5/0.75/1:
  //   #440154 → #3b528b → #21908c → #5dc863 → #fde725
  const stops: [number, number, number][] = [
    [0x44 / 255, 0x01 / 255, 0x54 / 255],
    [0x3b / 255, 0x52 / 255, 0x8b / 255],
    [0x21 / 255, 0x90 / 255, 0x8c / 255],
    [0x5d / 255, 0xc8 / 255, 0x63 / 255],
    [0xfd / 255, 0xe7 / 255, 0x25 / 255],
  ];
  const seg = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = stops[i];
  const b = stops[i + 1];
  return {
    r: a[0] + (b[0] - a[0]) * f,
    g: a[1] + (b[1] - a[1]) * f,
    b: a[2] + (b[2] - a[2]) * f,
  };
}

/** Format a finite number for the panel; falls through "∞" for divide-by-zero. */
export function fmtNum(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '∞';
  return n.toFixed(digits);
}

/** Format strain — small numbers; show 6 significant decimals. */
export function fmtStrain(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  if (abs >= 0.01) return n.toFixed(4);
  // microstrain — multiply by 1e6 and label "µε" in the UI.
  return (n * 1e6).toFixed(1);
}

/**
 * Visualization methods catalog. Stage 2 ships only the closed-form
 * uniform-σ path; Stage 3 will plug a pure-JS 1D FEA here (same
 * result for tension, but the framework will support beam bending
 * with non-uniform σ).
 */
export interface TensionMethod {
  id: string;
  label: string;
  status: 'available' | 'pending';
  description: string;
}

export const TENSION_METHODS: TensionMethod[] = [
  {
    id: 'closed-form',
    label: 'Closed-form (uniform σ)',
    status: 'available',
    description: 'Analytical σ = F/A. Uniform across section + along length. No mesh.',
  },
  {
    id: 'fea-1d',
    label: '1D pure-JS FEA (Stage 3 — not yet)',
    status: 'pending',
    description: 'Hand-rolled bar element solver. Same answer for pure tension; framework for bending.',
  },
];
