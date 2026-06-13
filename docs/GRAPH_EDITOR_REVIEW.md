# GraphEditorPane.svelte — code review + debug plan

- **File under review**: `src/lib/shared/GraphEditorPane.svelte` (~8,914 lines)
- **Date**: 2026-06-13
- **Scope**: full read; analysis focused on the script (lines 20-4444), which is the bug-prone surface. Template (4460-7537) and styles (7538+) skimmed.
- **Verdict**: Core save/bake/emit paths look sound and the known reactivity gotchas are already handled (effect-loop dedupe at 1004/1462, WebGL-context gating via the `active` prop, source/args pairing at 1438). The real issues are a **leaked global listener**, a **stale `graph.edges` mutation**, and some **latent reactivity fragility** — none are data-loss level.

## Findings (quick scan)

| # | Severity | Location | Summary |
|---|----------|----------|---------|
| 1 | High | 878-884 | Top-level `window.addEventListener('keydown')` never removed; one per instance (multi-tab leak) |
| 2 | Medium | 2710-2727 | `refreshCallArgs` raw node-spread skips `finalize()` → stale `graph.edges`/`imports` |
| 3 | Medium | 6735-6738 | Canvas `args` fresh-array fallback = documented re-mount/auto-fit loop trap |
| 4 | Low | 1080 | `firstBakeDone` plain `let` read in `$effect`s; works only via `bake` gating (fragile) |
| 5 | Low | 169 / 176 / 2682 | Double `emitGraph` per render; expected-params effect extra reruns |
| 6 | Low (resolved) | 145 / 151 | `embed`/`exemplarId` props snapshotted once — confirmed safe; `/primitives` keys panes by `t.key` |

---

## 1. High — leaked global keydown listener (one per instance)

```js
// lines 878-884
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (polyDeleteMode || polyInsertMode)) {
      polyDeleteMode = false; polyInsertMode = false;
    }
  });
}
```

This runs at the top level of `<script>`, so it fires **once per component instance** with an **anonymous handler that is never removed**. Every other window listener in the file is correctly registered/cleaned in `onMount` (e.g. `onWindowKeydown` at 1288-1292, the tooltip listeners at 1379-1392).

Consequences in the `/primitives` multi-tab wrapper (one `GraphEditorPane` per tab):

- Closing a tab leaves its listener (and the whole component closure) un-GC'able — a genuine leak that grows with tab churn.
- Every `Escape` keystroke runs N handlers, each toggling a *different* tab instance's `polyDeleteMode`/`polyInsertMode`.

**Fix**: fold this into the existing `onWindowKeydown` (which already handles `Escape` for wires at 1267) and register/clean it in the `onMount` at 1288-1292, or wrap in its own `onMount` that returns a `removeEventListener` cleanup.

## 2. Medium — `refreshCallArgs` bypasses edge rebuild

```js
// lines 2710-2727
function refreshCallArgs(callId: NodeId) {
  ...
  // Mutate via setCallArg one key at a time — preserves edge index rebuild.
  let g = graph;
  // First strip orphan keys via a node replacement.
  const updated = { ...node, args: { ...newArgs } } as any;
  g = { ...g, nodes: { ...g.nodes, [callId]: updated } };
  graph = g;
}
```

The comment claims it uses `setCallArg`, but it actually does a **raw node-spread that skips `finalize()`**. In `src/lib/cad/composition-graph.ts`, `setCallArg` (1401-1406) calls `finalize()` → `collectEdges()` → rebuilds `graph.edges` + `imports` (568-576). The raw spread here does not, so after a drift-refresh that drops a param-wired orphan key (or otherwise changes args), `graph.edges` is left **stale** until the next finalize-using mutation. `graph.edges` drives wire rendering and `slotsForParam` (the orphan check on param delete, 553-557), so this can briefly show/keep a phantom wire or mis-report orphans.

**Fix**: export `finalize` (or re-derive via `collectEdges`) and return `finalize({ ...graph, nodes: { ...graph.nodes, [callId]: updated } })`, or apply the surviving keys through `setCallArg` as the comment intends.

## 3. Medium — fresh-array prop in the canvas fallback

```svelte
<!-- lines 6735-6738 -->
<PrimitiveDualCanvas id={exemplarId} name={exemplarId} description=""
  args={bake.args ?? Object.values(graph.params).map((p) => p.default)}
  source={bake.source}
  showControls={true} showLabels={false}/>
```

The `?? Object.values(graph.params).map(...)` fallback allocates a **new array reference every render** — exactly the anti-pattern called out in `src/lib/cad/CLAUDE.md` and the `fresh-array-props-effect-loops` memory (a fresh array prop can re-mount the canvas / loop its auto-fit). It only triggers in the window before `bake.args` is first set, so it's latent rather than constant, but it's the kind of thing that bites after a refactor.

**Fix**: back it with a memoised `$derived` (e.g. `let paramDefaults = $derived.by(() => Object.values(graph.params).map((p) => p.default))`) and pass `args={bake.args ?? paramDefaults}`.

## 4. Low — `firstBakeDone` is a plain `let`, not `$state`

```js
// line 1080
let firstBakeDone = false;
```

It's read inside two `$effect`s (the initial-bake gate at 1421/1453 and the auto-bake guard at 1471) but isn't reactive. It happens to work because those effects re-run on the reactive `bake`/`graph`/`bakeNonce` they also touch, and the `bake === 'loading'` gate serializes the sequence. This is fragile: any change that stops routing through `bake` reactively would silently break the "fire exactly one initial bake" logic or re-enable a blocked bake.

**Fix**: either make it `$state` or leave a pointed comment about why it must stay a plain `let`.

## 5. Low — minor perf / reactivity

- `emitted` (169) and `emittedForRender` (176) each run a full `emitGraph(graph)` on every render — two complete emits per change. Could derive `emittedForRender` from `emitted` when `ghostIds` is empty.
- The expected-params `$effect` (2682) reads `expectedParams[src]` synchronously inside the loop via `loadExpectedParamsFor`, so it re-runs once per src as each populates. It converges (idempotent guard at 2657) but does extra work; keying the effect on the set of srcs would avoid it.

## 6. Low (resolved) — props snapshotted once

`embed` (151) and `exemplarId` (145) are seeded from props at init and intentionally never re-read (documented at 141-143). This is correct **only if** the `/primitives` wrapper keys each pane so changing a tab's part forces a remount.

**Confirmed safe.** `src/routes/primitives/+page.svelte` mounts each pane inside `{#each tabs as t (t.key)}` keyed by `t.key` (line 889) with `id={t.id}` (897-898). Opening a different part creates a new tab key → fresh mount. AI-generate renames in place (`onGenerated` → `renameActiveTab`), but `generateFromPrompt` already updates the component's own `exemplarId`, so the in-place id change is handled internally and only the tab label needs syncing. No remount required, no stale-prop bug in current usage.

---

## Debug / fix checklist (ordered)

1. **[High] Listener leak (finding 1)** — move the top-level `Escape` keydown handler into `onWindowKeydown` + the `onMount` at 1288, ensure cleanup. Verify: open/close several `/primitives` tabs, confirm no listener accumulation (DevTools → Elements → Event Listeners on `window`).
2. **[Medium] `refreshCallArgs` edge rebuild (finding 2)** — route through `finalize`/`setCallArg`. Verify: drift-refresh a Call that has a param-wired arg, confirm wires render correctly and param-delete orphan detection is accurate.
3. **[Medium] Canvas fallback array (finding 3)** — introduce a memoised `$derived` for the param-defaults fallback.
4. **[Low] `firstBakeDone` (finding 4)** — convert to `$state` or annotate.
5. **[Low] Emit/effect cleanups (finding 5)** — optional; derive `emittedForRender` from `emitted`, key the expected-params effect on the src set.
6. **[Low] Pane keying (finding 6)** — confirmed safe, no action needed.

After each change: `bun run build` + `bun test`, and prompt for an e2e run per CLAUDE.md Rule 11 (`/primitives`, `/graph-editor`, `/vocab`, `/primitives/profiles`).
