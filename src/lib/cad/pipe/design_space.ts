/**
 * Pipe-joint DesignSpace template — the parametric recipe shared by every
 * pipe-family component (tubing, casing, line pipe, drill pipe). Picking a
 * connection family + an OD + a grade is enough to derive every other
 * dimension via KB lookup against static/kb/api/casing-tubing-data.json.
 *
 * pipeJointDesignSpace(family) returns a DesignSpace whose three free vars
 * pin the row in the KB; remaining numerical dimensions become derived
 * variables. compose.ts (H.3+) will bind these vars to the three parts of
 * the assembly:
 *
 *   body : pipe_body         (od, pipe_id, body_length)
 *   top  : conn_<archetype>  (gender=box, family-specific dims from KB)
 *   bot  : conn_<archetype>  (gender=pin, family-specific dims from KB)
 *
 * Body length defaults to 354" (≈ 9 m, standard tubing R-2). Pup joints
 * are the same component with a smaller body_length (typical 24-120").
 */

import type { DesignSpace } from '$lib/authoring/schema';
import { familyById } from './families';
import { ARCHETYPES } from './archetypes';

/** ≈ 9 m in inches — the API R-2 tubing length. Pup joints override this. */
export const DEFAULT_BODY_LENGTH_IN = 354;

export function pipeJointDesignSpace(familyId: string): DesignSpace {
  const fam = familyById(familyId);
  if (!fam) throw new Error(`unknown connection family: "${familyId}"`);
  const arch = ARCHETYPES[fam.archetype];

  // Pick the dominant KB connection string for this family — used by
  // kb-lookup to filter rows. Variant-collapsing happens at the family
  // level; the first listed name is treated as canonical for lookups.
  const canonicalConnection = fam.kb_connection_names[0];

  return {
    variables: [
      // --- free ---
      {
        id: 'od',
        label: 'OD (in)',
        spec: { kind: 'free', type: 'number', default: 2.875, min: 1.5, max: 40, step: 0.125, unit: 'in' },
      },
      {
        id: 'grade',
        label: 'Grade',
        spec: { kind: 'free', type: 'string', default: 'L-80' },
      },
      {
        id: 'connection',
        label: 'Connection',
        spec: { kind: 'free', type: 'string', default: canonicalConnection },
      },
      {
        id: 'body_length',
        label: 'Body length (in)',
        spec: { kind: 'free', type: 'number', default: DEFAULT_BODY_LENGTH_IN, min: 1, max: 600, step: 1, unit: 'in' },
      },

      // --- derived (KB lookup on connection_od_in + grade + connection) ---
      // We use connection_od_in as the OD column — that matches the row's
      // outer-most dimension. wall_in + pipe_id_in + drift_in are the
      // bore-side; connection_length_in + thread_per_in are thread shape.
      {
        id: 'pipe_id',
        label: 'Pipe ID (in)',
        spec: {
          kind: 'derived', source: 'kb-lookup', kb: 'casing-tubing-data',
          lookup: { connection_od_in: 'od', grade: 'grade', connection: 'connection' },
          column: 'pipe_id_in',
        },
      },
      {
        id: 'wall',
        label: 'Wall (in)',
        spec: {
          kind: 'derived', source: 'kb-lookup', kb: 'casing-tubing-data',
          lookup: { connection_od_in: 'od', grade: 'grade', connection: 'connection' },
          column: 'wall_in',
        },
      },
      {
        id: 'drift',
        label: 'Drift (in)',
        spec: {
          kind: 'derived', source: 'kb-lookup', kb: 'casing-tubing-data',
          lookup: { connection_od_in: 'od', grade: 'grade', connection: 'connection' },
          column: 'drift_in',
        },
      },
      {
        id: 'connection_length',
        label: 'Connection length (in)',
        spec: {
          kind: 'derived', source: 'kb-lookup', kb: 'casing-tubing-data',
          lookup: { connection_od_in: 'od', grade: 'grade', connection: 'connection' },
          column: 'connection_length_in',
        },
      },
      {
        id: 'thread_per_in',
        label: 'Threads / inch',
        spec: {
          kind: 'derived', source: 'kb-lookup', kb: 'casing-tubing-data',
          lookup: { connection_od_in: 'od', grade: 'grade', connection: 'connection' },
          column: 'thread_per_in',
        },
      },
      {
        id: 'pipe_yield',
        label: 'Pipe yield (klbf)',
        spec: {
          kind: 'derived', source: 'kb-lookup', kb: 'casing-tubing-data',
          lookup: { connection_od_in: 'od', grade: 'grade', connection: 'connection' },
          column: 'pipe_yield_klbf',
        },
      },
    ],
    bindings: {
      // body part receives od / pipe_id / body_length
      'body.od': 'od',
      'body.id': 'pipe_id',
      'body.length': 'body_length',
      // top (box) and bot (pin) share OD + connection_length; gender
      // distinguishes them, set on the part's params directly. Family-
      // specific bindings get added once the concrete primitive params
      // are defined in Phase B (connections/<archetype>.ts).
      'top.od': 'od',
      'top.conn_length': 'connection_length',
      'bot.od': 'od',
      'bot.conn_length': 'connection_length',
    },
  };
}

/** Convenience: instantiate the pipe_joint AuthoredComponent skeleton for a
 *  family. Phase B will wire the actual primitive ids once they exist. */
export function pipeJointTemplate(familyId: string): {
  parts: { id: string; prim: string; params: Record<string, number> }[];
  design_space: DesignSpace;
} {
  const fam = familyById(familyId);
  if (!fam) throw new Error(`unknown connection family: "${familyId}"`);
  const arch = ARCHETYPES[fam.archetype];

  return {
    parts: [
      { id: 'body', prim: 'pipe_body',        params: { od: 2.875, id: 2.441, length: DEFAULT_BODY_LENGTH_IN } },
      { id: 'top',  prim: arch.primitive_id,  params: { gender: 0, od: 2.875, conn_length: 6 } }, // gender 0 = box (encoded numerically since AuthoredPart.params is Record<string, number>)
      { id: 'bot',  prim: arch.primitive_id,  params: { gender: 1, od: 2.875, conn_length: 6 } }, // gender 1 = pin
    ],
    design_space: pipeJointDesignSpace(familyId),
  };
}
