/**
 * param-keys — extract the ordered param-key list from a part/assembly source.
 *
 * Split out of the former `assembly-deps.ts` (2026-06-12): only `paramKeysOf`
 * survived the archival of the PrimitiveView / CompositionEditor editor stack.
 * The drift-snapshot machinery that used to live alongside it (parse/diff/
 * write dependency snapshots) moved to `archive/src/lib/cad/assembly-deps.ts`.
 *
 * Active consumer: `src/lib/server/primitive-loader.ts` (adaptive dispatcher —
 * matches the meta.params signature so object args aren't misrouted as
 * positional arg 0).
 */

/** Return Object.keys of meta.params, in declaration order. Empty array when
 *  no params block is found.
 *
 *  Walks the block char by char tracking brace depth + string state so a
 *  param row whose `default:` is a nested descriptor
 *  (`profile: { ..., default: { kind, params: { r, len } } }`) doesn't yield
 *  the inner `default` / `params` / `kind` as fake top-level param keys
 *  (which then either rename the loader's signature to `(profile, default,
 *  params, segments)` — a syntax error on the reserved word — or just
 *  return the wrong keys). */
export function paramKeysOf(source: string): string[] {
  const block = extractParamsBlock(source);
  if (!block) return [];
  const out: string[] = [];
  // Accept BOTH bare identifiers (`pipeOD: { … }`) AND quoted keys
  // (`"pipeOD": { … }` or `'pipeOD': { … }`). The K.69
  // proposal-translator emits JSON-style quoted keys via stringify;
  // without the quote-aware match `paramKeysOf` returned `[]` for every
  // translator-generated primitive (dt_mule_shoe → empty → adaptive
  // dispatcher misroutes object args as positional arg 0 → NaN coords →
  // "Non-finite vertex [in dt_mule_shoe → r_revolve(?,96)]").
  const keyRe = /(?:"([a-zA-Z_$][\w$]*)"|'([a-zA-Z_$][\w$]*)'|([a-zA-Z_$][\w$]*))\s*:\s*\{/g;
  let km: RegExpExecArray | null;
  while ((km = keyRe.exec(block))) {
    const key = km[1] ?? km[2] ?? km[3]!;
    // The bare-id `default: { kind: …, params: { … } }` nested descriptor
    // case is still handled by the depth-0 check below — same as before.
    // Bail if this match isn't at depth 0.
    let depth = 0, inStr: string | null = null;
    for (let p = 0; p < km.index; p++) {
      const ch = block[p]!;
      if (inStr) {
        if (ch === '\\') { p++; continue; }
        if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth !== 0) continue;
    out.push(key);
    // Skip past this row's matching close brace so the next regex match
    // starts AFTER the body — `default: { ... }` inside won't surface.
    const bodyStart = km.index + km[0].length;
    let d = 1, j = bodyStart;
    let s: string | null = null;
    while (j < block.length && d > 0) {
      const ch = block[j]!;
      if (s) {
        if (ch === '\\') { j += 2; continue; }
        if (ch === s) s = null;
        j++; continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { s = ch; j++; continue; }
      if (ch === '{') d++;
      else if (ch === '}') { d--; if (d === 0) break; }
      j++;
    }
    if (d === 0) keyRe.lastIndex = j + 1;
  }
  return out;
}

function extractParamsBlock(source: string): string | null {
  // Accept both bare (`params: {`) and quoted (`"params": {` / `'params': {`)
  // — JSON.stringify-emitted metas use quoted property names. Without the
  // optional-quote sentinel, paramKeysOf returned [] for any JSON-style
  // meta (the build script for g_star produced one), the adaptive
  // dispatcher misroutes the single positional arg into `p`, and the
  // function body sees p.length = undefined → "profile needs ≥ 3 points".
  // Mirrors the usesOf fix in primitive-loader.ts (commit 049db80).
  const open = source.match(/["']?\bparams\b["']?\s*:\s*\{/);
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
  return source.slice(start, i);
}
