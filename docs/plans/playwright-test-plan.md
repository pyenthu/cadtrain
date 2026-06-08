# `/graph-editor` Playwright test plan

Status: living doc, started 2026-06-06. Lives next to
`docs/plans/composition-architecture.md` (the architectural spec these
tests verify).

## Why this exists

The `/graph-editor` page IS the visual+bake+data integration test of
the composition architecture. The data layer has its own unit tests
(`src/lib/cad/composition-graph.test.ts`, 10/10 pass) — but the
acceptance contract for the editor is end-to-end through the GUI:
**click, drag, type, save → assert the canvas + the source pane + the
on-disk file all agree.**

These Playwright tests encode that contract. Every phase corresponds
to a specific user-confirmed workflow. When a phase fails, the
regression is structural; some part of the visual-bake-data trio
silently drifted.

## How to run

```bash
# All phases — headless (CI / fast)
bun run test:graph

# All phases — HEADED with slow_mo: 250 so you can watch every click
PWHEAD=1 bun run test:graph:headed

# Single phase by name (any of: 'phase 1', 'phase 2', 'phase 3', 'phase 4', 'smoke')
PWHEAD=1 bun run test:graph:headed -- --grep 'phase 2'

# Open the HTML report after a run
bun run test:e2e:report
```

Headed mode launches its own Chromium window — you'll see it actually
click `+ Drop`, scrub a slider, drag a wire from the param chip to
`mv.z`, and so on. Recommended whenever the editor's interaction layer
changes (canvas drag mechanics, SVG socket positions, popover anchors,
keyboard shortcuts).

## Phase rollout (13 phases shipped, more coming)

### Phase 1 — `mv` axis param wiring (single-Call)

| Step | Action | Assert |
|---|---|---|
| 1 | Drop a Call (`dt_box`) | 1 `.ge-node-bg.call` on canvas; title `A · dt_box` |
| 2 | Click `⇄` on the Call card | `.ge-inline-label` "mv" visible |
| 3 | Three axis sockets render on the LEFT edge | 3 × `.ge-sock.in.param.tiny` |
| + | Add `p.outerOD` default `4` | 1 × `.ge-param-card`, name `p.outerOD` |
| 4 | Drag param chip output → mv.z (3rd tiny socket) | wire commits |
| 5 | z slot flips to amber `p.outerOD` chip with × | `.ge-arg-pchip` text `p.outerOD` |
| 6 | Bezier wire renders | 1 × `path.ge-wire.param` |
| 7 | Source contains `mv(A, […])` and `p.outerOD` | regex match in `.ge-source` |
| 8 | Edit param default to 6.5 | `.ge-source` contains `default: 6.5` |
| ✕ | Click × on the chip — verifies unwire | wire count drops to 0 |

**File**: `tests/e2e/graph-editor.spec.ts::phase 1`
**Runtime**: ~3.4 s headless / ~12 s headed

### Phase 2 — CSG composition (drag-wire two Calls into a method)

For each `op ∈ {subtract, add, intersect}`:

| Step | Action | Assert |
|---|---|---|
| 1 | Drop `dt_box` (A) + `dt_pin` (B) | 2 × `.ge-node-bg.call` |
| 2 | Drop a `⊖ ⊕ ⊗` method node from CSG picker | 1 × `.ge-node-bg.method` |
| 3 | Drag A's output socket → `method.obj` | 1 × `path.ge-wire.obj` |
| 4 | Drag B's output socket → `method.arg` | 1 × `path.ge-wire.arg` |
| 5 | Source contains `A.<op>(B)` | regex match in `.ge-source` |
| 6 | Bake pane has no error | 0 × `.ge-err` |

**File**: `tests/e2e/graph-editor.spec.ts::phase 2`
**Runtime**: ~10 s headless (3 op variants × ~3.3 s each)

### Phase 3 — Save round-trip

Builds a small graph in the editor, clicks Save, fetches the saved
`.asm.ts` back via `/api/primitives/source`, and asserts the on-disk
source carries the new architecture's signature.

| Step | Action | Assert |
|---|---|---|
| 1 | Drop `dt_shaft` Call | 1 × `.ge-node-bg.call` |
| 2 | Add `p.outerR = 1.5` | 1 × `.ge-param-card` |
| 3 | Drag param output → A's first arg socket | wire commits |
| 4 | Click Save | `.ge-save-stat` says "saved to basic/" |
| 5 | GET `/api/primitives/source?name=test_phase3_save` | 200, has source |
| 6 | Source contains `graph: {` | proof the meta.graph block is on disk |
| 7 | Source contains `outerR` + `p.outerR` | proof the wire reached disk |
| 8 | `data.params` has `outerR` | proof the param schema persisted |

**Doubles as a part generator** — every passing run writes
`test_phase3_save.asm.ts` to the volume.

**File**: `tests/e2e/graph-editor.spec.ts::phase 3`
**Runtime**: ~3 s headless (depends on API latency)

### Phase 4 — Shared dial across multiple Calls

Verifies the "one dial drives N instances" promise of typed wires.

| Step | Action | Assert |
|---|---|---|
| 1 | Drop two `dt_shaft` Calls (A and B) | 2 × `.ge-node-bg.call` |
| 2 | Add `p.outerR = 1.5` | 1 × `.ge-param-card` |
| 3 | Drag param output → A's first arg socket | 1 × `path.ge-wire.param` |
| 4 | Drag param output → B's first arg socket | 2 × `path.ge-wire.param` |
| 5 | Both A and B show the `p.outerR` chip | 2 × `.ge-arg-pchip` |
| 6 | Edit dial to 7.5 | `.ge-source` contains `default: 7.5` |
| 7 | `p.outerR` appears ≥ 2× in source | regex count check |

**File**: `tests/e2e/graph-editor.spec.ts::phase 4`
**Runtime**: ~4 s headless

## Smoke tests (always run)

| Test | What it covers |
|---|---|
| loads with empty canvas | page reachable; +Drop / Save / Reset visible; 0 nodes |
| drops a Call → source pane reflects it | picker → primitive → emit pipeline |
| `+ param` adds a chip | param popover → addParam → render |
| inline edit on param chip re-bakes | param chip foreignObject input → setParamSchema → source updates |
| Reset clears the canvas | Reset button replaces graph with `newGraph()` |

**File**: `tests/e2e/graph-editor.spec.ts::smoke`
**Runtime**: ~5 s headless

### Phase 5 — Vocabulary replication (dt_tube via the editor)

Proves the new graph editor can express the canonical K.68 vocabulary
compose pattern: `A.subtract(B)` where each arg is one of:
literal | param-wire | free-text expression (`p.od / 2 - p.wall`).

| Step | Action | Assert |
|---|---|---|
| 1 | Add params: `od=4.5`, `wall=0.5`, `length=3` | 3 × `.ge-param-card` |
| 2 | Drop two `dt_shaft` Calls (A, B) | 2 × `.ge-node-bg.call` |
| 3 | Click A.r ƒ toggle → fill `p.od / 2` | A's r row has `input.ge-arg-input.expr` with that value |
| 4 | Drag p.length → A.len input socket | A.len becomes `kind:'param'` chip |
| 5 | Click B.r ƒ toggle → fill `p.od / 2 - p.wall` | B's r row has the expression |
| 6 | Drag p.length → B.len input socket | shared dial works |
| 7 | Drop ⊖ subtract method node | 1 × `.ge-node-bg.method` |
| 8 | Wire A.out → method.obj; B.out → method.arg | 2 × wires |
| 9-11 | Source has `A.subtract(B)` + expressions + 0 bake errors | regex matches |
| 12 | Save | `.ge-save-stat` confirms |
| 13 | Fetch back via `/api/primitives/source`; assert meta.graph + kind:'expr' + kind:'param' + `(p)` signature | proves round-trip |

**Doubles as a part generator** — every run writes `dt_tube_v2.asm.ts`
to the volume.

**File**: `tests/e2e/graph-editor.spec.ts::phase 5`
**Runtime**: ~10 s headless

**Test note**: ƒ-toggle clicks use `dispatchEvent('click')` because the
3D bake pane can intercept pointer events when the second Call card
overlaps with it at small viewport widths — same workaround as
`dragBetween` for SVG wires.

### Phase 6 — URL load (`?id=<name>`) + legacy banner

The editor's load-from-URL path proves the data layer's round-trip
through the volume. Two tests:

**6a — hydrates `dt_tube_v2`** (the part Phase 5 saved):

| Step | Assert |
|---|---|
| `goto('/graph-editor?id=dt_tube_v2')` | page loads |
| `input.ge-id` value | `dt_tube_v2` |
| `.ge-node-bg.call` count | 2 |
| `.ge-node-bg.method` count | 1 |
| `.ge-param-card` count | 3 |
| first `input.ge-arg-input.expr` value | `p.od / 2` |
| `.ge-err` count | 0 (bake compiles) |
| source has `A.subtract(B)` + both expressions | regex |
| `.ge-legacy-banner` count | 0 (has meta.graph) |

**6b — legacy banner for `dt_tube`** (translator-generated text body):

| Step | Assert |
|---|---|
| `goto('/graph-editor?id=dt_tube')` | page loads |
| canvas stays empty | 0 calls / 0 methods |
| `.ge-legacy-banner` visible | contains `dt_tube` + 'legacy' |

**File**: `tests/e2e/graph-editor.spec.ts::phase 6`
**Runtime**: ~10 s headless (depends on prod-volume fetch latency)

### Phase 7 — `/vocab` launches the graph editor

The user-facing K.68 integration. From the vocabulary GUI, select a
term → 🧬 Graph editor link appears → click navigates with
`?id=<exemplar>` pre-loaded.

| Step | Action | Assert |
|---|---|---|
| 1 | `goto('/vocab')` | `.vocab-bar` visible |
| 2 | Open `Browse` tab | term list rendered |
| 3 | Click `tube` row | term-detail header rendered |
| 4 | `a.head-graph-link` visible | href matches `/graph-editor?id=dt_` |
| 5 | Navigate to that href | `.ge-bar h1` says "Graph editor"; `.ge-id` has `dt_<exemplar>` |
| 6 | Either canvas hydrates OR legacy banner | `hasNodes + hasBanner > 0` |

**File**: `tests/e2e/graph-editor.spec.ts::phase 7`
**Runtime**: ~7 s headless

## Phases queued (not yet written)

### ✅ Phase 8 — Embedded graph editor in /vocab — SHIPPED

The 🧬 Graph editor chip is now a TOGGLE (button, not anchor). Click it
and an inline iframe panel opens below the term-detail header with the
editor mounted in `?embed=1` mode (SvelteKit nav hidden inside).

| Step | Assert |
|---|---|
| 1 | `goto('/vocab')` + Browse + click `tube` | term selected, no embed panel yet |
| 2 | Click `button.head-graph-link` | `.vocab-graph-embed` visible with src `/graph-editor?id=dt_tube&embed=1` |
| 3 | switch to `frameLocator('iframe.vge-iframe')` | inside the iframe: 2 calls, 1 method, 3 params, canvas visible |
| 4 | `#nav-menu-wrapper` inside iframe | hidden (embed=1 CSS in `<svelte:head>`) |
| 5 | Click `.vge-close` | panel removed from DOM |

**File**: `tests/e2e/graph-editor.spec.ts::phase 8`
**Runtime**: ~5 s headless

**Trade-off vs full component extraction**: iframe keeps the editor's
state self-contained (no prop drilling, no callback bridge for save).
Phase 14's translator already lands graph format on the volume + the
editor's own save flow writes back to the same volume — the iframe
boundary doesn't hide anything the user needs to act on. If/when we
want parent-page reactivity (e.g. closing the iframe should re-bake
the Proposed canvas), that's the moment to do the component-extraction
refactor. For now, iframe ships the user-facing flow.

### ✅ Phase 9 — Inline transforms compose with CSG — SHIPPED

| Step | Action | Assert |
|---|---|---|
| 1 | Drop two `dt_shaft` Calls (A, B) | 2 × `.ge-node-bg.call` |
| 2 | dispatchEvent('pointerdown') on A's first `text.ge-xform-btn` (⇄) | A's `.ge-inline-label` shows `mv` |
| 3 | Fill mv.z input with `3` | mv block has 3 in z slot |
| 4 | Drop ⊖ subtract method | 1 × `.ge-node-bg.method` |
| 5 | Drag A.out → method.obj; B.out → method.arg | wires commit |
| 6 | Source contains `mv(A, [...])` + `.subtract(B)` + `3` | regex matches |
| 7 | `.ge-err` count | 0 |

**Editor fix that landed alongside the test**: when a Call has an inline
mv/rot wrapper, the Call's output socket now reports the WRAPPER's id
(not the Call's). Without this, downstream methods would have bypassed
the transform — emit would be `A.subtract(B)` with an orphan `mv(...)`
sitting unused in the source.

**File**: `tests/e2e/graph-editor.spec.ts::phase 9`
**Runtime**: ~7 s headless

### ✅ Phase 10 — Multi-axis wiring on a single transform — SHIPPED

| Step | Action | Assert |
|---|---|---|
| 1 | Add 3 params x/y/z (defaults 0/0/3) | 3 × `.ge-param-card` |
| 2 | Drop Call + ⇄ inline mv | inline label `mv` |
| 3 | 3 tiny axis sockets on Call's left edge | `circle.ge-sock.in.param.tiny` × 3 |
| 4 | Wire p.x → axis 0, p.y → axis 1, p.z → axis 2 | 3 × `path.ge-wire.param` |
| 5 | 3 chips on mv block (`p.x`, `p.y`, `p.z`) | `.ge-arg-pchip` × 3 |
| 6 | Source has `mv(A, [` + p.x + p.y + p.z | regex matches |
| 7 | `.ge-err` | 0 |

**File**: `tests/e2e/graph-editor.spec.ts::phase 10`
**Runtime**: ~3 s headless

**Selector lesson**: a `g.ge-param-card` aggregates text from every
child (input value, ×, name); `hasText: /^p\.x$/` will fail because it
matches the AGGREGATE. Filter via `has: page.locator('text.ge-param-card-name', { hasText: ... })` instead.

### ✅ Phase 11 — Param schema drift detection — SHIPPED

Surfaces a ⚠ chip on a Call when the underlying primitive's
`meta.params` keys no longer match the Call's `args` keys. Click ⚠ → args
sync to the current primitive: keep existing values for shared keys,
add new keys with defaults, drop orphans.

| Step | Action | Assert |
|---|---|---|
| 1 | Write target v1 with params `{ r, len }` via /api/primitives/save | save 200 |
| 2 | Open editor, drop a Call of the target | no drift (`.ge-drift-btn` count 0) |
| 3 | Save the graph | `saved to basic/` |
| 4 | Rewrite target v2 with params `{ r, len, tag }` | save 200 |
| 5 | Reload `/graph-editor?id=<graph>` | drift chip visible after async fetch |
| 6 | pointerdown on the ⚠ chip | chip disappears |
| 7 | Call card now has 3 arg rows (was 2) | `.ge-arg-row` × 3 inside the call |
| 8 | Source contains `tag:` | regex match |

**File**: `tests/e2e/graph-editor.spec.ts::phase 11`
**Runtime**: ~3 s headless

**Editor changes shipped alongside**:
* `expectedParams: Record<src, string[]>` + `expectedDefaults` cached per src
* `$effect` walks every Call after any graph mutation, lazy-fetches missing srcs
* `isCallDrifted(callId)` derived comparison
* `refreshCallArgs(callId)` rewrites args wholesale (preserve, fill, drop)
* ⚠ chip in the Call card title row, amber, hover deepens to brown
* Cleared automatically after refresh — no manual dismiss

### ✅ Phase 13 — CSG chain (A ⊖ B ⊖ C) — SHIPPED

| Step | Action | Assert |
|---|---|---|
| 1 | Drop 3 dt_shaft Calls (A, B, C) | 3 × `.ge-node-bg.call` |
| 2 | Drop 2 ⊖ subtract methods (M1, M2) | 2 × `.ge-node-bg.method` |
| 3 | Wire A → M1.obj, B → M1.arg, M1.out → M2.obj, C → M2.arg | 4 wires |
| 4 | Source contains `A.subtract(B)` AND `.subtract(C)` | regex |
| 5 | `.ge-err` | 0 |

Proves transitive output→input wiring: a method's `out` can feed another
method's `obj`. Without it, multi-step CSG (the common case) doesn't compose.

**File**: `tests/e2e/graph-editor.spec.ts::phase 13`
**Runtime**: ~4 s headless

### Phase 12 — Standalone wrapper nodes
Drop a Call. Drop a standalone mv wrapper node from the picker (not
inline). Drag-wire the Call's output to the mv's child input. Edit
mv.xyz. Verify source emits the wrapped form correctly.

### ✅ Phase 14 — Translator round-trip (vocab.json → graph editor) — SHIPPED

`src/lib/authoring/rule-translator.ts` gained a `format` option that
defaults to `'graph'` for `kind:'compose'` rules. The legacy text-body
path (`format:'text'`) is kept for back-compat.

| Step | Action | Assert |
|---|---|---|
| 1 | POST `/api/vocab/regenerate?term=tube` | response `ok: true`, regenerated[0].bake.verts > 0, no failures |
| 2 | GET `/api/primitives/source?name=dt_tube` | source contains `graph: {` + `A`/`B` aliases + `op: 'subtract'` + the two expressions + `export function dt_tube(p)` |
| 3 | `goto('/graph-editor?id=dt_tube')` | id pre-filled |
| 4 | Canvas hydrates | 2 calls + 1 method + 3 params + first `.expr` input shows `p.od / 2` |
| 5 | No legacy banner | 0 |
| 6 | No bake error | 0 |

**File**: `tests/e2e/graph-editor.spec.ts::phase 14`
**Runtime**: ~6 s headless

Plus 4 vitest unit tests in `src/lib/authoring/rule-translator-graph.test.ts`
covering: (a) full graph block + correct ArgValue kinds, (b) idempotency
modulo random node ids, (c) text-format opt-in still works, (d) default
is graph-format.

**Important side effect**: this test PERMANENTLY rewrites `dt_tube` on
the prod volume into graph format. Phase 6b therefore writes its OWN
legacy fixture (`dt_test_legacy_banner.asm.ts`) rather than relying on
`dt_tube` still being legacy.

## Maintaining this suite

1. **One phase = one workflow contract.** If a workflow changes, the
   phase tests change with it. Don't add ad-hoc tests inside a phase
   describe block.
2. **Selectors are stable class hooks.** If you rename `.ge-sock`,
   `.ge-arg-pchip`, `.ge-node-bg.call`, etc., update the test file in
   the same commit. The selectors used here are deliberate.
3. **Always run headed before merging an editor change.** The headless
   run catches structural breaks; the headed run catches subtle layout
   regressions (sockets ending up under another element, drag-position
   off by 10 px, etc.).
4. **When a phase fails**, the test trace + screenshot are at
   `tests/results/playwright-report/`. Run `bun run test:e2e:report` to
   browse interactively.
5. **Add a new phase** when the architecture grows a new workflow. The
   docs/plans/composition-architecture.md plan file lists the slice
   roadmap; each new slice should land a corresponding phase test.

## Test helpers in `graph-editor.spec.ts`

Reusable across phases — when you write a new phase, compose these:

```ts
openEditor(page)                  // navigates + waits for canvas
setExemplar(page, id)             // sets the exemplar id input
openPicker(page)                  // opens the + Drop popover
pickPrimitive(page, name)         // filters + clicks one in the Call section
pickCsg(page, op)                 // clicks one of subtract/add/intersect
addParam(page, name, default)     // + param button → fill name + default → add
dragBetween(page, from, to)       // mouse drag between two Locators' centers
callCount(page)                   // count of .ge-node-bg.call
methodCount(page)                 // count of .ge-node-bg.method
paramChipCount(page)              // count of .ge-param-card
```

Add new helpers in the file's helper section near the top — keep them
small, pure, and named after the workflow they encode.
