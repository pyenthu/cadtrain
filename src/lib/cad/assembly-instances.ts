/**
 * assembly-instances — the ordered-array model for `.asm.ts` assemblies.
 *
 * Each row is one part instance the assembly places into the scene. The
 * array is the SOURCE OF TRUTH: the function body is regenerated from it
 * on every save (sequential rows auto-mate to the previous sequential
 * row's tail; overlay rows align to a named anchor + datum; custom rows
 * carry a raw expression string verbatim).
 *
 * Why this shape: completion strings are 95% sequential stacks with the
 * occasional overlay (collar/band/centralizer sitting on a parent), and
 * the 5% one-off offsets need a free-form escape. The mode flag covers
 * all three uniformly — drag-reorder mutates the array order, the
 * emitter recomputes the mating math, and the bake is unchanged.
 *
 * Format (in meta.instances):
 *   [
 *     { name: 'A', src: 'dp_box',     args: ['200'],          mode: 'sequential' },
 *     { name: 'B', src: 'pipe_joint', args: ['9000'],         mode: 'sequential' },
 *     { name: 'C', src: 'collar',    args: [],                mode: 'overlay',
 *       anchor: 'B', at: 'head' },
 *     { name: 'D', src: 'dp_pin',    args: ['200'],           mode: 'sequential' },
 *     { name: 'E',                                            mode: 'custom',
 *       expr: 'mv(dp_pin(200), [0, 0, tail(B) + 12])' },
 *   ]
 *
 * args are stored as STRING EXPRESSIONS (so `p.length`, `12 * 2`, etc. all
 * round-trip). The emitter joins them with `, ` into the positional call.
 *
 * Body emission for the example above:
 *   const A = dp_box(200);
 *   const B = mate(A, pipe_joint(9000));
 *   const C__raw = collar();
 *   const C = align(C__raw, head(B), head(C__raw));
 *   const D = mate(B, dp_pin(200));                  // mates to B, not C
 *   const E = mv(dp_pin(200), [0, 0, tail(B) + 12]);
 *   return empty().add(A).add(B).add(C).add(D).add(E);
 */

export type InstanceMode = 'sequential' | 'overlay' | 'custom';
/** Per-row CSG op applied LEFT-to-RIGHT to the row's own manifold:
 *  `const X = src(args).subtract(C).intersect(D)`.
 *  Each entry pairs the op with an operand name (a SIBLING row name).
 *  `add` = boolean union (vs the default "just placed in the scene"
 *  via the outer list — see emitAssemblyBody). */
export type CsgOp = 'add' | 'subtract' | 'intersect';
export interface CsgOpStep { op: CsgOp; arg: string; }
export type Datum = 'head' | 'tail' | 'center';

export interface Instance {
  /** Local binding name in the body — A, B, C, … (Excel-column style). */
  name: string;
  /** Source primitive id (e.g. 'dp_box', 'r_cylinder'). Omitted for `custom`. */
  src?: string;
  /** Positional args as expression strings. */
  args: string[];
  /** How the row places into the scene. */
  mode: InstanceMode;
  /** Overlay: name of the row this overlay is anchored to. */
  anchor?: string;
  /** Overlay: which datum of the anchor to align to (default 'head'). */
  at?: Datum;
  /** Custom: raw expression that produces a Manifold. `name` will bind to it. */
  expr?: string;
  /** Per-row CSG ops chain applied LEFT-to-RIGHT to this row's manifold:
   *  `const X = src(args).subtract(C).intersect(D);` is `ops: [
   *      { op: 'subtract', arg: 'C' },
   *      { op: 'intersect', arg: 'D' },
   *  ]`. Empty / omitted = the row participates in the scene by being
   *  placed in the outer return list (no boolean math). */
  ops?: CsgOpStep[];
  /** Exclude from the outer return list. Set automatically on legacy
   *  migration for rows that were boolean OPERANDS of another row
   *  (`op: 'subtract'` etc.) — those rows weren't meant to be visible
   *  on their own. Also set explicitly when a row is added purely as an
   *  operand via the Phase E.2 ops toolbar (TBD UX). */
  hidden?: boolean;
}

/** Excel-column-style sequence: A, B, …, Z, AA, AB, …, ZZ, AAA, … */
export function columnName(i: number): string {
  let n = i, out = '';
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

/** First name not already used (case-sensitive). */
export function nextInstanceName(used: readonly string[]): string {
  const taken = new Set(used);
  for (let i = 0; ; i++) {
    const n = columnName(i);
    if (!taken.has(n)) return n;
  }
}

// ─── Parse: meta.instances → Instance[] ────────────────────────────────

/** Find the outer `[` of `meta.instances = [...]` and return [start, end]
 *  spanning the literal (inclusive of both brackets). Returns null when
 *  missing or malformed (caller falls through to legacy mode). */
export function findInstancesLiteralRange(source: string): { start: number; end: number } | null {
  const head = source.match(/\binstances\s*:\s*\[/);
  if (!head) return null;
  const start = (head.index ?? 0) + head[0].length - 1; // points AT the `[`
  let depth = 0;
  let i = start;
  let inStr: string | null = null;
  while (i < source.length) {
    const ch = source[i]!;
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; i++; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) return { start, end: i + 1 }; }
    i++;
  }
  return null;
}

/** Parse `meta.instances = [...]` into typed Instance rows.
 *  Returns [] when missing — caller treats absent as "legacy assembly". */
export function parseInstances(source: string): Instance[] {
  const rows = parseInstancesRaw(source);
  // Phase E.1 legacy migration — lift each row's stale `op: 'subtract'|
  // 'intersect'` onto the PRECEDING row's ops chain. The old semantics was
  // a chained boolean (`empty().add(A).subtract(B)` = subtract B from
  // running A); the new model expresses the same as A.subtract(B) — i.e.
  // an op on A targeting B. Add + place become silent (the new default
  // IS placed-in-the-outer-list).
  for (let i = rows.length - 1; i > 0; i--) {
    const cur = rows[i] as Instance & { __legacyOp?: string };
    const legacy = cur?.__legacyOp;
    if (!legacy) continue;
    const prev = rows[i - 1]!;
    const step: CsgOpStep = { op: legacy as CsgOp, arg: cur.name };
    prev.ops = [...(prev.ops ?? []), step];
    // The legacy operand wasn't meant to be visible on its own — mark it
    // hidden so the new emit excludes it from the return list.
    cur.hidden = true;
    delete cur.__legacyOp;
  }
  // Strip the bookkeeping field from every row.
  for (const r of rows) delete (r as any).__legacyOp;
  return rows;
}

function parseInstancesRaw(source: string): Instance[] {
  const range = findInstancesLiteralRange(source);
  if (!range) return [];
  const literal = source.slice(range.start, range.end);
  // Walk the top-level `{…}` rows inside the outer `[…]`. We can't JSON.parse
  // because args + expr carry raw JS expressions (template strings, member
  // access, function calls). Hand-walk and pull each row's fields out.
  const rows: Instance[] = [];
  let depth = 0, rowStart = -1;
  let inStr: string | null = null;
  for (let i = 1; i < literal.length - 1; i++) {
    const ch = literal[i]!;
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') { if (depth === 0) rowStart = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && rowStart >= 0) {
        const row = parseInstanceRow(literal.slice(rowStart, i + 1));
        if (row) rows.push(row);
        rowStart = -1;
      }
    }
  }
  return rows;
}

/** Parse a single `{ name: 'A', src: 'X', args: ['1','2'], mode: 'sequential' }` row. */
function parseInstanceRow(row: string): Instance | null {
  const get = (key: string): string | null => {
    // `key: 'value'` | `key: "value"` | `key: [..]` — return the raw text after `:`
    const re = new RegExp(`\\b${key}\\s*:\\s*`);
    const m = row.match(re);
    if (!m) return null;
    const start = (m.index ?? 0) + m[0].length;
    let i = start, depth = 0, inStr: string | null = null;
    while (i < row.length) {
      const ch = row[i]!;
      if (inStr) {
        if (ch === '\\') { i += 2; continue; }
        if (ch === inStr) inStr = null;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; i++; continue; }
      if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') depth--;
      else if ((ch === ',' || ch === '}') && depth === 0) break;
      if (depth < 0) break;
      i++;
    }
    return row.slice(start, i).trim();
  };
  const unquote = (s: string | null): string | null => {
    if (s == null) return null;
    const m = s.match(/^['"`](.*)['"`]$/);
    return m && m[1] !== undefined ? m[1] : s;
  };
  const name = unquote(get('name'));
  if (!name) return null;
  const mode = (unquote(get('mode')) ?? 'sequential') as InstanceMode;
  const src = unquote(get('src')) ?? undefined;
  const argsRaw = get('args');
  let args: string[] = [];
  if (argsRaw) {
    // Strip outer [], then split on top-level commas.
    const inner = argsRaw.replace(/^\[/, '').replace(/\]$/, '');
    args = splitTopLevel(inner).map((s) => s.trim()).filter(Boolean);
  }
  const anchor = unquote(get('anchor')) ?? undefined;
  const at = (unquote(get('at')) as Datum | null) ?? undefined;
  const exprRaw = get('expr');
  const expr = exprRaw ? unquote(exprRaw) ?? undefined : undefined;
  // Legacy: pre-Phase-E.1 rows carried a single `op: 'add'|'subtract'|...`
  // field that joined the row into a running boolean chain at the return.
  // We stash it here; parseInstances() post-processes by lifting subtract /
  // intersect onto the PRECEDING row's ops chain so semantics are
  // preserved through a save round-trip.
  const legacyOp = unquote(get('op')) ?? undefined;
  // ops: [{op:'subtract', arg:'C'}, ...]
  const opsRaw = get('ops');
  let ops: CsgOpStep[] | undefined;
  if (opsRaw) {
    const inner = opsRaw.replace(/^\[/, '').replace(/\]$/, '');
    const steps: CsgOpStep[] = [];
    for (const seg of splitTopLevel(inner)) {
      const t = seg.trim();
      if (!t) continue;
      const opM = t.match(/op\s*:\s*['"`]([a-z]+)['"`]/);
      const argM = t.match(/arg\s*:\s*['"`]([^'"`]+)['"`]/);
      if (opM && argM && (opM[1] === 'add' || opM[1] === 'subtract' || opM[1] === 'intersect')) {
        steps.push({ op: opM[1] as CsgOp, arg: argM[1]! });
      }
    }
    if (steps.length) ops = steps;
  }
  const hiddenRaw = get('hidden');
  const hidden = hiddenRaw ? /^true\b/.test(hiddenRaw.trim()) : false;
  const out: Instance & { __legacyOp?: string } = { name, src, args, mode, anchor, at, ops, expr: expr ?? undefined, hidden: hidden || undefined };
  if (legacyOp && legacyOp !== 'add' && legacyOp !== 'place') out.__legacyOp = legacyOp;
  return out;
}

/** Split a comma-separated string but only on TOP-LEVEL commas. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  let inStr: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out;
}

// ─── Serialize: Instance[] → text ──────────────────────────────────────

/** Stringify an Instance row as a single object literal. */
function serializeRow(inst: Instance): string {
  const parts: string[] = [];
  parts.push(`name: ${JSON.stringify(inst.name)}`);
  if (inst.src) parts.push(`src: ${JSON.stringify(inst.src)}`);
  parts.push(`args: [${inst.args.join(', ')}]`);
  parts.push(`mode: ${JSON.stringify(inst.mode)}`);
  if (inst.anchor) parts.push(`anchor: ${JSON.stringify(inst.anchor)}`);
  if (inst.at) parts.push(`at: ${JSON.stringify(inst.at)}`);
  if (inst.ops && inst.ops.length) {
    const opsLit = inst.ops
      .map((s) => `{ op: ${JSON.stringify(s.op)}, arg: ${JSON.stringify(s.arg)} }`)
      .join(', ');
    parts.push(`ops: [${opsLit}]`);
  }
  if (inst.hidden) parts.push(`hidden: true`);
  if (inst.expr) parts.push(`expr: ${JSON.stringify(inst.expr)}`);
  return `    { ${parts.join(', ')} }`;
}

/** Splice a fresh `instances: [...]` literal into source. Replaces an
 *  existing block when present; inserts after `uses: [...]` otherwise. */
export function writeInstances(source: string, instances: readonly Instance[]): string {
  const body = instances.length === 0
    ? '[]'
    : '[\n' + instances.map(serializeRow).join(',\n') + ',\n  ]';
  const range = findInstancesLiteralRange(source);
  if (range) {
    return source.slice(0, range.start) + body + source.slice(range.end);
  }
  // Insert after `uses: [...]` (the standard placement).
  const usesM = source.match(/(\buses\s*:\s*\[[^\]]*\])\s*,/);
  if (usesM) {
    return source.replace(usesM[0], `${usesM[1]},\n  instances: ${body},`);
  }
  return source;
}

// ─── Body emitter: Instance[] → function body ──────────────────────────

/** Generate the assembly's function body from the instances array.
 *  Returns the body text BETWEEN the `{` and `}` of `export function ID() { ... }`.
 *
 *  Phase E.1 model — "lists are groups":
 *    Each row emits `const NAME = src(args).op1(arg).op2(arg)...;` where the
 *    ops chain is the row's per-row CSG (subtract / intersect / add). The
 *    body returns `[A, B, C]` — a bare array. The sandbox auto-wraps array
 *    returns in `place(...)` (recursive for nested arrays), so the user
 *    never sees `place(...)` in the source.
 *
 *  Wrapping style for sequential / overlay stays the same — `mv(prim(...),
 *  [0, 0, tail(prev)])` — so the recognizer at
 *  src/lib/server/recognize-composite.ts:192 unwraps mv() and surfaces the
 *  inner instance in the Parts panel. */
export function emitAssemblyBody(instances: readonly Instance[]): string {
  if (instances.length === 0) {
    return '\n  // Drag a part from the sidebar to add it here.\n  return [];\n';
  }
  // Two-pass emit so per-row ops can reference SIBLING rows without hitting
  // the const TDZ:
  //   PASS 1 — `const NAME_raw = <placement>` for rows that have ops; plain
  //            `const NAME = <placement>` otherwise. Sequential / overlay
  //            datum references use the _raw form when present (mate to the
  //            pre-CSG bbox so a downstream `.subtract(...)` doesn't crop
  //            the column's stacking math).
  //   PASS 2 — `const NAME = NAME_raw.subtract(B).intersect(C)` — all
  //            sibling names are now in scope, so the chain resolves.
  //   tail   — `return [N1, N2, …];` (sandbox auto-places arrays).
  const lines: string[] = [];
  const hasOps = (i: Instance) => !!i.ops?.length;
  /** Reference NAME — use NAME_raw when the row has ops so downstream
   *  rows lock onto the pre-CSG bbox. */
  const refFor = (i: Instance) => (hasOps(i) ? `${i.name}_raw` : i.name);
  const renderCall = (inst: Instance): string =>
    inst.mode === 'custom' ? (inst.expr ?? 'empty()') : `${inst.src ?? 'empty'}(${inst.args.join(', ')})`;
  const byName = new Map(instances.map((i) => [i.name, i]));
  let lastSequential: Instance | null = null;
  // PASS 1: placement declarations.
  for (const inst of instances) {
    const declName = hasOps(inst) ? `${inst.name}_raw` : inst.name;
    if (inst.mode === 'custom') {
      lines.push(`  const ${declName} = ${renderCall(inst)};`);
      continue;
    }
    if (!inst.src) continue;
    const call = renderCall(inst);
    let placed: string;
    if (inst.mode === 'sequential') {
      placed = lastSequential ? `mv(${call}, [0, 0, tail(${refFor(lastSequential)})])` : call;
      lastSequential = inst;
    } else { // overlay
      const at = inst.at ?? 'head';
      const anchorInst = inst.anchor ? byName.get(inst.anchor) : undefined;
      const anchorRef = anchorInst ? refFor(anchorInst) : (inst.anchor ?? '');
      placed = inst.anchor ? `mv(${call}, [0, 0, ${at}(${anchorRef})])` : call;
    }
    lines.push(`  const ${declName} = ${placed};`);
  }
  // PASS 2: ops chains, in declaration order. Safe — all _raw + plain
  // sibling consts are now bound.
  for (const inst of instances) {
    if (!hasOps(inst)) continue;
    const chain = inst.ops!.map((s) => `.${s.op}(${s.arg})`).join('');
    lines.push(`  const ${inst.name} = ${inst.name}_raw${chain};`);
  }
  // Hidden rows participate as operands but don't appear in the scene.
  const visible = instances.filter((i) => !i.hidden);
  lines.push(`  return [${visible.map((i) => i.name).join(', ')}];`);
  return '\n' + lines.join('\n') + '\n';
}

/** Replace the body of `export function ID() { ... }` with newBody.
 *  Preserves the surrounding declaration + trailing source. */
export function rewriteAssemblyFunctionBody(source: string, id: string, newBody: string): string {
  const fnRe = new RegExp(`(export\\s+function\\s+${id}\\s*\\([^)]*\\)\\s*\\{)`);
  const m = source.match(fnRe);
  if (!m) return source;
  const headEnd = (m.index ?? 0) + m[0].length;
  // Find matching close `}` via depth scan.
  let depth = 1, i = headEnd;
  let inStr: string | null = null;
  while (i < source.length && depth > 0) {
    const ch = source[i]!;
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  if (depth !== 0) return source;
  return source.slice(0, headEnd) + newBody + source.slice(i);
}

// ─── Append/mutate helpers ─────────────────────────────────────────────

/** Append a new instance at the end of the array.
 *  Defaults to `mode: 'sequential'`. When mode is 'overlay', auto-picks
 *  the last sequential row as anchor + `at: 'head'` so the row is
 *  immediately valid. */
export function appendInstance(
  existing: readonly Instance[],
  src: string,
  args: string[],
  mode: InstanceMode = 'sequential',
): Instance[] {
  const name = nextInstanceName(existing.map((e) => e.name));
  const inst: Instance = { name, src, args, mode };
  if (mode === 'overlay') {
    const lastSeq = [...existing].reverse().find((e) => e.mode === 'sequential');
    if (lastSeq) {
      inst.anchor = lastSeq.name;
      inst.at = 'head';
    }
  }
  return [...existing, inst];
}

/** Move a row by index. delta = -1 (up) | +1 (down). Returns a new array. */
export function moveInstance(
  existing: readonly Instance[],
  from: number,
  to: number,
): Instance[] {
  if (from < 0 || from >= existing.length) return existing.slice();
  const clamped = Math.max(0, Math.min(existing.length - 1, to));
  if (clamped === from) return existing.slice();
  const out = existing.slice();
  const [row] = out.splice(from, 1);
  if (!row) return existing.slice();
  out.splice(clamped, 0, row);
  return out;
}

/** Remove the row at index. Returns a new array. */
export function removeInstance(existing: readonly Instance[], index: number): Instance[] {
  const out = existing.slice();
  out.splice(index, 1);
  return out;
}

/** Update a row's fields by index. Returns a new array. */
export function updateInstance(
  existing: readonly Instance[],
  index: number,
  patch: Partial<Instance>,
): Instance[] {
  if (index < 0 || index >= existing.length) return existing.slice();
  const out = existing.slice();
  const prev = out[index];
  if (!prev) return existing.slice();
  out[index] = { ...prev, ...patch };
  return out;
}

/** Rewrite `meta.uses` to mirror the unique `src` values across all
 *  non-custom rows. The sandbox needs every referenced primitive listed
 *  in uses so it can inject the runtime binding. */
export function syncUsesToInstances(source: string, instances: readonly Instance[]): string {
  const seen = new Set<string>();
  const uses: string[] = [];
  for (const inst of instances) {
    if (inst.src && !seen.has(inst.src)) { seen.add(inst.src); uses.push(inst.src); }
  }
  const literal = '[' + uses.map((u) => `'${u}'`).join(', ') + ']';
  const m = source.match(/(\buses\s*:\s*)\[[^\]]*\]/);
  if (m && m[1]) {
    const start = (m.index ?? 0) + m[1].length;
    const end = (m.index ?? 0) + m[0].length;
    return source.slice(0, start) + literal + source.slice(end);
  }
  return source; // no uses block — leave alone
}

/** Convenience: do an append + write + body-emit + body-rewrite in one shot.
 *  Returns the new source text (or the input unchanged if not an assembly).
 *  `initialMode` defaults to 'sequential'; pass 'overlay' to drop into the
 *  Overlays subtab. */
export function applyAppendToSource(
  source: string,
  id: string,
  src: string,
  args: string[],
  initialMode: InstanceMode = 'sequential',
): string {
  // Refuse self-reference (the bug that produced `my_assy → my_assy`).
  if (src === id) return source;
  const before = parseInstances(source);
  const after = appendInstance(before, src, args, initialMode);
  return applyInstancesToSource(source, id, after);
}

/** Write a fresh instances array → mirror uses → re-emit body. Used by
 *  reorder, mode-change, and delete operations. */
export function applyInstancesToSource(
  source: string,
  id: string,
  instances: readonly Instance[],
): string {
  let out = writeInstances(source, instances);
  out = syncUsesToInstances(out, instances);
  const body = emitAssemblyBody(instances);
  return rewriteAssemblyFunctionBody(out, id, body);
}
