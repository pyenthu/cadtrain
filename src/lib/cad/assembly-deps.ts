/**
 * assembly-deps — snapshot + compare assemblies' upstream component shape so
 * the user gets a warning when a referenced component drifts (params added /
 * renamed / body rewritten).
 *
 * Snapshot is stored in assembly source as `meta.dependencies` — an array of
 * `{ id, paramKeys, hash }`:
 *   * id          — component id (matches an entry in meta.uses).
 *   * paramKeys   — Object.keys(meta.params) at snapshot time.
 *   * hash        — djb2 hash of (meta.params block + function body) at
 *                   snapshot time.
 *
 * Compare against the LIVE component source (fetched fresh) on assembly open
 * to surface what's out of sync.
 *
 * Phase 1 (the part-body `??= default` block) handles the common "add a
 * param" case silently. Phase 2 (this) handles every other case — including
 * semantically equivalent updates the user might want to inspect — by making
 * the change VISIBLE without crashing the assembly.
 */

export interface DependencySnapshot {
  id: string;
  paramKeys: string[];
  hash: string;
}

export interface DependencyDiff {
  id: string;
  ok: boolean;
  paramKeysAdded: string[];
  paramKeysRemoved: string[];
  paramKeysReordered: boolean;
  bodyHashChanged: boolean;
  liveHash?: string;
  liveParamKeys?: string[];
}

/** Tiny stable string hash (djb2) — used to compare component bodies across
 *  saves. Not cryptographic; collisions are astronomically unlikely for the
 *  string lengths involved in a part source. */
export function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h |= 0; // force i32
  }
  return (h >>> 0).toString(16);
}

/** Extract the `params: { … }` block + the `export function NAME(args) { body }`
 *  body from a part source, normalize whitespace, and djb2 over the result.
 *  The hash changes when either the param schema OR the function body changes;
 *  comment-only edits also change it (intentional — anything the user CAN see
 *  changing is worth surfacing). */
export function hashComponent(source: string): string {
  const params = extractParamsBlock(source) ?? '';
  const body = extractFunctionBody(source) ?? '';
  const normalized = (params + '\n' + body).replace(/\s+/g, ' ').trim();
  return djb2(normalized);
}

/** Return Object.keys of meta.params, in declaration order. Empty array when
 *  no params block is found. */
export function paramKeysOf(source: string): string[] {
  const block = extractParamsBlock(source);
  if (!block) return [];
  // Match top-level `KEY: { … }` rows. Same regex as inline-profile.ts.
  const rowRe = /([a-zA-Z_$][\w$]*)\s*:\s*\{/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(block))) out.push(m[1]);
  return out;
}

function extractParamsBlock(source: string): string | null {
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
  return source.slice(start, i);
}

function extractFunctionBody(source: string): string | null {
  const sig = source.match(/\bexport\s+function\s+([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*\{/);
  if (!sig) return null;
  const start = (sig.index ?? 0) + sig[0].length;
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

/** Parse the assembly source's `meta.dependencies` array (if present) into a
 *  list of snapshots. Returns [] when missing or malformed (no snapshots ==
 *  not enough info to flag drift — show nothing). Balanced-bracket scan
 *  finds the OUTER `[…]` so inner `paramKeys: [...]` arrays don't
 *  accidentally short-circuit the match. */
export function parseDependencies(assemblySource: string): DependencySnapshot[] {
  const head = assemblySource.match(/\bdependencies\s*:\s*\[/);
  if (!head) return [];
  const start = (head.index ?? 0) + head[0].length - 1; // points AT the `[`
  let depth = 0;
  let i = start;
  while (i < assemblySource.length) {
    const ch = assemblySource[i]!;
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { i++; break; } }
    i++;
  }
  if (depth !== 0) return [];
  const literal = assemblySource.slice(start, i)   // `[…]`
    .replace(/'/g, '"')
    // Quote any unquoted-ident keys: `{id:` → `{"id":`. Skip already-quoted.
    .replace(/([{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g, '$1"$2":')
    // JS allows trailing commas; JSON.parse doesn't. Strip them.
    .replace(/,(\s*[\]}])/g, '$1');
  try {
    const parsed = JSON.parse(literal);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e.id === 'string').map((e: any) => ({
      id: e.id,
      paramKeys: Array.isArray(e.paramKeys) ? e.paramKeys.map(String) : [],
      hash: typeof e.hash === 'string' ? e.hash : '',
    }));
  } catch { return []; }
}

/** Compute the diff between stored snapshots and the live components.
 *  liveSources: id → current source text. */
export function diffDependencies(
  snapshots: DependencySnapshot[],
  liveSources: Record<string, string>,
): DependencyDiff[] {
  return snapshots.map((s) => {
    const live = liveSources[s.id];
    if (!live) return { id: s.id, ok: false, paramKeysAdded: [], paramKeysRemoved: [], paramKeysReordered: false, bodyHashChanged: true };
    const liveKeys = paramKeysOf(live);
    const liveHash = hashComponent(live);
    const stored = new Set(s.paramKeys);
    const cur = new Set(liveKeys);
    const added = liveKeys.filter((k) => !stored.has(k));
    const removed = s.paramKeys.filter((k) => !cur.has(k));
    const reordered = added.length === 0 && removed.length === 0 &&
      s.paramKeys.some((k, i) => liveKeys[i] !== k);
    const ok = added.length === 0 && removed.length === 0 && !reordered && liveHash === s.hash;
    return {
      id: s.id, ok,
      paramKeysAdded: added,
      paramKeysRemoved: removed,
      paramKeysReordered: reordered,
      bodyHashChanged: liveHash !== s.hash,
      liveHash,
      liveParamKeys: liveKeys,
    };
  });
}

/** Build a fresh snapshot array from the live components (one entry per id). */
export function buildSnapshots(
  ids: readonly string[],
  liveSources: Record<string, string>,
): DependencySnapshot[] {
  return ids.map((id) => {
    const src = liveSources[id] ?? '';
    return { id, paramKeys: paramKeysOf(src), hash: hashComponent(src) };
  });
}

/** Rewrite the assembly source's `meta.dependencies` field — replace if
 *  present, insert after `uses` if absent. Same balanced-bracket scan as
 *  parseDependencies so the splice never grabs an inner array. */
export function writeDependencies(assemblySource: string, snapshots: DependencySnapshot[]): string {
  const serial = '[\n' + snapshots.map((s) =>
    `    { id: ${JSON.stringify(s.id)}, paramKeys: ${JSON.stringify(s.paramKeys)}, hash: ${JSON.stringify(s.hash)} },`
  ).join('\n') + '\n  ]';
  // Find existing dependencies block via balanced scan.
  const head = assemblySource.match(/(\bdependencies\s*:\s*)\[/);
  if (head) {
    const bracketAt = (head.index ?? 0) + head[1].length;   // points AT `[`
    let depth = 0;
    let j = bracketAt;
    while (j < assemblySource.length) {
      const ch = assemblySource[j]!;
      if (ch === '[') depth++;
      else if (ch === ']') { depth--; if (depth === 0) { j++; break; } }
      j++;
    }
    if (depth === 0) {
      return assemblySource.slice(0, bracketAt) + serial + assemblySource.slice(j);
    }
  }
  // Insert after `uses: […]`.
  const usesM = assemblySource.match(/(\buses\s*:\s*\[[^\]]*\])\s*,/);
  if (usesM) {
    return assemblySource.replace(usesM[0], `${usesM[1]},\n  dependencies: ${serial},`);
  }
  return assemblySource;
}

/** Pull the list of component ids the assembly currently uses (meta.uses).
 *  Used to seed snapshots when a save fires. */
export function parseUses(source: string): string[] {
  const m = source.match(/\buses\s*:\s*\[([^\]]*)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((mm) => mm[1]);
}
