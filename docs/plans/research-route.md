# Plan: `/research` route — a parked-research index + doc viewer

Status: PLAN ONLY (no source changes yet). Owner: TBD. Created 2026-06-16.

## Goal

A dedicated top-level `/research` route that PARKS our research notes: an index
page listing every markdown doc under `docs/research/` plus `docs/FINDINGS.md`,
each rendered as a browsable in-app page at `/research/<slug>`. This is a
legitimate new top-level route (a content index, not a test/demo page — those
must stay under existing routes per the memory `feedback_demos_under_primitives`).
Keep it simple and visually consistent with the existing dark routes.

## What already exists (audit results)

- **Markdown renderer is already a dependency**: `marked` `^18.0.3` in
  `package.json`. It is NOT currently imported anywhere in `src/` (the only
  `marked` hits are an unrelated `seed_marked` field in the vocab promote flow).
  The archived `MarkdownView` component is gone — we render with `marked`
  directly, no need to revive it.
- **`import.meta.glob` precedent**: `src/lib/server/stdlib.ts` uses
  `import.meta.glob('/src/lib/graph/stdlib/*.ts', { query:'?raw', import:'default', eager:true })`
  to inline raw file text into the build at compile time. We reuse this exact
  pattern, pointed at `/docs/research/*.md` + `/docs/FINDINGS.md`. The leading-
  slash path is relative to the Vite project root (the repo root), so `/docs/...`
  resolves even though `docs/` is outside `src/`. `?raw` inlines the text at
  build time, so the docs ship in the bundle regardless of being served as
  static files.
- **SSR is globally OFF** (`src/routes/+layout.ts`: `export const ssr = false`).
  So markdown parsing runs client-side. That is fine — `marked` is a sync,
  browser-safe parser and the docs are small.
- **No global navbar** (removed 2026-06-09). Navigation is the landing menu at
  `src/routes/+page.svelte` (a `.menu` of `.menu-item` anchors) plus in-page
  links. The `/research` index doubles as its own nav.
- **Docs present today** under `docs/research/`: `webgpu-slm.md`,
  `smooth-shading-normals.md`, `cad_authoring_patterns.md`,
  `cad_authoring_patterns.archived-2026-06-01.md`. (The task also mentions
  `web-llm-functionary`, `normals-smoothing`, `brep-io`,
  `svelteflow-for-graph-editor` — some do not exist yet; the glob auto-lists
  whatever is on disk, so new docs appear with no code change.)
- Existing simple single-file route precedent: `src/routes/design/+page.svelte`
  and `src/routes/plan/+page.svelte` (route + optional sibling `.ts`).

## Route structure

```
src/routes/research/
├── docs.ts            # shared loader: glob → { slug, title, body, group }[]
├── +page.svelte       # /research        — index list of all docs
└── [slug]/
    └── +page.svelte   # /research/<slug> — one rendered doc
```

- `/research` — index. Renders a grouped list (group: "Research" for
  `docs/research/*.md`, "Findings" for `docs/FINDINGS.md`). Each row links to
  `/research/<slug>` with the doc title + a short hint (first non-heading line,
  truncated).
- `/research/<slug>` — viewer. Looks the doc up by slug, renders `marked(body)`
  into a styled `.prose` container, with a back-link to `/research`.

### Slugs

- `docs/research/webgpu-slm.md` → slug `webgpu-slm` (filename minus `.md`).
- `docs/FINDINGS.md` → slug `findings`.
- Skip the `*.archived-*.md` variants by default (filter in `docs.ts`), or list
  them under a collapsed "Archived" group — recommend: filter out for v1.
- Slug = `filename.replace(/\.md$/, '').toLowerCase()`. Title = first `#`
  heading in the body, else the prettified slug.

## `docs.ts` — the shared loader

A pure module (no `+server`, no SSR needed) imported by both pages:

```ts
// Inline raw markdown text at build time — same mechanism as stdlib.ts.
const researchRaw = import.meta.glob('/docs/research/*.md', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;
const findingsRaw = import.meta.glob('/docs/FINDINGS.md', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

export type Doc = { slug: string; title: string; body: string; group: 'Research' | 'Findings' };

function titleOf(body: string, slug: string): string {
  const h = body.match(/^#\s+(.+)$/m);
  return h ? h[1].trim() : slug.replace(/[-_]/g, ' ');
}

// build Doc[] from both globs, filter *.archived-*, sort by title.
export const docs: Doc[] = /* … */;
export const bySlug = new Map(docs.map(d => [d.slug, d]));
```

This means **auto-indexing is free**: drop a new `.md` into `docs/research/` and
it appears on `/research` after the next build (HMR picks it up in dev, same as
stdlib's glob — see the GraphEditorPane glob-cache note).

## Markdown rendering

- `import { marked } from 'marked';` then `{@html marked.parse(doc.body)}` inside
  a `.prose` wrapper.
- Set `marked.setOptions({ gfm: true, breaks: false })` for GitHub-flavored
  tables/lists used in the docs.
- **XSS note**: content is our own repo docs, fully trusted and bundled at build
  time — no user input — so raw `{@html}` is acceptable here. If we ever surface
  user-authored markdown through this path, add `DOMPurify` (not a dep today).
  Document this assumption in a code comment.
- Style a dark `.prose` block consistent with the landing palette
  (`#1a1a2e` background, `#eee` text, `#cc2222` accent headings, code blocks on a
  slightly lighter panel `#16213e`). Reuse the color tokens from `+page.svelte`.

## `[slug]/+page.svelte`

- Read `$page.params.slug`, look up `bySlug.get(slug)`.
- If missing → render a "not found" panel with a back-link (don't 404 hard;
  SSR is off so this is a client view anyway).
- Render title + `{@html marked.parse(doc.body)}`; sticky top bar with
  `← Research` link back to `/research`.

## Landing-page nav entry

Add one `.menu-item` to `src/routes/+page.svelte`, matching the existing markup:

```svelte
<a href="/research" class="menu-item">Research <span class="hint">parked notes · findings</span></a>
```

Place it after `Plan` (or after `Primitives`, near the top — pick adjacency to
Plan since both are reference/reading surfaces). No style changes needed; it
inherits `.menu-item`/`.hint`.

## Phased build

**Phase 1 — loader + index (core).**
- Create `src/routes/research/docs.ts` (glob + Doc[] + bySlug).
- Create `src/routes/research/+page.svelte` (grouped list, dark styling).
- Add the landing-page `.menu-item`.
- Verify: `bun run dev`, open `/research`, confirm all current docs list with
  titles; click through to (stub) viewer.

**Phase 2 — doc viewer.**
- Create `src/routes/research/[slug]/+page.svelte` (marked render + back-link +
  not-found fallback + `.prose` styling).
- Verify each existing doc renders (headings, code blocks, tables, links).

**Phase 3 — polish (optional).**
- First-line hint/excerpt on index rows.
- "Archived" collapsed group (un-filter the `*.archived-*` docs).
- Anchor/TOC for long docs (FINDINGS, webgpu-slm); `marked` emits heading ids
  with a custom renderer if wanted.
- e2e: extend the graph-editor/route smoke spec to assert `/research` loads and
  a `/research/<slug>` renders non-empty (Rule 11/12 — prompt for headless run).

## Consistency / rules checklist

- New top-level route is allowed (Rule 2) and follows the `design/`+`plan/`
  single-page pattern. It is content/reference, not a demo route.
- No backend, no volume, no API endpoint — pure client render of bundled docs,
  so none of the volume/proxy rules (4, 13) apply.
- SSR-off compatible (`marked` runs in the browser).
- No new dependency required (`marked` already present); add `DOMPurify` ONLY if
  the source ever becomes untrusted.
- Build + lint clean before commit (Rule 8); commit after Phase 1 and Phase 2
  complete (Rule 7).
- Reconcile a `/research` entry INTO `/plan` at session end (Rule 19) if this
  becomes a tracked lane.

## Open questions

- Include `docs/plans/*.md` too, or keep `/research` strictly research+findings?
  Recommend research+findings for v1; plans are roadmap-adjacent and noisy.
- Title source when a doc has no `#` heading — fall back to prettified slug
  (handled above).
