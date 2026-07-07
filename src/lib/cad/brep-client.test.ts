/**
 * brep-client.test — headless guard for the client-side OCCT scaffold
 * (docs/plans/brep-client-side.md §7). Proves the feature is default OFF and the
 * stub contract holds, so the scaffold is zero-behaviour-change until P1.
 *
 * The vitest env is `node`, which may expose a NON-functional `localStorage`
 * global — so we stub a minimal in-memory Storage to exercise the flag reader
 * deterministically regardless of the runtime.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  BREP_CLIENT_FLAG,
  BREP_CLIENT_NOT_READY,
  brepClientEnabled,
  runBrepClient,
} from './brep-client';

function stubStorage(): void {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  });
}

describe('brep-client scaffold', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is default OFF when the flag is unset', () => {
    stubStorage();
    expect(brepClientEnabled()).toBe(false);
  });

  it('is OFF (never throws) when localStorage is unavailable (SSR-safe)', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(brepClientEnabled()).toBe(false);
  });

  it('turns ON only when explicitly set to "1"', () => {
    stubStorage();
    localStorage.setItem(BREP_CLIENT_FLAG, '0');
    expect(brepClientEnabled()).toBe(false);
    localStorage.setItem(BREP_CLIENT_FLAG, '1');
    expect(brepClientEnabled()).toBe(true);
  });

  it('runBrepClient rejects with BREP_CLIENT_NOT_READY (forces server fallback)', async () => {
    await expect(
      runBrepClient({ source: 'export function x(){}', scriptHash: 'abc', paramValues: {} }),
    ).rejects.toThrow(BREP_CLIENT_NOT_READY);
  });
});
