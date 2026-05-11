/**
 * Connection-family archetypes — the "abstract classes" of the pipe OOP
 * hierarchy. Every concrete family in families.ts points to exactly one
 * archetype, and every archetype corresponds to one primitive in
 * connections/. Adding a new connection (e.g. a new VAM variant) is a
 * one-line append to FAMILIES — no new primitive needed.
 *
 * Four archetypes cover all 56 connection names in casing-tubing-data:
 *
 *   api_upset           pipe ends with an external upset (thicker wall)
 *                       carrying API cut threads. Schematic: cone +
 *                       cylinder + coloured thread band. Family: EUE, NUE.
 *
 *   api_coupled         pin threads cut into pipe body OD + a separate
 *                       coupling collar joining two pin ends. The COUPLING
 *                       is its own piece (4-piece assembly: pin + body +
 *                       coupling + pin from next joint). Family: BC, LC,
 *                       STC, LTC.
 *
 *   premium_integral    integral pipe end (no upset, no coupling) with a
 *                       tapered metal-to-metal seal, thread engagement,
 *                       and an OPTIONAL torque shoulder. Covers ~190 KB
 *                       rows across many proprietary connections (VAM
 *                       family, TENARIS BLUE, NEW VAM, SEC FR, etc.).
 *                       The has_shoulder param + seal/thread sizing
 *                       carry the family-specific differences.
 *
 *   line_pipe_special   non-API end forms used in line pipe: slip joint,
 *                       plain end, weld neck, XLC-S. end_form enum
 *                       selects the variant. Body is plain cylinder.
 */

export type Archetype =
  | 'api_upset'
  | 'api_coupled'
  | 'premium_integral'
  | 'line_pipe_special';

export interface ArchetypeDef {
  id: Archetype;
  name: string;
  description: string;
  /** Primitive id registered in src/lib/components/library.ts (added in
   *  later phases — placeholder for now). */
  primitive_id: string;
  /** Connection-end gender(s) this archetype supports. All current
   *  archetypes support both box + pin via a `gender` param; line_pipe
   *  end forms typically only have one end shape. */
  genders: ('box' | 'pin' | 'coupling')[];
}

export const ARCHETYPES: Record<Archetype, ArchetypeDef> = {
  api_upset: {
    id: 'api_upset',
    name: 'API Integral Upset',
    description: 'External upset on the body OD at the pipe end, carrying cut API threads. Both box + pin share the same upset profile, threads differ.',
    primitive_id: 'conn_api_upset',
    genders: ['box', 'pin'],
  },
  api_coupled: {
    id: 'api_coupled',
    name: 'API Coupled',
    description: 'Pin threads cut into the body OD; a separate coupling collar joins two pin ends. Coupled joints are 4-piece (pin + body + coupling + body + pin).',
    primitive_id: 'conn_api_coupled',
    genders: ['pin', 'coupling'],
  },
  premium_integral: {
    id: 'premium_integral',
    name: 'Tubulars',
    description: 'Integral pipe end with tapered metal-to-metal seal, thread engagement, and (optionally) a torque shoulder. No coupling needed; box on top, pin on bottom of every joint.',
    primitive_id: 'conn_premium_integral',
    genders: ['box', 'pin'],
  },
  line_pipe_special: {
    id: 'line_pipe_special',
    name: 'Line Pipe Special',
    description: 'Non-API end forms for line pipe — XLC, slip joint, plain end, weld neck. end_form enum picks the variant; ends can be asymmetric (e.g. XLC-S RH/LH).',
    primitive_id: 'conn_line_pipe_special',
    genders: ['box', 'pin'],
  },
};
