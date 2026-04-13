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

import { readFileSync, existsSync, writeFileSync, renameSync } from 'fs';
import { hammingDistance } from './phash';

export interface CatalogMeta {
  catalog: 'HAL_PACKERS' | 'HAL_WPS';
  page?: number;
  tool_name?: string;
  original_path?: string;
}

export interface CacheRecord {
  id: string;
  hash: string;
  component_id: string;
  params: Record<string, number>;
  image_b64: string;
  source: 'seed' | 'refined' | 'manual' | 'catalog' | 'correction';
  created: string;
  uses: number;
  accepted: number;
  // v2 fields
  wrong_match: number;
  version: 2;
  catalog_meta?: CatalogMeta;
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
      .map((l) => {
        const r = JSON.parse(l) as Partial<CacheRecord>;
        // Upgrade v1 → v2 in memory: fill in missing fields with safe defaults.
        if (r.wrong_match === undefined) r.wrong_match = 0;
        if (r.version === undefined) r.version = 2;
        return r as CacheRecord;
      });
    this.loaded = true;
  }

  /** Append a new record (persists immediately via atomic rewrite). */
  async append(record: CacheRecord): Promise<void> {
    // Defensive defaults: ensure v2 fields are present even if caller omitted them.
    if (record.wrong_match === undefined) record.wrong_match = 0;
    if (record.version === undefined) record.version = 2;
    this.records.push(record);
    this.rewriteFile();
  }

  incrementWrongMatch(id: string): void {
    const rec = this.records.find((r) => r.id === id);
    if (rec) {
      rec.wrong_match++;
      this.rewriteFile();
    }
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
    const bySource: Record<string, number> = {
      seed: 0,
      refined: 0,
      manual: 0,
      catalog: 0,
      correction: 0,
    };
    let totalUses = 0;
    let totalAccepted = 0;
    let totalWrong = 0;
    for (const r of this.records) {
      bySource[r.source] = (bySource[r.source] || 0) + 1;
      totalUses += r.uses;
      totalAccepted += r.accepted;
      totalWrong += r.wrong_match || 0;
    }
    return {
      total: this.records.length,
      bySource,
      totalUses,
      totalAccepted,
      totalWrongMatch: totalWrong,
      avgUses: this.records.length > 0 ? totalUses / this.records.length : 0,
    };
  }

  getAll(): readonly CacheRecord[] {
    return this.records;
  }

  /** Atomic write: write to tmp file, then rename. Prevents corruption on crash. */
  private rewriteFile(): void {
    const text = this.records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, this.path);
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
