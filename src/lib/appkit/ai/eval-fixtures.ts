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

/** Ordered build prompts per app — replayed one-at-a-time, mutating the .app in place. */
export const EVAL_PROMPTS: Record<EvalAppId, string[]> = {
  plan: [
    'Make this a roadmap app titled "CAD Train — Roadmap".',
    'Define a task data structure with fields id, label, lane, start, end, status, and details.',
    'Seed a "tasks" variable with the CAD Train roadmap as a list of task records — bundles A through E of work (components, primitives, identity, SDK, wells) across sequence-weeks, each with id, label, lane, start, end, status, details.',
    'Add a level-1 heading titled "CAD Train — Roadmap".',
    'Add a small muted subtitle under it describing the timeline (bundles A–E, weeks, bars coloured by status).',
    'Add a Gantt timeline titled "Roadmap timeline" that reads the tasks variable, with the axis in weeks.',
    'Add a task table below the Gantt that reads the same tasks data and shows id, label, lane, start, end, status.',
    'Use a light theme with a blue accent.',
  ],
  design: [
    'Create an app called design titled CAD Train — Architecture, docType design, light theme with a slate accent.',
    'Define two data structures: an archNode (id, label, parentId, kind, tech, accent, href, blurb, planned, archived) and an archEdge (source, target, kind, label).',
    'Seed a variable nodes with the architecture: one system (CAD Train), four container boxes (Web App, API layer, CAD kernel, Volume store), and their key route / api / lib / store components as children (parentId). Mark /fem archived. Then seed a variable edges with the C4 summary links plus the calls / mounts / flow / reads / writes relationships between them.',
    'Seed a variable c4nodes with the C4 context: the CAD Author (person), CAD Train (system, child of the author), and the external systems Anthropic API, Railway + Volume, and FAL (archived) as children of the system. Seed c4edges with the author→system and system→external relationships and their labels.',
    'Add an H1 heading CAD Train — Architecture and a muted subtitle explaining it replicates /design as pure SSR-safe SVG.',
    'Add a tabs panel with two tabs labelled Tree and C4.',
    'Inside the first tab put a node tree titled Architecture — system · containers · components, reading its nodes from the nodes variable and its edges from edges.',
    'Inside the second tab put a node tree titled C4 — System Context, reading c4nodes and c4edges, a bit wider.',
  ],
  ewell: [
    'New app called ewell, title GEOWELLS — Well Schematic, docType well, light theme with a deep-teal accent (#0f3d56).',
    'Seed the active well Wildcat #1 (New Field, Wyoming, USA; TD 3000 ft). Add casing strings 13-3/8, 9-5/8, 7 and a 4-1/2 liner; the open-hole bit sections; cement columns; a 2-7/8 tubing string with a hanger and a production packer; three perforation intervals; and the completion tool list.',
    'Add a vertical tool rail on the left with icon buttons: Add Well, Header, Schematic, Completions, Perforations, Display, JSON.',
    'Clicking Header shows the well header; Completions shows the completion strings table; Perforations shows the perforations table; Display and JSON show notes.',
    'In the centre, show the well name as a heading, a subtitle, and the well schematic drawing sized 420×560, reading the seeded casings/holes/tubing/perforations/cement.',
    'Add a right sidebar titled Well Data with tables for the casing strings, the tubing, and the perforations.',
  ],
};
