/**
 * Authored component schema — JSON-serializable recipe that the
 * composition interpreter (compose.ts) turns into ManifoldCAD geometry.
 *
 * Design constraint: Claude never writes raw TS. It only emits this JSON
 * structure, which the interpreter executes against a fixed set of
 * primitive builders. No eval, no dynamic code.
 */

export interface AuthoredPart {
  /** Local reference id, e.g. "p0". Referenced by ops. */
  id: string;
  /** Primitive id from src/lib/components/library.ts COMPONENTS array. */
  prim: string;
  /** Parameters for that primitive (shape depends on primitive). */
  params: Record<string, number>;
  /** Optional rigid-body transform applied after building the part. */
  transform?: {
    tx?: number;
    ty?: number;
    tz?: number;
    rx?: number;
    ry?: number;
    rz?: number;
  };
}

export type CsgOpKind = 'union' | 'subtract' | 'intersect';

export interface AuthoredOp {
  op: CsgOpKind;
  /** Part ids or earlier op out-ids. First input is the base, rest are applied in order. */
  inputs: string[];
  /** Local id for this op's output, referenced by later ops. */
  out: string;
}

export interface AuthoringStep {
  t: string;
  actor: 'user' | 'claude';
  action:
    | 'add_part' | 'modify_part' | 'remove_part'
    | 'add_op' | 'modify_op' | 'remove_op'
    | 'prompt' | 'response' | 'accept_suggestion' | 'reject_suggestion';
  payload: unknown;
}

// ====================================================================
// Bundle H — constrained parametrization
// ====================================================================
//
// A component can optionally declare a DesignSpace: a flat list of named
// variables, plus a binding map that pins part-params to those variables.
// The variables split into FREE (user-driven, with range constraints) and
// DERIVED (computed from a KB lookup, another variable, or a future
// formula).  At evaluate time:
//
//   1. Free vars take their current input value.
//   2. Derived vars are resolved against the topologically-sorted DAG.
//   3. compose.ts reads bindings — for any "<part_id>.<param>" key,
//      substitute the variable's evaluated value before building.
//
// Backwards-compatible: components without `design_space` fall back to
// direct part.params editing (current /author UI). All 10 existing
// authored components in authored_cache.jsonl keep working unchanged.

/** Spec for one variable in a DesignSpace — either user-driven or computed. */
export type VariableSource =
  | { kind: 'free'; type: 'number'; default: number; min?: number; max?: number; step?: number; unit?: string }
  | { kind: 'free'; type: 'enum';   default: string; options: string[] }
  | { kind: 'free'; type: 'string'; default: string }
  /** KB lookup: find a row in static/kb/<kb>.json whose listed columns equal
   *  the named variables, then return that row's `column` value. If multiple
   *  rows match, the first wins (callers should narrow the lookup until that
   *  is acceptable). `fallback` is used when no row matches. */
  | { kind: 'derived'; source: 'kb-lookup'; kb: string; lookup: Record<string, string>; column: string; fallback?: number | string }
  /** Mirror another variable's value (useful for renaming or aliasing). */
  | { kind: 'derived'; source: 'ref'; var: string }
  /** Future (H.3+): simple arithmetic over other variables, e.g.
   *  "tubing_od - 2 * wall". Out of scope for the H.1 schema cut. */
  | { kind: 'derived'; source: 'formula'; expr: string };

export interface VariableDef {
  /** Unique within the DesignSpace, snake_case. e.g. "tubing_size". */
  id: string;
  /** UI label. e.g. "Tubing size (in)". */
  label: string;
  spec: VariableSource;
}

export interface DesignSpace {
  variables: VariableDef[];
  /** "<part_id>.<param_name>" → variable id. Resolved by compose.ts before
   *  the primitive builder runs. Unbound part-params fall back to their
   *  literal value in part.params. */
  bindings: Record<string, string>;
}

/** Stub for H.6+ — variant generation by sweeping a free variable's range
 *  or enumerating matching KB rows. Out of scope for H.1; declared here so
 *  the field can be added to AuthoredComponent without a second migration. */
export interface Generator {
  type: 'sweep' | 'kb-enumerate' | 'manual';
  notes?: string;
}

export interface AuthoredComponent {
  id: string;
  name: string;
  description: string;
  tags: string[];
  version: 1;
  created: string;
  source: 'manual' | 'claude_suggested' | 'claude_refined';

  parts: AuthoredPart[];
  ops: AuthoredOp[];

  thumbnail_b64?: string;
  hash?: string;

  authoring_log?: AuthoringStep[];

  /** Bundle H — optional. Absent on legacy records and on manually-composed
   *  components that don't need constrained parametrization. */
  design_space?: DesignSpace;
  generator?: Generator;
}

export function emptyAuthoredComponent(): AuthoredComponent {
  return {
    id: '',
    name: '',
    description: '',
    tags: [],
    version: 1,
    created: new Date().toISOString(),
    source: 'manual',
    parts: [],
    ops: [],
  };
}
