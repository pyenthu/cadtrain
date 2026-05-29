/**
 * inline-profile — locate (and splice into) the `const profile_pts = …;` slot
 * in an inline-profile part's source. Used by ExtrudePartBuilder /
 * RevolvePartBuilder to two-way-bind the embedded ProfileFnEditor against the
 * part's profile body without disturbing the rest of the source.
 *
 * A "slot" is the right-hand side of a single `const <name> = <body>;` line
 * declared inside the part's function body, where:
 *   * `<name>` matches NAME_RE (defaults to `profile_pts`), AND
 *   * `<body>` is balanced w.r.t. brackets/braces/parens (so `[...]`,
 *     `Array.from({...}, (_, i) => {...})`, and literal arrays all parse).
 *
 * Slot indices are over the FULL source string, so the host can do:
 *   `source.slice(0, slot.range[0]) + newBody + source.slice(slot.range[1])`
 * to splice an updated body in place.
 *
 * Multi-slot parts (e.g. r_plate_with_bore has plate + bore) are supported via
 * `findProfileSlots` returning N hits. Each can be rendered as its own
 * collapsible editor in the host.
 */

export interface ProfileSlot {
  /** Variable name (e.g. 'profile_pts', 'plate', 'bore'). */
  name: string;
  /** The body — the right-hand side of `const NAME = <body>;`. */
  body: string;
  /** Half-open source range [start, end) covering the body (NOT including
   *  the leading `=` or the trailing `;`). */
  range: [number, number];
}

const NAME_RE = /\bconst\s+(profile_pts|profile|plate|bore|hole|outer|inner|[a-z_][a-z0-9_]*_pts)\s*=\s*/g;
// Pattern for the calc lines we sweep upward into the slot — a single
// `const NAME = …;` at the START of a line (no preceding `=`/`:`). Captures
// the name + RHS so the editor's body parser sees the same shape it would
// have seen if the part author had written everything inline.
const PRECEDING_CALC_RE = /^[ \t]*const\s+([a-zA-Z_$][\w$]*)\s*=\s*([^;\n][^;]*?);[ \t]*$/gm;

/** Find every inline-profile slot in the part's source.
 *
 *  Each slot's body INCLUDES any `const X = …;` calc lines that immediately
 *  precede the `const NAME = …;` declaration in the same function body —
 *  the editor needs to see them as calc rows so refs to them inside the
 *  Array.from / literal-array body resolve correctly (otherwise "n is not
 *  defined" when the part has `const n = p.points * 2;` above the slot). */
export function findProfileSlots(source: string): ProfileSlot[] {
  const out: ProfileSlot[] = [];
  const seen = new Set<string>();
  NAME_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NAME_RE.exec(source))) {
    const name = m[1];
    if (seen.has(name)) continue;     // first occurrence wins
    // The `const NAME = ` token range; the body starts AFTER it.
    const declStart = m.index;
    const bodyStart = m.index + m[0].length;
    // Skip leading whitespace inside the body.
    let s = bodyStart;
    while (s < source.length && /\s/.test(source[s]!)) s++;
    // Walk to balanced end of the body.
    let depth = 0;
    let j = s;
    while (j < source.length) {
      const ch = source[j]!;
      if (ch === '[' || ch === '{' || ch === '(') depth++;
      else if (ch === ']' || ch === '}' || ch === ')') depth--;
      else if (depth === 0 && (ch === ';' || ch === '\n')) break;
      j++;
    }
    let e = j;
    while (e > s && /\s/.test(source[e - 1]!)) e--;
    const bodyOnly = source.slice(s, e);
    if (bodyOnly.length === 0) continue;

    // ── Sweep backward to grab preceding `const X = …;` calc lines ──────
    // Walk line-by-line from the line above `declStart` toward the function
    // body opener `{`. Stop at the first non-calc line (a return, a non-const
    // statement, the function opener itself, etc.). The collected calcs prefix
    // the body so the editor's parseBody sees them as Calc rows.
    const startLine = source.lastIndexOf('\n', declStart - 1);
    const head = source.slice(0, startLine >= 0 ? startLine : 0);
    const lines = head.split('\n');
    const sweptCalcs: string[] = [];
    let sweepStart = declStart;
    for (let li = lines.length - 1; li >= 0; li--) {
      const line = lines[li]!;
      const trimmed = line.trim();
      if (trimmed === '') continue;   // skip blank — keep walking
      PRECEDING_CALC_RE.lastIndex = 0;
      const c = /^[ \t]*const\s+([a-zA-Z_$][\w$]*)\s*=\s*([^;\n][^;]*?);[ \t]*$/.exec(line);
      if (!c) break;                  // not a calc — stop the sweep
      sweptCalcs.unshift(c[0]);
      // sweepStart is the index of THIS line's first char (so the slot's
      // range starts there, replacing the calc line on splice).
      // index = sum of lengths of lines[0..li-1] + li newlines (one per line
      // up to and including the preceding line's `\n`).
      let acc = 0;
      for (let k = 0; k < li; k++) acc += lines[k]!.length + 1;
      sweepStart = acc;
    }

    // The body handed to the editor must be SHAPED like a profile-build body
    // (calcs + `return <expr>;`) — the standalone ProfileFnEditor's parseBody
    // pattern. Wrap the raw RHS in `return … ;` so:
    //   * parseBody recognizes the Array.from / literal-array form.
    //   * /api/primitives/profiles/resolve runs build(p) and gets points.
    // The host's spliceSlot still replaces the slot range with whatever
    // composeInlineSlotBody emits (which is `const NAME = X` — no `return`),
    // so the part source on disk is unchanged in shape.
    const calcsPrefix = sweptCalcs.length ? sweptCalcs.join('\n') + '\n  ' : '  ';
    const body = `${calcsPrefix}return ${bodyOnly};`;
    // Range MUST include the `const NAME = ` prefix so spliced bodies (which
    // emit their own `const profile_pts = …`) don't end up double-declared
    // (`const profile_pts = const profile_pts = Array.from(…)`). Find the
    // start of the line containing the declaration; in the swept case
    // sweepStart already covers the preceding calc lines AND the const line.
    const declLineStart = sweptCalcs.length
      ? sweepStart
      : (source.lastIndexOf('\n', declStart - 1) + 1);
    const range: [number, number] = [declLineStart, e];
    out.push({ name, body, range });
    seen.add(name);
  }
  return out;
}

/** Splice a new body into the source at the given slot's range. Returns the
 *  updated source string. */
export function spliceSlot(source: string, slot: ProfileSlot, newBody: string): string {
  return source.slice(0, slot.range[0]) + newBody + source.slice(slot.range[1]);
}

/** True when a part is INLINE-profile-shaped (has at least one slot we can
 *  edit). False for legacy `resolveProfile({kind: ...})` parts AND for
 *  assemblies that don't declare a profile body. */
export function hasInlineProfile(source: string): boolean {
  return findProfileSlots(source).length > 0;
}

// ── Profile swap (picker) ───────────────────────────────────────────────────

interface ParamSpec {
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  default: number;
}

/** Serialize a params record into the same shape the part sources use:
 *  `  KEY: { label: 'X', min: A, max: B, step: C, default: D },` per line. */
function serializeParams(params: Record<string, ParamSpec>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    const fields: string[] = [];
    if (v.label != null) fields.push(`label: ${JSON.stringify(v.label)}`);
    if (v.min != null) fields.push(`min: ${v.min}`);
    if (v.max != null) fields.push(`max: ${v.max}`);
    if (v.step != null) fields.push(`step: ${v.step}`);
    fields.push(`default: ${v.default}`);
    lines.push(`    ${k}: { ${fields.join(', ')} },`);
  }
  return lines.join('\n');
}

/** Extract the meta.params block from source as a Record. Returns an empty
 *  object when meta or params aren't present — host typically falls back
 *  to a prop or default. */
export function extractMetaParams(source: string): Record<string, ParamSpec> {
  return parseMetaParams(source)?.params ?? {};
}

/** Parse the current source's `params: { … }` block into a Record. Returns
 *  null when meta or params aren't present in a recognizable shape. */
function parseMetaParams(source: string): { params: Record<string, ParamSpec>; range: [number, number] } | null {
  const open = source.match(/\bparams\s*:\s*\{/);
  if (!open) return null;
  const start = (open.index ?? 0) + open[0].length;
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    const ch = source[i]!;
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth === 0) break;
    i++;
  }
  if (depth !== 0) return null;
  const inner = source.slice(start, i);
  const out: Record<string, ParamSpec> = {};
  // Match `KEY: { … }` rows.
  const rowRe = /([a-zA-Z_$][\w$]*)\s*:\s*\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(inner))) {
    const key = m[1];
    const body = m[2];
    const num = (n: string) => {
      const r = body.match(new RegExp(`\\b${n}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`));
      return r ? parseFloat(r[1]) : undefined;
    };
    const labelM = body.match(/\blabel\s*:\s*['"]([^'"]+)['"]/);
    out[key] = {
      label: labelM ? labelM[1] : undefined,
      min: num('min'),
      max: num('max'),
      step: num('step'),
      default: num('default') ?? 0,
    };
  }
  return { params: out, range: [start, i] };
}

/** Rewrite the function signature `export function NAME(args) {` so the
 *  positional arg list matches the keys of `params` (preserving order). */
function rewriteFnSignature(source: string, params: Record<string, ParamSpec>): string {
  const sigRe = /(export\s+function\s+[a-zA-Z_$][\w$]*\s*\()[^)]*(\))/;
  return source.replace(sigRe, `$1${Object.keys(params).join(', ')}$2`);
}

/** Swap a part's profile body to a new template's body, and rewrite
 *  meta.params + the function signature so they match. ENGINE params
 *  (length/twist/divs/taper/segments) are PRESERVED from the part — their
 *  current default values stay, even though their schema fields take the
 *  template's defaults where applicable (engine params keep the part's).
 *  Non-engine params are REPLACED entirely with `template.partParams`. */
export function swapProfileTemplate(
  source: string,
  template: { body: string; partParams?: Record<string, ParamSpec> },
  enginePrefixOrder: readonly string[] = ['length', 'twist', 'divs', 'taper', 'segments'],
): string {
  // 1. Splice the new body into the profile_pts slot first.
  const slots = findProfileSlots(source);
  let next = source;
  if (slots.length > 0) {
    next = spliceSlot(next, slots[0]!, template.body);
  }
  // 2. Rewrite meta.params: (template.partParams in their order) + (engine
  //    params from the CURRENT part, in enginePrefixOrder).
  const parsed = parseMetaParams(next);
  if (!parsed) return next;
  const partParams = template.partParams ?? {};
  const preserved: Record<string, ParamSpec> = {};
  for (const k of enginePrefixOrder) {
    if (k in parsed.params) preserved[k] = parsed.params[k]!;
  }
  const newParams: Record<string, ParamSpec> = { ...partParams, ...preserved };
  const serialized = serializeParams(newParams);
  next = next.slice(0, parsed.range[0]) + '\n' + serialized + '\n  ' + next.slice(parsed.range[1]);
  // 3. Rewrite the function signature to match the new param order.
  next = rewriteFnSignature(next, newParams);
  return next;
}
