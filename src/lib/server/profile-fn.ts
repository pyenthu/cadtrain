/**
 * profile-fn — run a VOLUME profile-function's `build(p)` from
 * `primitives/profiles/<id>/source.ts` in a tiny points-only sandbox, returning
 * the (r,z) polygon. The profiles directory (docs/plans/profiles-directory.md,
 * K.22): curated profile functions live in src `PROFILE_REGISTRY`; user-authored
 * ones live on the volume as `profile.json` (params schema) + `source.ts`
 * (`export function build(p) { … return [[r,z],…]; }`).
 *
 * Far smaller surface than the primitive sandbox: a `build` returns POINTS, not
 * geometry, so the only scope it needs is `Math`. `new Function` in the host
 * realm (same posture as component-loader.ts) + import-strip + denylist.
 */
import { transformSync } from 'esbuild';
import { pen } from '$lib/shared/profiles/profile-presets';
import { evalMetaLiteral, metaLiteralRange } from '$lib/server/primitives-meta';
import * as mathLib from '$lib/graph/math-lib';

// Bare math names — `cos(x)`, `PI`, `tau`, `deg(45)` — injected alongside `Math`
// so author-friendly profile bodies don't need the `Math.` prefix. Single source
// of truth in math-lib.ts; the primitive sandbox imports the same module.
const MATH_NAMES = Object.keys(mathLib);
const MATH_VALUES = MATH_NAMES.map((n) => (mathLib as any)[n]);

function stripImports(src: string): string {
  return src.replace(/^\s*import\s[^\n]*;?\s*$/gm, '');
}

// Points-only: no Manifold, no I/O. Reject the obvious escape/IO vectors.
const DENY = /\b(require|process|globalThis|Function|eval|fetch|__proto__|constructor)\b|import\s*\(/;

/** Compile a profile's `build(p)` ONCE → a reusable (params)→points function.
 *  Used by the bake path (P6): a part's `resolveProfile({kind})` for a VOLUME
 *  profile calls this compiled build with the part's params, so edits/forks
 *  drive the part. */
export function compileProfileBuild(source: string): (params?: Record<string, number>) => [number, number][] {
  const stripped = stripImports(source);
  if (DENY.test(stripped)) throw new Error('profile source uses a denied construct (points-only: Math + params)');
  const body = transformSync(stripped, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  const mod = { exports: {} as Record<string, unknown> };
  // eslint-disable-next-line no-new-func
  const fn = new Function('Math', 'pen', ...MATH_NAMES, 'exports', 'module', `${body}\nreturn (exports.build || (module.exports && module.exports.build));`);
  const build = fn(Math, pen, ...MATH_VALUES, mod.exports, mod) as ((p: Record<string, number>) => unknown) | undefined;
  if (typeof build !== 'function') throw new Error('profile source must `export function build(p)`');
  return (params: Record<string, number> = {}) => {
    const pts = build(params || {});
    if (!Array.isArray(pts) || pts.length < 3) throw new Error('build(p) must return ≥ 3 points (revolve: [r,z] · cartesian: [x,y])');
    return pts.map((q: any) => [Number(q?.[0]), Number(q?.[1])] as [number, number]);
  };
}

export function buildProfileFromSource(source: string, params: Record<string, number> = {}): [number, number][] {
  return compileProfileBuild(source)(params);
}

// ── Merged profile module (<id>.prvl.ts / .prex.ts) ─────────────────────────
// The file-based layout (docs/plans/file-based-architecture.md) stores a profile
// as ONE module: the meta literal (params schema + axis `set`) followed by the
// `build(p)` body — replacing the old `profile.json` + `source.ts` pair. The
// mid-extension (prvl/prex) IS the kind; `set` is mirrored in meta for the
// existing profile-list filter + the editor.

export interface ProfileMeta {
  id: string;
  label: string;
  description: string;
  set: 'revolve' | 'cartesian';
  tags: string[];
  params: Record<string, any>;
  /** Optional graph block — emitted by the /primitives editor when the
   *  profile is authored via the polygon node. Persists the node layout
   *  + connections + viewport so the next open hydrates the canvas
   *  instead of falling into 'legacy mode'. Read by GraphEditorPane's
   *  load path (extractGraphFromSource or data.graph). */
  graph?: any;
}

/** The file mid-extension a profile's `set` maps to: revolve→prvl, cartesian→prex. */
export function profileExt(set: string): 'prvl' | 'prex' {
  return set === 'cartesian' ? 'prex' : 'prvl';
}

/** Compose a merged profile module from its meta + build() body. */
export function composeProfileModule(meta: ProfileMeta, buildSource: string): string {
  const ext = profileExt(meta.set);
  const kind = meta.set === 'cartesian' ? 'extrude (cross-section)' : 'revolve ((r,z) half-section)';
  const header =
    `// ${meta.id}.${ext}.ts — ${kind} profile (function).\n` +
    `// meta = params schema + axis; build(p) returns the profile points.`;
  return `${header}\nexport const meta = ${JSON.stringify(meta, null, 2)};\n\n${buildSource.trim()}\n`;
}

/** Split a merged profile module back into { meta, buildSource }. buildSource is
 *  everything after the meta literal (the build fn + any helpers it defines). */
export function splitProfileModule(src: string): { meta: ProfileMeta; buildSource: string } {
  const raw = evalMetaLiteral(src);
  const range = metaLiteralRange(src);
  let buildSource = src;
  if (range) {
    let after = range[1] + 1;
    while (after < src.length && /[;\s]/.test(src[after])) after++; // skip `;` + whitespace
    buildSource = src.slice(after);
  }
  const meta: ProfileMeta = {
    id: String(raw.id ?? ''),
    label: String(raw.label ?? raw.id ?? ''),
    description: String(raw.description ?? ''),
    set: raw.set === 'cartesian' ? 'cartesian' : 'revolve',
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    params: raw.params && typeof raw.params === 'object' ? raw.params : {},
  };
  // PRESERVE the optional graph block. Earlier cut explicitly constructed
  // meta from only the canonical fields - graph was silently dropped on
  // every load, so files saved with a graph round-tripped to nothing on
  // reopen ('legacy mode' banner). Copy it through when present.
  if (raw.graph && typeof raw.graph === 'object') meta.graph = raw.graph;
  return { meta, buildSource: buildSource.trim() };
}
