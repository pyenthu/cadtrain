// src/lib/server/golden-templates.ts — PARAMETERIZED (templated) golden RAG entries (#43).
//
// One golden entry can stand for a whole FAMILY of prompts via {{slot}} placeholders, instead
// of storing N near-duplicate concrete pairs (one per colour / size / …):
//
//   md   = "turn the background {{color}}"                 // the retrieval KEY (a template)
//   app  = { theme: { background: "{{color}}" }, … }       // the target, also templated
//
// That saves corpus SPACE (1 file, not N) and retrieval TOKENS (one few-shot line covers the
// whole family instead of crowding the top-k with near-duplicates).
//
// TWO independent fill mechanisms (the caller can use either / both):
//   (a) LLM few-shot generalization — renderGrounding (app-corpus.ts) shows the template + a
//       one-line "fill {{color}} from the user's prompt" note; the model substitutes. Zero
//       code, robust to paraphrase ("make the background red"). RECOMMENDED / primary.
//   (b) Deterministic pattern-match + substitute — matchTemplate() regex-captures the slot
//       value from an EXACT-structure prompt; fillTemplate()/applyTemplate() substitute it.
//       Free + instant, but brittle (only matches the exact template phrasing). A fast-path.
//
// Retrieval is SLOT-AWARE (goldenScore, used by rankGolden): a templated golden is scored by
// how completely the prompt covers its NON-slot SKELETON (maskSlots strips the {{slot}}), so
// the slot VALUE is ignored — "turn the background {{color}}" ranks equally for teal / red / …
// Non-templated goldens fall through to the ORIGINAL prompt↔md overlap unchanged.
//
// PURE — no IO, no Svelte, no browser, no shared mutable state. Fully unit-testable.
import type { GoldenPair, GoldenSlot } from './app-corpus-store';

type GoldenLike = Pick<GoldenPair, 'md' | 'slots'>;

// A fresh regex per call — a global regex carries lastIndex state, so never share one instance
// across matchAll / replace / exec.
const slotRe = (): RegExp => /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

// ── lexical primitives (shared with app-corpus.ts so both sides score identically) ──────────
export const tokenize = (s: string): Set<string> => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);

/** Fraction of `a`'s tokens that also appear in `b` (asymmetric — matches the corpus's BM25-ish
 *  overlap). */
export function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n / Math.max(1, a.size);
}

// ── slot introspection ──────────────────────────────────────────────────────────────────────
/** Find `{{name}}` placeholders in a template string, in first-seen order, de-duplicated. */
export function extractSlots(md: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of md.matchAll(slotRe())) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** Effective slot NAMES of a golden: explicit `slots` metadata wins (its declared order), else
 *  derived from the md's `{{...}}` placeholders. So a golden is "templated" as soon as its md
 *  carries a placeholder — no metadata required. */
export function slotNamesOf(golden: GoldenLike): string[] {
  if (golden.slots?.length) return golden.slots.map((s) => s.name);
  return extractSlots(golden.md);
}

/** True when the golden carries at least one slot (md placeholder or declared metadata). */
export function isTemplated(golden: GoldenLike): boolean {
  return slotNamesOf(golden).length > 0;
}

// ── mask / fill ───────────────────────────────────────────────────────────────────────────
/** Replace the named `{{slot}}` placeholders with a single space so tokenisation DROPS the slot
 *  value — leaving the TEMPLATE SKELETON (the non-slot words). Used to build the skeleton the
 *  concrete prompt is scored against, so lexical overlap ignores the slot value ("drop the slot
 *  token from both sides"). Empty `slotNames` → text unchanged (backward-compatible: a
 *  non-templated golden masks to itself). */
export function maskSlots(text: string, slotNames: string[]): string {
  if (!slotNames.length) return text;
  let out = text;
  for (const name of slotNames) {
    out = out.replace(new RegExp(`\\{\\{\\s*${escapeRegExp(name)}\\s*\\}\\}`, 'g'), ' ');
  }
  return out;
}

/** Substitute `{{name}}` → value in a template STRING. Unknown placeholders are left intact (so
 *  a missing value is visible, not silently blanked). */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(slotRe(), (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole,
  );
}

/** Deep-substitute `{{name}}` → value across every string (keys + values) of an .app doc,
 *  returning a filled clone. The deterministic fast-path's target builder, and used to render a
 *  concrete example in the grounding. Non-string leaves pass through untouched. */
export function applyTemplate<T>(app: T, values: Record<string, string>): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return fillTemplate(v, values);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) o[fillTemplate(k, values)] = walk(val);
      return o;
    }
    return v;
  };
  return walk(app) as T;
}

// ── deterministic match ─────────────────────────────────────────────────────────────────────
/** Deterministically match a CONCRETE prompt against a templated golden's md, capturing each
 *  slot value. Returns `{ values }` or `null` (no match / not templated). The regex is built
 *  from the template's first content line: literals match verbatim (whitespace-flexible,
 *  case-insensitive, tolerant of trailing punctuation) and each `{{slot}}` becomes a capture —
 *  constrained to the slot's known `values` when provided (tighter, fewer false positives),
 *  else an open capture. This is fill-mechanism (b): free + instant but only for exact phrasing. */
export function matchTemplate(prompt: string, golden: GoldenLike): { values: Record<string, string> } | null {
  const names = slotNamesOf(golden);
  if (!names.length) return null;
  const tpl = firstContentLine(golden.md);
  const declaredValues = (name: string): string[] | undefined =>
    golden.slots?.find((s) => s.name === name)?.values;

  const re = slotRe();
  const order: string[] = [];
  let pattern = '^\\s*';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tpl))) {
    pattern += whitespaceFlexible(escapeRegExp(tpl.slice(last, m.index)));
    const name = m[1];
    order.push(name);
    const vals = declaredValues(name);
    pattern += vals && vals.length ? `(${vals.map(escapeRegExp).join('|')})` : '(.+?)';
    last = m.index + m[0].length;
  }
  pattern += whitespaceFlexible(escapeRegExp(tpl.slice(last)));
  pattern += '\\s*[.!?]*\\s*$';

  const hit = new RegExp(pattern, 'i').exec(prompt.trim());
  if (!hit) return null;
  const values: Record<string, string> = {};
  order.forEach((name, i) => {
    values[name] = (hit[i + 1] ?? '').trim();
  });
  return { values };
}

// ── slot-aware scoring (the retrieval key) ──────────────────────────────────────────────────
/** Slot-aware lexical score of a prompt against a golden (0..1). Drives rankGolden.
 *   - Non-templated golden → the ORIGINAL prompt↔md token overlap (UNCHANGED — backward-compat).
 *   - Templated golden     → coverage of the template SKELETON (md with `{{slots}}` stripped) by
 *     the prompt. Because we measure "how many skeleton words are present", the extra slot-VALUE
 *     token in the prompt never affects the score → the golden ranks equally for every family
 *     member ("turn the background teal" and "…red" both score against the same skeleton). */
export function goldenScore(prompt: string, golden: GoldenLike): number {
  const names = slotNamesOf(golden);
  const q = tokenize(prompt);
  if (!names.length) return overlap(q, tokenize(golden.md)); // literal golden — original behaviour
  const skeleton = tokenize(maskSlots(golden.md, names));
  if (!skeleton.size) return matchTemplate(prompt, golden) ? 1 : 0; // degenerate: md was all-slot
  return overlap(skeleton, q);
}

// ── local regex helpers ─────────────────────────────────────────────────────────────────────
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** Turn runs of literal whitespace into `\s+` so "turn  the" matches "turn the". */
function whitespaceFlexible(escaped: string): string {
  return escaped.replace(/\s+/g, '\\s+');
}
/** First non-empty line, with a leading markdown heading marker stripped (mirrors app-corpus
 *  `firstLine`). Templates are usually a single line; this keeps multi-line md tolerant. */
function firstContentLine(md: string): string {
  const line = md.split('\n').find((l) => l.trim()) ?? '';
  return line.replace(/^#+\s*/, '').trim();
}

export type { GoldenSlot };
