import { describe, it, expect, beforeEach } from 'vitest';
import { TrainingCache, type CacheRecord } from './cache';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function tempCachePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cachetest-'));
  return join(dir, 'cache.jsonl');
}

function makeRecord(overrides: Partial<CacheRecord> = {}): CacheRecord {
  return {
    id: 'r1',
    hash: 'aaaaaaaaaaaaaaaa',
    component_id: 'hollow_cylinder',
    params: { od: 2.5, wall: 0.3, length: 4 },
    image_b64: '',
    source: 'seed',
    created: new Date().toISOString(),
    uses: 0,
    accepted: 0,
    ...overrides,
  };
}

describe('TrainingCache', () => {
  let path: string;
  let cache: TrainingCache;

  beforeEach(async () => {
    path = tempCachePath();
    cache = new TrainingCache(path);
    await cache.load();
  });

  describe('load()', () => {
    it('handles missing file gracefully', async () => {
      expect(cache.stats().total).toBe(0);
    });

    it('reads existing JSONL records', async () => {
      await cache.append(makeRecord());
      const fresh = new TrainingCache(path);
      await fresh.load();
      expect(fresh.stats().total).toBe(1);
    });
  });

  describe('append()', () => {
    it('adds a record and persists it', async () => {
      await cache.append(makeRecord({ id: 'r1' }));
      await cache.append(makeRecord({ id: 'r2' }));
      expect(cache.stats().total).toBe(2);
      expect(existsSync(path)).toBe(true);
    });

    it('persists writes atomically (no .tmp left behind)', async () => {
      await cache.append(makeRecord({ id: 'r1' }));
      // After a successful write the tmp file should be cleaned up
      expect(existsSync(`${path}.tmp`)).toBe(false);
    });

    it('writes valid JSONL format', async () => {
      await cache.append(makeRecord({ id: 'r1' }));
      const text = readFileSync(path, 'utf-8');
      const lines = text.trim().split('\n');
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.id).toBe('r1');
    });
  });

  describe('findSimilar()', () => {
    it('returns empty array when cache is empty', () => {
      expect(cache.findSimilar('ff00ff00ff00ff00', 5)).toEqual([]);
    });

    it('returns records ordered by hamming distance', async () => {
      await cache.append(makeRecord({ id: 'same', hash: 'ffffffffffffffff' }));
      await cache.append(makeRecord({ id: 'close', hash: 'fffffffffffffffe' }));
      await cache.append(makeRecord({ id: 'far', hash: '0000000000000000' }));

      const results = cache.findSimilar('ffffffffffffffff', 3);
      expect(results[0].id).toBe('same');
      expect(results[1].id).toBe('close');
      expect(results[2].id).toBe('far');
    });

    it('respects the k limit', async () => {
      for (let i = 0; i < 10; i++) {
        await cache.append(makeRecord({ id: `r${i}`, hash: 'aaaaaaaaaaaaaaaa' }));
      }
      expect(cache.findSimilar('aaaaaaaaaaaaaaaa', 3)).toHaveLength(3);
    });
  });

  describe('incrementUse()', () => {
    it('increments uses on matching records', async () => {
      await cache.append(makeRecord({ id: 'r1' }));
      cache.incrementUse(['r1']);
      const records = cache.getAll();
      expect(records[0].uses).toBe(1);
    });

    it('persists the change after reload', async () => {
      await cache.append(makeRecord({ id: 'r1' }));
      cache.incrementUse(['r1']);
      const fresh = new TrainingCache(path);
      await fresh.load();
      expect(fresh.getAll()[0].uses).toBe(1);
    });

    it('is a no-op for unknown ids', async () => {
      await cache.append(makeRecord({ id: 'r1' }));
      cache.incrementUse(['unknown']);
      expect(cache.getAll()[0].uses).toBe(0);
    });
  });

  describe('incrementAccepted()', () => {
    it('increments accepted counter', async () => {
      await cache.append(makeRecord({ id: 'r1' }));
      cache.incrementAccepted('r1');
      expect(cache.getAll()[0].accepted).toBe(1);
    });
  });

  describe('stats()', () => {
    it('groups by source', async () => {
      await cache.append(makeRecord({ id: '1', source: 'seed' }));
      await cache.append(makeRecord({ id: '2', source: 'seed' }));
      await cache.append(makeRecord({ id: '3', source: 'refined' }));
      const s = cache.stats();
      expect(s.total).toBe(3);
      expect(s.bySource.seed).toBe(2);
      expect(s.bySource.refined).toBe(1);
    });

    it('computes totals and averages', async () => {
      await cache.append(makeRecord({ id: '1', uses: 5, accepted: 2 }));
      await cache.append(makeRecord({ id: '2', uses: 3, accepted: 1 }));
      const s = cache.stats();
      expect(s.totalUses).toBe(8);
      expect(s.totalAccepted).toBe(3);
      expect(s.avgUses).toBe(4);
    });
  });
});
