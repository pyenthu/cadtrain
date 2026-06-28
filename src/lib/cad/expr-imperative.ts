/**
 * expr-imperative.ts — the IMPERATIVE loop model for `list<point>` outputs
 * (#11, the accumulator style). Instead of the functional
 *   return map(range(0,N), f(i)=[x,y])
 * a list output can be an imperative program:
 *   poly = []
 *   for i = 0 to NPts
 *     point = [x, y]          ← assign an intermediate variable
 *     poly.append(point)      ← accumulate into the list
 *   for j = 0 to NPts         ← (any number of loops, one accumulator)
 *     poly.append([x, y])
 *   return poly
 *
 * Parse → structured program (the FOR-blocks edit it); serialize back; compile to
 * a JS IIFE (a real for-loop with push). Body EXPRESSIONS (`[x,y]`, the count,
 * assign RHS) are still lowered via the functional list compiler (compileListFormula
 * = parse + listNodeToJs), so cos/sin/loop-vars/params resolve the same way. The
 * emit's rewriteExprLocalRefs namespaces def params to V_*; the loop-locals
 * (poly/point/i) are bare + survive. Returns null when it isn't this shape (caller
 * falls back to the functional path).
 */
import { compileListFormula, parseAndValidateBare } from './graph-exprs';

export interface ImpAssign { kind: 'assign'; name: string; expr: string; }
export interface ImpAppend { kind: 'append'; list: string; expr: string; }
export type ImpStatement = ImpAssign | ImpAppend;
export interface ImpLoop { loopVar: string; start: string; stop: string; statements: ImpStatement[]; }
export interface ImperativeProgram {
  accumulators: string[];   // declared lists (usually one, e.g. 'poly')
  loops: ImpLoop[];
  result: string;           // the accumulator returned
}

const ACC_RE = /^([A-Za-z_]\w*)\s*=\s*\[\s*\]$/;
const FOR_RE = /^for\s+([A-Za-z_]\w*)\s*=\s*(.+?)\s+to\s+(.+)$/;
const APPEND_RE = /^([A-Za-z_]\w*)\.append\(\s*(.+?)\s*\)$/;
const ASSIGN_RE = /^([A-Za-z_]\w*)\s*=\s*(.+)$/;
const RETURN_RE = /^return\s+([A-Za-z_]\w*)$/;

/** Parse the imperative loop DSL, or null if `src` isn't that shape. */
export function parseImperative(src: string): ImperativeProgram | null {
  const lines = (src ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 4) return null; // accumulator + for + ≥1 stmt + return

  let idx = 0;
  const accumulators: string[] = [];
  while (idx < lines.length && ACC_RE.test(lines[idx]!)) {
    accumulators.push(lines[idx]!.match(ACC_RE)![1]!); idx++;
  }
  if (!accumulators.length) return null;

  const retM = lines[lines.length - 1]!.match(RETURN_RE);
  if (!retM) return null;
  const result = retM[1]!;
  if (!accumulators.includes(result)) return null;

  const loops: ImpLoop[] = [];
  while (idx < lines.length - 1) {
    const fm = lines[idx]!.match(FOR_RE);
    if (!fm) return null; // expected a `for`
    idx++;
    const loop: ImpLoop = { loopVar: fm[1]!, start: fm[2]!.trim(), stop: fm[3]!.trim(), statements: [] };
    while (idx < lines.length - 1 && !FOR_RE.test(lines[idx]!)) {
      const l = lines[idx]!;
      const ap = l.match(APPEND_RE);
      if (ap) { loop.statements.push({ kind: 'append', list: ap[1]!, expr: ap[2]!.trim() }); idx++; continue; }
      const as = l.match(ASSIGN_RE);
      if (as) { loop.statements.push({ kind: 'assign', name: as[1]!, expr: as[2]!.trim() }); idx++; continue; }
      return null; // unrecognized statement
    }
    if (!loop.statements.length) return null;
    loops.push(loop);
  }
  return loops.length ? { accumulators, loops, result } : null;
}

/** True when `src` is an imperative loop (vs the functional map form). */
export function isImperative(src: string): boolean { return parseImperative(src) !== null; }

/** Serialize a program back to the DSL (the canonical, parse-able + readable form). */
export function serializeImperative(p: ImperativeProgram): string {
  const lines: string[] = (p.accumulators ?? []).map((a) => `${a} = []`);
  for (const lp of p.loops ?? []) {
    lines.push(`for ${lp.loopVar} = ${lp.start} to ${lp.stop}`);
    for (const s of lp.statements) {
      lines.push(s.kind === 'assign' ? `  ${s.name} = ${s.expr}` : `  ${s.list}.append(${s.expr})`);
    }
  }
  lines.push(`return ${p.result}`);
  return lines.join('\n');
}

/** Validate an imperative program against `allowed` names — first error or null.
 *  Loop-locals (accumulators, loop vars, assigned vars) are added to scope; each
 *  sub-expr (count, assign RHS, append) validates under the list grammar. */
export function validateImperative(src: string, allowed: ReadonlySet<string>): string | null {
  const p = parseImperative(src);
  if (!p) return 'not a valid loop';
  const locals = new Set<string>(allowed);
  for (const a of p.accumulators) locals.add(a);
  for (const lp of p.loops) {
    locals.add(lp.loopVar);
    for (const s of lp.statements) if (s.kind === 'assign') locals.add(s.name);
  }
  const check = (expr: string) => parseAndValidateBare(expr, locals, 'list').errors[0]?.msg ?? null;
  for (const lp of p.loops) {
    const e = check(lp.start) ?? check(lp.stop);
    if (e) return e;
    for (const s of lp.statements) { const se = check(s.expr); if (se) return se; }
  }
  return null;
}

function exprToJs(s: string): string {
  const r = compileListFormula(s); // parse + lower (handles arrays/ops/cos/sin/…)
  if (!r.ok) throw new Error(r.error);
  return r.js;
}

/** Compile the imperative program to a JS IIFE that runs the loop(s) + returns the
 *  accumulator. Symbol names preserved (emit rewrites def params later). */
export function compileImperative(src: string): { ok: true; js: string } | { ok: false; error: string } {
  const p = parseImperative(src);
  if (!p) return { ok: false, error: 'not an imperative loop' };
  try {
    const decls = p.accumulators.map((a) => `let ${a} = [];`).join(' ');
    const loopJs = p.loops.map((lp) => {
      const stmts = lp.statements.map((s) =>
        s.kind === 'assign' ? `const ${s.name} = ${exprToJs(s.expr)};` : `${s.list}.push(${exprToJs(s.expr)});`,
      ).join(' ');
      return `for (let ${lp.loopVar} = ${exprToJs(lp.start)}; ${lp.loopVar} < (${exprToJs(lp.stop)}); ${lp.loopVar}++) { ${stmts} }`;
    }).join(' ');
    return { ok: true, js: `(() => { ${decls} ${loopJs} return ${p.result}; })()` };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
