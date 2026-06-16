/**
 * graph-editor-bake.ts — PURE source/meta parsing + drift comparison for the
 * graph editor (modularize K.65, Phase B). No runes, no state, no DOM — so it
 * is unit-testable in plain vitest. The stateful expected-params cache that
 * USES these lives in the sibling `graph-editor-bake.svelte.ts` rune module
 * (which re-exports the parsers, so callers have one import).
 */

/** Client-side graph-block extractor — walks balanced braces to isolate the
 *  `graph: {...}` literal inside the meta block, then evals as plain data via
 *  `new Function`. Pure object/array literals → safe. Returns undefined when
 *  the source has no graph block (legacy part) or the literal is malformed. */
export function extractGraphFromSource(src: string): any | undefined {
  if (!src) return undefined;
  const m = /(^|[\s,{])graph\s*:\s*\{/m.exec(src);
  if (!m) return undefined;
  const startBrace = src.indexOf('{', m.index + m[0].length - 1);
  if (startBrace < 0) return undefined;
  let depth = 0;
  let end = -1;
  for (let i = startBrace; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return undefined;
  const block = src.slice(startBrace, end + 1);
  try { return new Function(`return (${block});`)(); } catch { return undefined; }
}

/** Pull `drawingMd: '...'` (single-quoted, newlines escaped) out of a saved
 *  meta block. Companion to extractGraphFromSource for endpoints that don't
 *  return the parsed meta field. Returns '' when absent. */
export function extractDrawingMdFromSource(src: string): string {
  if (!src) return '';
  const m = /(^|[\s,{])drawingMd\s*:\s*'((?:\\'|[^'])*)'/m.exec(src);
  if (!m) return '';
  return (m[2] ?? '').replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

/** Pure drift comparator: a Call's args keys vs the primitive's CURRENT params
 *  keys. Returns false when expected keys are unknown (not yet fetched) so the
 *  ⚠ badge doesn't false-positive, and for non-call nodes. */
export function callDrift(node: any, expectedKeys: string[] | undefined): boolean {
  if (!node || node.type !== 'call' || !expectedKeys) return false;
  const have = Object.keys(node.args ?? {}).sort();
  const want = [...expectedKeys].sort();
  if (have.length !== want.length) return true;
  return have.some((k, i) => k !== want[i]);
}
