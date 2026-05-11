/**
 * DesignSpace evaluator.
 *
 * Pure function: given a DesignSpace, the current free-variable inputs,
 * and a map of loaded KBs, resolve every variable in topological order
 * and return the value of each.
 *
 * Pipeline (per call):
 *   1. Build the dep graph (free vars are sources; derived vars edge to
 *      whatever they reference).
 *   2. Topologically sort. Cycles + unknown refs are reported as errors
 *      and yield null values.
 *   3. Walk the order:
 *        free       → ctx.free[id] ?? spec.default
 *        ref        → values[other]
 *        kb-lookup  → first matching row in ctx.kbs[kb], then row[column]
 *                     (or fallback / null on miss)
 *        formula    → stub (H.3+)
 *
 * Callers wire this into reactive UI by recomputing on every input change.
 * The function itself is intentionally non-reactive so it can be used in
 * tests, scripts, and the future Opus DesignSpace generator without
 * dragging in Svelte runtime.
 */

import type { DesignSpace, VariableSource } from './schema';

export type Value = number | string;
export type ValueMap = Record<string, Value | null>;

/** Subset of a KB JSON we actually consume — just the row array. Callers
 *  pass `{ rows: kbJson.rows }` after fetching /kb/<id>.json. */
export interface KbData {
  rows: Record<string, any>[];
}

export interface EvalContext {
  /** KB id (from static/kb/index.json) → loaded data. */
  kbs: Map<string, KbData>;
  /** Current values of free variables, keyed by var id. */
  free: ValueMap;
}

export interface EvalError {
  var_id: string;
  message: string;
}

export interface EvalResult {
  values: ValueMap;
  errors: EvalError[];
}

const FORMULA_RESERVED = /^(true|false|null|undefined|Math|abs|floor|ceil|round|min|max|sqrt|pow|PI|E)$/i;

function depsOf(spec: VariableSource): string[] {
  if (spec.kind === 'free') return [];
  if (spec.source === 'ref') return [spec.var];
  if (spec.source === 'kb-lookup') return Object.values(spec.lookup);
  // formula: extract bare-word identifiers, drop known built-ins.
  return (spec.expr.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? []).filter(
    (t) => !FORMULA_RESERVED.test(t),
  );
}

function topoSort(spec: DesignSpace): { order: string[]; errors: EvalError[] } {
  const byId = new Map(spec.variables.map((v) => [v.id, v]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];
  const errors: EvalError[] = [];

  function visit(id: string, fromId?: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      errors.push({ var_id: fromId ?? id, message: `cyclic dependency at "${id}"` });
      return;
    }
    if (!byId.has(id)) {
      if (fromId) errors.push({ var_id: fromId, message: `references unknown variable "${id}"` });
      return;
    }
    visiting.add(id);
    for (const dep of depsOf(byId.get(id)!.spec)) visit(dep, id);
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  }

  for (const v of spec.variables) visit(v.id);
  return { order, errors };
}

function findFirstMatchingRow(
  kb: KbData,
  criteria: Record<string, Value | null>,
): Record<string, any> | null {
  // Bail if any criterion is null/undefined — a partial match would be
  // misleading (it could resolve to the wrong row by accident).
  for (const v of Object.values(criteria)) {
    if (v === null || v === undefined) return null;
  }
  outer: for (const row of kb.rows) {
    for (const [col, val] of Object.entries(criteria)) {
      if (row[col] !== val) continue outer;
    }
    return row;
  }
  return null;
}

export function evaluateDesignSpace(spec: DesignSpace, ctx: EvalContext): EvalResult {
  const { order, errors } = topoSort(spec);
  const values: ValueMap = {};
  const byId = new Map(spec.variables.map((v) => [v.id, v]));

  for (const id of order) {
    const v = byId.get(id);
    if (!v) continue;
    const s = v.spec;

    if (s.kind === 'free') {
      const input = ctx.free[id];
      values[id] = input !== undefined && input !== null ? input : (s.default as Value);
      continue;
    }

    // Derived
    if (s.source === 'ref') {
      values[id] = values[s.var] ?? null;
      continue;
    }

    if (s.source === 'kb-lookup') {
      const kb = ctx.kbs.get(s.kb);
      if (!kb) {
        errors.push({ var_id: id, message: `KB not loaded: "${s.kb}"` });
        values[id] = s.fallback ?? null;
        continue;
      }
      const criteria: Record<string, Value | null> = {};
      for (const [col, varId] of Object.entries(s.lookup)) {
        criteria[col] = values[varId] ?? null;
      }
      const row = findFirstMatchingRow(kb, criteria);
      if (!row) {
        if (s.fallback !== undefined) values[id] = s.fallback;
        else {
          errors.push({
            var_id: id,
            message: `no row in "${s.kb}" matches ${JSON.stringify(criteria)}`,
          });
          values[id] = null;
        }
        continue;
      }
      const v = row[s.column];
      values[id] = v ?? s.fallback ?? null;
      continue;
    }

    if (s.source === 'formula') {
      errors.push({ var_id: id, message: 'formula evaluator not implemented (H.3+)' });
      values[id] = null;
      continue;
    }
  }

  return { values, errors };
}

/**
 * Substitute resolved variable values into a part's params using the
 * DesignSpace's bindings. Returns a NEW params object; the input is not
 * mutated. Unbound params pass through. Non-numeric resolved values are
 * ignored (compose.ts only consumes numeric params).
 */
export function applyBindings(
  partId: string,
  params: Record<string, number>,
  bindings: Record<string, string>,
  values: ValueMap,
): Record<string, number> {
  const out: Record<string, number> = { ...params };
  const prefix = partId + '.';
  for (const [bindKey, varId] of Object.entries(bindings)) {
    if (!bindKey.startsWith(prefix)) continue;
    const paramName = bindKey.slice(prefix.length);
    const v = values[varId];
    if (typeof v === 'number' && isFinite(v)) out[paramName] = v;
  }
  return out;
}
