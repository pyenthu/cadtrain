import { describe, it, expect } from 'vitest';
import {
  normalizePath,
  makeRef,
  refFromNode,
  flattenFiles,
  resolveRefNode,
  linkStatus,
  type FileNode,
} from './workspace-tree';

// A small workspace fixture:
//   root/
//     well-a.wson
//     logs/
//       run1.las
//       run1.dlis
//     archive/
//       run1.las        (duplicate NAME under a different path)
const tree: FileNode = {
  name: 'SAMPLE',
  kind: 'dir',
  path: '',
  handle: { k: 'root' },
  children: [
    { name: 'well-a.wson', kind: 'file', path: 'well-a.wson', handle: { k: 'wson' } },
    {
      name: 'logs',
      kind: 'dir',
      path: 'logs',
      children: [
        { name: 'run1.las', kind: 'file', path: 'logs/run1.las', handle: { k: 'las' } },
        { name: 'run1.dlis', kind: 'file', path: 'logs/run1.dlis', handle: { k: 'dlis' } },
      ],
    },
    {
      name: 'archive',
      kind: 'dir',
      path: 'archive',
      children: [{ name: 'run1.las', kind: 'file', path: 'archive/run1.las', handle: { k: 'las2' } }],
    },
  ],
};

describe('normalizePath', () => {
  it('strips leading ./ and /, collapses \\ and empty segments', () => {
    expect(normalizePath('./logs//run1.las')).toBe('logs/run1.las');
    expect(normalizePath('/well-a.wson')).toBe('well-a.wson');
    expect(normalizePath('logs\\run1.dlis')).toBe('logs/run1.dlis');
    expect(normalizePath('')).toBe('');
    expect(normalizePath('a/./b/')).toBe('a/b');
  });
});

describe('makeRef / refFromNode', () => {
  it('normalizes the path and omits falsy type', () => {
    expect(makeRef('a.wson', './a.wson')).toEqual({ name: 'a.wson', path: 'a.wson' });
    expect(makeRef('a.wson', 'x//a.wson', '.wson')).toEqual({ name: 'a.wson', path: 'x/a.wson', type: '.wson' });
  });
  it('builds a ref straight from a node', () => {
    const node = { name: 'run1.las', path: 'logs/run1.las' };
    expect(refFromNode(node, 'las')).toEqual({ name: 'run1.las', path: 'logs/run1.las', type: 'las' });
  });
});

describe('flattenFiles', () => {
  it('returns files only, sorted by path; dirs excluded', () => {
    const files = flattenFiles(tree);
    expect(files.map((f) => f.path)).toEqual(['archive/run1.las', 'logs/run1.dlis', 'logs/run1.las', 'well-a.wson']);
  });
  it('is null-safe', () => {
    expect(flattenFiles(null)).toEqual([]);
    expect(flattenFiles(undefined)).toEqual([]);
  });
});

describe('resolveRefNode', () => {
  it('matches by exact path first', () => {
    const n = resolveRefNode(tree, makeRef('run1.las', 'logs/run1.las'));
    expect((n?.handle as any)?.k).toBe('las');
  });
  it('tolerates a non-normalized stored path', () => {
    const n = resolveRefNode(tree, { name: 'run1.las', path: './logs//run1.las' });
    expect((n?.handle as any)?.k).toBe('las');
  });
  it('falls back to a UNIQUE base name when the path moved', () => {
    // well-a.wson only exists once → name fallback binds even though the path is stale.
    const n = resolveRefNode(tree, { name: 'well-a.wson', path: 'old/dir/well-a.wson' });
    expect((n?.handle as any)?.k).toBe('wson');
  });
  it('does NOT bind an AMBIGUOUS name (run1.las exists twice) when the path is unknown', () => {
    const n = resolveRefNode(tree, { name: 'run1.las', path: 'nowhere/run1.las' });
    expect(n).toBeNull();
  });
  it('returns null for a missing file and for an absent tree/ref', () => {
    expect(resolveRefNode(tree, { name: 'nope.las', path: 'nope.las' })).toBeNull();
    expect(resolveRefNode(null, makeRef('a', 'a'))).toBeNull();
    expect(resolveRefNode(tree, null)).toBeNull();
  });
});

describe('linkStatus', () => {
  it('linked when resolvable, missing when not, no-workspace without a tree', () => {
    expect(linkStatus(tree, makeRef('run1.dlis', 'logs/run1.dlis'))).toBe('linked');
    expect(linkStatus(tree, makeRef('gone.las', 'x/gone.las'))).toBe('missing');
    expect(linkStatus(null, makeRef('run1.dlis', 'logs/run1.dlis'))).toBe('no-workspace');
    expect(linkStatus(tree, null)).toBe('missing');
  });
});
