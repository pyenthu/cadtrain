# `src/lib/app_components/` — component BUNDLES (the scalable component home)

Each app component is a **self-contained, repeatable bundle** — one folder holding everything
about it — so components are consistent, flexible, and Claude-definable, and so the superapp
scales. See `docs/plans/app-server-render.md` (TODO — component bundles + `.app` → component).

## Bundle shape

```
app_components/<Name>/
   <Name>.svelte        the render (the actual Svelte element) — UI
   meta.ts              the catalog metadata — HEADLESS (import type only)
   <Name>Editor.svelte  OPTIONAL per-component editor (e.g. Table = Excel-like); else the
                        generic settings popover drives off meta.props
```

- **`meta.ts` exports `metas: ComponentMeta[]`** — an ARRAY, because one render can back several
  kinds (e.g. `Container` → container/card/div/col; `Form` → form/table; `Toolbar` → toolbar/row).
  It **MUST stay pure** (`import type { ComponentMeta } …` only — no Svelte, no runtime import of
  the catalog) so `appkit/catalog/components.ts` can aggregate it (`...<name>Metas`) without a
  cycle and without breaking appkit's headless rule. Each meta carries: `kind · name · description
  · group · tags · dataMode · computeMode? · acceptsChildren? · props[] · wiresTo[] · slots?`.
- **`<Name>.svelte`** receives the standard panel props (`panel, run, fire, select, active,
  params, vars, slots, slotApi, dataRev, preloaded, kids, renderChild`) — take what you need.

## Wiring (two aggregation points — the headless/UI split is preserved)

- **Metadata** → `src/lib/appkit/catalog/components.ts` imports each bundle's `meta` (pure) into
  `COMPONENT_CATALOG`. This is what the search bar + settings popover read.
- **Render** → `src/lib/shared/harness/panels/registry.ts` maps `kind → <Name>.svelte`.

**Migration COMPLETE (2026-07-30):** every render is a bundle. `harness/panels/` now holds only
`PanelNode.svelte` (the recursive tree renderer) + `registry.ts` (kind → bundle render). All 15
bundles: List · Form · DataGrid · EditableTable · Text · Heading · Divider · Button · Container ·
Toolbar · Tabs · File · Chat · Bake3d · Placeholder.

## Roadmap
- Per-component editors (`<Name>Editor.svelte`) where the generic props form isn't enough
  (Table = Excel-like columns first).
- **`.app` → component**: promote a saved composition (or subtree) into a new bundle, parameterized
  by its own props/slots (`docs/plans/app-server-render.md`).
