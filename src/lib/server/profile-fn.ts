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
import { pen } from '$lib/shared/profile-presets';

function stripImports(src: string): string {
  return src.replace(/^\s*import\s[^\n]*;?\s*$/gm, '');
}

// Points-only: no Manifold, no I/O. Reject the obvious escape/IO vectors.
const DENY = /\b(require|process|globalThis|Function|eval|fetch|__proto__|constructor)\b|import\s*\(/;

export function buildProfileFromSource(source: string, params: Record<string, number> = {}): [number, number][] {
  const stripped = stripImports(source);
  if (DENY.test(stripped)) throw new Error('profile source uses a denied construct (points-only: Math + params)');
  const body = transformSync(stripped, { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  const mod = { exports: {} as Record<string, unknown> };
  // eslint-disable-next-line no-new-func
  const fn = new Function('Math', 'pen', 'exports', 'module', `${body}\nreturn (exports.build || (module.exports && module.exports.build));`);
  const build = fn(Math, pen, mod.exports, mod) as ((p: Record<string, number>) => unknown) | undefined;
  if (typeof build !== 'function') throw new Error('profile source must `export function build(p)`');
  const pts = build(params || {});
  if (!Array.isArray(pts) || pts.length < 3) throw new Error('build(p) must return ≥ 3 [r,z] points');
  return pts.map((q: any) => [Number(q?.[0]), Number(q?.[1])] as [number, number]);
}
