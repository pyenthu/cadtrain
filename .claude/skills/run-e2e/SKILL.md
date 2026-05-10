---
name: run-e2e
description: Run cadtrain's Playwright e2e suite, asking the user whether to run headless (fast, ~15s, just verifies routes load and links resolve) or headed (slower, opens a real Chromium at slowMo 250 so they can watch). Codifies CLAUDE.md Rule 11.
allowed-tools: Bash, AskUserQuestion
model: haiku
---

# run-e2e

Runs the cadtrain end-to-end Playwright suite. Use this after non-trivial UI/route/backend changes per CLAUDE.md Rule 11.

## TRIGGER when

- The user types `/run-e2e`
- The user asks "run the tests", "run e2e", "playwright", "smoke test", "verify routes", or similar
- After a non-trivial route move, navbar rewrite, backend dispatch refactor, or API contract change — even if the user didn't ask, prompt them per Rule 11

## DO NOT TRIGGER for

- Vitest unit tests (use `bun test` directly instead)
- Trivial edits (typo fixes, comment-only changes, single-style tweaks, plan/details.ts updates)
- Documentation-only changes (CLAUDE.md edits, README.md, plan file)
- When a Playwright run is already in progress this session

## Steps

1. **Ask the user which mode** via AskUserQuestion (skip if the user already specified, e.g., "run e2e headed"):

   - **headless** — `bun run test:e2e` — fast (~15s), CI-suitable, default for routine verification
   - **headed** — `bun run test:e2e:headed` — opens visible Chromium with `slowMo: 250`, suited for debugging a specific failure

2. **Run the chosen command** via Bash. Pipe through `tail -20` for headless to keep output tight; for headed, let the user watch the browser and just report pass/fail at the end.

3. **Report:**
   - On success: `N/N passed in Xs` plus a one-line summary of what was covered
   - On failure: name the failing spec, give the failing assertion, suggest looking at `tests/results/playwright-report/` (offer `bun run test:e2e:report`)

## Notes

- The e2e config (`playwright.config.ts`) auto-spawns a dev server on port 4445 to avoid colliding with manual `bun run dev` on 3333. No need to start a server first.
- 44 tests across 3 specs: `tests/e2e/routes.spec.ts` (route map), `tests/e2e/navbar.spec.ts` (nav segments), `tests/e2e/archive-links.spec.ts` (intra-archive nav).
- If `bunx playwright install chromium` hasn't been run, the first invocation will fail — install browsers and retry.
