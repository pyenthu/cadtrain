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
