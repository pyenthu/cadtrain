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
  /** Phase E.4 — non-atom row kinds. Atom rows (no `kind`) emit
   *  `const NAME = src(args)` and participate in stacking + ops.
   *
   *  `import` — `{ name, kind: 'import', src }` emits `const NAME = src;`
   *  at the TOP of the body (above any consts that might use it). The
   *  primitive becomes a callable alias that subsequent expression rows
   *  can invoke any number of times with different args:
   *      const A = shaft;
   *      const core = A(p.od, p.len).subtract(A(p.id, p.len));
   *  Import rows don't appear in the outer return list. */
  kind?: 'import';
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
  /** Phase E.3 — nested group. When set, this row is a SUB-LIST rather
   *  than a primitive call: its emit is `const NAME = [...child names];`
   *  (auto-place'd by the sandbox like any returned array). Sequential
   *  mate cursors reset PER GROUP; ops chains can still cross groups
   *  because every binding is in the same function scope. A group row
   *  ignores `src` / `args` / `mode` / `anchor` / `at` / `expr`. */
  children?: Instance[];
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
  // Strip the outer `[` and `]` then walk top-level `{...}` rows.
  return scanRows(literal.slice(1, literal.length - 1));
}

/** Parse a single `{ name: 'A', src: 'X', args: ['1','2'], mode: 'sequential' }` row.
 *  Group rows look like `{ name: 'G', children: [{…}, {…}] }` — `children`
 *  is extracted + stripped FIRST so subsequent field lookups don't reach
 *  into the nested rows. */
function parseInstanceRow(rawRow: string): Instance | null {
  // Strip `children: [...]` if present, parse recursively, then continue
  // with the rest of the row text. Balanced-bracket scan finds the outer `]`.
  let row = rawRow;
  let children: Instance[] | undefined;
  const childM = row.match(/(\bchildren\s*:\s*)\[/);
  if (childM) {
    const head = (childM.index ?? 0);
    const bracketStart = head + childM[0].length - 1; // points AT `[`
    let depth = 0, j = bracketStart;
    let inStr: string | null = null;
    while (j < row.length) {
      const ch = row[j]!;
      if (inStr) {
        if (ch === '\\') { j += 2; continue; }
        if (ch === inStr) inStr = null;
        j++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; j++; continue; }
      if (ch === '[') depth++;
      else if (ch === ']') { depth--; if (depth === 0) { j++; break; } }
      j++;
    }
    if (depth === 0) {
      const childrenLit = row.slice(bracketStart + 1, j - 1); // inside `[...]`
      children = scanRows(childrenLit);
      // Splice out the whole `children: [...]` clause + any trailing comma.
      let tail = j;
      while (tail < row.length && /[,\s]/.test(row[tail]!)) tail++;
      row = row.slice(0, head) + row.slice(tail);
    }
  }
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
  // Phase E.4 — `kind: 'import'` marks an alias row.
  const kindRaw = unquote(get('kind'));
  const kind = kindRaw === 'import' ? 'import' as const : undefined;
  // children was already extracted + stripped above (so the field-scanner
  // didn't reach into nested rows looking for src/args/etc on the group).
  const out: Instance & { __legacyOp?: string } = { name, src, args, mode, anchor, at, ops, expr: expr ?? undefined, hidden: hidden || undefined, children, kind };
  if (legacyOp && legacyOp !== 'add' && legacyOp !== 'place') out.__legacyOp = legacyOp;
  return out;
}

/** Walk top-level `{...}` blocks inside an instances/children body, parsing
 *  each as an Instance row. Shared between the outer parser and the
 *  recursive children parse. */
function scanRows(body: string): Instance[] {
  const rows: Instance[] = [];
  let depth = 0, rowStart = -1;
  let inStr: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
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
        const row = parseInstanceRow(body.slice(rowStart, i + 1));
        if (row) rows.push(row);
        rowStart = -1;
      }
    }
  }
  return rows;
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

/** Stringify an Instance row as a single object literal. Group rows
 *  (with `children`) recursively serialize their nested list. */
function serializeRow(inst: Instance): string {
  const parts: string[] = [];
  parts.push(`name: ${JSON.stringify(inst.name)}`);
  if (inst.kind) parts.push(`kind: ${JSON.stringify(inst.kind)}`);
  if (inst.src) parts.push(`src: ${JSON.stringify(inst.src)}`);
  if (inst.args && inst.args.length) parts.push(`args: [${inst.args.join(', ')}]`);
  // Import rows never carry mode (they're not placed in the scene).
  if (inst.mode && inst.kind !== 'import') parts.push(`mode: ${JSON.stringify(inst.mode)}`);
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
  if (inst.children && inst.children.length) {
    const inner = inst.children.map(serializeRow).join(', ');
    parts.push(`children: [${inner}]`);
  }
  return `{ ${parts.join(', ')} }`;
}

/** Splice a fresh `instances: [...]` literal into source. Replaces an
 *  existing block when present; inserts after `uses: [...]` otherwise. */
export function writeInstances(source: string, instances: readonly Instance[]): string {
  const body = instances.length === 0
    ? '[]'
    : '[\n' + instances.map((r) => '    ' + serializeRow(r)).join(',\n') + ',\n  ]';
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
/** Recursive deep walk: are any rows at any depth other than import rows? */
function hasGeometryRows(rows: readonly Instance[]): boolean {
  for (const r of rows) {
    if (r.kind !== 'import') return true;
    if (r.children && hasGeometryRows(r.children)) return true;
  }
  return false;
}

export function emitAssemblyBody(instances: readonly Instance[]): string {
  if (instances.length === 0 || !hasGeometryRows(instances)) {
    // Pure-import rows still emit at the top, but there's no scene; keep
    // them around (so the alias survives the round-trip) and return [].
    const importLines = instances
      .filter((i) => i.kind === 'import' && i.src)
      .map((i) => `  const ${i.name} = ${i.src};`);
    const head = importLines.length ? '\n' + importLines.join('\n') + '\n' : '\n';
    return `${head}  // Drag a part from the sidebar to add it here.\n  return [];\n`;
  }
  // PASS 1 (recursive) — declare each row's placement-wrapped manifold (or,
  // for group rows, declare the inner array literal AFTER its children).
  // Rows with ops get a `_raw` suffix so siblings can mate to the
  // pre-CSG bbox. Sequential `lastSequential` is local to each group —
  // mating happens within a sub-list, not across one.
  //
  // PASS 2 (flat across the whole tree) — apply each row's ops chain.
  // Safe by then because every binding in the body is in scope.
  //
  // RETURN — visible top-level rows as a bare array literal; the sandbox
  // recursively auto-places arrays (including nested ones from groups).
  const lines: string[] = [];
  const hasOps = (i: Instance) => !!i.ops?.length;
  const isGroup = (i: Instance) => Array.isArray(i.children);
  const isImport = (i: Instance) => i.kind === 'import';
  const refFor = (i: Instance) => (hasOps(i) ? `${i.name}_raw` : i.name);
  const renderCall = (inst: Instance): string =>
    inst.mode === 'custom' ? (inst.expr ?? 'empty()') : `${inst.src ?? 'empty'}(${inst.args.join(', ')})`;
  // Phase E.4 — emit IMPORT rows first so subsequent atom / expression
  // rows can reference the aliased primitive callable. Imports are
  // top-level only; they're hoisted out of any group they happen to
  // appear in (rare — a group with an import inside is unusual but
  // semantically valid).
  for (const inst of instances) {
    if (isImport(inst) && inst.src) {
      lines.push(`  const ${inst.name} = ${inst.src};`);
    }
  }
  // Resolve a name to its row via depth-first search across the tree.
  // Cross-group refs (an overlay anchored on a top-level row) are valid.
  const findByName = (nodes: readonly Instance[] | undefined, name: string): Instance | undefined => {
    if (!nodes) return undefined;
    for (const n of nodes) {
      if (n.name === name) return n;
      if (n.children) {
        const hit = findByName(n.children, name);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  const emitLevel = (rows: readonly Instance[]) => {
    let lastSequential: Instance | null = null;
    for (const inst of rows) {
      if (isImport(inst)) continue; // already emitted at the top
      if (isGroup(inst)) {
        // Children first (recursive). Then declare the group as an inner array.
        emitLevel(inst.children!);
        const visibleChildren = inst.children!.filter((c) => !c.hidden);
        const declName = hasOps(inst) ? `${inst.name}_raw` : inst.name;
        lines.push(`  const ${declName} = [${visibleChildren.map((c) => c.name).join(', ')}];`);
        // A group's "tail" for downstream sequential rows uses the LAST
        // visible child's bbox (the deepest extent along z). When there
        // are no visible children we conservatively keep the cursor.
        if (visibleChildren.length) lastSequential = visibleChildren[visibleChildren.length - 1]!;
        continue;
      }
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
        const anchorInst = inst.anchor ? findByName(instances, inst.anchor) : undefined;
        const anchorRef = anchorInst ? refFor(anchorInst) : (inst.anchor ?? '');
        placed = inst.anchor ? `mv(${call}, [0, 0, ${at}(${anchorRef})])` : call;
      }
      lines.push(`  const ${declName} = ${placed};`);
    }
  };
  emitLevel(instances);
  // PASS 2 — ops chains across the WHOLE tree.
  const walk = (rows: readonly Instance[]) => {
    for (const r of rows) {
      if (hasOps(r)) {
        const chain = r.ops!.map((s) => `.${s.op}(${s.arg})`).join('');
        lines.push(`  const ${r.name} = ${r.name}_raw${chain};`);
      }
      if (r.children) walk(r.children);
    }
  };
  walk(instances);
  // Import rows are NEVER in the scene — they're aliases, not geometry.
  const visibleTop = instances.filter((i) => !i.hidden && !isImport(i));
  lines.push(`  return [${visibleTop.map((i) => i.name).join(', ')}];`);
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

/** Depth-first iterator over every instance in a possibly-nested tree —
 *  used by the UI / dep machinery when it needs to see all rows
 *  regardless of where they sit in the group hierarchy. */
export function* walkInstances(instances: readonly Instance[]): Generator<Instance> {
  for (const inst of instances) {
    yield inst;
    if (inst.children) yield* walkInstances(inst.children);
  }
}

/** Flat array of every instance (atom + group + nested). */
export function flatInstances(instances: readonly Instance[]): Instance[] {
  return [...walkInstances(instances)];
}

/** Remove the named row from the tree (top level or any nested group)
 *  and return both the new tree AND the removed row. When the name
 *  isn't found, returns `{ tree: input, removed: undefined }` so callers
 *  can safely short-circuit. */
export function removeFromTree(
  tree: readonly Instance[],
  name: string,
): { tree: Instance[]; removed: Instance | undefined } {
  let removed: Instance | undefined;
  const walk = (rows: readonly Instance[]): Instance[] => {
    const out: Instance[] = [];
    for (const r of rows) {
      if (r.name === name) { removed = r; continue; }
      if (r.children) {
        out.push({ ...r, children: walk(r.children) });
      } else {
        out.push(r);
      }
    }
    return out;
  };
  const next = walk(tree);
  return { tree: next, removed };
}

/** Find the row with the given name anywhere in the tree (deep). */
export function findInTree(tree: readonly Instance[], name: string): Instance | undefined {
  for (const r of tree) {
    if (r.name === name) return r;
    if (r.children) {
      const hit = findInTree(r.children, name);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Move a row INTO a group as the last child. No-op when the source
 *  is missing, the target group is missing, or the target isn't a
 *  group. Returns a new tree (immutable). */
export function moveIntoGroup(
  tree: readonly Instance[],
  fromName: string,
  groupName: string,
): Instance[] {
  if (fromName === groupName) return tree.slice();
  const { tree: pruned, removed } = removeFromTree(tree, fromName);
  if (!removed) return tree.slice();
  const insertChild = (rows: Instance[]): Instance[] => {
    return rows.map((r) => {
      if (r.name === groupName && Array.isArray(r.children)) {
        return { ...r, children: [...r.children, removed] };
      }
      if (r.children) {
        return { ...r, children: insertChild(r.children) };
      }
      return r;
    });
  };
  return insertChild(pruned);
}

/** Move a row OUT of its current group to the top level (appended at end). */
export function moveToTopLevel(tree: readonly Instance[], name: string): Instance[] {
  const { tree: pruned, removed } = removeFromTree(tree, name);
  if (!removed) return tree.slice();
  return [...pruned, removed];
}

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
