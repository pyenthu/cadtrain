/**
 * parseBuildSource — reverse-interpret a profile `build(p)` function into the
 * structured editor model (params · calc · path), via a real AST (acorn).
 *
 * This is the robust counterpart to composing source FROM the editor: it lets
 * you hand-type / paste a build function and have the calc grid + path
 * flow-chart + preview rebuild themselves. Anything that doesn't fit the
 * structured shape (loops, conditionals, helper calls) sets `ok:false` so the
 * caller can fall back to the raw source view — never a lossy/wrong parse.
 *
 * Recognized inside `function build(p) { … }` (or a bare body, auto-wrapped):
 *   - `const { bore, wall } = p;`          → params (names bound from p)
 *   - `const ri = <expr>, z1 = <expr>;`    → calc { name, expr-source }
 *   - `return pen().mv(a,b).line(a,b)…pts()`  → moves (chained)
 *   - `const t = pen(); t.mv(a,b); …; return t.pts();`  → moves (legacy)
 *   - `return [[x,y], …];`                  → literal point list
 */
import { parse } from 'acorn';

export interface ParsedMove { cmd: 'mv' | 'line' | 'lineR' | 'lineZ'; a: string; b: string; }
export interface ParsedBuild {
  ok: boolean;                          // fully recognized into the structured model
  params: string[];                     // names destructured from p
  calc: { name: string; expr: string }[];
  moves: ParsedMove[];
  literal: [number, number][] | null;   // a raw `return [[…]]` (no pen) profile
}

const PEN = new Set(['mv', 'line', 'lineR', 'lineZ']);
const fail: ParsedBuild = { ok: false, params: [], calc: [], moves: [], literal: null };

export function parseBuildSource(input: string): ParsedBuild {
  const src = /\bfunction\b|=>/.test(input) ? input : `function build(p){\n${input}\n}`;
  let ast: any;
  try { ast = parse(src, { ecmaVersion: 2022 }); } catch { return { ...fail }; }

  const fn = findBuildFn(ast);
  if (!fn) return { ...fail };
  const slice = (n: any) => src.slice(n.start, n.end);

  const params: string[] = [];
  const calc: { name: string; expr: string }[] = [];
  let moves: ParsedMove[] = [];
  let literal: [number, number][] | null = null;
  let ok = true;

  const body = fn.body;
  const stmts = body.type === 'BlockStatement' ? body.body : [{ type: 'ReturnStatement', argument: body }];
  for (const st of stmts) {
    if (st.type === 'VariableDeclaration') {
      for (const d of st.declarations) {
        if (d.id.type === 'ObjectPattern' && d.init?.type === 'Identifier' && d.init.name === 'p') {
          for (const pr of d.id.properties) if (pr.value?.type === 'Identifier') params.push(pr.value.name);
        } else if (d.id.type === 'Identifier' && d.init) {
          if (isPen(d.init)) continue; // `const t = pen()` scaffolding — not calc
          calc.push({ name: d.id.name, expr: slice(d.init) });
        } else ok = false;
      }
    } else if (st.type === 'ReturnStatement' && st.argument) {
      const chain = penChain(st.argument, src);
      if (chain) { moves = moves.concat(chain); continue; }
      const lit = literalPts(st.argument);
      if (lit) { literal = lit; continue; }
      ok = false;
    } else if (st.type === 'ExpressionStatement') {
      const mv = singleMove(st.expression, src); // legacy `t.mv(…);`
      if (mv) moves.push(mv); else ok = false;
    } else ok = false;
  }
  return { ok, params, calc, moves, literal };
}

function findBuildFn(ast: any): any {
  for (const node of ast.body) {
    if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'FunctionDeclaration') return node.declaration;
    if (node.type === 'FunctionDeclaration') return node;
    if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) {
        if (d.init?.type === 'ArrowFunctionExpression' || d.init?.type === 'FunctionExpression') return d.init;
      }
    }
  }
  return null;
}

function isPen(node: any): boolean {
  return node?.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'pen';
}

/** Walk a `pen().mv().line()….pts()` (or `t.pts()`) chain → moves in order. */
function penChain(node: any, src: string): ParsedMove[] | null {
  if (node.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression' || node.callee.property?.name !== 'pts') return null;
  const calls: ParsedMove[] = [];
  let cur = node.callee.object;
  while (cur?.type === 'CallExpression' && cur.callee?.type === 'MemberExpression') {
    const m = cur.callee.property?.name;
    if (PEN.has(m)) {
      const args = cur.arguments.map((a: any) => src.slice(a.start, a.end));
      calls.push({ cmd: m, a: args[0] ?? '0', b: args[1] ?? '0' });
    }
    cur = cur.callee.object;
  }
  const rooted = isPen(cur) || cur?.type === 'Identifier';
  return rooted ? calls.reverse() : null;
}

function singleMove(node: any, src: string): ParsedMove | null {
  if (node?.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') return null;
  const m = node.callee.property?.name;
  if (!PEN.has(m)) return null;
  const args = node.arguments.map((a: any) => src.slice(a.start, a.end));
  return { cmd: m, a: args[0] ?? '0', b: args[1] ?? '0' };
}

function numOf(n: any): number | null {
  if (n?.type === 'Literal' && typeof n.value === 'number') return n.value;
  if (n?.type === 'UnaryExpression' && n.operator === '-' && n.argument?.type === 'Literal') return -n.argument.value;
  return null;
}
function literalPts(node: any): [number, number][] | null {
  if (node?.type !== 'ArrayExpression') return null;
  const pts: [number, number][] = [];
  for (const el of node.elements) {
    if (el?.type !== 'ArrayExpression' || el.elements.length !== 2) return null;
    const x = numOf(el.elements[0]), y = numOf(el.elements[1]);
    if (x === null || y === null) return null;
    pts.push([x, y]);
  }
  return pts.length ? pts : null;
}
