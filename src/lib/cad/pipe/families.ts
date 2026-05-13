/**
 * Connection-family taxonomy. Each FAMILY entry is the "concrete class" in
 * the pipe OOP hierarchy — it points to an archetype (which is the
 * abstract class / primitive impl) and lists the KB connection-name values
 * that belong to it.
 *
 * Why connection-name-list (not regex / pattern):
 *   KB connection strings are not consistently formatted (mixed case,
 *   parens for handing, vendor-specific suffixes like -KA / -NB). An
 *   explicit lookup avoids surprise mis-classifications and makes
 *   coverage gaps obvious.
 *
 * Coverage today: this file covers the top ~12 connection families that
 * together represent most rows in casing-tubing-data. The long tail (~30
 * sparse names) lands in the "other" bucket via familyByConnection()
 * returning undefined — those rows are still in the KB, just not yet
 * mapped to a buildable archetype. Adding them as we encounter them.
 */

import type { Archetype } from './archetypes';

export interface ConnectionFamily {
  /** Lower-snake-case id, used in the design_space and primitive params. */
  id: string;
  /** Display name (matches the dominant KB connection string when possible). */
  name: string;
  archetype: Archetype;
  /** All KB connection strings that belong to this family. Variants (-KA,
   *  -NB, RH/LH handing, TUBING-vs-CASING markers) collapse into one
   *  family because they share the same archetype geometry. */
  kb_connection_names: string[];
  /** One-line note: vendor + visual distinguishing feature. */
  notes?: string;
}

export const FAMILIES: ConnectionFamily[] = [
  // -------------------- PREMIUM INTEGRAL --------------------
  // VAM family (Vallourec) — premium tapered seal connections. Sub-variants
  // collapse by archetype; HC vs non-HC distinguishes torque-shoulder
  // presence but geometry differences are captured by has_shoulder param.
  { id: 'new_vam',      name: 'NEW VAM',      archetype: 'premium_integral',
    kb_connection_names: ['NEW VAM', 'NEW VAM SPCL'],
    notes: 'Vallourec; tapered metal seal + torque shoulder. Tubing + casing.' },
  { id: 'vam_top',      name: 'VAM TOP',      archetype: 'premium_integral',
    kb_connection_names: ['VAM TOP', 'VAM TOP TUBING'],
    notes: 'Vallourec; integral tubing connection.' },
  { id: 'vam_top_hc',   name: 'VAM TOP-HC',   archetype: 'premium_integral',
    kb_connection_names: ['VAM TOP-HC', 'VAM TOP-HC-NB', 'VAM TOP-HC-KA'],
    notes: 'Vallourec; high-collapse variant of VAM TOP with reinforced shoulder.' },
  { id: 'vam_21',       name: 'VAM 21',       archetype: 'premium_integral',
    kb_connection_names: ['VAM 21'],
    notes: 'Vallourec; semi-flush casing connection.' },
  { id: 'vam_httc',     name: 'VAM HTTC',     archetype: 'premium_integral',
    kb_connection_names: ['VAM HTTC'],
    notes: 'Vallourec; high-torque tubing connection.' },
  { id: 'vam_fjl',      name: 'VAM FJL',      archetype: 'premium_integral',
    kb_connection_names: ['VAM FJL'],
    notes: 'Vallourec; flush joint liner.' },
  // Tenaris family
  { id: 'tenaris_blue', name: 'TENARIS BLUE', archetype: 'premium_integral',
    kb_connection_names: ['TENARIS BLUE', 'TENARIS BLUE DPLS', 'TENARIS BLUE MAX', 'TENARIS BIG FLUSH'],
    notes: 'Tenaris; flagship premium tapered, slim profile.' },
  { id: 'easy_run',     name: 'Easy Run',     archetype: 'premium_integral',
    kb_connection_names: ['Easy Run'],
    notes: 'Tenaris; semi-premium with running-friendly torque profile.' },
  { id: 'big_omega',    name: 'BIG OMEGA-IS', archetype: 'premium_integral',
    kb_connection_names: ['BIG OMEGA-IS'],
    notes: 'Tenaris; large-OD premium with integral seal.' },
  // SMI / TPS / VOEST
  { id: 'sec_fr',       name: 'SEC FR',       archetype: 'premium_integral',
    kb_connection_names: ['SEC FR', 'SEC FR SPCL'],
    notes: 'Tenaris SEC (Special Engineering Couplings) free-running profile.' },
  { id: 'techniseal',   name: 'TECHNISEAL',   archetype: 'premium_integral',
    kb_connection_names: ['TECHNISEAL', 'TECHNISEAL SPCL'],
    notes: 'TPS; tapered seal with thread compound contingency.' },
  { id: 'multiseal',    name: 'MULTISEAL',    archetype: 'premium_integral',
    kb_connection_names: ['MULTISEAL TS-6', 'MULTISEAL TS-8'],
    notes: 'TPS; multi-seal tubing connection family.' },
  { id: 'va_gt',        name: 'VA-GT',        archetype: 'premium_integral',
    kb_connection_names: ['VA-GT', 'VA-GT SPCL'],
    notes: 'Voest-Alpine; tapered tubing.' },

  // -------------------- API COUPLED --------------------
  { id: 'bc',           name: 'BC (Buttress)', archetype: 'api_coupled',
    kb_connection_names: ['BC'],
    notes: 'API Buttress Casing thread; coupled with a separate collar.' },
  { id: 'lc',           name: 'LC (Long-Coupled)', archetype: 'api_coupled',
    kb_connection_names: ['LC'],
    notes: 'API Long Thread Casing; round-thread variant.' },

  // -------------------- API INTEGRAL UPSET --------------------
  { id: 'eue',          name: 'EUE',          archetype: 'api_upset',
    kb_connection_names: ['EUE'],
    notes: 'API External Upset End — integral tubing, external upset carries threads.' },

  // -------------------- LINE PIPE SPECIAL --------------------
  { id: 'xlc_s',        name: 'XLC-S',        archetype: 'line_pipe_special',
    kb_connection_names: ['XLC-S (RH)', 'XLC-S (LH)'],
    notes: 'NOV / GE; large-OD line pipe connection. RH/LH = right/left-hand thread.' },
  { id: 'slip_joint',   name: 'Slip Joint',   archetype: 'line_pipe_special',
    kb_connection_names: ['SLIP JOINT'],
    notes: 'Line pipe with axial slip provision; no thread, sealed by elastomer.' },
];

/** Find which family owns a given KB connection name (or undefined if the
 *  long-tail KB row hasn't been mapped yet). */
export function familyByConnection(connectionName: string): ConnectionFamily | undefined {
  if (!connectionName) return undefined;
  return FAMILIES.find((f) => f.kb_connection_names.includes(connectionName));
}

export function familyById(id: string): ConnectionFamily | undefined {
  return FAMILIES.find((f) => f.id === id);
}

/** Group FAMILIES by archetype — used by the Library tab to render the
 *  taxonomy with archetype headers. */
export function familiesByArchetype(): Record<Archetype, ConnectionFamily[]> {
  const out: Record<string, ConnectionFamily[]> = {};
  for (const f of FAMILIES) {
    (out[f.archetype] ||= []).push(f);
  }
  return out as Record<Archetype, ConnectionFamily[]>;
}
