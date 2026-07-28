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
import { compileListFormula, parseAndValidateBare, parseExpr } from '$lib/graph/graph-exprs';

export interface ImpAssign { kind: 'assign'; name: string; expr: string; }
export interface ImpAppend { kind: 'append'; list: string; expr: string; }
/** A CONDITIONAL block (#31): run `then` when `cond` is truthy, else `else`.
 *  `then`/`else` are NESTED statements (assign / append / if) — the visual
 *  IF/THEN block edits them. Serialized to a keyword-delimited text form
 *  (`if <cond>` … `else` … `end`) so blocks ↔ text ↔ the SAME IIFE round-trip;
 *  the condition lowers through the functional list compiler like every other
 *  body expression (so params/loop-vars/comparisons resolve identically). */
export interface ImpIf { kind: 'if'; cond: string; then: ImpStatement[]; else?: ImpStatement[]; }
export type ImpStatement = ImpAssign | ImpAppend | ImpIf;
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
  stmts?: ImpStatement[];   // top-level statements (add-point / set / if) run before the loops — e.g. a literal point list imported as appends
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
// #31 conditional-block delimiters (their own logical lines): `if <cond>` opens,
// `else` splits, `end` closes. Checked BEFORE ASSIGN_RE so `if a > b` (no `=`)
// isn't mistaken for an assignment; the trailing space in IF_RE keeps a var
// literally named `iffy = …` from matching.
const IF_RE = /^if\s+(.+)$/;
const ELSE_RE = /^else$/;
const END_RE = /^end$/;

/** Parse the imperative loop DSL, or null if `src` isn't that shape. Handles both
 *  a loop program (accumulator + for-loops + return) AND a loop-free program with
 *  only TOP-LEVEL statements (accumulator + `poly.append(…)`/`if …` + return) — the
 *  latter is what an imported LITERAL point list serializes to. A bare array
 *  literal (`[[…]]`, a single line) stays non-imperative → null (see the length
 *  guard) so the emit + inference contract for literals is unchanged. */
export function parseImperative(src: string): ImperativeProgram | null {
  const lines = (src ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return null; // accumulator + ≥1 stmt/loop + return

  let idx = 0;
  const accumulators: string[] = [];
  const vars: ImpAssign[] = [];
  const topLines: string[] = []; // top-level statement lines (append / if) before the first loop
  let sawStmt = false;
  while (idx < lines.length - 1 && !FOR_RE.test(lines[idx]!)) {
    const line = lines[idx]!;
    const acc = line.match(ACC_RE);
    if (acc && !sawStmt) { accumulators.push(acc[1]!); idx++; continue; }
    // a LEADING plain assignment (before any append/if) is a top-level VARIABLE;
    // from the first append/if onward everything is a top-level STATEMENT body.
    const looksStmt = APPEND_RE.test(line) || IF_RE.test(line) || ELSE_RE.test(line) || END_RE.test(line);
    if (!sawStmt && !looksStmt) {
      const as = line.match(ASSIGN_RE);
      if (as) { vars.push({ kind: 'assign', name: as[1]!, expr: as[2]!.trim() }); idx++; continue; }
      return null; // unexpected top-level line
    }
    sawStmt = true;
    topLines.push(line); idx++;
  }
  if (!accumulators.length) return null;

  const retM = lines[lines.length - 1]!.match(RETURN_RE);
  if (!retM) return null;
  const result = retM[1]!;
  if (!accumulators.includes(result)) return null;

  const stmts = topLines.length ? bodyStatements(topLines.join('\n')) : [];

  const loops: ImpLoop[] = [];
  while (idx < lines.length - 1) {
    const hd = parseForHeader(lines[idx]!);
    if (!hd) return null; // expected a `for`
    idx++;
    const bodyLines: string[] = [];
    while (idx < lines.length - 1 && !FOR_RE.test(lines[idx]!)) { bodyLines.push(lines[idx]!); idx++; }
    loops.push({ ...hd, body: bodyLines.join('\n') });
  }
  return (loops.length || stmts.length)
    ? { accumulators, vars, stmts, loops, result }
    : null;
}

/** Import a raw ARRAY-LITERAL point list `[[a,b,c], …]` (or `[[a,b], …]`) into
 *  top-level append statements — `<acc>.append([a,b,c])` per row — so a LITERAL
 *  `list<point>` formula can be edited as blocks WITHOUT losing the data (the
 *  block builder then shows one add-point block per literal point). Returns null
 *  when `src` is not an array-of-array literal (the caller keeps the raw text).
 *  Deliberately SEPARATE from parseImperative so isImperative stays false for a
 *  bare literal (the emit + inference contract for literals is unchanged). */
export function importLiteralPointList(src: string, acc = 'poly'): ImpAppend[] | null {
  const parsed = parseExpr((src ?? '').replace(/\breturn\b/g, ' '));
  if (!parsed.ok) return null;
  const ast: any = parsed.ast;
  if (ast?.type !== 'ArrayNode') return null;
  const items: any[] = ast.items ?? [];
  if (!items.length || !items.every((it) => it?.type === 'ArrayNode')) return null;
  return items.map((it) => ({ kind: 'append', list: acc, expr: String(it.toString()) }));
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

/** Parse a loop's body TEXT into a NESTED statement tree (assign / append / if);
 *  unrecognized lines are dropped here (validateImperative flags them). `if`
 *  blocks span multiple logical lines (`if …` / `else` / `end`) and nest — a
 *  small recursive-descent walk over the bracket-aware statement lines. */
export function bodyStatements(body: string): ImpStatement[] {
  const lines = splitStatements(body);
  let i = 0;
  const block = (): ImpStatement[] => {
    const out: ImpStatement[] = [];
    while (i < lines.length) {
      const l = lines[i]!;
      if (ELSE_RE.test(l) || END_RE.test(l)) break;    // terminator — caller consumes it
      const ifm = l.match(IF_RE);
      if (ifm) {
        i++;                                           // consume `if <cond>`
        const thenB = block();
        let elseB: ImpStatement[] | undefined;
        if (i < lines.length && ELSE_RE.test(lines[i]!)) { i++; elseB = block(); }
        if (i < lines.length && END_RE.test(lines[i]!)) i++;   // consume `end`
        out.push({ kind: 'if', cond: ifm[1]!.trim(), then: thenB, else: elseB });
        continue;
      }
      const ap = l.match(APPEND_RE);
      if (ap) { out.push({ kind: 'append', list: ap[1]!, expr: ap[2]!.trim() }); i++; continue; }
      const as = l.match(ASSIGN_RE);
      if (as) { out.push({ kind: 'assign', name: as[1]!, expr: as[2]!.trim() }); i++; continue; }
      i++;                                             // unrecognized — skip (validate flags it)
    }
    return out;
  };
  return block();
}

/** Serialize a nested statement tree back to the body TEXT form bodyStatements
 *  reads (2-space indent per nesting level; `if …`/`else`/`end` keyword lines). */
export function serializeStatements(stmts: ImpStatement[], indent = ''): string {
  const lines: string[] = [];
  const emit = (ss: ImpStatement[], ind: string) => {
    for (const s of ss) {
      if (s.kind === 'assign') lines.push(`${ind}${s.name} = ${s.expr}`);
      else if (s.kind === 'append') lines.push(`${ind}${s.list}.append(${s.expr})`);
      else {
        lines.push(`${ind}if ${s.cond}`);
        emit(s.then, ind + '  ');
        if (s.else && s.else.length) { lines.push(`${ind}else`); emit(s.else, ind + '  '); }
        lines.push(`${ind}end`);
      }
    }
  };
  emit(stmts, indent);
  return lines.join('\n');
}

/** True when `src` is an imperative loop (vs the functional map form). */
export function isImperative(src: string): boolean { return parseImperative(src) !== null; }

/** Serialize a program back to the DSL (the canonical, parse-able + readable form). */
export function serializeImperative(p: ImperativeProgram): string {
  const lines: string[] = (p.accumulators ?? []).map((a) => `${a} = []`);
  for (const v of p.vars ?? []) lines.push(`${v.name} = ${v.expr}`);
  // top-level statements (add-point / set / if) — flat, before the loops.
  const topText = serializeStatements(p.stmts ?? []);
  if (topText) for (const l of topText.split('\n')) lines.push(l);
  for (const lp of p.loops ?? []) {
    lines.push(lp.loopVar2
      ? `for ${lp.loopVar} = ${lp.start} to ${lp.stop}, ${lp.loopVar2} = ${lp.start2} to ${lp.stop2}`
      : `for ${lp.loopVar} = ${lp.start} to ${lp.stop}`);
    // preserve the body's OWN indentation (nested if/else blocks) — only trim
    // trailing whitespace + drop blank lines, then indent one level under `for`.
    for (const raw of (lp.body ?? '').split('\n')) {
      const bl = raw.replace(/\s+$/, '');
      if (bl.trim()) lines.push(`  ${bl}`);
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
  for (const v of p.vars) locals.add(v.name);
  // collect every assigned name (including inside if/else blocks) into scope —
  // validation is lenient defence-in-depth (the sandbox is the real boundary).
  const collect = (ss: ImpStatement[]) => {
    for (const s of ss) {
      if (s.kind === 'assign') locals.add(s.name);
      else if (s.kind === 'if') { collect(s.then); if (s.else) collect(s.else); }
    }
  };
  collect(p.stmts ?? []);
  for (const lp of p.loops) {
    locals.add(lp.loopVar);
    if (lp.loopVar2) locals.add(lp.loopVar2);
    collect(bodyStatements(lp.body));
  }
  const check = (expr: string) => parseAndValidateBare(expr, locals, 'list').errors[0]?.msg ?? null;
  const checkStmts = (ss: ImpStatement[]): string | null => {
    for (const s of ss) {
      if (s.kind === 'if') {
        if (bracketBalance(s.cond) !== 0) return `unbalanced brackets in condition: ${s.cond.slice(0, 48)}`;
        const c = check(s.cond); if (c) return c;
        if (!s.then.length) return `"if ${s.cond.slice(0, 32)}" is empty — add a step (or point) inside it`;
        const t = checkStmts(s.then); if (t) return t;
        if (s.else) { const el = checkStmts(s.else); if (el) return el; }
      } else {
        if (bracketBalance(s.expr) !== 0) return `unbalanced brackets in: ${s.expr.slice(0, 48)}`;
        const se = check(s.expr); if (se) return se;
      }
    }
    return null;
  };
  for (const v of p.vars) { const e = check(v.expr); if (e) return e; }
  const topErr = checkStmts(p.stmts ?? []); if (topErr) return topErr;
  for (const lp of p.loops) {
    const e = check(lp.start) ?? check(lp.stop)
      ?? (lp.loopVar2 ? (check(lp.start2 ?? '') ?? check(lp.stop2 ?? '')) : null);
    if (e) return e;
    const stmts = bodyStatements(lp.body);
    if (!stmts.length) return `loop "${lp.loopVar}" has no statements — add a ${p.accumulators[0]}.append(…)`;
    const se = checkStmts(stmts); if (se) return se;
  }
  return null;
}

function exprToJs(s: string): string {
  const r = compileListFormula(s); // parse + lower (handles arrays/ops/cos/sin/…)
  if (!r.ok) throw new Error(r.error);
  return r.js;
}

/** Lower a nested statement tree to JS (assign → `let`, append → `.push`, if →
 *  a real `if (cond) { … } else { … }`). Conditions + expressions lower through
 *  exprToJs so params/loop-vars/comparisons resolve like every other body expr.
 *  Symbol names preserved (emit rewrites def params to V_* afterward). */
function compileStatements(stmts: ImpStatement[]): string {
  return stmts.map((s) => {
    if (s.kind === 'assign') return `let ${s.name} = ${exprToJs(s.expr)};`;
    if (s.kind === 'append') return `${s.list}.push(${exprToJs(s.expr)});`;
    const thenJs = compileStatements(s.then);
    const elseJs = s.else && s.else.length ? ` else { ${compileStatements(s.else)} }` : '';
    return `if (${exprToJs(s.cond)}) { ${thenJs} }${elseJs}`;
  }).join(' ');
}

/** Compile the imperative program to a JS IIFE that runs the loop(s) + returns the
 *  accumulator. Symbol names preserved (emit rewrites def params later). */
export function compileImperative(src: string): { ok: true; js: string } | { ok: false; error: string } {
  const p = parseImperative(src);
  if (!p) return { ok: false, error: 'not an imperative loop' };
  try {
    const decls = p.accumulators.map((a) => `let ${a} = [];`).join(' ');
    const varDecls = (p.vars ?? []).map((v) => `const ${v.name} = ${exprToJs(v.expr)};`).join(' ');
    const topJs = compileStatements(p.stmts ?? []); // top-level add-point / set / if
    const loopJs = p.loops.map((lp) => {
      const stmts = compileStatements(bodyStatements(lp.body));
      const inner = `for (let ${lp.loopVar} = ${exprToJs(lp.start)}; ${lp.loopVar} < (${exprToJs(lp.stop)}); ${lp.loopVar}++)`;
      if (!lp.loopVar2) return `${inner} { ${stmts} }`;
      // GRID: u OUTER, v INNER → row-major Nu×Nv iterations; both in body scope.
      const innerV = `for (let ${lp.loopVar2} = ${exprToJs(lp.start2 ?? '0')}; ${lp.loopVar2} < (${exprToJs(lp.stop2 ?? '0')}); ${lp.loopVar2}++)`;
      return `${inner} { ${innerV} { ${stmts} } }`;
    }).join(' ');
    return { ok: true, js: `(() => { ${decls} ${varDecls} ${topJs} ${loopJs} return ${p.result}; })()` };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
