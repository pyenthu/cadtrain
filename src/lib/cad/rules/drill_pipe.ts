/**
 * Drill-pipe composite generation rules.
 *
 * Sister file to ./tubing.ts. Where tubing keys on (size, weight, grade,
 * connection), drill pipe keys on (size, weight_class, grade) — with the
 * tool-joint marking scheme driving how the joint is identified visually
 * per the API drill-pipe identification chart (KB:
 * static/kb/api/drill-pipe-identification.json).
 *
 * Pipeline:
 *
 *   inputs → resolveMarking → derived dims + marking → buildDrillPipeSpec
 *
 * resolveMarking pulls (num_grooves, num_slots, groove_wide) from the
 * drill-pipe-identification KB by (weight_class, grade). The geometry
 * uses the new `drill_pipe_tool_joint` primitive which renders those
 * markings on the upset OD.
 *
 * Convention (matches tubing.ts): box on TOP, pin on BOTTOM. A drill-pipe
 * joint actually has tool joints at BOTH ends — pin at one, box at the
 * other. We model the upper end as box (consistent with tubing) and the
 * lower end as pin.
 */

import type { AuthoredComponent } from '$lib/authoring/schema';

export type DrillPipeWeight = 'STANDARD' | 'HEAVY';
export type DrillPipeGrade = 'E75' | 'X95' | 'G105' | 'S135' | 'HIGH STRENGTH';

export interface DrillPipeInputs {
  /** Pipe-body OD in inches. Common: 3.5, 4, 4.5, 5, 5.5, 6.625. */
  size_in: number;
  /** Wall thickness in inches. Default 0.362 for 5" Range-2 STD. */
  wall_in?: number;
  /** Standard or heavy wall body. */
  weight_class: DrillPipeWeight;
  /** Pipe-body grade. */
  grade: DrillPipeGrade;
  /** Body length in inches. R-2 = 354", R-3 = 406". */
  body_length_in?: number;
  /** Tool-joint upset OD ratio (over pipe OD). Typical 1.3 for STD, 1.4 for HEAVY. */
  tool_joint_od_ratio?: number;
  /** Tool-joint band length in inches (single end). */
  tool_joint_length_in?: number;
}

interface MarkingRow {
  weight_class: string;
  grade: string;
  marking: string;
  num_grooves: number;
  num_slots: number;
  groove_wide?: boolean;
  yield_min_psi: number | null;
  notes?: string;
}

let markingCache: MarkingRow[] | null = null;
async function loadMarkingRows(): Promise<MarkingRow[]> {
  if (markingCache) return markingCache;
  const r = await fetch('/kb/api/drill-pipe-identification.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error(`drill-pipe KB load failed: ${r.status}`);
  const data = await r.json();
  markingCache = data.rows as MarkingRow[];
  return markingCache;
}

export interface DrillPipeDerived {
  wall_in: number;
  pipe_id_in: number;
  tool_joint_od_in: number;
  tool_joint_length_in: number;
  body_length_in: number;
  num_grooves: number;
  num_slots: number;
  groove_wide: boolean;
  yield_min_psi: number | null;
  marking_label: string;
  from_kb: boolean;
}

function findMarking(rows: MarkingRow[], i: DrillPipeInputs): MarkingRow | null {
  return rows.find((r) =>
    r.weight_class.toUpperCase() === i.weight_class.toUpperCase() &&
    r.grade.toUpperCase() === i.grade.toUpperCase(),
  ) ?? null;
}

/** Formula fallbacks for the dimensions (drill-pipe identification KB
 *  doesn't carry size-specific dims; only marking shape). */
function dimsForInputs(i: DrillPipeInputs) {
  const wall = i.wall_in ?? (i.weight_class === 'HEAVY' ? 0.5 : 0.362);
  const tjRatio = i.tool_joint_od_ratio ?? (i.weight_class === 'HEAVY' ? 1.4 : 1.32);
  const tjLen = i.tool_joint_length_in ?? 6.0;
  const bodyLen = i.body_length_in ?? 354;
  return {
    wall_in: wall,
    pipe_id_in: i.size_in - 2 * wall,
    tool_joint_od_in: i.size_in * tjRatio,
    tool_joint_length_in: tjLen,
    body_length_in: bodyLen,
  };
}

export async function resolveDrillPipe(i: DrillPipeInputs): Promise<DrillPipeDerived> {
  const dims = dimsForInputs(i);
  let row: MarkingRow | null = null;
  try {
    row = findMarking(await loadMarkingRows(), i);
  } catch {
    // KB unreachable — fall through.
  }
  if (row) {
    return {
      ...dims,
      num_grooves: row.num_grooves,
      num_slots: row.num_slots,
      groove_wide: !!row.groove_wide,
      yield_min_psi: row.yield_min_psi,
      marking_label: row.marking,
      from_kb: true,
    };
  }
  return {
    ...dims,
    num_grooves: 0,
    num_slots: 0,
    groove_wide: false,
    yield_min_psi: null,
    marking_label: 'unmarked',
    from_kb: false,
  };
}

const BODY_VIEW_LENGTH_FRAC = 0.012;
const TJ_VIEW_LENGTH_FRAC = 0.04;
const TJ_VIEW_BUMP = 5;

export function buildDrillPipeSpec(
  id: string,
  name: string,
  inputs: DrillPipeInputs,
  d: DrillPipeDerived,
): AuthoredComponent {
  const bodyLen = d.body_length_in * BODY_VIEW_LENGTH_FRAC;
  const tjLen = d.tool_joint_length_in * TJ_VIEW_LENGTH_FRAC * TJ_VIEW_BUMP;
  return {
    id, name,
    description: `${inputs.size_in}" ${inputs.weight_class} ${inputs.grade} drill pipe. Tool-joint OD ${d.tool_joint_od_in.toFixed(2)}" with ${d.marking_label}${d.from_kb ? ' (KB-anchored)' : ' (formula)'}.`,
    tags: ['drill pipe', `${inputs.size_in}`, inputs.weight_class, inputs.grade, 'API drill pipe'],
    version: 1,
    created: new Date('2026-05-12').toISOString(),
    source: 'manual',
    parts: [
      // Body — hollow cylinder.
      {
        id: 'body', kind: 'primitive', prim: 'hollow_cylinder',
        params: { od: inputs.size_in, wall: d.wall_in, length: bodyLen },
      },
      // Top tool joint (box end above the body) — carries the markings.
      {
        id: 'top_box', kind: 'primitive', prim: 'drill_pipe_tool_joint',
        params: {
          pipeOD: inputs.size_in,
          toolJointOD: d.tool_joint_od_in,
          wall: d.wall_in + 0.1,
          length: tjLen,
          numGrooves: d.num_grooves,
          numSlots: d.num_slots,
          grooveDepth: 0.05,
          grooveWidth: 0.2,
          grooveWide: d.groove_wide ? 1 : 0,
          slotWidth: 0.15,
          slotLength: 0.6,
        },
        transform: { tz: bodyLen },
      },
      // Bottom tool joint (pin end below the body). Same markings — both
      // ends of a drill pipe joint carry the identification stripe.
      {
        id: 'bot_pin', kind: 'primitive', prim: 'drill_pipe_tool_joint',
        params: {
          pipeOD: inputs.size_in,
          toolJointOD: d.tool_joint_od_in,
          wall: d.wall_in + 0.1,
          length: tjLen,
          numGrooves: d.num_grooves,
          numSlots: d.num_slots,
          grooveDepth: 0.05,
          grooveWidth: 0.2,
          grooveWide: d.groove_wide ? 1 : 0,
          slotWidth: 0.15,
          slotLength: 0.6,
        },
        transform: { tz: -tjLen },
      },
    ],
    ops: [],
  };
}

export async function generateDrillPipeComponent(
  id: string,
  name: string,
  inputs: DrillPipeInputs,
): Promise<AuthoredComponent> {
  const derived = await resolveDrillPipe(inputs);
  return buildDrillPipeSpec(id, name, inputs, derived);
}

export function generateDrillPipeComponentSync(
  id: string,
  name: string,
  inputs: DrillPipeInputs,
): AuthoredComponent {
  // Synchronous variant: skips KB lookup, defaults markings to "unmarked"
  // (no grooves, no slots). Use for module-load-time generation; the
  // KB-resolved variant runs from a row click on the KB tab.
  const dims = dimsForInputs(inputs);
  const derived: DrillPipeDerived = {
    ...dims,
    num_grooves: 0,
    num_slots: 0,
    groove_wide: false,
    yield_min_psi: null,
    marking_label: 'unmarked',
    from_kb: false,
  };
  return buildDrillPipeSpec(id, name, inputs, derived);
}
