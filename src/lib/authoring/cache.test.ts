import { describe, it, expect, beforeEach } from 'vitest';
import { AuthoredCache } from './cache';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AuthoredComponent } from './schema';

function tempCachePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'authored-cache-'));
  return join(dir, 'authored.jsonl');
}

function makeAuthored(overrides: Partial<AuthoredComponent> = {}): AuthoredComponent {
  return {
    id: 'test_component',
    name: 'Test',
    description: '',
    tags: [],
    version: 1,
    created: new Date().toISOString(),
    source: 'manual',
    parts: [{ id: 'p0', prim: 'hollow_cylinder', params: { od: 2.5, wall: 0.3, length: 4 } }],
    ops: [],
    ...overrides,
  };
}

describe('AuthoredCache', () => {
  let path: string;
  let cache: AuthoredCache;

  beforeEach(async () => {
    path = tempCachePath();
    cache = new AuthoredCache(path);
    await cache.load();
  });

  it('handles missing file on first load', async () => {
    expect(cache.getAll()).toHaveLength(0);
    expect(cache.stats().total).toBe(0);
  });

  it('appends a record and persists it to disk atomically', async () => {
    const rec = makeAuthored({ id: 'r1' });
    await cache.append(rec);
    expect(cache.getAll()).toHaveLength(1);
    expect(cache.getById('r1')?.parts[0].prim).toBe('hollow_cylinder');

    // Verify the file was written and is valid JSONL.
    const text = readFileSync(path, 'utf-8');
    const lines = text.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).id).toBe('r1');
  });

  it('upserts: appending with an existing id replaces that record', async () => {
    await cache.append(makeAuthored({ id: 'r1', name: 'First' }));
    await cache.append(makeAuthored({ id: 'r1', name: 'Second' }));
    expect(cache.getAll()).toHaveLength(1);
    expect(cache.getById('r1')?.name).toBe('Second');
  });

  it('round-trips records through disk reload', async () => {
    await cache.append(makeAuthored({ id: 'r1' }));
    await cache.append(makeAuthored({ id: 'r2', source: 'claude_suggested' }));

    const fresh = new AuthoredCache(path);
    await fresh.load();
    expect(fresh.getAll()).toHaveLength(2);
    expect(fresh.stats().bySource.manual).toBe(1);
    expect(fresh.stats().bySource.claude_suggested).toBe(1);
  });

  it('findSimilar stub returns most-recent K records sorted desc', async () => {
    await cache.append(makeAuthored({ id: 'a', created: '2026-01-01T00:00:00Z' }));
    await cache.append(makeAuthored({ id: 'b', created: '2026-03-01T00:00:00Z' }));
    await cache.append(makeAuthored({ id: 'c', created: '2026-02-01T00:00:00Z' }));

    const top = cache.findSimilar(null, 2);
    expect(top.map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('findSimilarByHash ranks by hamming distance and ignores records without a hash', async () => {
    await cache.append(makeAuthored({ id: 'close', hash: '0000000000000000' }));
    await cache.append(makeAuthored({ id: 'far', hash: 'ffffffffffffffff' }));
    await cache.append(makeAuthored({ id: 'no_hash' })); // should be excluded

    const top = cache.findSimilarByHash('0000000000000001', 5);
    expect(top.map((r) => r.id)).toEqual(['close', 'far']);
    expect(top.find((r) => r.id === 'no_hash')).toBeUndefined();
  });
});
