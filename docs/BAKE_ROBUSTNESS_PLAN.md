# Bake round-trip robustness — root-cause + fix plan

**Date**: 2026-06-13. Trigger: a g_tube assembly (g_dp_box + g_tube + g_dp_pin
stacked) with degenerate params produced
`memory access out of bounds [in g_shaft → r_revolve({profile:?, segments:256})]`,
after which the **whole app stopped loading** until the dev server was
restarted. Complements `docs/GRAPH_EDITOR_REVIEW.md` (client review) with the
server/WASM findings.

## The cascade (why one bad bake takes everything down)

1. **Degenerate geometry reaches Manifold.** A CSG/revolve gets a bad profile —
   NaN/undefined param, a profile collapsed to the axis (all r≈0), zero-area, or
   a subtract of two identically-dimensioned solids → empty. No input
   validation before the WASM boundary.
2. **Manifold WASM aborts** ("memory access out of bounds") **and the shared
   WASM singleton is corrupted.** `src/lib/cad/manifold-helpers.ts:38-39,119-134`
   stores ONE `globalThis.__cadtrain_manifold__` instance, initialised once
   (`initManifold` early-returns if `wasm` is set). There is **no try/catch that
   re-instantiates after an abort**.
3. **No recovery → every subsequent bake fails.** All `/api/primitives/preview`
   + `/bake-preview` requests reuse the corrupted instance → they all error →
   the app is unusable server-side. **This is the "everything breaks" root
   cause** (not the client).
4. **Client loops.** On the persistent bake error, GraphEditorPane re-emits a
   FRESH `args` array / `source` each render (`bake.args ?? Object.values(...)`,
   review finding #3); `PrimitiveDualCanvas`'s rebuild `$effect` is keyed on
   `JSON.stringify({id,args,source})`, so the changing key re-fires
   `rebuild()` → `/preview` + `/bake-preview` 400s in a tight loop → flood.
5. **Misleading hint wedges the dev server.** The error message matches the
   `GraphEditorPane` regex `/parameter 0 has unknown type|memory access out of
   bounds/` (~line 6722) → shows the **"🔄 Restart dev server"** hint. The user
   clicks it; the in-app `/api/__dev_restart` wedges the server (came back 000),
   compounding the outage.

Separately surfaced and already shipped this session:
- 404 `/source` flood (a 404ing dep re-fetched every graph change) — fixed with
  an attempted-once guard + a server flood guard (`366241b`, `bab89d8`).
- `finalizeManifold` now throws a clean "EMPTY solid" on a 0-triangle result —
  but the OOB happens INSIDE r_revolve, BEFORE finalize, so input validation is
  still needed upstream.

## Other round-trip gaps found (audit)

- **🔴 `_renderZScale` global race** (`builder.ts:495-496,532`) — module-level
  var mutated per request; concurrent bakes can scale geometry wrong. Thread it
  through `finalizeManifold` instead of a global.
- **🟡 Save not blocked on validation errors** (`GraphEditorPane` save button) —
  a graph with broken node refs can be saved → file throws on next load.
- **🟡 `errorKind`/`depChain` not surfaced** — the server already returns
  `errorKind:'wasm-oob'` + `depChain` (`preview/+server.ts:145-150`) but
  `bakeGraphPreview` ignores them, so the editor can't point at the failing node.
- **🟡 `refreshCallArgs` skips `finalize()`** (review #2) → stale `graph.edges`.
- **🟡 leaked top-level keydown listener** (review #1) — one per tab instance.
- Save/load IS lossless (sketch `mode`, spline `pts`, `args` all round-trip).

## Probe result (2026-06-13, step 0a) — WASM is robust; the loop is the killer

`scripts/wasm-recovery-probe.ts` ran the real `r_revolve`/`weldAndBuild` path
AND raw CSG/cutaway/compose with NaN, all-on-axis, single-point, negative-r,
identical-subtract→empty, union-of-200, compose([]), huge-translate. **None hard-
crashed.** Every degenerate input either threw a RECOVERABLE error ("Not
manifold", "Non-finite vertex") or returned an empty manifold (volume 0), and
the shared WASM instance stayed healthy after every case.

**Conclusion:** the "one OOB corrupts the shared WASM forever → server dead"
hypothesis is NOT supported — Manifold is robust to degenerate geometry. The
PROVEN "everything breaks" mechanism is the **client request-flood loop** (seen
twice in Railway logs: `/source` 404s, then `/profiles/resolve` 400s) saturating
the API. The `memory access out of bounds` is a recoverable bake error that
*triggers* the loop via the misleading restart-hint + rebuild-on-error churn.

**Re-prioritization:** demote 0a (WASM recovery) to cheap defense-in-depth (NOT
the root cause; keep only as a small guard). PROMOTE the client-loop fix (0c),
the clean-error handling (0b), and the misleading-hint fix (1b) to the front —
they address the actual outage.

## Fix plan (prioritized — revised after the probe)

### P0 — stop the cascade (the fundamental fix)

**0a. _(demoted — defense-in-depth, not root cause)_ WASM crash recovery (server).** `manifold-helpers.ts`: add
`resetManifold()` that clears `G.__cadtrain_manifold__ = {wasm:null, M:null}`;
make `initManifold()` able to re-instantiate. In the preview + bake-preview
endpoints, on a Manifold abort/OOB, call `resetManifold()` so the NEXT request
re-inits a clean instance instead of inheriting corruption.
> **VALIDATE FIRST**: prototype that after an OOB, `resetManifold()` + a fresh
> `await Module()` actually bakes successfully. If the abort poisons the wasm
> memory irrecoverably within the process, escalate to an out-of-process bake
> worker (heavier; only if reset doesn't recover). This single check decides
> 0a's shape — do it before building the rest.

**0b. Input validation before the WASM boundary.** `manifold-mesh.ts`
(`revolveProfile`/`weldAndBuild`) + `stdstale/r_revolve.ts`: reject a profile
that is non-finite, has < 3 points, is entirely on the axis, or has zero area —
throw a clean, friendly error ("revolve profile is degenerate …") BEFORE handing
it to Manifold. This prevents the OOB from ever happening for the common cases.

**0c. Break the client loop.** (1) `GraphEditorPane`: memoise the param-defaults
fallback as a `$derived` so `args` is a stable reference (review #3). (2)
`PrimitiveDualCanvas`: track consecutive bake failures and STOP re-issuing the
same failing `{id,args,source}` key (no retry until the key changes) so a
persistent error can't flood.

### P1 — correct, non-misleading errors

**1a.** `bakeGraphPreview` surfaces `errorKind` + `depChain`.
**1b.** `GraphEditorPane` error UI: when `errorKind==='wasm-oob'` (or the new
degenerate-profile error), show "Invalid geometry — check the params (a
revolve/CSG produced empty or invalid geometry)" and DO NOT show the
restart-dev-server hint. Reserve that hint for genuine stale-module errors.
**1c.** Decide the fate of the in-app "🔄 Restart dev server" button — it wedged
the server; either fix `/api/__dev_restart` to restart cleanly or remove the
button (prefer remove + document the manual restart).

### P1 — concurrency + save safety

**1d.** Remove the `_renderZScale` global race — thread zScale as a
`finalizeManifold` argument.
**1e.** Block Save when `emitted.validationErrors.length > 0` (disable the
button + tooltip).

### P2 — hygiene (from the client review)

**2a.** Move the top-level keydown listener into `onMount` + cleanup (review #1).
**2b.** Route `refreshCallArgs` through `finalize()`/`setCallArg` (review #2).
**2c.** Optional: derive `emittedForRender` from `emitted` when no ghosts;
key the expected-params effect on the src set (review #5).

## Verify (each step)

`bun run build` + `bun test`, then the empty/degenerate repro: open the stacked
assembly, set the same OD on both shafts → expect ONE clean "invalid geometry"
error, the 3D pane showing the error (not blank-looping), the server STILL
healthy afterwards (subsequent bakes of OTHER parts succeed — proves 0a), and no
request flood (watch Railway logs + the local network panel).
