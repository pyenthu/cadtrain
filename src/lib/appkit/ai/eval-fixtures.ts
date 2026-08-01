// src/lib/appkit/ai/eval-fixtures.ts — the SINGLE SOURCE OF TRUTH for the app-build eval's ordered
// natural-language prompt scripts + the app-id list. Consumed by BOTH the headless runner
// (scripts/eval-app-build.ts) AND the in-browser eval route (src/routes/app_design/eval/+page.svelte)
// so the two can never drift. Pure data — no IO, no Svelte, client- AND node-importable (satisfies
// the appkit HEADLESS rule).
//
// The prompts are fed to the builder ONE AT A TIME; the mutated .app is forwarded to the next prompt.
// Goldens live on the volume at ai/app-rag/golden/<id>.app (committed snapshots in
// scripts/eval-fixtures/golden/<id>.app). Transcribed verbatim from the original
// scripts/eval-fixtures/prompts.json (now superseded by this module).

export const APP_IDS = ['plan', 'design', 'ewell'] as const;
export type EvalAppId = (typeof APP_IDS)[number];

/** Ordered build prompts per app — replayed one-at-a-time, mutating the .app in place.
 *
 *  ATOMIC (2026-08): each prompt does ONE thing and maps to 1–2 verbs — the shape the
 *  `docs/rag/sample-prompts.md` library prescribes and a small local model can reliably emit
 *  (vs the old mega-seed prompts). Splits: meta ⁄ theme separated; each data variable seeded on its
 *  OWN line (named explicitly so it matches the name-keyed scorer + grounds both models); the giant
 *  well seed broken into per-string seeds. The FINAL app is unchanged, so `scoreApp` vs the golden
 *  is directly comparable to the pre-atomic runs. */
export const EVAL_PROMPTS: Record<EvalAppId, string[]> = {
  plan: [
    'Make this a roadmap app titled "CAD Train — Roadmap".',
    'Define a task structure with fields id, label, lane, start, end, status, details.',
    'Seed a "tasks" variable with a few roadmap task records (bundles A–E), each with id, label, lane, start, end, status, details.',
    'Add a level-1 heading "CAD Train — Roadmap".',
    'Add a small muted subtitle describing the timeline.',
    'Add a Gantt timeline titled "Roadmap timeline" that reads the tasks variable, axis in weeks.',
    'Add a task table below it that reads tasks, columns id, label, lane, start, end, status.',
    'Use a light theme with a blue accent (#0369a1).',
  ],
  design: [
    'Create an app called design titled "CAD Train — Architecture", docType design.',
    'Use a light theme with a slate accent (#475569).',
    'Define an archNode structure with fields id, label, parentId, kind, tech, accent, href, blurb, planned, archived.',
    'Define an archEdge structure with fields source, target, kind, label.',
    'Seed a "nodes" variable with the architecture: one system, four container boxes (Web App, API layer, CAD kernel, Volume store), and their route/api/lib/store components as children; mark /fem archived.',
    'Seed an "edges" variable with the C4 summary links plus the calls/mounts/flow/reads/writes relationships.',
    'Seed a "c4nodes" variable with the C4 context: the CAD Author (person), CAD Train (system), and the external systems Anthropic API, Railway + Volume, and FAL (archived).',
    'Seed a "c4edges" variable with the author→system and system→external relationships and their labels.',
    'Add an H1 heading "CAD Train — Architecture".',
    'Add a muted subtitle explaining it replicates /design as pure SSR-safe SVG.',
    'Add a tabs panel with two tabs labelled Tree and C4.',
    'Inside the first tab, put a node tree titled "Architecture — system · containers · components" reading nodes and edges.',
    'Inside the second tab, put a node tree titled "C4 — System Context" reading c4nodes and c4edges, a bit wider.',
  ],
  ewell: [
    'New app called ewell, title "GEOWELLS — Well Schematic", docType well.',
    'Use a light theme with a deep-teal accent (#0f3d56).',
    'Seed a "well" variable with the active well: Wildcat #1, New Field, Wyoming, USA, TD 3000 ft.',
    'Seed a "casings" variable with the 13-3/8, 9-5/8 and 7 casing strings plus the 4-1/2 liner.',
    'Seed a "holes" variable with the open-hole bit sections.',
    'Seed a "cement" variable with the cement columns.',
    'Seed a "tubing" variable with a 2-7/8 tubing string, a hanger, and a production packer.',
    'Seed a "perforations" variable with three perforation intervals.',
    'Seed a "completions" variable with the completion tool list.',
    'Add a vertical tool rail on the left with icon buttons: Add Well, Header, Schematic, Completions, Perforations, Display, JSON.',
    'Wire the rail: Header shows the well header; Completions shows the completion strings table; Perforations shows the perforations table; Display and JSON show notes.',
    'In the centre, show the well name as a heading, a subtitle, and the well schematic sized 420×560 reading the seeded casings, holes, tubing, perforations, and cement.',
    'Add a right sidebar titled "Well Data" with tables for the casing strings, the tubing, and the perforations.',
  ],
};
