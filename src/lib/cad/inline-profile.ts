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
