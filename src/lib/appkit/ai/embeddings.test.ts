import { describe, it, expect } from 'vitest';
import { cosineSim, l2normalize, rankByVector } from './embeddings';

describe('embeddings — pure vector math (always run, no model)', () => {
  it('cosineSim: identical=1, orthogonal=0, opposite=-1', () => {
    expect(cosineSim([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(cosineSim([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
    expect(cosineSim([], [1, 2])).toBe(0); // degenerate → 0, never NaN
  });

  it('l2normalize → unit length (zero vector unchanged)', () => {
    const u = l2normalize([3, 4]);
    expect(Math.hypot(...u)).toBeCloseTo(1, 6);
    expect(l2normalize([0, 0])).toEqual([0, 0]);
  });

  it('rankByVector ranks by cosine similarity, top-k', () => {
    const q = [1, 0];
    const items = [
      { item: 'orthogonal', vec: [0, 1] },
      { item: 'aligned', vec: [1, 0.1] },
      { item: 'opposite', vec: [-1, 0] },
    ];
    const ranked = rankByVector(q, items, 2);
    expect(ranked.map((r) => r.item)).toEqual(['aligned', 'orthogonal']);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});

// Opt-in: loads the real bge-small model (~33MB download on first run) — gate so CI stays fast.
// Run with: RUN_EMBED_TESTS=1 bun run test src/lib/appkit/ai/embeddings.test.ts
const RUN = !!process.env.RUN_EMBED_TESTS;
describe.skipIf(!RUN)('embeddings — local model beats lexical on a paraphrase (opt-in)', () => {
  it('ranks a semantic paraphrase above a lexically-overlapping distractor', async () => {
    const { localEmbedder } = await import('$lib/server/local-embedder');
    const query = 'add a 3D CAD viewer of a part';
    const candidates = [
      'show an interactive cad model in three dimensions', // semantic match, ~zero word overlap
      'add a data table of the parts with columns and totals', // shares "add"/"part(s)" — lexical bait
    ];
    const [q, ...cs] = await localEmbedder.embed([query, ...candidates]);
    const simSemantic = cosineSim(q, cs[0]);
    const simLexicalBait = cosineSim(q, cs[1]);
    // the paraphrase (no shared content words) must out-rank the word-overlap distractor:
    expect(simSemantic).toBeGreaterThan(simLexicalBait);
  }, 120_000);
});
