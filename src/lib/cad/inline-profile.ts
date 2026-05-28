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

/** Find every inline-profile slot in the part's source. */
export function findProfileSlots(source: string): ProfileSlot[] {
  const out: ProfileSlot[] = [];
  const seen = new Set<string>();
  NAME_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NAME_RE.exec(source))) {
    const name = m[1];
    if (seen.has(name)) continue;     // first occurrence wins
    const start = m.index + m[0].length;
    // Skip leading whitespace inside the body — we want the body proper.
    let s = start;
    while (s < source.length && /\s/.test(source[s]!)) s++;
    // Walk to balanced end. Track [, {, ( depths together; the slot ends at
    // the first `;` (or newline if no semicolon) seen at depth 0.
    let depth = 0;
    let j = s;
    while (j < source.length) {
      const ch = source[j]!;
      if (ch === '[' || ch === '{' || ch === '(') depth++;
      else if (ch === ']' || ch === '}' || ch === ')') depth--;
      else if (depth === 0 && (ch === ';' || ch === '\n')) break;
      j++;
    }
    // Trim trailing whitespace inside the body.
    let e = j;
    while (e > s && /\s/.test(source[e - 1]!)) e--;
    const body = source.slice(s, e);
    if (body.length === 0) continue;
    out.push({ name, body, range: [s, e] });
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
