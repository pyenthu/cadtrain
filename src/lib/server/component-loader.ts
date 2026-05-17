/**
 * Library-component loader — transpile + execute a part's `component.ts`
 * that lives on the persistent volume under `library/<category>/<id>/`
 * (not the build-time `src/` tree, so Vite's `import.meta.glob` never
 * sees it). See `library.ts` for the directory model.
 *
 * The geom endpoint (`/api/components/geom`) calls `loadVolumeComponent(id)`
 * to get back `{ meta, geom }` for a library part, then runs the geom
 * server-side exactly like a bundled primitive.
 *
 * Security model — a volume `.ts` is untrusted code:
 *   - `parseImports` allowlists ONLY `'../manifold-helpers'`, `'.'` and
 *     `'./<sibling-id>'`. Anything else (`node:fs`, bare packages, `'..'`,
 *     parent traversal) throws before any execution.
 *   - all import lines are physically stripped from the source.
 *   - a denylist scan rejects `require(`, `process`, `globalThis`, dynamic
 *     `import(`, `eval(`, `Function(`, `child_process`, `__dirname`.
 *   - execution is via `new Function` (host realm — keeps `Manifold` class
 *     identity intact) with ONLY the manifold helpers + `defineGeom` +
 *     resolved sibling deps in scope. No `require`, no `process`, no module
 *     loader is reachable from the function body.
 */

import { readFile } from 'fs/promises';
import { createHash } from 'crypto';
import { transformSync } from 'esbuild';
import {
  M,
  cyl,
  tube,
  mv,
  rot,
  initManifold,
  setCircularSegmentMode,
  getCutBox,
  CIRCULAR_SEGMENTS_DEFAULT,
  CIRCULAR_SEGMENTS_COMPOSE,
} from '../cad/manifold-helpers';
import { defineGeom, geomById, metaById } from '../cad/components';
import type { GeomFn, PrimitiveMeta } from '../cad/components';
import { discoverHelpers } from '../cad/manifold-helpers-meta';

const HELPER_PROP_NAMES: Map<string, string[]> = new Map(
  discoverHelpers().map((h) => [h.name, h.props.map((p) => p.name)]),
);

/** Walk balanced parens starting at `i` (which points at the char AFTER
 *  the opening `(`). Returns the index of the matching `)`, or -1.
 *  Mirrors the client-side helper in src/routes/primitives/+page.svelte. */
function findMatchingParen(src: string, i: number): number {
  let depth = 1;
  let inS: '"' | "'" | '`' | null = null;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (inS) {
      if (c === '\\') { i += 2; continue; }
      if (c === inS) inS = null;
    } else {
      if (c === '"' || c === "'" || c === '`') inS = c as '"' | "'" | '`';
      else if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) return i; }
    }
    i++;
  }
  return -1;
}

/** Split a comma-separated arg list, respecting brackets / parens /
 *  strings. Returns the segments WITHOUT the separating commas. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  let inS: '"' | "'" | '`' | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inS) {
      if (c === '\\') { buf += c + (s[i + 1] ?? ''); i++; continue; }
      if (c === inS) inS = null;
      buf += c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inS = c as '"' | "'" | '`'; buf += c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; buf += c; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; buf += c; continue; }
    if (c === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim() !== '' || out.length > 0) out.push(buf);
  return out;
}

/** Replace every `<INST>.<prop>` reference in `src` with the raw arg
 *  value taken from the matching base declaration. Lets the user
 *  write live cross-instance refs in the editor (e.g.
 *  `B = mv(B, [A.length, 0, 0])`) without needing to snapshot at
 *  edit-time — A's current `length` value is inlined here, so the
 *  cascade is automatic on every re-execute.
 *
 *  Resolution rules:
 *    - helper instance (`A = tube(0.5, 0.4, 4)`): positional args are
 *      mapped to HELPER prop names from manifold-helpers-meta. So
 *      `A.h` → `4`.
 *    - component instance (`B = hollowCylinderGeom({ od: 4.5, ... })`):
 *      object-literal keys taken from the imported component's
 *      `meta.params`. So `B.od` → `4.5`.
 *  Unresolved refs (unknown instance, unknown prop) pass through
 *  unchanged — the WASM execution will throw a useful TypeError. */
function expandInstancePropRefs(
  src: string,
  deps: ParsedImports['deps'],
  resolveDep: DepResolver,
): string {
  // Map: import-alias (e.g. `hollowCylinderGeom`) → the imported
  // component's meta.params keys.
  const aliasParamKeys = new Map<string, Set<string>>();
  for (const { depId, specs } of deps) {
    let mod: LoadedComponent | undefined;
    try { mod = resolveDep(depId); } catch { continue; }
    const params = (mod?.meta as Record<string, unknown> | undefined)?.['params'];
    if (!params || typeof params !== 'object') continue;
    const keys = new Set(Object.keys(params as Record<string, unknown>));
    for (const s of specs) {
      // Only the `geom` import is relevant — that's the call-site name
      // users write in the body. Other exports (e.g. `meta`) don't
      // bind callable params.
      if (s.imported === 'geom') aliasParamKeys.set(s.local, keys);
    }
  }

  // Parse every base declaration: `(let|const) X = call(args)`.
  // Build instance → { propName: rawValue }.
  const propMap = new Map<string, Record<string, string>>();
  const baseRe = /\b(?:let|const)\s+([A-Z][A-Z0-9]*)\s*=\s*(\w+)\s*\(/g;
  for (const m of src.matchAll(baseRe)) {
    const inst = m[1];
    const callName = m[2];
    const argStart = m.index! + m[0].length;
    const argEnd = findMatchingParen(src, argStart);
    if (argEnd < 0) continue;
    const argText = src.slice(argStart, argEnd);
    const componentKeys = aliasParamKeys.get(callName);
    const props: Record<string, string> = {};
    if (componentKeys) {
      // Component call — parse `{ key: value, … }`.
      const trimmed = argText.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        const inner = trimmed.slice(1, -1);
        for (const seg of splitTopLevel(inner)) {
          const colon = seg.indexOf(':');
          if (colon < 0) continue;
          const k = seg.slice(0, colon).trim();
          const v = seg.slice(colon + 1).trim();
          if (k && componentKeys.has(k)) props[k] = v;
        }
      }
    } else {
      // Helper call — positional args mapped to HELPER prop names.
      const positional = splitTopLevel(argText);
      const propNames = HELPER_PROP_NAMES.get(callName) ?? [];
      for (let i = 0; i < Math.min(positional.length, propNames.length); i++) {
        const v = positional[i].trim();
        if (v) props[propNames[i]] = v;
      }
    }
    if (Object.keys(props).length > 0) propMap.set(inst, props);
  }

  if (propMap.size === 0) return src;

  // Multi-pass substitution to a fixpoint. A single .replace pass only
  // resolves direct refs — chained ones like `E.top = D.top + D.length`
  // need a second pass over the SUBSTITUTED text (the first pass writes
  // `D.top + D.length` into the mv expression, the second resolves it
  // to `0 + 5`). Capped to avoid runaway on circular refs (the regex
  // can't detect them, but the iteration count will).
  const re = /\b([A-Z][A-Z0-9]*)\.([a-z][a-zA-Z0-9_]*)\b/g;
  const substitute = (s: string) =>
    s.replace(re, (full, inst, prop) => {
      const v = propMap.get(inst)?.[prop];
      if (v == null) return full;
      // Wrap compound expressions in parens so substitution preserves
      // precedence inside larger expressions (`A.length / 2` stays
      // sane even if A.length itself is `p.bodyOD - 1`).
      return /^-?\d+(\.\d+)?$/.test(v) || /^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(v) ? v : `(${v})`;
    });
  let cur = src;
  for (let i = 0; i < 8; i++) {
    const next = substitute(cur);
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

export interface LoadedComponent {
  meta: PrimitiveMeta;
  geom: GeomFn;
}

/** A single named import specifier: `{ imported as local }`. */
interface ImportSpec {
  imported: string;
  local: string;
}

interface ParsedImports {
  /** Source with every `import …` line removed. */
  stripped: string;
  /** Sibling-component imports — `import { geom as fooGeom } from './foo'`. */
  deps: { depId: string; specs: ImportSpec[] }[];
}

/** Helper / `defineGeom` names a component file is allowed to import.
 *  The local name MUST equal the export name (no aliasing) — we pass
 *  these positionally into `new Function`. */
const HELPER_NAMES = new Set([
  'M',
  'cyl',
  'tube',
  'mv',
  'rot',
  'initManifold',
  'setCircularSegmentMode',
  'getCutBox',
  'CIRCULAR_SEGMENTS_DEFAULT',
  'CIRCULAR_SEGMENTS_COMPOSE',
  'defineGeom',
]);

/** Substrings that must never appear in a volume component body. */
const DENYLIST = [
  'require(',
  'process',
  'globalThis',
  'import(',
  'eval(',
  'Function(',
  'child_process',
  '__dirname',
  '__filename',
];

const IMPORT_RE =
  /import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:from\s*)?['"]([^'"]+)['"]\s*;?/g;

/** Parse + validate the import header. Throws on any disallowed import. */
export function parseImports(src: string): ParsedImports {
  const deps: { depId: string; specs: ImportSpec[] }[] = [];
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    const [, defaultImport, named, source] = m;
    if (defaultImport) {
      throw new Error(
        `Disallowed default import "${defaultImport}" from "${source}" — volume components may only use named imports from '../manifold-helpers', '.' or './<sibling>'.`,
      );
    }
    const specs = parseSpecifiers(named ?? '');
    if (source === '../manifold-helpers' || source === '.') {
      for (const s of specs) {
        if (s.imported !== s.local) {
          throw new Error(
            `Disallowed aliased import "{ ${s.imported} as ${s.local} }" from "${source}" — helper imports must use the export name verbatim.`,
          );
        }
        if (!HELPER_NAMES.has(s.local)) {
          throw new Error(
            `Unknown import "${s.local}" from "${source}" — not a manifold helper or defineGeom.`,
          );
        }
      }
      continue;
    }
    const depMatch = /^\.\/([a-z][a-z0-9_]*)$/.exec(source);
    if (depMatch) {
      deps.push({ depId: depMatch[1], specs });
      continue;
    }
    throw new Error(
      `Disallowed import from "${source}" — volume components may only import from '../manifold-helpers', '.' or './<sibling-id>'.`,
    );
  }

  const stripped = src.replace(IMPORT_RE, '');
  for (const bad of DENYLIST) {
    if (stripped.includes(bad)) {
      throw new Error(
        `Disallowed token "${bad}" in component body — volume components run sandboxed and may not touch the host environment.`,
      );
    }
  }
  return { stripped, deps };
}

function parseSpecifiers(named: string): ImportSpec[] {
  const out: ImportSpec[] = [];
  for (const raw of named.split(',')) {
    const part = raw.trim().replace(/^type\s+/, '');
    if (!part) continue;
    const asMatch = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(part);
    if (asMatch) {
      out.push({ imported: asMatch[1], local: asMatch[2] });
    } else if (/^[A-Za-z_$][\w$]*$/.test(part)) {
      out.push({ imported: part, local: part });
    } else {
      throw new Error(`Unparseable import specifier "${part}".`);
    }
  }
  return out;
}

/** resolveDep(depId) → the module object exporting `meta` / `geom`. */
export type DepResolver = (depId: string) => LoadedComponent;

/** Enforce the split-init/composition grammar (~/.claude/plans/
 *  grammar-split-init-compose.md). The body of `defineGeom(meta, (p,
 *  geom) => { … })` MUST be partitioned into an INITIALIZATION region
 *  (every `let|const X = call(...)` declaration + any `X = mv(X, …)`
 *  reassignments) followed by a COMPOSITION region (every
 *  `geom.add|subtract|intersect(X)` call). The boundary is the FIRST
 *  `geom.<op>(...)` line: any `let|const` declaration AFTER that line
 *  is a violation, and any `geom.<op>` call BEFORE the first one is
 *  trivially fine.
 *
 *  Throws with a clear message naming the offending line so the AI
 *  refine endpoint, the inspector, and library-on-disk parts all hit
 *  the same gate. The CSG op now lives in the composition source text
 *  itself (no more `meta.instanceOps` rewrite) — `geom.add(X)` /
 *  `geom.subtract(X)` / `geom.intersect(X)` are read verbatim. */
function enforceSplitGrammar(src: string): void {
  // Strip comments BEFORE the grammar scan. Otherwise a `//` line or
  // `/* */` block that mentions `geom.add(X)` as documentation text
  // (e.g. an examples comment in a re-authored file) would be flagged
  // as the first composition call, and every real `let X = …` decl
  // would land "after" it.
  const scan = stripCommentsForScan(src);
  // First geom.<op>(...) call — the boundary between init and composition.
  const opRe = /\bgeom\s*\.\s*(add|subtract|intersect)\s*\(/;
  const firstOp = opRe.exec(scan);
  if (!firstOp) return; // No composition at all — vacuously valid (single-instance, etc.)
  const boundary = firstOp.index;
  // After the boundary, no `let|const X = …` decls are allowed.
  const declAfterRe = /\b(?:let|const)\s+[A-Z][A-Z0-9]*\s*=\s*[A-Za-z_][\w]*\s*\(/g;
  declAfterRe.lastIndex = boundary;
  const stray = declAfterRe.exec(scan);
  if (stray) {
    const lineNo = scan.slice(0, stray.index).split('\n').length;
    throw new Error(
      `Grammar violation on line ${lineNo}: instance declaration "${stray[0]}" appears AFTER the first geom.${firstOp[1]}(...) call. ` +
        `Move every \`let|const X = …\` declaration into the INITIALIZATION section (above all geom.add/subtract/intersect calls). ` +
        `See ~/.claude/plans/grammar-split-init-compose.md.`,
    );
  }
}

// Replace every `//` line-comment and slash-star block-comment with
// same-length runs of spaces. Preserves line + column offsets so the
// grammar enforcer's line-number arithmetic still points at the
// original source. Strings are NOT scanned for comment markers
// (the grammar regex doesn't look inside strings, so a `geom.add`
// appearing in a template literal won't false-trigger anyway).
// Exported so the /api/components/refine validator can share the
// same comment-stripping shape as the loader's grammar gate.
export function stripCommentsForScan(src: string): string {
  let out = '';
  let i = 0;
  let inS: '"' | "'" | '`' | null = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inS) {
      if (c === '\\') { out += c + (src[i + 1] ?? ''); i += 2; continue; }
      if (c === inS) inS = null;
      out += c;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inS = c as any; out += c; i++; continue; }
    if (c === '/' && n === '/') {
      // Line comment — replace until newline (keep the newline).
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && n === '*') {
      // Block comment — replace until `*/`, preserving newlines.
      out += '  '; i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < src.length) { out += '  '; i += 2; }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Walk from `start` inside an arg-object literal to the index that ends
 *  the current key's value: the next top-level `,` or the closing `}` of
 *  the object. Tracks (), [], {} depth so commas / closers inside nested
 *  expressions don't fool us. Returns -1 if no terminator is found. */
function findArgValueEnd(src: string, start: number): number {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']') {
      if (depth === 0) return i;
      depth--;
    } else if (c === '}') {
      if (depth === 0) return i;
      depth--;
    } else if (c === ',' && depth === 0) return i;
  }
  return -1;
}

/** Rewrite each `top:` arg in instance declarations per the caller-supplied
 *  placement mode map. Walks declarations in source order so each
 *  instance's PREV is the one immediately above it (matching how the
 *  inspector orders them). Source on disk is unchanged — the rewrite is
 *  layered at load time, then `expandInstancePropRefs` substitutes the
 *  new `PREV.top + PREV.length` expressions to literals on the next pass.
 *
 *  Modes (instance keyed by uppercase name):
 *    - 'stack'   → `top: PREV.top + PREV.length`
 *    - 'overlay' → `top: PREV.top + <offset>` (or `PREV.top` when offset=0)
 *    - 'origin'  → `top: 0`
 *  Unset instances are left as-authored. First instance can only be
 *  rewritten to 'origin' (it has no PREV); other modes silently skip it.
 *  An instance whose call args have no `top:` key (helpers) is skipped.
 */
function applyInstanceTopMode(
  src: string,
  modes: Record<string, 'stack' | 'overlay' | 'origin'> | undefined,
  offsets: Record<string, number> | undefined,
): string {
  if (!modes || Object.keys(modes).length === 0) return src;
  // Collect every `let|const X = call(` declaration in source order.
  const reDecl = /\b(?:let|const)\s+([A-Z][A-Z0-9]*)\s*=\s*[A-Za-z_][\w]*\s*\(/g;
  type Decl = { name: string; argStart: number; argEnd: number };
  const decls: Decl[] = [];
  let m: RegExpExecArray | null;
  while ((m = reDecl.exec(src))) {
    const openParen = m.index + m[0].length - 1;
    const argStart = openParen + 1;
    const argEnd = findMatchingParen(src, argStart);
    if (argEnd === -1) continue;
    decls.push({ name: m[1], argStart, argEnd });
  }
  if (decls.length === 0) return src;
  // Process in REVERSE source order so earlier rewrites don't shift the
  // indices we're about to splice into.
  let out = src;
  for (let i = decls.length - 1; i >= 0; i--) {
    const { name, argStart, argEnd } = decls[i];
    const mode = modes[name];
    if (!mode) continue;
    const prev = i > 0 ? decls[i - 1].name : null;
    let newTop: string;
    if (mode === 'origin') {
      newTop = '0';
    } else if (!prev) {
      // First instance can't stack/overlay (no PREV). Skip silently.
      continue;
    } else if (mode === 'overlay') {
      const off = offsets?.[name];
      newTop = off && Number.isFinite(off) && off !== 0
        ? `${prev}.top + ${off}`
        : `${prev}.top`;
    } else {
      // 'stack'
      newTop = `${prev}.top + ${prev}.length`;
    }
    // Find `top:` inside the args region. Match identifier-bound so
    // `bottom:` or a substring inside a string literal isn't touched.
    const argsRegion = out.slice(argStart, argEnd);
    const topMatch = /\btop\s*:\s*/.exec(argsRegion);
    if (!topMatch) continue; // helper or component without a `top` arg
    const keyStartInArgs = topMatch.index;
    const valStartInArgs = keyStartInArgs + topMatch[0].length;
    const valEndInArgs = findArgValueEnd(argsRegion, valStartInArgs);
    if (valEndInArgs === -1) continue;
    const valStart = argStart + valStartInArgs;
    const valEnd = argStart + valEndInArgs;
    out = out.slice(0, valStart) + newTop + out.slice(valEnd);
  }
  return out;
}

/**
 * Transpile a component `.ts` source string and execute it in a sandboxed
 * host-realm function, returning `{ meta, geom }`. `resolveDep` supplies
 * sibling-component modules for composition imports.
 *
 * The source MUST follow the split-init/composition grammar — see
 * ~/.claude/plans/grammar-split-init-compose.md. The CSG op lives in
 * the source itself (`geom.add` / `geom.subtract` / `geom.intersect`);
 * there's no `instanceOps` rewrite at execute time.
 *
 * `instanceTopMode` + `instanceTopOffset` (optional) rewrite each
 * instance's `top:` arg before prop-ref expansion so the placement
 * picker semantics (stack below / overlay-with-offset / at origin)
 * cascade through to the mv translate via the normal expansion path.
 *
 * `injectedMeta` (optional) — when the caller has identity/schema meta
 * available from a sidecar (library parts after the meta-to-JSON
 * migration), pass it here. The loader prepends
 * `const meta = <JSON>; exports.meta = meta;` so the existing
 * `defineGeom(meta, fn)` call resolves AND the returned LoadedComponent
 * has authoritative meta from JSON. Sources that still hold an inline
 * `export const meta = {...}` continue to work — that export will
 * overwrite the prepended one. When the source has no inline export
 * AND no injectedMeta is supplied, the load fails (no `result.meta`).
 */
export function loadGeomFromSource(
  src: string,
  resolveDep: DepResolver,
  instanceTopMode?: Record<string, 'stack' | 'overlay' | 'origin'>,
  instanceTopOffset?: Record<string, number>,
  injectedMeta?: PrimitiveMeta,
): LoadedComponent {
  const { stripped, deps } = parseImports(src);
  // Grammar gate — strict split-init/composition layout. CSG op now
  // lives in the source itself (`geom.add` / `geom.subtract` /
  // `geom.intersect`) so this is the single point where bad layouts
  // get rejected before they can crash WASM with a cryptic error.
  enforceSplitGrammar(stripped);
  // Per-instance placement rewrite — rewrites each `top:` arg per the
  // mode (+ optional offset). MUST run before expandInstancePropRefs so
  // the new `PREV.top + PREV.length` (etc.) gets substituted to literals
  // in the same pass, and so the mv vec3 reading `B.top` picks up the
  // new value via the normal expansion path. Source on disk is
  // unchanged — semantics layer on top at execute time.
  const withTop = applyInstanceTopMode(stripped, instanceTopMode, instanceTopOffset);
  // Substitute `<INST>.<prop>` cross-instance references (e.g.
  // `B = mv(B, [A.length, 0, 0])`) BEFORE transpile — the executed
  // JS sees the concrete numeric value where the user wrote a
  // part-prop reference. Source-on-disk preserves the reference
  // text, so the substitution re-runs on every load and the
  // cascade stays live across saves.
  const expanded = expandInstancePropRefs(withTop, deps, resolveDep);

  // Prepend the JSON meta as an `export const meta = ...` when the
  // source doesn't already declare one. esbuild's CJS output wires
  // `export const` declarations into the module's exports — a plain
  // `exports.meta = ...` would NOT survive esbuild's
  // `module.exports = __toCommonJS(stdin_exports)` rebind (it runs
  // BEFORE the user code, so any post-rebind `exports.meta = ...`
  // hits a stale `exports` while the actual module.exports has been
  // replaced). The injected ESM export also brings `meta` into scope
  // so the user's `defineGeom(meta, fn)` call resolves at load time.
  //
  // When the source HAS an inline `export const meta`, we skip the
  // prepend entirely — declaring `const meta` twice is a fatal
  // esbuild transform error. Inline meta wins (back-compat path for
  // pre-migration parts).
  //
  // JSON.stringify is safe — PartMeta is JSON-clean by construction.
  // Strip comments before the inline-meta sniff — otherwise a doc line
  // like `// the loader prepends \`export const meta = {...}\`` would
  // false-trigger and we'd skip the JSON prepend, leaving `meta`
  // undefined in the user's `defineGeom(meta, fn)` call.
  const hasInlineMeta = /\bexport\s+const\s+meta\s*=/.test(stripCommentsForScan(expanded));
  const prefix = injectedMeta && !hasInlineMeta
    ? `export const meta = ${JSON.stringify(injectedMeta)};\n`
    : '';
  const { code } = transformSync(prefix + expanded, {
    loader: 'ts',
    format: 'cjs',
    target: 'node22',
  });

  // Resolve sibling deps and flatten their specifiers into positional args.
  const depArgNames: string[] = [];
  const depArgValues: unknown[] = [];
  for (const { depId, specs } of deps) {
    const mod = resolveDep(depId);
    const modAsRecord = mod as unknown as Record<string, unknown>;
    for (const s of specs) {
      depArgNames.push(s.local);
      depArgValues.push(modAsRecord[s.imported]);
    }
  }

  const exportsObj: Record<string, unknown> = {};
  const helperValues: unknown[] = [
    M,
    cyl,
    tube,
    mv,
    rot,
    initManifold,
    setCircularSegmentMode,
    getCutBox,
    CIRCULAR_SEGMENTS_DEFAULT,
    CIRCULAR_SEGMENTS_COMPOSE,
    defineGeom,
  ];
  const helperParamNames = [
    'M',
    'cyl',
    'tube',
    'mv',
    'rot',
    'initManifold',
    'setCircularSegmentMode',
    'getCutBox',
    'CIRCULAR_SEGMENTS_DEFAULT',
    'CIRCULAR_SEGMENTS_COMPOSE',
    'defineGeom',
  ];

  // eslint-disable-next-line no-new-func
  const factory = new Function(
    ...helperParamNames,
    ...depArgNames,
    'exports',
    'module',
    `${code}\nreturn module.exports !== exports ? module.exports : exports;`,
  );
  const moduleObj = { exports: exportsObj };
  const result = factory(
    ...helperValues,
    ...depArgValues,
    exportsObj,
    moduleObj,
  ) as Record<string, unknown>;

  const meta = result.meta as PrimitiveMeta | undefined;
  const geom = result.geom as GeomFn | undefined;
  if (!meta || typeof geom !== 'function') {
    throw new Error(
      'Component source must export both `meta` (object) and `geom` (function).',
    );
  }
  return { meta, geom };
}

// ── loadVolumeComponent — read + cache ───────────────────────────────────────

interface CacheEntry {
  sourceHash: string;
  loaded: LoadedComponent;
}
const volumeCache = new Map<string, CacheEntry>();

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Load a volume-resident component by id. Reads `<volume>/components/<id>.ts`,
 * transpiles + executes it, and memoizes the result keyed by source hash so
 * an unchanged file is loaded once. Composition imports (`./<sibling>`)
 * resolve to a bundled primitive first (`geomById`), otherwise recurse into
 * another volume component, with a cycle guard.
 */
export async function loadVolumeComponent(
  id: string,
  seen: Set<string> = new Set(),
): Promise<LoadedComponent> {
  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    throw new Error(`Invalid component id "${id}".`);
  }
  if (seen.has(id)) {
    throw new Error(
      `Circular composition import — "${id}" appears in its own dependency chain.`,
    );
  }
  seen.add(id);

  // Lazy import — library.ts → volume.ts pulls `$env/dynamic/private`,
  // which only resolves inside the SvelteKit runtime. Deferring it here
  // keeps parseImports / loadGeomFromSource importable from plain unit tests.
  const { resolvePart } = await import('./library');
  // A library part is a directory under library/<category>/<id>/ —
  // resolvePart finds it in whichever category it currently sits in.
  const part = await resolvePart(id);
  if (!part) {
    throw new Error(`Library part "${id}" not found in any category.`);
  }
  const path = part.componentPath;
  let src: string;
  try {
    src = await readFile(path, 'utf8');
  } catch {
    throw new Error(`Library part "${id}" component.ts unreadable at ${path}.`);
  }
  // Cache key folds in placement (top mode + offset) and the
  // injected JSON meta so toggling any of those flips the executed geom
  // on the next /api/components/geom call without the user having to
  // also edit the source. The CSG op lives in the source itself now
  // (see split-grammar plan) so it's part of `src` already and
  // doesn't need its own sig. NUL byte separator avoids any
  // ambiguity between fields.
  const topModeSig = part.meta.instanceTopMode
    ? JSON.stringify(Object.entries(part.meta.instanceTopMode).sort())
    : '';
  const topOffSig = part.meta.instanceTopOffset
    ? JSON.stringify(Object.entries(part.meta.instanceTopOffset).sort())
    : '';
  const injectedMetaSig =
    part.meta.id && part.meta.params
      ? JSON.stringify({
          id: part.meta.id,
          name: part.meta.name,
          description: part.meta.description,
          tags: part.meta.tags,
          params: part.meta.params,
        })
      : '';
  const hash = sha(`${src} ${topModeSig} ${topOffSig} ${injectedMetaSig}`);
  const cached = volumeCache.get(id);
  if (cached && cached.sourceHash === hash) return cached.loaded;

  // resolveDep must be synchronous for loadGeomFromSource, so any volume
  // sibling has to be loaded ahead of time. Pre-scan the import header and
  // resolve every dep, then hand loadGeomFromSource a sync lookup.
  const { deps } = parseImports(src);
  const resolved = new Map<string, LoadedComponent>();
  for (const { depId } of deps) {
    if (resolved.has(depId)) continue;
    const bundledGeom = geomById(depId);
    if (bundledGeom) {
      const bundledMeta = metaById(depId);
      if (!bundledMeta) {
        throw new Error(`Bundled dep "${depId}" has a geom but no meta.`);
      }
      resolved.set(depId, { meta: bundledMeta, geom: bundledGeom });
    } else {
      resolved.set(depId, await loadVolumeComponent(depId, seen));
    }
  }

  // Hand the JSON meta to the loader when meta.json carries identity +
  // schema (the post-grammar-split shape). The loader prepends it as a
  // `const meta = ...` so the existing `defineGeom(meta, fn)` reference
  // resolves and the returned LoadedComponent.meta is authoritative.
  // Pre-migration parts (no `id` / `params` in JSON) get undefined and
  // the loader falls back to the inline `export const meta` in the .ts.
  const injectedMeta: PrimitiveMeta | undefined =
    part.meta.id && part.meta.name && part.meta.params
      ? {
          id: part.meta.id,
          name: part.meta.name,
          description: part.meta.description,
          tags: part.meta.tags,
          params: part.meta.params as Record<string, any>,
        }
      : undefined;

  const loaded = loadGeomFromSource(
    src,
    (depId) => {
      const dep = resolved.get(depId);
      if (!dep) throw new Error(`Unresolved composition dep "${depId}".`);
      return dep;
    },
    part.meta.instanceTopMode,
    part.meta.instanceTopOffset,
    injectedMeta,
  );

  volumeCache.set(id, { sourceHash: hash, loaded });
  return loaded;
}

// ── Serialized-geometry result cache ─────────────────────────────────────────
// Keyed by `<id>|<paramsJson>|<zScale>`. Holds the JSON the /api/components/geom
// endpoint sends to the client, so an unchanged (id, params, zScale) tuple
// skips the WASM rebuild entirely. Capped LRU-ish: oldest insertion evicted
// once over capacity.

const RESULT_CACHE_CAP = 200;
const resultCache = new Map<string, unknown>();

export function getGeomResult(key: string): unknown | undefined {
  const hit = resultCache.get(key);
  if (hit !== undefined) {
    // Touch — move to newest position for LRU eviction order.
    resultCache.delete(key);
    resultCache.set(key, hit);
  }
  return hit;
}

export function setGeomResult(key: string, value: unknown): void {
  resultCache.set(key, value);
  while (resultCache.size > RESULT_CACHE_CAP) {
    const oldest = resultCache.keys().next().value;
    if (oldest === undefined) break;
    resultCache.delete(oldest);
  }
}

/** Drop the memoized entry for a component (called after a save overwrites it).
 *  Also evicts every result-cache entry derived from that component id. */
export function invalidateVolumeComponent(id: string): void {
  volumeCache.delete(id);
  const prefix = `${id}|`;
  for (const key of resultCache.keys()) {
    if (key.startsWith(prefix)) resultCache.delete(key);
  }
}
