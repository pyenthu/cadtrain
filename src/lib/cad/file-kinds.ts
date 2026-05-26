/**
 * file-kinds — the typed-file taxonomy for the file-based /primitives architecture
 * (docs/plans/file-based-architecture.md). Each entity is a TS module whose
 * MID-EXTENSION identifies its type; the client picks an editor + the server picks
 * a bake/resolve route off the kind. This module is the single source of that
 * mapping (pure, no I/O) so the sidebar, tab/app registry, and server routing all
 * agree.
 *
 *   <id>.prvl.ts  revolve profile   → ProfileFnEditor (Z-down)   → resolve
 *   <id>.prex.ts  extrude profile   → ProfileFnEditor (cartesian)→ resolve
 *   <id>.prim.ts  CAD primitive     → PrimitiveView              → bake
 *   <id>.asm.ts   assembly          → PrimitiveView / asm view   → bake
 *
 * `kindOf` also bridges the CURRENT (pre-migration) layout — `<id>/source.ts`
 * under a category dir, and `primitives/profiles/<id>/...` — so the registry works
 * before files are renamed.
 */

export type FileKind = 'prvl' | 'prex' | 'prim' | 'asm';

/** Which client editor opens a kind. */
export type EditorKind = 'profile' | 'primitive';

/** Which server route bakes/resolves a kind. */
export type ApiKind = 'resolve' | 'bake';

const MID_EXT_RE = /\.(prvl|prex|prim|asm)\.ts$/i;

/** The kind of a volume file by path. Prefers the explicit mid-extension; falls
 *  back to the current folder-based layout (location = kind, CLAUDE.md Rule 18).
 *  Returns null when the path isn't a recognized entity file. */
export function kindOf(path: string): FileKind | null {
  const m = MID_EXT_RE.exec(path);
  if (m) return m[1].toLowerCase() as FileKind;
  // ── Legacy bridge (pre-migration) ───────────────────────────────────────
  // Only `source.ts` is an entity file (NOT profile.json / meta.json / etc.).
  // A profile lives under `…/profiles/<id>/source.ts`; we can't tell revolve
  // (prvl) from extrude (prex) by path alone (today that's the `set` field
  // inside), so default to 'prvl' — both open the same editor; the axis is read
  // from the file's meta. Any other `source.ts` is a primitive leaf.
  if (/(^|\/)source\.ts$/i.test(path)) {
    return /(^|\/)profiles\//.test(path) ? 'prvl' : 'prim';
  }
  return null;
}

export function isProfileKind(k: FileKind): boolean {
  return k === 'prvl' || k === 'prex';
}

/** The editor a kind opens in. Both profile kinds share ProfileFnEditor; both
 *  geometry kinds share PrimitiveView (assembly view is a PrimitiveView variant). */
export function editorFor(k: FileKind): EditorKind {
  return isProfileKind(k) ? 'profile' : 'primitive';
}

/** The server route for a kind: profiles resolve to points; prim/asm bake to a Manifold. */
export function apiFor(k: FileKind): ApiKind {
  return isProfileKind(k) ? 'resolve' : 'bake';
}

/** The axis convention a profile kind implies (null for non-profiles). The
 *  mid-extension encodes this, so no separate `set` flag is needed post-migration. */
export function axisFor(k: FileKind): 'revolve' | 'cartesian' | null {
  if (k === 'prvl') return 'revolve';
  if (k === 'prex') return 'cartesian';
  return null;
}

/** Human label for a kind (for the sidebar / tab chrome). */
export function labelFor(k: FileKind): string {
  return { prvl: 'revolve profile', prex: 'extrude profile', prim: 'primitive', asm: 'assembly' }[k];
}
