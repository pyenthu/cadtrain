import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  serializeTabs,
  restoreTabs,
  saveTabs,
  loadTabs,
  clearTabs,
  closeTab,
  dropWorkspaceTabs,
  type CachedTabs,
  type OpenTab,
} from './workspace-cache';

// A realistic mix: one bundled sample + four unhydrated `ws:` placeholder tabs
// (the "Reopen SAMPLE" state where the folder has not been re-granted, so the
// workspace files aren't loaded yet). Keys are unique; ids share a shape.
const mixed = (): OpenTab[] => [
  { id: '01-vertical', key: 1 },
  { id: 'ws:SAMPLE/well-1.wson', key: 2 },
  { id: 'ws:SAMPLE/well-2.wson', key: 3 },
  { id: 'ws:SAMPLE/well-3.wson', key: 4 },
  { id: 'ws:SAMPLE/well-4.wson', key: 5 },
];

describe('closeTab — pure tab-list close', () => {
  it('removes EXACTLY the keyed tab and preserves ws: placeholder siblings', () => {
    // The reported bug: closing ONE tab wiped every unhydrated ws: tab. This is
    // the regression guard — closing the sample must leave all four ws: tabs.
    const { tabs, activeKey } = closeTab(mixed(), 1, 1);
    expect(tabs.map((t) => t.id)).toEqual([
      'ws:SAMPLE/well-1.wson',
      'ws:SAMPLE/well-2.wson',
      'ws:SAMPLE/well-3.wson',
      'ws:SAMPLE/well-4.wson',
    ]);
    expect(tabs).toHaveLength(4);
    // Closed the leftmost active tab → active steps to the new first tab.
    expect(activeKey).toBe(2);
  });

  it('closing one ws: placeholder leaves the other three (and the sample) intact', () => {
    const { tabs, activeKey } = closeTab(mixed(), 3, 3);
    expect(tabs.map((t) => t.key)).toEqual([1, 2, 4, 5]);
    // Closed the active middle tab → active moves to the LEFT neighbour.
    expect(activeKey).toBe(2);
  });

  it('closing the active LAST tab moves active to the left neighbour', () => {
    const { activeKey } = closeTab(mixed(), 5, 5);
    expect(activeKey).toBe(4);
  });

  it('closing a NON-active tab leaves activeKey unchanged', () => {
    const { tabs, activeKey } = closeTab(mixed(), 5, 2);
    expect(tabs.map((t) => t.key)).toEqual([1, 3, 4, 5]);
    expect(activeKey).toBe(5);
  });

  it('closing the only tab empties the list and nulls activeKey', () => {
    const { tabs, activeKey } = closeTab([{ id: '01-vertical', key: 1 }], 1, 1);
    expect(tabs).toEqual([]);
    expect(activeKey).toBeNull();
  });

  it('an unknown key is a no-op and returns the SAME array reference', () => {
    const input = mixed();
    const res = closeTab(input, 2, 999);
    expect(res.tabs).toBe(input); // same ref → caller skips reassignment
    expect(res.activeKey).toBe(2);
  });
});

describe('dropWorkspaceTabs — pure workspace clear', () => {
  it('drops every ws: tab and keeps the samples', () => {
    const { tabs } = dropWorkspaceTabs(mixed(), 1);
    expect(tabs.map((t) => t.id)).toEqual(['01-vertical']);
  });

  it('when the active tab was a ws: tab, active falls back to the first survivor', () => {
    const { tabs, activeKey } = dropWorkspaceTabs(mixed(), 4);
    expect(tabs).toHaveLength(1);
    expect(activeKey).toBe(1); // the surviving sample
  });

  it('when the active tab is a kept sample, activeKey is unchanged', () => {
    const { activeKey } = dropWorkspaceTabs(mixed(), 1);
    expect(activeKey).toBe(1);
  });

  it('dropping all tabs (no samples) nulls activeKey', () => {
    const wsOnly: OpenTab[] = [
      { id: 'ws:a.wson', key: 7 },
      { id: 'ws:b.wson', key: 8 },
    ];
    const { tabs, activeKey } = dropWorkspaceTabs(wsOnly, 7);
    expect(tabs).toEqual([]);
    expect(activeKey).toBeNull();
  });

  it('no ws: tabs → no-op, same array reference', () => {
    const samples: OpenTab[] = [
      { id: '01-vertical', key: 1 },
      { id: '02-deviated', key: 2 },
    ];
    const res = dropWorkspaceTabs(samples, 2);
    expect(res.tabs).toBe(samples);
    expect(res.activeKey).toBe(2);
  });
});

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
