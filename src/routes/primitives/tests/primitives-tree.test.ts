import { describe, it, expect } from 'vitest';
import {
  type FolderNode,
  isMoveTarget,
  topLevelOf,
  ensureFolderPath,
  nodeAt,
  isPathAtOrUnder,
  folderMoveInto,
  resolveDropTargetFolder,
} from '../primitives-tree';

/** Minimal tree: root → basic (+ basic/spirals), completions/svtc, archive. */
function sampleTree(): FolderNode {
  return {
    name: '', path: '', parts: [], children: [
      { name: 'basic', path: 'basic', parts: [], children: [
        { name: 'spirals', path: 'basic/spirals', parts: [], children: [] },
      ] },
      { name: 'completions', path: 'completions', parts: [], children: [
        { name: 'svtc', path: 'completions/svtc', parts: [], children: [] },
      ] },
      { name: 'archive', path: 'archive', parts: [], children: [] },
    ],
  };
}

describe('isMoveTarget', () => {
  it('accepts valid folder paths', () => {
    expect(isMoveTarget('basic', '')).toBe(true);
    expect(isMoveTarget('completions/svtc', '')).toBe(true);
    expect(isMoveTarget('basic/spirals/x', '')).toBe(true); // 3 segments = max depth
  });
  it('excludes the source folder (move) but allows it when excludeDir is empty (copy)', () => {
    expect(isMoveTarget('basic', 'basic')).toBe(false);
    expect(isMoveTarget('basic', '')).toBe(true);
  });
  it('rejects the root, reserved names, and over-deep paths', () => {
    expect(isMoveTarget('', '')).toBe(false);
    expect(isMoveTarget('profiles', '')).toBe(false);
    expect(isMoveTarget('stdlib', '')).toBe(false);
    expect(isMoveTarget('stdstale/r_extrude', '')).toBe(false);
    expect(isMoveTarget('a/b/c/d', '')).toBe(false); // 4 segments
  });
});

describe('isPathAtOrUnder', () => {
  it('is true for the folder itself and any descendant', () => {
    expect(isPathAtOrUnder('basic', 'basic')).toBe(true);
    expect(isPathAtOrUnder('basic', 'basic/spirals')).toBe(true);
    expect(isPathAtOrUnder('basic', 'basic/spirals/x')).toBe(true);
  });
  it('is segment-aware — a sibling prefix is NOT a descendant', () => {
    expect(isPathAtOrUnder('basic', 'basicfoo')).toBe(false);
    expect(isPathAtOrUnder('basic/foo', 'basic/foobar')).toBe(false);
  });
  it('root contains everything', () => {
    expect(isPathAtOrUnder('', 'anything')).toBe(true);
  });
});

describe('folderMoveInto', () => {
  it('nests a folder under a target — dest = target/leaf', () => {
    expect(folderMoveInto('basic/spirals', 'completions')).toEqual({ ok: true, dest: 'completions/spirals' });
    expect(folderMoveInto('mytools', 'basic')).toEqual({ ok: true, dest: 'basic/mytools' });
  });
  it('rejects dropping a folder onto itself or into its own subtree', () => {
    expect(folderMoveInto('basic', 'basic').ok).toBe(false);
    expect(folderMoveInto('basic', 'basic/spirals').ok).toBe(false);
  });
  it('reports the drop-onto-current-parent no-op as "already there"', () => {
    // basic/spirals dropped back onto basic → dest basic/spirals === from
    expect(folderMoveInto('basic/spirals', 'basic')).toMatchObject({ ok: false, reason: 'already there' });
  });
  it('refuses to move a built-in root folder', () => {
    expect(folderMoveInto('basic', 'completions').ok).toBe(false);
    expect(folderMoveInto('completions', 'basic').ok).toBe(false);
    expect(folderMoveInto('archive', 'basic').ok).toBe(false);
  });
  it('refuses internal buckets as source or target', () => {
    expect(folderMoveInto('stdlib/x', 'basic').ok).toBe(false);
    expect(folderMoveInto('basic/spirals', 'archive').ok).toBe(false);
    expect(folderMoveInto('basic/spirals', 'stdstale').ok).toBe(false);
  });
  it('enforces the 3-segment depth limit', () => {
    // basic/a/b (3) into completions/x → completions/x/b would be 3 (ok),
    // but basic/a/b into completions/x/y → 4 segments (rejected upstream: target is 3 already)
    expect(folderMoveInto('basic/a/b', 'completions/x').ok).toBe(true);
    expect(folderMoveInto('basic/a', 'completions/x/y')).toMatchObject({ ok: false }); // target already 3-deep
  });
  it('rejects malformed / empty paths', () => {
    expect(folderMoveInto('', 'basic').ok).toBe(false);
    expect(folderMoveInto('basic/spirals', '').ok).toBe(false);
    expect(folderMoveInto('Bad Name', 'basic').ok).toBe(false);
  });
});

describe('resolveDropTargetFolder', () => {
  it('a file row targets its ENCLOSING folder (Explorer-style body drop)', () => {
    expect(resolveDropTargetFolder({ kind: 'file', parentPath: 'basic' })).toBe('basic');
    expect(resolveDropTargetFolder({ kind: 'file', parentPath: 'completions/svtc' })).toBe('completions/svtc');
  });
  it('a folder row targets the folder itself — most specific folder wins', () => {
    expect(resolveDropTargetFolder({ kind: 'folder', path: 'basic/spirals' })).toBe('basic/spirals');
    expect(resolveDropTargetFolder({ kind: 'folder', path: 'completions' })).toBe('completions');
  });
});

describe('topLevelOf', () => {
  it('returns the first path segment, or empty for the root', () => {
    expect(topLevelOf('completions/svtc/sub')).toBe('completions');
    expect(topLevelOf('basic')).toBe('basic');
    expect(topLevelOf('')).toBe('');
  });
});

describe('ensureFolderPath', () => {
  it('inserts a brand-new nested folder, creating intermediate nodes', () => {
    const t = sampleTree();
    expect(ensureFolderPath(t, 'completions/packers')).toBe(true);
    expect(nodeAt(t, 'completions/packers')).toMatchObject({ name: 'packers', path: 'completions/packers' });
  });
  it('creates missing intermediate segments', () => {
    const t = sampleTree();
    expect(ensureFolderPath(t, 'newtop/child')).toBe(true);
    expect(nodeAt(t, 'newtop')).not.toBeNull();
    expect(nodeAt(t, 'newtop/child')).toMatchObject({ path: 'newtop/child' });
  });
  it('is a no-op (returns false) when the path already exists', () => {
    const t = sampleTree();
    expect(ensureFolderPath(t, 'basic/spirals')).toBe(false);
    // basic still has exactly one child
    expect(nodeAt(t, 'basic')!.children).toHaveLength(1);
  });
  it('returns false for an empty path', () => {
    expect(ensureFolderPath(sampleTree(), '')).toBe(false);
  });
});
