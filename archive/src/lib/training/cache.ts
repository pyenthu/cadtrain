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
import { cosineSim, hybridScore } from './embed';

export interface CatalogMeta {
  catalog: 'HAL_PACKERS' | 'HAL_WPS';
  page?: number;
  tool_name?: string;
  original_path?: string;
}

export interface CacheRecord {
  id: string;
  hash: string;
  // 512-dim CLIP embedding (Xenova/clip-vit-base-patch32). Optional for
  // backward compat with pre-migration records — those rank by pHash only
  // until scripts/migrate_to_clip.ts has run over the cache.
  embedding?: number[];
  component_id: string;
  // Optional taxonomy hint used by hybridScore. Not currently populated
  // on seed records; reserved for future backfill.
  component_category?: string;
  // Widened from number-only because synthetic records carry categorical
  // params like `profile: 'barrel'`, `pin_or_box: 'pin'`.
  params: Record<string, number | string>;
  image_b64: string;
  source: 'seed' | 'refined' | 'manual' | 'catalog' | 'correction' | 'synthetic';
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

  /**
   * Bulk append: push many records in memory, rewrite the file ONCE.
   * Use for large indexing jobs where per-record append() would be O(n²).
   */
  async appendBatch(records: CacheRecord[]): Promise<void> {
    for (const r of records) {
      if (r.wrong_match === undefined) r.wrong_match = 0;
      if (r.version === undefined) r.version = 2;
      this.records.push(r);
    }
    this.rewriteFile();
  }

  incrementWrongMatch(id: string): void {
    const rec = this.records.find((r) => r.id === id);
    if (rec) {
      rec.wrong_match++;
      this.rewriteFile();
    }
  }

  /**
   * Find top-K most similar records via hybrid CLIP + pHash scoring.
   *
   *   score = 0.75 * cosine(embedding)            ← primary semantic match
   *         + 0.15 * sameCategory                 ← packer ≠ tubing
   *         + 0.10 * (1 - hamming(pHash) / 64)    ← pixel-level tiebreaker
   *
   * Higher score = better. Pass an empty `queryEmbedding` to fall back to
   * pHash-only ranking (used during step-by-step migration before any
   * records have embeddings, and as a safe default).
   *
   * Tiebreaks: more `accepted` first, then fewer `wrong_match`, then
   * more `uses`. Feedback no longer dominates ranking — CLIP cosine is
   * a stronger signal than hand-counted feedback.
   */
  async findSimilar(
    queryEmbedding: number[],
    queryHash: string,
    k: number = 5,
    opts: { categoryHint?: string } = {},
  ): Promise<CacheRecord[]> {
    if (!this.records.length) return [];
    const useEmbedding = queryEmbedding.length > 0;
    const scored = this.records.map((r) => {
      const cos =
        useEmbedding && r.embedding && r.embedding.length === queryEmbedding.length
          ? cosineSim(queryEmbedding, r.embedding)
          : 0;
      const ham = hammingDistance(queryHash, r.hash);
      const sameCat = opts.categoryHint != null && r.component_category === opts.categoryHint;
      const score = hybridScore({ cosine: cos, sameCategory: sameCat, hammingPHash: ham });
      return { record: r, score };
    });
    scored.sort((a, b) => {
      if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
      // Tiebreak: more accepted, then fewer wrong_match, then more uses.
      const ac = (b.record.accepted || 0) - (a.record.accepted || 0);
      if (ac !== 0) return ac;
      const wm = (a.record.wrong_match || 0) - (b.record.wrong_match || 0);
      if (wm !== 0) return wm;
      return (b.record.uses || 0) - (a.record.uses || 0);
    });
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
      synthetic: 0,
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
