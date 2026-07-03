import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  serializeTabs,
  restoreTabs,
  saveTabs,
  loadTabs,
  clearTabs,
  type CachedTabs,
} from './workspace-cache';

describe('workspace-cache tab (de)serialization — pure', () => {
  it('round-trips a tab state through serialize → restore', () => {
    const ids = ['01-vertical', 'ws:field-A/well-1.wson', 'ws:field-A/well-2.wson'];
    const restored = restoreTabs(serializeTabs(ids, 2));
    expect(restored).toEqual<CachedTabs>({ ids, activeIdx: 2 });
  });

  it('returns null for empty / missing / garbage input', () => {
    expect(restoreTabs(null)).toBeNull();
    expect(restoreTabs(undefined)).toBeNull();
    expect(restoreTabs('')).toBeNull();
    expect(restoreTabs('not json')).toBeNull();
    expect(restoreTabs('{"foo":1}')).toBeNull();
    expect(restoreTabs(serializeTabs([], 0))).toBeNull();
  });

  it('drops non-string ids', () => {
    const raw = JSON.stringify({ v: 1, ids: ['a', 42, null, 'b'], activeIdx: 0 });
    expect(restoreTabs(raw)?.ids).toEqual(['a', 'b']);
  });

  it('clamps an out-of-range or non-integer activeIdx to 0', () => {
    const ids = ['a', 'b'];
    expect(restoreTabs(serializeTabs(ids, 99))?.activeIdx).toBe(0);
    expect(restoreTabs(serializeTabs(ids, -1))?.activeIdx).toBe(0);
    expect(restoreTabs(JSON.stringify({ ids, activeIdx: 'x' }))?.activeIdx).toBe(0);
  });
});

describe('workspace-cache tab persistence — localStorage round-trip', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal('window', {} as unknown as Window);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    } as unknown as Storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saveTabs then loadTabs restores the same state', () => {
    saveTabs(['01-vertical', 'ws:a/b.wson'], 1);
    expect(loadTabs()).toEqual<CachedTabs>({ ids: ['01-vertical', 'ws:a/b.wson'], activeIdx: 1 });
  });

  it('loadTabs is null before anything is saved', () => {
    expect(loadTabs()).toBeNull();
  });

  it('clearTabs removes the persisted state', () => {
    saveTabs(['a'], 0);
    clearTabs();
    expect(loadTabs()).toBeNull();
  });

  it('saveTabs swallows a throwing setItem (quota / private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    } as unknown as Storage);
    expect(() => saveTabs(['a'], 0)).not.toThrow();
  });
});
