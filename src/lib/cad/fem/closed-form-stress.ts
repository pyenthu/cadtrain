/**
 * Closed-form section stress — Stage 1 of the FEM roadmap
 * (see `docs/research/FEM.md`).
 *
 * Pure analytical formulas applied to a tubular cross-section (OD/ID).
 * No mesh, no solver, no per-element variation. One sigma per section.
 *
 * Convention: oilfield units. Inputs are lbf / ft-lbf / inches.
 * Internally everything is converted to inch-pound (psi for stress).
 * Output ksi (= psi/1000) is what drill-pipe engineers actually read.
 *
 * Combined loading model: σ_axial + σ_bending act along the pipe axis
 * (uniaxial); τ_torsion acts on the same section. Von Mises (Mises-
 * Hencky) for ductile steel:
 *     σ_vm = sqrt((σ_a + σ_b)^2 + 3 · τ^2)
 *
 * Safety factor = σ_y / σ_vm. API 5C3 / 7-2 design check verdict:
 *     SF ≥ 1.5 → OK
 *     1.0 ≤ SF < 1.5 → Marginal
 *     SF < 1.0 → Yields
 */

export interface StressInputs {
  /** Axial tensile load (positive = tension), lbf */
  F_lbf: number;
  /** Applied torque, ft-lbf */
  T_ftlbf: number;
  /** Bending moment, ft-lbf */
  M_ftlbf: number;
  /** Material yield stress, ksi */
  sigma_y_ksi: number;
  /** Outer diameter, inches */
  OD_in: number;
  /** Inner diameter (bore), inches */
  ID_in: number;
}

export interface StressResults {
  /** Cross-section area, in² */
  A_in2: number;
  /** Polar moment of inertia, in⁴ */
  J_in4: number;
  /** Second moment of area, in⁴ */
  I_in4: number;
  /** Axial stress, ksi (positive = tension) */
  sigma_a_ksi: number;
  /** Shear stress from torsion, ksi */
  tau_ksi: number;
  /** Bending stress (extreme fiber), ksi */
  sigma_b_ksi: number;
  /** Von Mises combined stress, ksi */
  sigma_vm_ksi: number;
  /** Safety factor = σ_y / σ_vm */
  safety_factor: number;
  /** API design-check verdict */
  verdict: 'OK' | 'Marginal' | 'Yields';
}

/** Common drill-pipe grades — API 5DP. Yield in ksi. */
export const MATERIAL_GRADES: { id: string; label: string; yield_ksi: number }[] = [
  { id: 'E75',  label: 'E-75',  yield_ksi:  75 },
  { id: 'X95',  label: 'X-95',  yield_ksi:  95 },
  { id: 'G105', label: 'G-105', yield_ksi: 105 },
  { id: 'S135', label: 'S-135', yield_ksi: 135 },
  { id: 'Z140', label: 'Z-140', yield_ksi: 140 },
  { id: 'V150', label: 'V-150', yield_ksi: 150 },
];

/** Default material — G-105 is the most common medium-grade drill pipe. */
export const DEFAULT_YIELD_KSI = 105;

/**
 * Compute combined section stress from axial load + torque + bending
 * moment on a hollow circular cross-section.
 */
export function computeStress(input: StressInputs): StressResults {
  const { F_lbf, T_ftlbf, M_ftlbf, sigma_y_ksi, OD_in, ID_in } = input;

  // Geometry — solid annular cross-section.
  const OD2 = OD_in * OD_in;
  const ID2 = ID_in * ID_in;
  const OD4 = OD2 * OD2;
  const ID4 = ID2 * ID2;
  const A_in2 = Math.PI * (OD2 - ID2) / 4;             // in²
  const J_in4 = Math.PI * (OD4 - ID4) / 32;            // in⁴
  const I_in4 = Math.PI * (OD4 - ID4) / 64;            // in⁴

  // Convert ft-lbf to in-lbf for torque/moment (×12). Stresses come
  // out in psi; convert to ksi at the end (÷1000).
  const T_inlbf = T_ftlbf * 12;
  const M_inlbf = M_ftlbf * 12;

  // Guard against degenerate sections (A_in2 ≈ 0 → divide-by-zero).
  const safeA = A_in2 > 1e-9 ? A_in2 : 1e-9;
  const safeJ = J_in4 > 1e-9 ? J_in4 : 1e-9;
  const safeI = I_in4 > 1e-9 ? I_in4 : 1e-9;

  const sigma_a_psi = F_lbf / safeA;                          // axial
  const tau_psi     = (T_inlbf * OD_in) / (2 * safeJ);        // torsion
  const sigma_b_psi = (M_inlbf * OD_in) / (2 * safeI);        // bending

  // Convert psi → ksi.
  const sigma_a_ksi = sigma_a_psi / 1000;
  const tau_ksi     = tau_psi     / 1000;
  const sigma_b_ksi = sigma_b_psi / 1000;

  // Combined uniaxial stress on the section (axial + bending fiber).
  const sigma_combined_ksi = sigma_a_ksi + sigma_b_ksi;

  // Von Mises (Mises-Hencky) — ductile steel failure criterion.
  const sigma_vm_ksi = Math.sqrt(
    sigma_combined_ksi * sigma_combined_ksi + 3 * tau_ksi * tau_ksi
  );

  const safety_factor = sigma_vm_ksi > 1e-9 ? sigma_y_ksi / sigma_vm_ksi : Infinity;

  // API 5C3 / 7-2 design check.
  const verdict: 'OK' | 'Marginal' | 'Yields' =
    safety_factor >= 1.5 ? 'OK'
    : safety_factor >= 1.0 ? 'Marginal'
    : 'Yields';

  return {
    A_in2, J_in4, I_in4,
    sigma_a_ksi, tau_ksi, sigma_b_ksi, sigma_vm_ksi,
    safety_factor,
    verdict,
  };
}

/**
 * Viridis-ish 3-stop LUT for σ_vm / σ_y ratio.
 *  ratio < 0.5  → green   (low stress, safe)
 *  ratio < 0.8  → amber   (working but watch)
 *  ratio ≥ 0.8  → red     (near yield / yielded)
 *
 * Returns a CSS color string (`#rrggbb`).
 */
export function stressColor(sigma_vm_ksi: number, sigma_y_ksi: number): string {
  if (sigma_y_ksi <= 0) return '#666666';
  const r = sigma_vm_ksi / sigma_y_ksi;
  if (r < 0.5) return '#22aa44';
  if (r < 0.8) return '#e0b020';
  return '#cc2222';
}

/** Symmetric numeric formatter for the result panel. */
export function fmtNum(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '∞';
  return n.toFixed(digits);
}
