/**
 * Tubing-composite generation rules.
 *
 * One canonical place that says: given a small set of inputs (size, weight,
 * grade, connection, length, thread density), produce a complete tubing
 * joint AuthoredComponent — body + top box + bottom pin. The rules are
 * explicit + documented so they can be reviewed against the API spec or
 * a vendor catalog without spelunking through code.
 *
 * Pipeline (one direction; no back-resolution):
 *
 *   inputs → resolveSpecs → derived dims → buildTubingSpec → AuthoredComponent
 *
 * resolveSpecs first asks the KB (static/kb/api/casing-tubing-data.json)
 * for an exact (size, weight, grade, connection) row. If hit: lift wall,
 * pipe_id, connection_od, connection_length, MUT verbatim. If miss: fall
 * back to formula defaults rooted in the API tables (e.g. wall ≈ od ×
 * standard ratio for the connection family) so we always produce
 * SOMETHING editable.
 *
 * The returned object carries both the resolved dims (so a UI can show
 * "ID = 2.441" alongside the slider) and the geometry spec.
 */

import type { AuthoredComponent } from '$lib/authoring/schema';

// ── Inputs ───────────────────────────────────────────────────────────────

export type ConnectionType = 'EUE' | 'NUE';
export type Grade = 'J-55' | 'L-80' | 'N-80' | 'P-110' | 'Q-125';

export interface TubingInputs {
  /** Nominal OD in inches (2.375 = 2-3/8", 2.875 = 2-7/8", 3.5 = 3-1/2"). */
  size_in: number;
  /** Nominal weight in lb/ft. Used as a primary KB filter. */
  weight_lbft: number;
  /** Pipe-body grade. Drives yield + MUT. */
  grade: Grade;
  /** Connection type — EUE has an upset; NUE is non-upset (smaller threads). */
  connection: ConnectionType;
  /** Joint body length in inches. R-2 = 354" (~9 m), R-3 = 406". For pup joints
   *  override to 24"–120". */
  body_length_in?: number;
  /** Thread density (threads-per-inch). API EUE = 8 TPI for sizes ≤ 3-1/2";
   *  10 TPI for 4-1/2"+. NUE follows the same convention. */
  tpi?: number;
}

// ── KB row shape (subset of casing-tubing-data.json rows we actually use) ─

interface KbRow {
  type: string;
  size_in: number;
  weight_lbft: number;
  grade: string;
  connection: string;
  wall_in: number;
  pipe_id_in: number;
  drift_in: number | null;
  connection_od_in: number;
  connection_length_in: number;
  mut_opti_ftlb: number | null;
}

let kbRowsCache: KbRow[] | null = null;
async function loadKbRows(): Promise<KbRow[]> {
  if (kbRowsCache) return kbRowsCache;
  const r = await fetch('/api/volume?path=kb/api/casing-tubing-data.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error(`KB load failed: ${r.status}`);
  const data = await r.json();
  kbRowsCache = data.rows as KbRow[];
  return kbRowsCache;
}

// ── Derivation ───────────────────────────────────────────────────────────

export interface TubingDerived {
  /** Body wall thickness, in. */
  wall_in: number;
  /** Pipe ID, in. */
  pipe_id_in: number;
  /** Connection (upset / coupling) OD, in. EUE upset is ~1.18× body OD. */
  connection_od_in: number;
  /** Engaged thread length on the connection, in. */
  connection_length_in: number;
  /** Total thread count = round(TPI × connection_length). */
  thread_count: number;
  /** API thread taper (per unit length) = 0.0625 for round V-thread. */
  thread_taper: number;
  /** Optimum make-up torque, ft·lb (KB if available, else null). */
  mut_opti_ftlb: number | null;
  /** True iff every dimension came from a KB row hit. */
  from_kb: boolean;
}

/** Find the closest KB row by (size, weight, grade, connection). Returns
 *  null if nothing matches. */
function findKbRow(rows: KbRow[], i: TubingInputs): KbRow | null {
  return rows.find((r) =>
    r.type === 'TBG' &&
    Math.abs(r.size_in - i.size_in) < 1e-3 &&
    Math.abs(r.weight_lbft - i.weight_lbft) < 0.05 &&
    r.grade === i.grade &&
    r.connection === i.connection,
  ) ?? null;
}

/** Formula fallbacks for when no KB row hits. Anchors:
 *   wall      ≈ size × 0.080            (typical 2-3/8 to 3-1/2 EUE J-55)
 *   conn_OD   ≈ size × 1.18             (EUE upset)
 *   conn_len  ≈ size × 1.85             (≥ ~4 in for tubing sizes)
 */
function formulaDerived(i: TubingInputs): Omit<TubingDerived, 'thread_count' | 'from_kb'> {
  const wall = i.size_in * 0.080;
  const pipe_id = i.size_in - 2 * wall;
  const conn_od = i.connection === 'EUE' ? i.size_in * 1.18 : i.size_in * 1.05;
  const conn_len = Math.max(4, i.size_in * 1.85);
  return {
    wall_in: wall,
    pipe_id_in: pipe_id,
    connection_od_in: conn_od,
    connection_length_in: conn_len,
    thread_taper: 0.0625,
    mut_opti_ftlb: null,
  };
}

/** Resolve the input set into concrete dimensions. KB hit wins; formula
 *  fills the gaps. */
export async function resolveTubing(i: TubingInputs): Promise<TubingDerived> {
  const tpi = i.tpi ?? (i.size_in <= 3.5 ? 8 : 10);
  let row: KbRow | null = null;
  try {
    row = findKbRow(await loadKbRows(), i);
  } catch {
    // KB not reachable (test env, etc.) — fall through to formula.
  }
  if (row) {
    return {
      wall_in: row.wall_in,
      pipe_id_in: row.pipe_id_in,
      connection_od_in: row.connection_od_in,
      connection_length_in: row.connection_length_in,
      thread_count: Math.round(tpi * row.connection_length_in),
      thread_taper: 0.0625,
      mut_opti_ftlb: row.mut_opti_ftlb,
      from_kb: true,
    };
  }
  const f = formulaDerived(i);
  return {
    ...f,
    thread_count: Math.round(tpi * f.connection_length_in),
    from_kb: false,
  };
}

// ── Geometry build ───────────────────────────────────────────────────────

/** Visual scale: real tubing is ~31 ft body + ~6" connection. We compress
 *  the body length to keep the canvas readable. Connection lengths render
 *  at true scale relative to the body (so the box+pin/body proportion is
 *  realistic per the spec). */
const BODY_VIEW_LENGTH_FRAC = 0.012;  // 354" body → 4.25 view units
const CONN_VIEW_LENGTH_FRAC = 0.02;   // 5.25" conn → 0.105 view units (×5 for visibility)
const CONN_VIEW_BUMP = 5;             // multiplier so connections aren't invisible

/** Build the AuthoredComponent spec for a tubing joint from resolved dims.
 *  Three parts laid out by the universal pipe-end convention:
 *
 *    BOX (female) on TOP        ── threads cut into the bore, OD = coupling/upset OD
 *    BODY                       ── plain hollow cylinder, length = body_length_in
 *    PIN (male) on BOTTOM       ── threads cut into the OD, OD = body OD
 *
 *  This convention holds across the whole library: every joint mates pin
 *  (bottom of upper joint) into box (top of lower joint) when stacked into
 *  a string. The drilling/well "z down" sign convention agrees: positive
 *  z is up, negative z is down — top_box at +bodyLen, bot_pin at -connLen.
 */
export function buildTubingSpec(
  id: string,
  name: string,
  inputs: TubingInputs,
  d: TubingDerived,
): AuthoredComponent {
  const bodyLen = (inputs.body_length_in ?? 354) * BODY_VIEW_LENGTH_FRAC;
  const connLen = d.connection_length_in * CONN_VIEW_LENGTH_FRAC * CONN_VIEW_BUMP;
  const tag = `${inputs.size_in}" ${inputs.weight_lbft} lb/ft ${inputs.grade} ${inputs.connection}`;
  return {
    id, name,
    description: `${tag}. Wall ${d.wall_in.toFixed(3)}", ID ${d.pipe_id_in.toFixed(3)}", coupling OD ${d.connection_od_in.toFixed(3)}", thread engagement ${d.connection_length_in.toFixed(2)}" at ${(d.thread_count / d.connection_length_in).toFixed(0)} TPI${d.from_kb ? ' (KB-anchored)' : ' (formula)'}.`,
    tags: ['tubing', `${inputs.size_in}`, inputs.connection, inputs.grade, 'API tubing'],
    version: 1,
    created: new Date('2026-05-12').toISOString(),
    source: 'manual',
    parts: [
      // Body — hollow cylinder with the resolved wall.
      {
        id: 'body', kind: 'primitive', prim: 'hollow_cylinder',
        params: { od: inputs.size_in, wall: d.wall_in, length: bodyLen },
      },
      // Top box — sits above body. Coupling OD + matching wall + tapered threads.
      {
        id: 'top_box', kind: 'primitive', prim: 'threaded_box',
        params: {
          od: d.connection_od_in,
          wall: d.wall_in + 0.05,
          length: connLen,
          threadCount: d.thread_count,
          threadDepth: 0.04,
          taper: d.thread_taper,
        },
        transform: { tz: bodyLen },
      },
      // Bottom pin — below body, same OD as the body, threads cut into the OD.
      {
        id: 'bot_pin', kind: 'primitive', prim: 'threaded_pin',
        params: {
          od: inputs.size_in,
          wall: d.wall_in,
          length: connLen,
          threadCount: d.thread_count,
          threadDepth: 0.04,
          taper: d.thread_taper,
        },
        transform: { tz: -connLen },
      },
    ],
    ops: [],
  };
}

/** End-to-end: inputs → resolved dims → AuthoredComponent. Convenience for
 *  callers that don't care about the intermediate `derived`. */
export async function generateTubingComponent(
  id: string,
  name: string,
  inputs: TubingInputs,
): Promise<AuthoredComponent> {
  const derived = await resolveTubing(inputs);
  return buildTubingSpec(id, name, inputs, derived);
}

/** Synchronous formula-only generator. Skips KB lookup so it can run at
 *  module-load time. Use generateTubingComponent() instead when KB-anchored
 *  values matter (live row → click → preview flow). */
export function generateTubingComponentSync(
  id: string,
  name: string,
  inputs: TubingInputs,
): AuthoredComponent {
  const tpi = inputs.tpi ?? (inputs.size_in <= 3.5 ? 8 : 10);
  const f = formulaDerived(inputs);
  const derived: TubingDerived = {
    ...f,
    thread_count: Math.round(tpi * f.connection_length_in),
    from_kb: false,
  };
  return buildTubingSpec(id, name, inputs, derived);
}
