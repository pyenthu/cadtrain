// src/lib/appkit/manifest/compute.ts — declarative computed variables.
//
// Each `computed` entry is `name: "= expr"`: a formula over params + earlier vars,
// evaluated by a SMALL, safe interpreter — NO eval, NO codegen, NO network. Declaration
// order: a var may reference vars declared before it (accumulating scope).
//
// Why not reuse graph/expr's mathjs? That instance is `create(parseDependencies)` —
// parse-ONLY, it cannot evaluate; and a full mathjs instance would add ~250 KB to the
// harness bundle. This UI-oriented formula evaluator is deliberately minimal: numbers,
// strings, booleans, dotted identifiers (scope lookup), a whitelist of math functions,
// arithmetic/comparison/logic operators, and a ternary. Formulas are pure (no side
// effects), so eager evaluation is safe.

type Tok = { t: string; v?: string | number };

const FUNCS: Record<string, (...a: any[]) => number | boolean> = {
  min: (...a) => Math.min(...flat(a)),
  max: (...a) => Math.max(...flat(a)),
  sum: (...a) => flat(a).reduce((s, x) => s + x, 0),
  avg: (...a) => {
    const f = flat(a);
    return f.length ? f.reduce((s, x) => s + x, 0) / f.length : 0;
  },
  round: (x, d = 0) => {
    const m = 10 ** d;
    return Math.round(x * m) / m;
  },
  floor: Math.floor,
  ceil: Math.ceil,
  abs: Math.abs,
  sqrt: Math.sqrt,
  pow: Math.pow,
  len: (x) => (Array.isArray(x) || typeof x === 'string' ? x.length : 0),
};

function flat(a: any[]): number[] {
  const out: number[] = [];
  for (const x of a) {
    if (Array.isArray(x)) out.push(...flat(x));
    else out.push(Number(x));
  }
  return out;
}

const TWO = new Set(['**', '==', '!=', '<=', '>=', '&&', '||']);

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < s.length && /[0-9.eE+\-]/.test(s[j]) && !(/[+\-]/.test(s[j]) && !/[eE]/.test(s[j - 1]))) j++;
      out.push({ t: 'num', v: parseFloat(s.slice(i, j)) });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1,
        str = '';
      while (j < s.length && s[j] !== c) {
        str += s[j];
        j++;
      }
      out.push({ t: 'str', v: str });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_$.]/.test(s[j])) j++;
      out.push({ t: 'ident', v: s.slice(i, j) });
      i = j;
      continue;
    }
    const t2 = s.slice(i, i + 2);
    if (TWO.has(t2)) {
      out.push({ t: t2 });
      i += 2;
      continue;
    }
    out.push({ t: c });
    i++;
  }
  return out;
}

const BINPREC: Record<string, number> = {
  '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4,
  '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '**': 7,
};

function lookup(path: string, scope: Record<string, unknown>): unknown {
  if (path === 'true') return true;
  if (path === 'false') return false;
  if (path === 'null') return null;
  return path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), scope);
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v);
}
function truthy(v: unknown): boolean {
  return !!v;
}

function applyBin(op: string, a: unknown, b: unknown): unknown {
  switch (op) {
    case '+': return typeof a === 'string' || typeof b === 'string' ? String(a) + String(b) : num(a) + num(b);
    case '-': return num(a) - num(b);
    case '*': return num(a) * num(b);
    case '/': return num(a) / num(b);
    case '%': return num(a) % num(b);
    case '**': return num(a) ** num(b);
    case '<': return num(a) < num(b);
    case '<=': return num(a) <= num(b);
    case '>': return num(a) > num(b);
    case '>=': return num(a) >= num(b);
    case '==': return a === b;
    case '!=': return a !== b;
    case '&&': return truthy(a) && truthy(b);
    case '||': return truthy(a) ? a : b;
  }
  throw new Error(`compute: unknown operator ${op}`);
}

/** Evaluate ONE formula against a scope. Returns undefined on any parse/eval error. */
export function evalExpr(src: string, scope: Record<string, unknown> = {}): unknown {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const expect = (t: string) => {
    if (toks[pos++]?.t !== t) throw new Error(`compute: expected "${t}"`);
  };

  function primary(): unknown {
    const tk = toks[pos++];
    if (!tk) throw new Error('compute: unexpected end');
    switch (tk.t) {
      case 'num':
      case 'str':
        return tk.v;
      case '-':
        return -num(primary());
      case '!':
        return !truthy(primary());
      case '(': {
        const v = expr(0);
        expect(')');
        return v;
      }
      case 'ident': {
        const name = tk.v as string;
        if (peek()?.t === '(') {
          pos++;
          const args = argList();
          const fn = FUNCS[name];
          if (!fn) throw new Error(`compute: unknown function ${name}`);
          return fn(...args);
        }
        return lookup(name, scope);
      }
    }
    throw new Error(`compute: unexpected token "${tk.t}"`);
  }

  function argList(): unknown[] {
    const args: unknown[] = [];
    if (peek()?.t === ')') {
      pos++;
      return args;
    }
    for (;;) {
      args.push(expr(0));
      const t = toks[pos++];
      if (t?.t === ')') break;
      if (t?.t !== ',') throw new Error('compute: expected , or )');
    }
    return args;
  }

  function expr(minPrec: number): unknown {
    let left = primary();
    for (;;) {
      const tk = peek();
      if (!tk) break;
      if (tk.t === '?' && minPrec === 0) {
        pos++;
        const a = expr(0);
        expect(':');
        const b = expr(0);
        left = truthy(left) ? a : b;
        continue;
      }
      const prec = BINPREC[tk.t];
      if (prec == null || prec < minPrec) break;
      pos++;
      const right = expr(tk.t === '**' ? prec : prec + 1);
      left = applyBin(tk.t, left, right);
    }
    return left;
  }

  try {
    const v = expr(0);
    if (pos < toks.length) return undefined; // trailing garbage → invalid
    return v;
  } catch {
    return undefined;
  }
}

/** Evaluate a `computed` block in declaration order (each var sees params + earlier vars). */
export function evalComputed(
  computed: Record<string, string> | undefined,
  scope: Record<string, unknown> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!computed) return out;
  for (const [name, formula] of Object.entries(computed)) {
    const src = String(formula ?? '')
      .replace(/^\s*=\s*/, '')
      .trim();
    out[name] = src ? evalExpr(src, { ...scope, ...out }) : undefined;
  }
  return out;
}
