/**
 * profile-fn-compose — the PURE profile-function round-trip logic extracted
 * out of `ProfileFnEditor.svelte` (modularize R9). Author a `build(p)` body as
 * a calc block + a list of pen `Move`s; round-trip `body string ⇄ {expr, moves}`.
 *
 * No Svelte / `$state` here — just string parsing + emit. The editor component
 * owns the reactive state (rows / calc / moves) and the UI; it imports these
 * functions and feeds them plain values.
 *
 * KNOWN LIMITATION (memory `profile_editor_composeSource_bug`): the round-trip
 * is LOSSY on multi-`Array.from` bodies. `bodyTooComplexToDecompose` detects
 * those and makes `parseBody` bail to a passthrough (ZERO moves), so the editor
 * preserves the original body verbatim instead of recomposing a malformed one.
 * That behaviour is intentional and is pinned by the tests — DO NOT "fix" it
 * here without addressing the underlying decompose path.
 */

// Move kinds:
//   mv / line      — absolute (x, y).
//   lineR / lineZ  — relative (radial / axial delta).
//   repeat         — Array.from({length: a}, (_, i) => [b, c]) emitting a
//                    SEQUENCE of points. a = count expression, b = x(i),
//                    c = y(i). The visual loop primitive — D3 join in code.
export interface Move { cmd: 'mv' | 'line' | 'lineR' | 'lineZ' | 'repeat'; a: string; b: string; c?: string; }

// A calculated expression row (`const name = expr;`).
export interface Calc { name: string; expr: string; }

// Split call args on top-level commas (so `Math.max(a, b), z` → two args).
export function splitArgs(s: string): string[] {
  const out: string[] = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Heuristic — does this body use constructs the editor's structured
 *  rows can't represent without information loss? If so, parseBody
 *  returns ZERO moves so composeBody falls into the verbatim
 *  branch (emits `seedBody` unchanged).
 *
 *  Triggers:
 *    - more than one `Array.from(...)` call (the editor models exactly
 *      ONE repeat row),
 *    - a named spread `...<identifier>` inside the return array
 *      (the editor can't reconstruct named consts at compose-time).
 *
 *  Without this guard, complex curated profiles like `collar_rounded`
 *  (two shoulder arcs + literal corners) parse as a single 'repeat'
 *  row, then compose re-emits a return that collapses to one
 *  Array.from and DROPS the second arc + the corner points →
 *  malformed `.prvl.ts` shadow on the volume. Memory:
 *  `[[profile_editor_composeSource_bug]]`. */
export function bodyTooComplexToDecompose(b: string): boolean {
  const arrFromCount = (b.match(/Array\.from\s*\(/g) ?? []).length;
  if (arrFromCount > 1) return true;
  // Spread of a named identifier inside any return-array literal.
  // Look at the LAST top-level return [...] / => [...] block — same
  // anchor the (3) literal-array branch uses.
  const arrMatch = b.match(/(?:return|=>)\s*(\[(?:[^\[\]]|\[[^\[\]]*\])*\])\s*;?\s*$/);
  if (arrMatch) {
    // `...identifier` (NOT `...Array.from(...)` and NOT `...[...]`).
    if (/\.\.\.\s*[A-Za-z_$][\w$]*\b(?!\s*\.from\s*\()/.test(arrMatch[1])) return true;
  }
  return false;
}

// Parse a build body into { expr (calculated values), moves (the pen path) }.
// Two body shapes are recognized:
//   1. pen() chain — `pen().mv(a,b).line(c,d)…` or `t.mv()/t.line()` calls.
//   2. return-array literal — `return [[a,b], [c,d], …]` or `=> [[…]]`.
//      Every curated profile uses this shape (rect/l/t/plus/cylinder/tube/
//      cone/barrel/drill_pipe_pin) — extract each [a,b] pair as a move so the
//      structured editor can decompose them. p.<name> is stripped so the
//      destructured bare param names (added by composeBody) match.
// Algorithmic bodies (for/Array.from + push) won't match either pattern and
// get preserved verbatim by composeBody's no-moves branch.
export function parseBody(b: string): { expr: string; moves: Move[] } {
  // Bail to verbatim when the body uses constructs the structured editor
  // would round-trip lossily. Empty moves → composeBody keeps the
  // original body. Top-level destr `const { ... } = p;` stays
  // intact via the verbatim wrapping.
  if (bodyTooComplexToDecompose(b)) {
    const penIdx = b.search(/\bpen\s*\(/);
    const expr = (penIdx >= 0 ? b.slice(0, penIdx) : b)
      .replace(/[,;]?\s*(?:\b(?:const|let|var)\s+)?[A-Za-z_$][\w$]*\s*=\s*$/, '')
      .replace(/\breturn\s+$/, '')
      .replace(/\n{2,}/g, '\n')
      .trim();
    return { expr, moves: [] };
  }
  const moves: Move[] = [];
  // (1) pen-chain moves.
  const re = /\.(mv|line|lineR|lineZ)\s*\(((?:[^()]|\([^()]*\))*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(b))) {
    const a = splitArgs(m[2]);
    moves.push({ cmd: m[1] as Move['cmd'], a: a[0] ?? '0', b: a[1] ?? '0' });
  }
  // (2) Array.from repeat pattern — recognized BEFORE the literal-array form
  // so wrapped uses (`return [...Array.from(...)]`) decompose to a single
  // repeat row instead of being over-eagerly parsed as a one-point literal.
  // Two callback forms:
  //   inline   : (_, i) => [<x>, <y>]
  //   block    : (_, i) => { const <name> = <expr>; return [<x>, <y>]; }
  // Local calcs in the block form are INLINED to fixpoint so the row's
  // expressions are pure functions of params + i.
  if (!moves.length) {
    // count uses [\s\S]+? (non-greedy ANY char) so expressions with commas
    // inside parens — Math.max(0, Math.round(n)) — match cleanly; the
    // surrounding `\s*\}\s*,\s*\(\s*_\s*,\s*i\s*\)` terminates the capture.
    const afMatch = b.match(/Array\.from\s*\(\s*\{\s*length\s*:\s*([\s\S]+?)\s*\}\s*,\s*\(\s*_\s*,\s*i\s*\)\s*=>\s*(\[[^\[\]]*\]|\{[\s\S]*?\}(?=\s*\)))/);
    if (afMatch) {
      // composeBody wraps the repeat count in `Math.max(0, Math.round(N))`
      // every emit. Without an unwrap, each parse → compose cycle would
      // ADD a wrapper layer, producing
      //   Math.max(0, Math.round(max(0, round(max(0, round(n))))))
      // on subsequent saves. Strip recursively to the innermost expr.
      let count = afMatch[1].trim();
      for (let pass = 0; pass < 8; pass++) {
        const m1 = count.match(/^Math\.max\s*\(\s*0\s*,\s*Math\.round\s*\(\s*([\s\S]+)\s*\)\s*\)$/);
        const m2 = !m1 && count.match(/^max\s*\(\s*0\s*,\s*round\s*\(\s*([\s\S]+)\s*\)\s*\)$/);
        const inner = (m1 ?? m2)?.[1]?.trim();
        if (!inner) break;
        count = inner;
      }
      const cbody = afMatch[2].trim();
      let x = '', y = '';
      if (cbody.startsWith('[')) {
        const close = cbody.lastIndexOf(']');
        if (close > 0) {
          const parts = splitArgs(cbody.slice(1, close));
          if (parts.length === 2) { x = parts[0]; y = parts[1]; }
        }
      } else if (cbody.startsWith('{')) {
        const close = cbody.lastIndexOf('}');
        const inner = close > 0 ? cbody.slice(1, close) : cbody;
        const localCalcs: Record<string, string> = {};
        for (const stmt of inner.split(';')) {
          const sm = stmt.match(/^\s*const\s+([a-zA-Z_$][\w$]*)\s*=\s*([\s\S]+?)\s*$/);
          if (sm) localCalcs[sm[1]] = sm[2].trim();
        }
        const ret = inner.match(/return\s*\[([\s\S]+?)\]\s*;?/);
        if (ret) {
          const parts = splitArgs(ret[1]);
          if (parts.length === 2) {
            const subst = (e: string) => {
              for (let pass = 0; pass < 8; pass++) {
                let changed = false;
                for (const [k, v] of Object.entries(localCalcs)) {
                  const re = new RegExp('\\b' + k + '\\b', 'g');
                  const next = e.replace(re, '(' + v + ')');
                  if (next !== e) { e = next; changed = true; }
                }
                if (!changed) break;
              }
              return e;
            };
            x = subst(parts[0]);
            y = subst(parts[1]);
          }
        }
      }
      if (x && y) {
        // Strip `p.` (destr'd by composeBody) AND `Math.` (sandbox-injected
        // bare names — math-lib.ts) so the editor shows clean expressions:
        // `r * cos(i * 2 * PI / n)` instead of `p.r * Math.cos(i * 2 * Math.PI / p.n)`.
        const strip = (s: string) => s.replace(/\bp\./g, '').replace(/\bMath\./g, '').trim();
        moves.push({ cmd: 'repeat', a: strip(count), b: strip(x), c: strip(y) });
      }
    }
  }
  // (3) return-array literal — only when (1) and (2) found nothing. Match the
  // LAST top-level `return [...]` or `=> [...]` containing 2-element subarrays.
  if (!moves.length) {
    const arrMatch = b.match(/(?:return|=>)\s*(\[(?:[^\[\]]|\[[^\[\]]*\])*\])\s*;?\s*$/);
    if (arrMatch) {
      const outer = arrMatch[1];
      const elemRe = /\[\s*([^\[\]]+?)\s*\]/g;
      let em: RegExpExecArray | null;
      while ((em = elemRe.exec(outer))) {
        const parts = splitArgs(em[1]);
        if (parts.length !== 2) continue;
        const a = parts[0].replace(/\bp\./g, '').replace(/\bMath\./g, '').trim();
        const c = parts[1].replace(/\bp\./g, '').replace(/\bMath\./g, '').trim();
        moves.push({ cmd: moves.length ? 'line' : 'mv', a, b: c });
      }
    }
  }
  // calc = everything before the pen path begins (`const t = pen()` /
  // `return pen()`); a raw `return [...]` profile (no pen) → whole body is calc.
  const penIdx = b.search(/\bpen\s*\(/);
  const expr = (penIdx >= 0 ? b.slice(0, penIdx) : b)
    .replace(/[,;]?\s*(?:\b(?:const|let|var)\s+)?[A-Za-z_$][\w$]*\s*=\s*$/, '')
    .replace(/\breturn\s+$/, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return { expr, moves };
}

/** Inputs to {@link composeBody} — the plain values the editor's reactive
 *  state (rows / calc / moves / seed) reduces to. composeSource() genuinely
 *  depends on ALL of these (not just expr + moves): the param `keys` drive the
 *  `const { … } = p;` destructure, `calc` is the calculated-expr block, and
 *  `seedBody` is round-tripped verbatim when no pen moves are recognised. */
export interface ComposeInput {
  /** Raw param keys (rows.map(r => r.key)); trimmed + validated internally. */
  keys: string[];
  /** Calculated-expression rows, emitted as `const name = expr;` lines. */
  calc: Calc[];
  /** The pen-path move list. */
  moves: Move[];
  /** The original loaded body — emitted verbatim when no moves are recognised. */
  seedBody?: string;
}

/** Reassemble the build BODY (the inner statements, WITHOUT the
 *  `export function build(p) { … }` wrapper — the caller adds that): the
 *  param destructure, the calc block, then the pen path / point array from
 *  the move list. Pure inverse of {@link parseBody} for decomposable bodies.
 *
 *  composeSource() in the editor wraps the return value:
 *    `export function build(p) {\n${composeBody(input)}\n}`. */
export function composeBody(input: ComposeInput): string {
  const { calc, moves, seedBody } = input;
  // Expose params as bare names (const { bore, wall, … } = p) so the path AND
  // calc can use them directly — no `const ri = p.bore` aliasing needed. Skip
  // any name the calc block already declares (avoids double-declaration).
  const keys = input.keys.map((k) => k.trim()).filter((k) => /^[a-zA-Z_]\w*$/.test(k));
  const usable = keys.filter((k) => !calc.some((c) => c.name === k));
  const destr = usable.length ? `  const { ${usable.join(', ')} } = p;\n` : '';
  const ex = calc.length ? calc.map((c) => `  const ${c.name} = ${c.expr};`).join('\n') + '\n' : '';
  if (!moves.length) {
    // No pen moves recognized. Three cases:
    //  (a) Procedural body (for/while/Array.from + pts.push) like the curated
    //      ellipse/ngon/star — parseBody returns 0 moves because there's no
    //      pen chain to extract. Preserve the original body verbatim so it
    //      still builds. Calc/destr is NOT prepended here (the body already
    //      contains its own declarations + return; duplicating would double-
    //      declare). Adding a row to "path" switches to the pen-chain branch
    //      below, which replaces the body entirely.
    //  (b) Body too complex for the editor's structured rows (multiple
    //      Array.from arcs, named spreads in the return — see
    //      `bodyTooComplexToDecompose`). parseBody intentionally returned
    //      zero moves so we land here and round-trip the original verbatim
    //      instead of recomposing a lossy version.
    //  (c) Truly empty (a fresh profile that had its moves deleted) — emit a
    //      visible empty array so the error surfaces clearly.
    const body = (seedBody || '').trim();
    if (body) {
      // The body was extracted from a part where the same names existed as
      // FUNCTION ARGS (e.g. `function name(segments, od, bore, …)`), so it
      // uses bare `od / bore / …`. Inside `build(p)` those names don't
      // exist unless we destructure. Prepend `const { od, bore, … } = p;`
      // — but ONLY for names the body actually references AND that aren't
      // already declared in it (avoid double-declaring a name the body's
      // own `const X = …` block introduces, like `len` reused as a var).
      const declRe = /\b(?:const|let|var)\s+([a-zA-Z_$][\w$]*)/g;
      const declared = new Set<string>();
      let dm: RegExpExecArray | null;
      while ((dm = declRe.exec(body))) declared.add(dm[1]!);
      const needed = usable.filter((k) => !declared.has(k) && new RegExp(`\\b${k}\\b`).test(body));
      const verbatimDestr = needed.length ? `  const { ${needed.join(', ')} } = p;\n` : '';
      return `${verbatimDestr}  ${body.replace(/\n/g, '\n  ')}`;
    }
    return `${destr}${ex}  return [];`;
  }
  // When ANY repeat row is present, emit a RAW point-array body that mixes
  // static (mv/line) literals with Array.from() expansions for each repeat.
  // pen()'s relative ops (lineR/lineZ) can't compose cleanly with spread, so
  // they're flagged as a comment when mixed with repeat — the user can switch
  // them back to absolute line/mv once they're aware. For pure mv/line/lineR/
  // lineZ rows (no repeat), keep the pen() chain — that's what loaded sources
  // round-trip to and what the snake/flow view expects.
  const hasRepeat = moves.some((m) => m.cmd === 'repeat');
  if (hasRepeat) {
    const els = moves.map((m) => {
      if (m.cmd === 'repeat') return `    ...Array.from({ length: Math.max(0, Math.round(${m.a || '0'})) }, (_, i) => [${m.b || '0'}, ${m.c ?? '0'}])`;
      if (m.cmd === 'lineR' || m.cmd === 'lineZ') return `    /* ${m.cmd}(${m.a}) — relative ops not supported when a repeat row is present; convert to mv/line */`;
      return `    [${m.a || '0'}, ${m.b || '0'}]`;
    }).join(',\n');
    return `${destr}${ex}  return [\n${els},\n  ];`;
  }
  // Chained pen path: pen().mv(…).line(…)….pts()
  const chain = moves.map((mv) =>
    mv.cmd === 'lineR' || mv.cmd === 'lineZ' ? `    .${mv.cmd}(${mv.a})` : `    .${mv.cmd}(${mv.a}, ${mv.b})`,
  ).join('\n');
  return `${destr}${ex}  return pen()\n${chain}\n    .pts();`;
}
