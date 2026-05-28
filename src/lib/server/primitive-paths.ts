/**
 * primitive-paths — the ONE place that maps a primitive/profile id to its file
 * on the volume. Every endpoint (source/save/list/delete/restore + profiles/*)
 * routes through here so the resolvers can never drift apart (the lesson from
 * the 2026-05-23 category restructure, which broke three flat-path resolvers).
 *
 * File-based layout (docs/plans/file-based-architecture.md) — the new scheme:
 *   primitives/<cat>/<id>.prim.ts   CAD primitive (legacy / generic — pre-typed-builder)
 *   primitives/<cat>/<id>.exp.ts    Extrude Part — inline (x,y) profile → r_weld_extrude
 *   primitives/<cat>/<id>.rev.ts    Profile (Revolve) Part — inline (r,z) profile → r_revolve
 *   primitives/<cat>/<id>.asm.ts    Assembly — composes other parts via CSG / place()
 *   primitives/profiles/<id>.prvl.ts | .prex.ts   profile (function) — legacy standalone
 * where <cat> ∈ { '' (flat), basic, archive } or completions/<family>.
 *
 * The four primitive kinds + the dispatch they drive in /primitives:
 *   * exp → ExtrudePartBuilder (cartesian profile editor + extrude dials)
 *   * rev → RevolvePartBuilder (revolve profile editor + revolve dials)
 *   * asm → AssemblyEditor (current Parts accordion + Builder)
 *   * prim → AssemblyEditor (legacy fallback for pre-typed-builder parts; their
 *           shape can be anything — most are assemblies in practice. New parts
 *           never write `.prim.ts`; the typed extensions distinguish at filename.)
 *
 * LEGACY (pre-migration) folder scheme — still READ as a fallback so the app
 * keeps working during/after the destructive migration, and so a volume that
 * hasn't been migrated yet still resolves:
 *   primitives/<cat>/<id>/source.ts
 *   primitives/profiles/<id>/{ profile.json, source.ts }
 *
 * Writers only ever emit the NEW scheme; on save they delete the legacy folder.
 */
import { readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { volumePath } from '$lib/server/volume';

/** A primitive's file-type marker. The mid-extension IS the type. */
export type PrimKind = 'prim' | 'exp' | 'rev' | 'asm';

const PRIM_KINDS: PrimKind[] = ['prim', 'exp', 'rev', 'asm'];
const PRIM_EXT_RE = /\.(prim|exp|rev|asm)\.ts$/i;
const PROFILE_EXT_RE = /\.(prvl|prex)\.ts$/i;

// ── Primitives ──────────────────────────────────────────────────────────────

export interface PrimHit {
  /** Absolute path to the source file (new flat file OR legacy source.ts). */
  path: string;
  kind: PrimKind;
  /** True when resolved via the old <id>/source.ts folder. */
  legacy: boolean;
  /** Directory the entity lives IN — its category dir (or the root for flat). */
  dir: string;
  /** '' (flat) | basic | archive | completions */
  category: string;
  /** completions family, when category === 'completions'. */
  family?: string;
  /** Subfolder NAME inside the family (e.g. 'tests') when the part lives at
   *  `primitives/<cat>/<family>/<subfolder>/<id>.prim.ts`. The 3rd resolver
   *  level for user-created sub-buckets (e.g. drill_pipe/tests/). */
  subfolder?: string;
}

/** Parse a new-scheme primitive file name → { id, kind }, or null. */
export function primIdFromFile(name: string): { id: string; kind: PrimKind } | null {
  const m = PRIM_EXT_RE.exec(name);
  if (!m) return null;
  const tag = m[1].toLowerCase();
  const kind = (PRIM_KINDS as string[]).includes(tag) ? (tag as PrimKind) : 'prim';
  return { id: name.slice(0, m.index), kind };
}

/** Where to WRITE a primitive's source — the new flat file in `dir`. */
export function primFilePath(dir: string, id: string, kind: PrimKind = 'prim'): string {
  return join(dir, `${id}.${kind}.ts`);
}

// Look in ONE directory for an entity: new flat file first (in order — newer
// typed extensions win over the legacy generic `prim`), then legacy folder.
function hitInDir(dir: string, id: string): { path: string; kind: PrimKind; legacy: boolean } | null {
  for (const kind of PRIM_KINDS) {
    const p = join(dir, `${id}.${kind}.ts`);
    if (existsSync(p)) return { path: p, kind, legacy: false };
  }
  const legacy = join(dir, id, 'source.ts');
  if (existsSync(legacy)) return { path: legacy, kind: 'prim', legacy: true };
  return null;
}

/** Resolve a primitive id → its source file. Searches flat (primitives/<id>),
 *  one level (primitives/<cat>/<id>) and two (primitives/<cat>/<family>/<id>).
 *  ACTIVE-ONLY by default — archive/ is a graveyard that NOTHING resolves into
 *  unless it explicitly opts in with `includeArchive: true` (only delete +
 *  restore do). The id is the identity; the folder is just the category, so an
 *  archived copy must never shadow the active part of the same id (that made
 *  saves look un-persisted on reload). */
export async function findPrim(id: string, opts: { includeArchive?: boolean } = {}): Promise<PrimHit | null> {
  const includeArchive = opts.includeArchive === true;
  const root = volumePath('primitives');
  if (!existsSync(root)) return null;
  let h = hitInDir(root, id);
  if (h) return { ...h, dir: root, category: '' };
  let lvl1;
  try { lvl1 = await readdir(root, { withFileTypes: true }); } catch { return null; }
  for (const cat of lvl1) {
    if (!cat.isDirectory()) continue;
    if (!includeArchive && cat.name === 'archive') continue;
    const catDir = join(root, cat.name);
    h = hitInDir(catDir, id);
    if (h) return { ...h, dir: catDir, category: cat.name };
    let lvl2;
    try { lvl2 = await readdir(catDir, { withFileTypes: true }); } catch { continue; }
    for (const fam of lvl2) {
      if (!fam.isDirectory()) continue;
      const famDir = join(catDir, fam.name);
      h = hitInDir(famDir, id);
      if (h) return { ...h, dir: famDir, category: cat.name, family: fam.name };
      // 3rd-level walk: subfolders inside a family (e.g. drill_pipe/tests/).
      // Lets users create per-family sub-buckets via the sidebar 📁+ button.
      let lvl3;
      try { lvl3 = await readdir(famDir, { withFileTypes: true }); } catch { continue; }
      for (const sub of lvl3) {
        if (!sub.isDirectory()) continue;
        const subDir = join(famDir, sub.name);
        h = hitInDir(subDir, id);
        if (h) return { ...h, dir: subDir, category: cat.name, family: fam.name, subfolder: sub.name };
      }
    }
  }
  return null;
}

/** Remove EVERY on-disk form of `id` directly inside `dir` — all flat files
 *  (`<id>.{prim,exp,rev,asm}.ts`) and the legacy folder (`<id>/`). Best-effort;
 *  used to clear a prior copy before archive/restore writes a fresh one. */
export async function removeIdForms(dir: string, id: string): Promise<void> {
  for (const kind of PRIM_KINDS) {
    const p = join(dir, `${id}.${kind}.ts`);
    if (existsSync(p)) { try { await rm(p, { force: true }); } catch { /* best-effort */ } }
  }
  const folder = join(dir, id);
  if (existsSync(folder)) { try { await rm(folder, { recursive: true, force: true }); } catch { /* best-effort */ } }
}

export interface PrimEntryLite { id: string; kind: PrimKind; legacy: boolean }

/** Enumerate entities directly inside `dir` (one level): new flat files PLUS
 *  legacy <id>/source.ts folders. A new flat file wins over a legacy folder of
 *  the same id (so a half-migrated dir lists each id once). */
export async function listEntitiesIn(dir: string): Promise<PrimEntryLite[]> {
  let ents;
  try { ents = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out = new Map<string, PrimEntryLite>();
  for (const e of ents) {
    if (!e.isFile()) continue;
    const m = primIdFromFile(e.name);
    if (m) out.set(m.id, { id: m.id, kind: m.kind, legacy: false });
  }
  for (const e of ents) {
    if (!e.isDirectory() || out.has(e.name)) continue;
    if (existsSync(join(dir, e.name, 'source.ts'))) out.set(e.name, { id: e.name, kind: 'prim', legacy: true });
  }
  return [...out.values()];
}

// ── Profiles ────────────────────────────────────────────────────────────────

export interface ProfileHit {
  path: string;
  legacy: boolean;
  /** new-scheme mid-extension, or null for a legacy folder. */
  ext: 'prvl' | 'prex' | null;
}

const profilesRoot = () => volumePath(join('primitives', 'profiles'));

/** Resolve a profile id → its module file (new flat .prvl/.prex, else legacy
 *  <id>/source.ts). The legacy `profile.json` sidecar is read separately. */
export function findProfile(id: string): ProfileHit | null {
  const base = profilesRoot();
  for (const ext of ['prvl', 'prex'] as const) {
    const p = join(base, `${id}.${ext}.ts`);
    if (existsSync(p)) return { path: p, legacy: false, ext };
  }
  const legacy = join(base, id, 'source.ts');
  if (existsSync(legacy)) return { path: legacy, legacy: true, ext: null };
  return null;
}

/** Where to WRITE a profile module — new flat file keyed by axis. */
export function profileFilePath(id: string, set: string): string {
  return join(profilesRoot(), `${id}.${set === 'cartesian' ? 'prex' : 'prvl'}.ts`);
}

/** Legacy folder for a profile id (for cleanup on save). */
export function legacyProfileDir(id: string): string {
  return join(profilesRoot(), id);
}

/** Parse a new-scheme profile file name → { id, ext }, or null. */
export function profileIdFromFile(name: string): { id: string; ext: 'prvl' | 'prex' } | null {
  const m = PROFILE_EXT_RE.exec(name);
  if (!m) return null;
  return { id: name.slice(0, m.index), ext: m[1].toLowerCase() as 'prvl' | 'prex' };
}
