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

## Phase rollout (4 phases shipped, more coming)

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

## Phases queued (not yet written)

### Phase 5 — Inline transforms compose with CSG
Drop A and B, drop `⊖ subtract`, wire them. Toggle `⇄` on A → inline mv
appears. Edit mv.z. Verify source emits `mv(A, [0, 0, N]).subtract(B)`.

### Phase 6 — Multi-axis wiring on a single transform
Wire `p.x` to mv.x, `p.y` to mv.y, `p.z` to mv.z all on the same Call.
Verify 3 wires, 3 chips, source has `mv(A, [p.x, p.y, p.z])`.

### Phase 7 — Param schema drift detection
Set up a Call wired to a param. Edit the underlying primitive's source
(adds a new arg). Reopen the editor — verify the drift badge fires + the
refresh action grows the Call's arg list.

### Phase 8 — Legacy load + amber banner
Open an old-format `.asm.ts` (no `meta.graph`). Verify amber legacy
banner + read-only source pane below the empty canvas.

### Phase 9 — Standalone wrapper nodes
Drop a Call. Drop a standalone mv wrapper node from the picker (not
inline). Drag-wire the Call's output to the mv's child input. Edit
mv.xyz. Verify source emits the wrapped form correctly.

### Phase 10 — CSG chain (A ⊖ B ⊖ C)
Three Calls + two subtract method nodes chained. Verify the source
emits `A.subtract(B).subtract(C)` and bake renders. Tests transitive
output→input wiring.

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
