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
/** A loop's body is the raw multi-line statements TEXT (the user types it); the
 *  statements are parsed from it at compile/validate time.
 *
 *  A loop may carry a SECOND iterator (`loopVar2`/`start2`/`stop2`) → it becomes a
 *  NESTED grid loop emitting a uv grid of points (row-major, `loopVar` OUTER,
 *  `loopVar2` INNER) — the foundation for parametric surfaces. When `loopVar2` is
 *  absent it's an ordinary 1D loop (behaviour byte-identical). */
export interface ImpLoop {
  loopVar: string; start: string; stop: string; body: string;
  loopVar2?: string; start2?: string; stop2?: string;
}
export interface ImperativeProgram {
  accumulators: string[];   // declared lists (usually one, e.g. 'poly')
  vars: ImpAssign[];        // top-level intermediate values, computed before the loops
  loops: ImpLoop[];
  result: string;           // the accumulator returned
}

const ACC_RE = /^([A-Za-z_]\w*)\s*=\s*\[\s*\]$/;
const FOR_RE = /^for\s+([A-Za-z_]\w*)\s*=\s*(.+?)\s+to\s+(.+)$/;
// 2D / GRID header: `for u = 0 to Nu, v = 0 to Nv` — a comma after the outer range
// introduces an inner iterator + its range (the lazy quantifiers + the trailing
// `, ident = … to …` requirement let bounds contain commas, e.g. `to clamp(N,0)`).
const FOR2_RE = /^for\s+([A-Za-z_]\w*)\s*=\s*(.+?)\s+to\s+(.+?)\s*,\s*([A-Za-z_]\w*)\s*=\s*(.+?)\s+to\s+(.+)$/;

/** Parse a single `for …` header line into loop fields (grid header first, then the
 *  ordinary 1D header), or null if it isn't a loop header at all. */
function parseForHeader(line: string): Omit<ImpLoop, 'body'> | null {
  const g = line.match(FOR2_RE);
  if (g) return { loopVar: g[1]!, start: g[2]!.trim(), stop: g[3]!.trim(),
                  loopVar2: g[4]!, start2: g[5]!.trim(), stop2: g[6]!.trim() };
  const m = line.match(FOR_RE);
  if (m) return { loopVar: m[1]!, start: m[2]!.trim(), stop: m[3]!.trim() };
  return null;
}
const APPEND_RE = /^([A-Za-z_]\w*)\.append\(\s*(.+?)\s*\)$/;
const ASSIGN_RE = /^([A-Za-z_]\w*)\s*=\s*(.+)$/;
const RETURN_RE = /^return\s+([A-Za-z_]\w*)$/;

/** Parse the imperative loop DSL, or null if `src` isn't that shape. */
export function parseImperative(src: string): ImperativeProgram | null {
  const lines = (src ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 4) return null; // accumulator + for + ≥1 stmt + return

  let idx = 0;
  const accumulators: string[] = [];
  const vars: ImpAssign[] = [];
  while (idx < lines.length - 1 && !FOR_RE.test(lines[idx]!)) {
    const acc = lines[idx]!.match(ACC_RE);
    if (acc) { accumulators.push(acc[1]!); idx++; continue; }
    const as = lines[idx]!.match(ASSIGN_RE);
    if (as) { vars.push({ kind: 'assign', name: as[1]!, expr: as[2]!.trim() }); idx++; continue; }
    return null; // unexpected top-level line
  }
  if (!accumulators.length) return null;

  const retM = lines[lines.length - 1]!.match(RETURN_RE);
  if (!retM) return null;
  const result = retM[1]!;
  if (!accumulators.includes(result)) return null;

  const loops: ImpLoop[] = [];
  while (idx < lines.length - 1) {
    const hd = parseForHeader(lines[idx]!);
    if (!hd) return null; // expected a `for`
    idx++;
    const bodyLines: string[] = [];
    while (idx < lines.length - 1 && !FOR_RE.test(lines[idx]!)) { bodyLines.push(lines[idx]!); idx++; }
    loops.push({ ...hd, body: bodyLines.join('\n') });
  }
  return loops.length ? { accumulators, vars, loops, result } : null;
}

const OPEN = '([{', CLOSE = ')]}';
/** Net bracket balance of `s` (positive = unclosed opens). */
export function bracketBalance(s: string): number {
  let d = 0;
  for (const ch of s) { if (OPEN.includes(ch)) d++; else if (CLOSE.includes(ch)) d--; }
  return d;
}

/** Split a body into LOGICAL statements: a newline or `;` ends a statement only
 *  at bracket-depth 0, so a `poly.append([…, …])` wrapped across lines (or any
 *  parenthesised expression) parses as ONE statement instead of erroring. */
export function splitStatements(body: string): string[] {
  const out: string[] = [];
  let buf = '', depth = 0;
  for (const ch of body ?? '') {
    if (OPEN.includes(ch)) depth++;
    else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
    if ((ch === '\n' || ch === ';') && depth === 0) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
    } else if (ch === '\n') {
      buf += ' '; // newline INSIDE brackets → join the wrapped statement
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Parse a loop's body TEXT into statements (assign / append); unrecognized
 *  statements are dropped here (validateImperative flags them with a reason). */
export function bodyStatements(body: string): ImpStatement[] {
  const out: ImpStatement[] = [];
  for (const l of splitStatements(body)) {
    const ap = l.match(APPEND_RE);
    if (ap) { out.push({ kind: 'append', list: ap[1]!, expr: ap[2]!.trim() }); continue; }
    const as = l.match(ASSIGN_RE);
    if (as) { out.push({ kind: 'assign', name: as[1]!, expr: as[2]!.trim() }); continue; }
  }
  return out;
}

/** True when `src` is an imperative loop (vs the functional map form). */
export function isImperative(src: string): boolean { return parseImperative(src) !== null; }

/** Serialize a program back to the DSL (the canonical, parse-able + readable form). */
export function serializeImperative(p: ImperativeProgram): string {
  const lines: string[] = (p.accumulators ?? []).map((a) => `${a} = []`);
  for (const v of p.vars ?? []) lines.push(`${v.name} = ${v.expr}`);
  for (const lp of p.loops ?? []) {
    lines.push(lp.loopVar2
      ? `for ${lp.loopVar} = ${lp.start} to ${lp.stop}, ${lp.loopVar2} = ${lp.start2} to ${lp.stop2}`
      : `for ${lp.loopVar} = ${lp.start} to ${lp.stop}`);
    for (const bl of (lp.body ?? '').split('\n').map((l) => l.trim()).filter(Boolean)) lines.push(`  ${bl}`);
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
  for (const v of p.vars) locals.add(v.name);
  for (const lp of p.loops) {
    locals.add(lp.loopVar);
    if (lp.loopVar2) locals.add(lp.loopVar2);
    for (const s of bodyStatements(lp.body)) if (s.kind === 'assign') locals.add(s.name);
  }
  const check = (expr: string) => parseAndValidateBare(expr, locals, 'list').errors[0]?.msg ?? null;
  for (const v of p.vars) { const e = check(v.expr); if (e) return e; }
  for (const lp of p.loops) {
    const e = check(lp.start) ?? check(lp.stop)
      ?? (lp.loopVar2 ? (check(lp.start2 ?? '') ?? check(lp.stop2 ?? '')) : null);
    if (e) return e;
    const stmts = bodyStatements(lp.body);
    if (!stmts.length) return `loop "${lp.loopVar}" has no statements — add a ${p.accumulators[0]}.append(…)`;
    // flag any LOGICAL statement (bracket-depth aware) that isn't recognized,
    // with a reason — unbalanced brackets vs wrong shape.
    for (const raw of splitStatements(lp.body)) {
      if (APPEND_RE.test(raw) || ASSIGN_RE.test(raw)) continue;
      const bal = bracketBalance(raw);
      const snip = raw.length > 48 ? raw.slice(0, 48) + '…' : raw;
      if (bal > 0) return `unbalanced "(" or "[" in: ${snip}`;
      if (bal < 0) return `unbalanced ")" or "]" in: ${snip}`;
      return `expected "name = …" or "${p.accumulators[0]}.append(…)" — got: ${snip}`;
    }
    for (const s of stmts) {
      if (bracketBalance(s.expr) !== 0) return `unbalanced brackets in: ${s.expr.slice(0, 48)}`;
      const se = check(s.expr); if (se) return se;
    }
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
    const varDecls = (p.vars ?? []).map((v) => `const ${v.name} = ${exprToJs(v.expr)};`).join(' ');
    const loopJs = p.loops.map((lp) => {
      const stmts = bodyStatements(lp.body).map((s) =>
        s.kind === 'assign' ? `const ${s.name} = ${exprToJs(s.expr)};` : `${s.list}.push(${exprToJs(s.expr)});`,
      ).join(' ');
      const inner = `for (let ${lp.loopVar} = ${exprToJs(lp.start)}; ${lp.loopVar} < (${exprToJs(lp.stop)}); ${lp.loopVar}++)`;
      if (!lp.loopVar2) return `${inner} { ${stmts} }`;
      // GRID: u OUTER, v INNER → row-major Nu×Nv iterations; both in body scope.
      const innerV = `for (let ${lp.loopVar2} = ${exprToJs(lp.start2 ?? '0')}; ${lp.loopVar2} < (${exprToJs(lp.stop2 ?? '0')}); ${lp.loopVar2}++)`;
      return `${inner} { ${innerV} { ${stmts} } }`;
    }).join(' ');
    return { ok: true, js: `(() => { ${decls} ${varDecls} ${loopJs} return ${p.result}; })()` };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
