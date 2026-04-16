/**
 * Persistent JSONL cache for authored components.
 *
 * Mirrors the pattern of src/lib/training/cache.ts — one record per line,
 * atomic rewrites via temp-file + rename, singleton per path so multiple
 * route handlers share the same in-memory state. Stores AuthoredComponent
 * specs (including their optional thumbnail + pHash) so the library
 * browser can list them and /api/author/suggest can use them as RAG
 * few-shot examples in a later phase.
 */

import { readFileSync, existsSync, writeFileSync, renameSync } from 'fs';
import { hammingDistance } from '../training/phash';
import type { AuthoredComponent } from './schema';

export class AuthoredCache {
  private records: AuthoredComponent[] = [];
  private loaded = false;

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    if (!existsSync(this.path)) {
      this.loaded = true;
      return;
    }
    const text = readFileSync(this.path, 'utf-8');
    this.records = text
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as AuthoredComponent);
    this.loaded = true;
  }

  /** Append a new record or replace an existing one with the same id. */
  async append(record: AuthoredComponent): Promise<void> {
    const existingIdx = this.records.findIndex((r) => r.id === record.id);
    if (existingIdx >= 0) {
      this.records[existingIdx] = record;
    } else {
      this.records.push(record);
    }
    this.rewriteFile();
  }

  getById(id: string): AuthoredComponent | undefined {
    return this.records.find((r) => r.id === id);
  }

  getAll(): readonly AuthoredComponent[] {
    return this.records;
  }

  /**
   * Stub retrieval for Phase 3. Returns the most recent K records
   * (by `created` timestamp descending). Phase 4 replaces this with
   * real pHash + text similarity when /api/author/suggest is wired up.
   */
  findSimilar(_queryHash: string | null, k: number = 5): AuthoredComponent[] {
    const sorted = [...this.records].sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''));
    return sorted.slice(0, k);
  }

  /**
   * Phase 4 will call this with a real query hash once pHash-based
   * retrieval is wired. Kept as an explicit method so Phase 3 callers
   * don't need to know the internals.
   */
  findSimilarByHash(queryHash: string, k: number = 5): AuthoredComponent[] {
    const scored = this.records
      .filter((r) => typeof r.hash === 'string')
      .map((r) => ({ record: r, d: hammingDistance(queryHash, r.hash as string) }));
    scored.sort((a, b) => a.d - b.d);
    return scored.slice(0, k).map((s) => s.record);
  }

  stats() {
    const bySource: Record<string, number> = { manual: 0, claude_suggested: 0, claude_refined: 0 };
    for (const r of this.records) {
      bySource[r.source] = (bySource[r.source] || 0) + 1;
    }
    return {
      total: this.records.length,
      bySource,
    };
  }

  /** Atomic rewrite: write to tmp file, then rename. */
  private rewriteFile(): void {
    const text = this.records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, this.path);
  }
}

const instances = new Map<string, AuthoredCache>();

export async function getAuthoredCache(path: string): Promise<AuthoredCache> {
  if (!instances.has(path)) {
    const cache = new AuthoredCache(path);
    await cache.load();
    instances.set(path, cache);
  }
  return instances.get(path)!;
}
