import { describe, it, expect } from 'vitest';
import {
  type FolderNode,
  isMoveTarget,
  topLevelOf,
  ensureFolderPath,
  nodeAt,
} from './primitives-tree';

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
