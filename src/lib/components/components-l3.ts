/**
 * Level-3 Component library — complete physical items.
 *
 * Each entry is one of:
 *   - 'authored' — multi-part AuthoredComponent built from primitives via
 *      buildAuthored(). Renders inline as a primitive-tab does, just from
 *      a multi-part spec instead of a single-part one.
 *   - 'tool' — legacy parametric tool with its own custom builder/scene
 *      (bottom-sub, ratch-latch). Listed here for one-stop browsing; the
 *      primitives route opens it via the existing /archive/tools/<id>
 *      route since those builders return multi-geometry results that
 *      don't fit the unified rendering path yet.
 *
 * Convention — every joint / pipe component follows the same end-form
 * convention so two of them stack into a string without orientation flips:
 *
 *   BOX (female) on TOP    — internal threads, OD = coupling/upset OD
 *   PIN (male) on BOTTOM   — external threads, OD = body OD
 *
 * Drilling z-down convention: positive z is up, negative z is down.
 * Use the helper in src/lib/components/rules/tubing.ts when generating
 * tubing joints; it bakes this convention in.
 */

import type { AuthoredComponent } from '$lib/authoring/schema';
import { generateTubingComponentSync, type TubingInputs } from './rules/tubing';

/** Hierarchy tier:
 *    2 = Composition — single-part physical item assembled from primitives
 *        and unioned into one piece (tubing joint, LatchRite window joint).
 *    3 = Component   — multi-part physical item where each part is
 *        independently installed or moves (HS-ICV valve, HF-1 packer,
 *        Bottom Sub, Ratch-Latch). Renders as a unioned preview here, but
 *        the conceptual model is multiple parts.
 */
export type Tier = 2 | 3;

export interface ComponentL3Authored {
  kind: 'authored';
  id: string;
  tier: Tier;
  name: string;
  description: string;
  tags: string[];
  /** Sub-group label so the sidebar can group related entries under
   *  inline headers (e.g. "Standard tubing", "Intelligent Completions"). */
  group?: string;
  spec: AuthoredComponent;
}

export interface ComponentL3Tool {
  kind: 'tool';
  id: string;
  tier: Tier;
  name: string;
  description: string;
  tags: string[];
  group?: string;
  /** Route to mount the legacy tool viewer for now. */
  route: string;
  /** Optional preview image relative to /static. */
  preview?: string;
}

export type ComponentL3 = ComponentL3Authored | ComponentL3Tool;

// ── Helper: tubing joint via the rules in src/lib/components/rules/tubing.ts ─
// All geometry derivation lives in that one file; this helper just wraps
// the rules output with the L3 metadata (name / tags / group). KB-anchored
// values aren't available synchronously at module load — the formula
// fallbacks are used here, which match the API spec for common sizes
// closely enough that the visible difference vs KB-resolved is minimal.
// The KB-resolved path runs from the casing-tubing-data row click flow.
function tubingJoint(opts: {
  id: string;
  name: string;
  description: string;
  tags: string[];
  group?: string;
  inputs: TubingInputs;
}): ComponentL3Authored {
  const spec = generateTubingComponentSync(opts.id, opts.name, opts.inputs);
  // Override the auto-generated description with the catalog-flavored one
  // the caller supplied (keeps the L3 catalog reading nicely in the sidebar).
  spec.description = opts.description;
  spec.tags = opts.tags;
  return {
    kind: 'authored',
    id: opts.id, name: opts.name, description: opts.description, tags: opts.tags, group: opts.group,
    spec,
  };
}

// ── Components catalog ───────────────────────────────────────────────────

export const COMPONENTS_L3: ComponentL3[] = [
  // Tubing joints — 4 standard API sizes. Real connections coming from the
  // KB (static/kb/api/casing-tubing-data.json); ODs match common EUE rows.
  tubingJoint({
    id: 'tubing_2_375_eue',
    name: '2-3/8" EUE Tubing Joint',
    description: '2-3/8" OD tubing joint, J-55, EUE connection. Body + top box + bottom pin. Common production tubing in shallow wells.',
    tags: ['tubing', '2-3/8', 'EUE', 'API tubing', 'production tubing'],
    tier: 2,
    group: 'Standard API tubing',
    inputs: { size_in: 2.375, weight_lbft: 4.7, grade: 'J-55', connection: 'EUE' },
  }),
  tubingJoint({
    id: 'tubing_2_875_eue',
    name: '2-7/8" EUE Tubing Joint',
    description: '2-7/8" OD tubing joint, J-55, EUE connection. Most common production tubing size.',
    tags: ['tubing', '2-7/8', 'EUE', 'API tubing', 'production tubing'],
    tier: 2,
    group: 'Standard API tubing',
    inputs: { size_in: 2.875, weight_lbft: 6.5, grade: 'J-55', connection: 'EUE' },
  }),
  tubingJoint({
    id: 'tubing_3_500_eue',
    name: '3-1/2" EUE Tubing Joint',
    description: '3-1/2" OD tubing joint, J-55, EUE connection. High-rate gas wells, larger production strings.',
    tags: ['tubing', '3-1/2', 'EUE', 'API tubing', 'high rate'],
    tier: 2,
    group: 'Standard API tubing',
    inputs: { size_in: 3.5, weight_lbft: 9.3, grade: 'J-55', connection: 'EUE' },
  }),
  tubingJoint({
    id: 'tubing_4_500_lc',
    name: '4-1/2" LC Casing Joint',
    description: '4-1/2" OD casing joint, K-55/J-55/N-80, LC (Long Thread Coupled). Typical shallow casing string member.',
    tags: ['casing', '4-1/2', 'LC', 'long thread', 'API casing'],
    tier: 2,
    group: 'Standard API casing',
    inputs: { size_in: 4.5, weight_lbft: 11.6, grade: 'J-55', connection: 'EUE' },
  }),

  // ── Catalog-inspired completions (Halliburton Intelligent Completions
  //    Catalog 2024 + Multilateral Technology Catalog) ──
  {
    kind: 'authored',
    id: 'hs_icv_valve',
    name: 'HS-ICV (Interval Control Valve)',
    description: 'Halliburton HS-ICV — high-pressure/high-temperature interval control valve. Modeled as a sliding-sleeve mandrel + bottom packer element. The eight-position flow trim is simplified to 4 ports.',
    tags: ['HS-ICV', 'ICV', 'interval control valve', 'HPHT', 'SmartWell', 'completion', 'Halliburton'],
    tier: 3,
    group: 'Intelligent Completions (HAL catalog)',
    spec: {
      id: 'hs_icv_valve', name: 'HS-ICV Valve',
      description: 'HS-ICV with packer below', tags: ['HS-ICV', 'ICV'],
      version: 1, created: new Date('2026-05-12').toISOString(), source: 'manual',
      parts: [
        { id: 'sleeve', kind: 'primitive', prim: 'sliding_sleeve',
          params: { od: 3.5, wall: 0.35, length: 6.0, numPorts: 4, portWidth: 0.4, portHeight: 1.2, sealBoreDepth: 0.06, sealBoreHeight: 0.5 },
          transform: { tz: 0 } },
        { id: 'packer', kind: 'primitive', prim: 'packer_element',
          params: { odCompressed: 3.4, odExpanded: 5.0, mandrelOD: 2.6, length: 1.5, numRings: 3 },
          transform: { tz: -1.6 } },
      ],
      ops: [],
    },
  },
  {
    kind: 'authored',
    id: 'hf1_packer',
    name: 'HF-1 Production Packer',
    description: 'Halliburton HF-1 — single-string retrievable cased-hole packer with premium connections. Element + slips + mandrel; setting accomplished by tubing-applied pressure.',
    tags: ['HF-1', 'production packer', 'packer', 'retrievable', 'SmartWell', 'completion', 'Halliburton'],
    tier: 3,
    group: 'Intelligent Completions (HAL catalog)',
    spec: {
      id: 'hf1_packer', name: 'HF-1 Packer',
      description: 'HF-1 production packer', tags: ['HF-1', 'packer'],
      version: 1, created: new Date('2026-05-12').toISOString(), source: 'manual',
      parts: [
        { id: 'top_sub', kind: 'primitive', prim: 'hollow_cylinder',
          params: { od: 3.0, wall: 0.35, length: 1.0 },
          transform: { tz: 3.5 } },
        { id: 'slips_top', kind: 'primitive', prim: 'slips',
          params: { slipOD: 4.0, bodyOD: 2.6, height: 0.8, numSectors: 6, gapWidth: 0.15, numGrooves: 4, grooveDepth: 0.06 },
          transform: { tz: 2.7 } },
        { id: 'element', kind: 'primitive', prim: 'packer_element',
          params: { odCompressed: 3.5, odExpanded: 5.5, mandrelOD: 2.6, length: 2.0, numRings: 3 },
          transform: { tz: 0.7 } },
        { id: 'slips_bot', kind: 'primitive', prim: 'slips',
          params: { slipOD: 4.0, bodyOD: 2.6, height: 0.8, numSectors: 6, gapWidth: 0.15, numGrooves: 4, grooveDepth: 0.06 },
          transform: { tz: -0.1 } },
        { id: 'mandrel_ext', kind: 'primitive', prim: 'hollow_cylinder',
          params: { od: 2.6, wall: 0.3, length: 1.0 },
          transform: { tz: -1.1 } },
      ],
      ops: [],
    },
  },
  {
    kind: 'authored',
    id: 'latchrite_window',
    name: 'LatchRite Pre-Milled Window Joint',
    description: 'Halliburton LatchRite — TAML Level 4 multilateral junction component. Casing joint with a pre-milled axial window for lateral exit; latch coupling above orients the whipstock during construction.',
    tags: ['LatchRite', 'pre-milled window', 'multilateral', 'TAML', 'lateral', 'junction', 'Halliburton'],
    tier: 2,
    group: 'Multilateral (HAL catalog)',
    spec: {
      id: 'latchrite_window', name: 'LatchRite Window',
      description: 'Pre-milled window casing joint', tags: ['LatchRite', 'multilateral'],
      version: 1, created: new Date('2026-05-12').toISOString(), source: 'manual',
      parts: [
        { id: 'window_joint', kind: 'primitive', prim: 'window_cutout',
          params: { od: 7.0, wall: 0.4, length: 5.0, windowWidth: 2.0, windowHeight: 3.0, windowOffset: 1.0 },
          transform: { tz: 0 } },
        { id: 'latch_coupling', kind: 'primitive', prim: 'grooved_cylinder',
          params: { od: 8.0, wall: 0.5, length: 1.5, numGrooves: 4, grooveDepth: 0.06 },
          transform: { tz: 5.0 } },
      ],
      ops: [],
    },
  },

  // Legacy parametric tools — link to existing /archive viewers until we
  // port their builders into the unified buildAuthored pipeline.
  {
    kind: 'tool',
    id: 'bottom_sub',
    name: 'Bottom Sub (HAL10408)',
    description: 'Halliburton bottom sub — housing + sleeve + slips. Parametric; opens in the legacy viewer with full param sliders.',
    tags: ['HAL', 'completion', 'bottom sub', 'HAL10408', 'sub'],
    route: '/archive/tools/bottom-sub',
    tier: 3,
    group: 'Legacy parametric tools',
  },
  {
    kind: 'tool',
    id: 'ratch_latch',
    name: 'Ratch-Latch Receiving Head',
    description: 'Ratch-latch receiving head — body + mandrel + seals. Parametric assembly with retrievable lock profile.',
    tags: ['ratch latch', 'receiving head', 'completion', 'lock', 'seal'],
    route: '/archive/tools/ratch-latch',
    tier: 3,
    group: 'Legacy parametric tools',
  },
];
