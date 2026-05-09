/**
 * Detail records for /plan task popups. Keyed by task `id` from
 * +page.svelte. Add an entry only when there's enough substance to
 * warrant the popup; the page falls back to "no detail entry yet"
 * when missing.
 */

export interface PlanDetail {
  summary?: string;
  steps?: string[];
  acceptance?: string[];
  refs?: string[];
}

export const details: Record<number, PlanDetail> = {
  // ───── B. Retrieval ─────

  26: {
    summary:
      'CLIP retrieval rolled out end-to-end (commits 9b67c29..81261c5). ' +
      '@xenova/transformers integrated with sharp + a Bun compat shim for ' +
      'Node↔Bun parity. Hybrid scoring: 0.75·cos + 0.15·sameCategory + ' +
      '0.10·(1 - ham/64). Migration script embedded all 1,772 cache records ' +
      'plus 700 synthetic samples.',
    acceptance: [
      'Build clean on both bun --bun and bun (Node 25)',
      '50 vitest tests pass',
      'cache.jsonl: 1,772 records each carry a 512-dim embedding',
      '/api/identify computes embedding + pHash in parallel (Promise.all)',
    ],
    refs: ['~/.claude/plans/clip-retrieval-and-synthetic-data.md'],
  },

  28: {
    summary:
      'CLIP collapses on default-param primitive renders — 12 of 18 primitives ' +
      'produce identical embeddings (cos = 1.000) because the silhouettes are ' +
      'too abstract for CLIP\'s natural-image training distribution. The ' +
      'CLAUDE.md TODO lists four options: re-render with shading + color, ' +
      'add edge-histogram fingerprint, fine-tune CLIP on the primitive set, ' +
      'or replace the 18-image test with real photo benchmarks.',
    refs: ['CLAUDE.md (Open TODOs)', '~/.claude/projects/.../memory/clip_silhouette_collapse.md'],
  },

  // ───── D. Wells ─────

  60: {
    summary:
      'Mirror SVTC\'s WSON shape into cadtrain so /api/wells/extract emits a ' +
      'document SVTC\'s drawing apps can absorb directly. Schema lives at ' +
      'src/lib/wells/schema.ts; the canonical reference is SVTC\'s ' +
      'src/lib/apps/wson/CLAUDE.md (lines 108-148). Single root object, not an array.',
    steps: [
      'Define TypeScript interfaces for WSON top-level: meta, oh[], ch[], cementing[], completions[], perforations[], strata[], profile[]',
      'Add a small zod (or hand-rolled) validator so extracted JSON can be sanity-checked before save',
      'Document the rules from SVTC\'s CLAUDE.md (e.g., tubing in completions[], not ch[])',
    ],
    acceptance: [
      'src/lib/wells/schema.ts exports WSON + section types',
      'A round-trip test parses + serialises a minimal valid WSON without loss',
    ],
    refs: ['~/Desktop/GitHub/SVTC/src/lib/apps/wson/CLAUDE.md'],
  },

  61: {
    summary:
      'Server endpoint that takes a well document (PDF or image + optional text) and ' +
      'returns a WSON object via Claude vision. PDFs go through type:document so ' +
      'Claude sees the text layer + vector elements directly — much cleaner than ' +
      'rasterising first. Output is validated against schema.ts before return.',
    refs: ['~/.claude/plans/clip-retrieval-and-synthetic-data.md (out-of-scope §)'],
  },

  62: {
    summary:
      '/wells route — upload a document, watch live extraction, edit, save. ' +
      'Mirrors the /reverse pattern (upload → identify → refine → save) but ' +
      'for documents instead of component images.',
  },

  // ───── F. Meta ─────

  100: {
    summary: 'This page. Built 2026-05-09, mirrors the Gantt pattern from sister-repo SVTC.',
    refs: ['~/Desktop/GitHub/SVTC/src/routes/plan/+page.svelte'],
  },
};
