# App Design Studio — enhancement plan

**Status:** PLAN (2026-07-29, for review). Builds on the shipped `/app_design` file-editor
+ the harness (`docs/architecture/app-harness.md`). Captures the enhancement direction the
user set: components · grid · theme · formatting (on Flowbite/Tailwind) · a searchable
component catalog · engine wiring · a `.app` text view · an embedded MD doc · a deliberate
design-RAG built from MD↔.app pairs.

---

## 0. The crystallized architecture (two registries, two dirs, one SDK)

```
 src/lib/engines/         the cadtrain ENGINES (Manifold/TF/BREP + primitives)
      └─ exposed as ─▶ VERB registry (the engine API)  ─┐
                                                          ├─▶ ONE SDK/API (catalog)
 src/lib/app_components/  the app UI COMPONENTS (NEW dir) │        │
      └─ exposed as ─▶ COMPONENT registry (metadata) ─────┘        ▼
                                                        the studio SEARCH BAR
                                                        (add components · wire engines)
```

- **`src/lib/app_components/`** (NEW) — the app's UI building blocks, parallel to `engines/`.
  **Each component is a BUNDLE** — its *render* + its *own editor* + *metadata*:
  ```
  app_components/Table/    Table.svelte  ·  TableEditor.svelte  ·  meta.ts
  app_components/Tabs/     Tabs.svelte   ·  TabsEditor.svelte   ·  meta.ts
  app_components/Toolbar/  …             ·  ToolbarEditor.svelte
  app_components/Memory/   …             ·  MemoryEditor.svelte
  ```
  - The **editor is per-component + spreadsheet-like where it fits** — e.g. `TableEditor` is
    Excel-style: rows = columns of the table, cells = title · type · props (align, width, format…).
    `TabsEditor` edits the tab set; `ToolbarEditor` the buttons; etc.
  - `meta.ts` = the **catalog metadata** (name, kind, description, props schema, tags, which engine
    verbs it can wire to) → feeds the SDK/search bar.
  - **Kinds v1:** Table · Tabs · Toolbar · **File** (Open/Save/Save As, bound to a slot) · List ·
    Form · Text · Bake3d · Chat · Card · Button · Input · Chart · Heading · Image.
- **The SDK/API** projects both registries (verbs from `engines/`, components from
  `app_components/`) into a catalog the studio queries — the palette becomes a **search bar**.

## 0.5 Data model — the app OPENS data files (file slots)

The `.app` is a **stateless tool** — it holds NO data; it processes + outputs. DATA lives in
files (`.wson`, `.asm.ts`, part files). Model (matches SVTC's `fileSlots`):
- **File slots** — the `.app` declares named data-file slots: `files: [{ slot, type, label }]`
  (e.g. `{ slot:'well', type:'.wson', label:'Well' }`). An app can have **multiple, linkable**.
- **File components** — a **File** component (Open · Save · Save As) assigns/writes a data file to
  a slot at runtime (File System Access picker, same as the `.app` itself).
- **Wiring** — a component's `source`/actions reference a SLOT:
  `source: { verb:'loadData', args:{ slot:'well' } }`; the engine verbs process that slot's file →
  the component renders the result. Many components → one slot; many slots across the app.
- **Flow:** pick a data file → it fills a slot → wired components process + show it → swap the
  file, they update. (So the studio grows Open/Save/Save-As for DATA files too, not just the `.app`.)
- **"Memory" component is OUT** — the app stores no data; state comes from the file(s) in its slots.

## 1. The design RAG — built from MD ↔ .app pairs

The corpus is **(description, structure) pairs**: the **MD** (natural language) is the retrieval
KEY, the **.app** (JSON structure) is the TARGET. Built in **two layers**:
- **Layer 1 — raw log (automatic):** every build appends `{prompt, .app-summary, ts}` to
  `builds.jsonl`. A LOG only — to review + spot good builds. **NOT the retrieval DB.**
- **Layer 2 — golden pairs (curated = the DB):** a golden entry = an **MD file** + its **.app
  file** (`golden/<name>.md` + `golden/<name>.app`). Added by **(a)** promoting a build you like
  ("★ add to RAG" → saves the `.app` + its MD), or **(b)** authoring a `.app` directly (Claude/
  hand) + writing the MD. → **Not every prompt becomes an example — only the ones you keep**
  (high-signal, no garbage).
- **Retrieval:** a new prompt → match the golden **MD** descriptions → few-shot the paired `.app`
  structures. (Lexical/BM25 first — D11 v1; a local vector index later.)
- **Store — the VOLUME by default (pluggable):**
  - **volume** (DEFAULT — the setup is all shared prod volume) — `<volume>/ai/app-rag/` via
    `volumePath()` + the volume proxy (Rule 13), like the existing parts corpus
    `ai/rag/parts.jsonl`. Works in local dev (**proxied to prod**) AND prod; **shared → users
    build it collectively**. The src/local drive isn't accessible in prod, so this is the home.
  - **local** (OPTIONAL) — `CADTRAIN_APP_CORPUS` (e.g. `~/.cadtrain/app-rag/`) for air-gapped/offline.
  Contents: `builds.jsonl` (log) · `golden/<name>.{md,app}` (curated pairs) · the index. Behind an
  `AppCorpusStore` interface, so volume↔local is config. **Clean split:** `.app` + data files are
  LOCAL documents (file picker, Desktop/SAMPLE); the **RAG is the shared VOLUME corpus** (not src).
  *(The current `_builds.jsonl` in `~/Desktop/SAMPLE` moves behind this store → the volume.)*

## 2. Views in the studio (rail toggles): Design · Preview · `</>` Text · 📄 Doc

- **Text** — the raw `.app` JSON (inspect; edit-with-reparse later).
- **Doc (embedded MD)** — the `.app` carries a **`doc` markdown field** (travels *inside* the
  file). The Doc view renders + edits it; if empty, **auto-generates a summary** from the
  structure (panels + wiring). **This MD is what feeds the RAG** (§1).

## 3. Track A — Components · Grid · Theme · Formatting (on Tailwind + Flowbite-Svelte)

The app already ships Tailwind + `flowbite-svelte` (used by `/vocab`) — build on it, no new fw.
- **Components** — `app_components/` restyled as Flowbite (Card/Table/Button/Input/Badge/Alert…),
  each with catalog metadata. Richer palette (button · input · card · chart · heading · image …).
- **Grid layout** — each panel/component in the `.app` gets `{col,row,w,h}` → the harness renders
  a **responsive CSS grid**; the visual editor places/resizes on it (drop the fixed 3-column).
- **Theme** — a `theme` field on the `.app` (light/dark + accent) → Tailwind/Flowbite classes.
- **Formatting** — per-component Tailwind-class props surfaced in the editor.
- **Search-bar palette** — "add component" searches the component catalog (§0 SDK).

## 3.1 Component model — props + hierarchy (nesting)

- **Props** — every component instance carries typed `props` (declared by its `meta` props schema),
  edited in its per-component editor (Table = Excel-like columns/types; Text = size/weight/colour…).
- **Hierarchy (nesting)** — components have `children: Component[]` → the harness renders a **TREE
  recursively** (HTML/Svelte-style encapsulation): a Card/Container/Panel wraps a heading + text +
  table inside. "A text within the main panel" = a Text component nested in a Panel.
- **Custom components** — extend the catalog: a new Svelte component + `meta.ts` (props schema +
  allowed children) + register → the harness + editor pick it up automatically.
- **Manifest shape** evolves from flat `panels[]` → a component TREE: each node
  `{ kind, props?, children?, source?/on? }`, rendered recursively via the registry.
  *(Backward-compatible: today's panels are top-level nodes.)*

## 4. Track B — Wiring + engine abstractions

- **Wire components → verbs** in the visual editor: bind a component's `source`/`onEdit`/`add`/
  `onSelect` to a verb + args, via a picker sourced from the engine (verb) catalog.
- **Engine abstractions** — the component+engine catalog IS the abstraction layer; a component's
  metadata declares which engine verbs it wires to, so dropping it in + wiring is one flow. (The
  user's "grabstactions": reusable component blocks bundled with their engine wiring.)

## 4.5 Declarative logic layer (events · variables · API — all declarative, no codegen)

The `.app` gains a richer vocabulary; the harness gains three tiny interpreters.
- **Events** — a general `on: { <event>: <action | action[]> }` map on any component; the harness
  wires component events → `dispatch`. **Action sequences** supported (`click: [{verb:'save'},
  {verb:'bake'}]`).
- **Declarative variables (computed)** — `computed: { name: "= expr" }`, evaluated **reactively**
  (`$derived`). **REUSE the graph editor's expression system** (`src/lib/graph/expr/`, `ArgValue`
  = expr, the CodeMirror expr builder) — no new language, no `eval`, proven + safe.
- **API calls** — generic verbs (`http`, app-API) alongside the engine verbs; any action / panel
  `source` wires to any verb. (Verbs already ARE the engine/API wiring.)
- **Boundary unchanged:** arbitrary imperative logic / novel UI → a new component (Svelte) or
  promotion (codegen). Events + API wiring + formulas stay comfortably declarative.

## 5. AI docs — Svelte `llms.txt` (svelte.dev/docs/llms)

Two AIs, two doc diets (D6, refined for codegen):
- **Runtime declarative `.app` authoring** → sees ONLY our generated tool schema + `API.md` + the
  component/engine catalog. NOT framework docs (small · safe · local-model-friendly).
- **Component CODEGEN** — when the AI writes a NEW `app_components/<X>` render or its editor
  (Svelte 5 code) — ground it with the vendored Svelte **`llms-small.txt`** + a tight importable-
  libs allowlist (SVTC `API.md` pattern). *This* is where Svelte's LLM docs earn their keep.
- **Dev-time** (us/Claude building components) → the full `llms-full.txt` as reference.
- **Action:** vendor `svelte.dev/llms-small.txt` → `docs/vendor/svelte-llms.txt`.

## Sequencing (incremental — user priority 2026-07-29)

- ✅ **Step 1a/b** — manifest `files/doc/theme/layout` + Text/Doc views.
- ▶ **Step 1c** — volume-backed `AppCorpusStore` (read/write the RAG on the volume). *(pending)*
- Then, **one increment at a time** (each: build-green + browser-verify + commit):
  1. **Grid layout** — render panel `layout {col,row,w,h}` in a responsive grid.
  2. **Consistent CSS + theme** — Tailwind/Flowbite look + the `theme` field.
  3. **Component model** — `props` (+ per-component editors) · `children` (nested tree render).
  4. **Events** — the `on` map + action sequences.
  5. **Declarative variables** — `computed` expressions (reuse `graph/expr`).
  6. **API calls** — generic `http`/engine verbs.
  7. **`app_components/` reorg + registry** — first-class dir + catalog metadata.
  8. **Component search bar** — search the catalog to add components.
  9. **More custom components** — grow the catalog (Table · Tabs · Toolbar · File · Card · Chart…).

## Files (indicative)
- `src/routes/app_design/+page.svelte` — rail view toggles (Design/Preview/Text/Doc).
- `src/lib/appkit/manifest/types.ts` — add `doc`, grid `{col,row,w,h}`, `theme`.
- `src/lib/app_components/` (NEW) — components + registry + metadata; harness renders grid.
- `src/lib/appkit/schema/` — the SDK/catalog projection (components + verbs) for the search bar.
- `src/lib/server/app-corpus.ts` + `app-paths.ts` — corpus dir config; MD↔.app pairs.
- `docs/architecture/app-harness.md` — record `app_components/` + the MD-RAG + the SDK catalog.

## Open confirmations
- RAG dir default `~/.cadtrain/app-rag/` — good, or elsewhere (SAMPLE / volume)?
- Start with **Views (Text + MD)** then the **`app_components/` reorg** — yes?
