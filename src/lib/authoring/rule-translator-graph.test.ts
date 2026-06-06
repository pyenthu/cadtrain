/**
 * Phase 14 — rule-translator graph-emit unit tests.
 *
 * Exercises translate(term, vocab, { format: 'graph' }) on the canonical
 * `tube` compose rule from docs/parts/vocabulary.json and asserts the
 * output has:
 *   • meta.graph JSON block (proves the new emitter wired in correctly)
 *   • aliased Calls (A + B) referencing the right exemplar (dt_shaft)
 *   • kind:'expr' ArgValues for "p.od / 2" + "p.od/2 - p.wall"
 *   • kind:'param' ArgValues for clean "p.length" refs
 *   • kind:'literal' for the segments: 64 number
 *   • meta.params surfacing od, wall, length
 *   • function signature with `(p)` since params are declared
 *   • generated_from trace tag (term + vocab_version + rule_hash)
 *
 * Same vocab → same translator → same source: idempotent. Drift-detectable.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { translate, type Vocabulary } from './rule-translator';

function loadVocab(): Vocabulary {
  const root = resolve(process.cwd());
  return JSON.parse(readFileSync(resolve(root, 'docs/parts/vocabulary.json'), 'utf8'));
}

describe('rule-translator — graph emit path (Phase 14)', () => {
  it('translates the canonical tube compose rule to meta.graph + correct ArgValues', () => {
    const vocab = loadVocab();
    const src = translate('tube', vocab, { format: 'graph' });

    // 1. Meta.graph block present.
    expect(src).toContain('graph: {');

    // 2. Both Calls aliased correctly + reference dt_shaft.
    expect(src).toMatch(/alias:\s*['"]A['"]/);
    expect(src).toMatch(/alias:\s*['"]B['"]/);
    expect(src).toMatch(/src:\s*['"]dt_shaft['"]/);

    // 3. Method node (subtract) present.
    expect(src).toMatch(/op:\s*['"]subtract['"]/);

    // 4. Both expression args present as kind:'expr'.
    expect(src).toMatch(/kind:\s*['"]expr['"]/);
    expect(src).toContain('p.od / 2');
    expect(src).toContain('p.od/2 - p.wall');

    // 5. Shared dial — p.length is wired as kind:'param' on both Calls.
    expect(src).toMatch(/kind:\s*['"]param['"]/);
    expect(src).toMatch(/param:\s*['"]length['"]/);

    // 6. Segments stays a literal number.
    expect(src).toMatch(/kind:\s*['"]literal['"]/);

    // 7. Assembly params lifted into meta.params.
    expect(src).toMatch(/od:\s*\{/);
    expect(src).toMatch(/wall:\s*\{/);
    expect(src).toMatch(/length:\s*\{/);

    // 8. Function signature takes `p` (body uses p.od / p.wall / p.length).
    expect(src).toMatch(/export function dt_tube\(p\)/);

    // 9. Trace tag — provenance for drift detection.
    expect(src).toMatch(/generated_from:\s*\{/);
    expect(src).toContain(`term: 'tube'`);
    expect(src).toContain(`vocab_version: '${vocab.version}'`);
  });

  it('is idempotent — same input produces byte-identical source', () => {
    const vocab = loadVocab();
    const a = translate('tube', vocab, { format: 'graph' });
    const b = translate('tube', vocab, { format: 'graph' });
    // Strip the random node ids (n_xxxxxx) — only those are intentionally
    // non-deterministic. Everything else must match.
    const normalize = (s: string) => s.replace(/n_[a-z0-9]{6}/g, 'n_XXXXXX');
    expect(normalize(a)).toBe(normalize(b));
  });

  it('legacy text format still works when explicitly requested', () => {
    const vocab = loadVocab();
    const textSrc = translate('tube', vocab, { format: 'text' });
    // Text format has the OLD composition block, NOT a meta.graph block.
    expect(textSrc).toContain('composition: {');
    expect(textSrc).not.toContain('graph: {');
  });

  it('default format for compose rules is graph (Phase 14 flip)', () => {
    const vocab = loadVocab();
    const defaultSrc = translate('tube', vocab); // no format option
    const graphSrc   = translate('tube', vocab, { format: 'graph' });
    // Stripping ids (random per call), they should match the graph-mode output.
    const normalize = (s: string) => s.replace(/n_[a-z0-9]{6}/g, 'n_XXXXXX');
    expect(normalize(defaultSrc)).toBe(normalize(graphSrc));
  });
});
