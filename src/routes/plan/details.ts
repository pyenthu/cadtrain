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

  // ───── F. Two-product split ─────

  110: {
    summary:
      'Extract the API/CLI dispatch pattern that\'s currently duplicated across ' +
      'src/lib/identify/backend.ts and src/lib/wells/backend.ts. Six small modules ' +
      'in src/lib/shared/: mime-ext, anthropic-client, cli-subprocess, cli-output-parse, ' +
      'temp-file, cli-args. Both existing backends refactored to call shared/. RAG and ' +
      'domain prompts stay in their backend files. ~150 LOC saved.',
    steps: [
      'Create src/lib/shared/mime-ext.ts — guessImageExt(mime)',
      'Create src/lib/shared/anthropic-client.ts — requireAnthropicKey() + createAnthropicClient()',
      'Create src/lib/shared/cli-subprocess.ts — spawnClaudeCli(args, cleanupPaths)',
      'Create src/lib/shared/cli-output-parse.ts — parseCliEnvelope(stdout, opts)',
      'Create src/lib/shared/temp-file.ts — withTempFile(prefix, ext, buffer, fn)',
      'Create src/lib/shared/cli-args.ts — buildClaudeCliArgs({ model, addDir, system, user })',
      'Refactor identify/backend.ts to use shared/',
      'Refactor wells/backend.ts to use shared/',
      'Verify: bun run build, bun test, manual /reverse + /wells smoke test',
    ],
    acceptance: [
      'bun run build clean',
      'bun test passes (50+ tests)',
      'Image upload at /reverse returns identification result',
      'PDF upload at /wells returns valid WSON',
      '~150 LOC removed from backend.ts files',
    ],
    refs: ['~/.claude/plans/silly-conjuring-deer.md'],
  },

  111: {
    summary:
      'Move all current user-facing routes under src/routes/archive/* so they remain ' +
      'a reference but are unambiguously "old work." API routes stay at /api/* (no URL ' +
      'change to avoid breaking archived pages). The src/lib/* tree stays put this PR — ' +
      'reorganizing lib paths is a separate ~40-file rename PR.',
    steps: [
      '(training)/components → archive/(training)/components',
      '(training)/reverse → archive/(training)/reverse',
      '(training)/training → archive/(training)/training',
      '(training)/tests → archive/(training)/tests (incl. tests/components, tests/wells)',
      '(build)/author → archive/(build)/author',
      '(build)/library → archive/(build)/library',
      'tools/bottom-sub → archive/tools/bottom-sub',
      'tools/ratch-latch → archive/tools/ratch-latch',
      'wells → archive/wells',
      'Update internal links in 6 page files (Tests, Author, Library back-/forward-links)',
    ],
    acceptance: [
      'Every archived URL loads in dev server',
      'Intra-archive nav works (Tests → Tests/Wells, Author → Library)',
      '/api/identify and /api/wells/extract still respond from archive pages',
      'Static assets (/training_data, /eval, /tests) still resolve',
    ],
    refs: ['~/.claude/plans/silly-conjuring-deer.md'],
  },

  112: {
    summary:
      'Replace the current 5-segment navbar (Training · Build · Tools · Wells · Meta) ' +
      'with a 4-segment layout: CAD | Wells | Archive | Meta. CAD and Wells initially ' +
      'point to empty stubs; Archive expands to all 9 archived routes; Meta stays.',
    refs: ['~/.claude/plans/silly-conjuring-deer.md'],
  },

  113: {
    summary:
      'Create src/routes/cad/+page.svelte and src/routes/wells/+page.svelte as ' +
      'placeholders explaining the new products are under construction. Rewrite ' +
      'src/routes/+page.svelte as a clean two-product landing. Optionally add ' +
      'src/routes/archive/+page.svelte as an index of legacy routes.',
    refs: ['~/.claude/plans/silly-conjuring-deer.md'],
  },

  114: {
    summary:
      'Rewrite the Routes table in CLAUDE.md to reflect CAD / Wells / Archive / Meta ' +
      'split. Add a Methodology (shared) section documenting: dual-backend dispatch ' +
      'pattern (API vs CLI), cold-classification baseline finding, cache-grows-with-use ' +
      'compounding loop, 5-layer validation hierarchy. Add lib/shared/ subsection with ' +
      'the 4 new modules. Document the cad/wells no-cross-import rule. Add Rule 11 ' +
      '(prompt for e2e tests after route/UI/backend changes, asking headless vs headed).',
    refs: ['~/.claude/plans/silly-conjuring-deer.md', 'CLAUDE.md'],
  },

  115: {
    summary:
      'Playwright e2e suite added (commit ~ after 55b1f43). 44 tests in 3 specs ' +
      'under tests/e2e/. Auto-spawns dev server on port 4445 to avoid colliding ' +
      'with manual `bun run dev` on 3333. Headless run completes in ~15s.',
    steps: [
      'bun add -d @playwright/test',
      'bunx playwright install chromium',
      'tests/e2e/routes.spec.ts — 16 active routes return 200, 8 removed top-level URLs return 404',
      'tests/e2e/navbar.spec.ts — 4 segments visible, 10 archive links listed, active highlighting works, click-through navigation',
      'tests/e2e/archive-links.spec.ts — no stale top-level links inside any archived page; intra-archive nav resolves',
      'playwright.config.ts — PWHEAD=1 toggles headed mode with slowMo 250',
    ],
    acceptance: [
      '`bun run test:e2e` passes 44/44 in ~15s',
      '`bun run test:e2e:headed` opens visible Chromium for debugging',
      'CLAUDE.md Rule 11 codifies when to prompt the user to run it',
      'Memory file feedback_test_after_route_changes.md persists rule across sessions',
    ],
    refs: ['playwright.config.ts', 'tests/e2e/'],
  },

  116: {
    summary:
      'Current e2e suite covers route loading, navbar, intra-archive links — but ' +
      'no actual backend smoke tests. Next: upload a sample PDF to /archive/wells ' +
      'and assert WSON response shape; upload a sample image to /archive/reverse ' +
      'and assert IdentifyResponse shape. Use the API backend (skip CLI tests since ' +
      'they need claude binary auth and would fail in CI).',
  },

  117: {
    summary:
      'e2e currently runs only when manually triggered. Wire into CI (GitHub Actions ' +
      'workflow on PR) and/or a pre-commit hook for high-risk paths (anything under ' +
      'src/routes/ or src/lib/shared/). Skip running on docs-only changes.',
  },
};
