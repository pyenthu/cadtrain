/**
 * Persistent training cache for VLM retrieval-augmented identification.
 *
 * JSONL on disk — each line is a self-contained record with:
 *   - perceptual hash (for similarity search)
 *   - component id + params (ground truth)
 *   - thumbnail image base64 (for few-shot prompts)
 *
 * Append-only: new records from seed data + user feedback.
 */

import { readFileSync, existsSync, appendFileSync, writeFileSync } from 'fs';
import { hammingDistance } from './phash';

export interface CacheRecord {
  id: string;
  hash: string;
  component_id: string;
  params: Record<string, number>;
  image_b64: string;
  source: 'seed' | 'refined' | 'manual';
  created: string;
  uses: number;
  accepted: number;
}

export class TrainingCache {
  private records: CacheRecord[] = [];
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
      .map((l) => JSON.parse(l) as CacheRecord);
    this.loaded = true;
  }

  /** Append a new record (persists immediately). */
  async append(record: CacheRecord): Promise<void> {
    this.records.push(record);
    appendFileSync(this.path, JSON.stringify(record) + '\n');
  }

  /** Find top-K most similar records by Hamming distance. */
  findSimilar(hash: string, k: number = 5): CacheRecord[] {
    if (!this.records.length) return [];
    const scored = this.records.map((r) => ({
      record: r,
      distance: hammingDistance(hash, r.hash),
    }));
    scored.sort((a, b) => a.distance - b.distance);
    return scored.slice(0, k).map((s) => s.record);
  }

  /** Increment `uses` counter (best-effort, rewrites the whole file). */
  incrementUse(ids: string[]): void {
    let changed = false;
    for (const id of ids) {
      const rec = this.records.find((r) => r.id === id);
      if (rec) {
        rec.uses++;
        changed = true;
      }
    }
    if (changed) this.rewriteFile();
  }

  incrementAccepted(id: string): void {
    const rec = this.records.find((r) => r.id === id);
    if (rec) {
      rec.accepted++;
      this.rewriteFile();
    }
  }

  /** Summary statistics. */
  stats() {
    const bySource: Record<string, number> = { seed: 0, refined: 0, manual: 0 };
    let totalUses = 0;
    let totalAccepted = 0;
    for (const r of this.records) {
      bySource[r.source] = (bySource[r.source] || 0) + 1;
      totalUses += r.uses;
      totalAccepted += r.accepted;
    }
    return {
      total: this.records.length,
      bySource,
      totalUses,
      totalAccepted,
      avgUses: this.records.length > 0 ? totalUses / this.records.length : 0,
    };
  }

  getAll(): readonly CacheRecord[] {
    return this.records;
  }

  private rewriteFile(): void {
    const text = this.records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    writeFileSync(this.path, text);
  }
}

// Singleton instance keyed by path
const instances = new Map<string, TrainingCache>();

export async function getCache(path: string): Promise<TrainingCache> {
  if (!instances.has(path)) {
    const cache = new TrainingCache(path);
    await cache.load();
    instances.set(path, cache);
  }
  return instances.get(path)!;
}
