# Detach transforms (mv/rot/xform) from the Call card → standalone chainable nodes

**Status:** planning (2026-07-01). User direction: stop ATTACHING mv/rot/xform to a
part's Call card; instead CHAIN them as standalone nodes (mv is now a compact icon).
Cleaner code, more generative, more networkable.

## Today (two render/emit paths — the problem)
- **Standalone** mv/rot: now a compact glyph ICON + x/y/z click-popover (shipped this
  session) — one child input (left), one output (right), chainable by wiring.
- **Inline strips**: the `⇄`/`↻` buttons on a Call card (`NodeCard` toggleInlineTransform)
  ATTACH an mv/rot to that Call; rendered as STRIPS hanging off the card
  (`geom.ts` STRIP_* + `xformSocketAt` + `attachedTransforms` + NodeCard "Attached
  transforms" block); emitted as wrapping — `rot(mv(A, …), …)`.

Two paths for the same operation = extra code, and the inline form couples the transform
to one part (not composable / not a first-class graph node a generator can enumerate).

## Target (one path — chained nodes)
To translate/rotate a part: drop an `mv`/`rot` node and wire `part.output → mv.child`,
`mv.output → next`. Each op is a standalone, wireable, chainable graph node. A shape can
fan its output into several transforms; an AI/generator can enumerate ops + wire by type.

## Plan
1. **Chained is the only model.** Standalone mv/rot already emit correctly (each node wraps
   its `child`: `mv(child, [x,y,z])`) — confirm parity with the inline `rot(mv(…))` emit +
   ordering.
2. **Retire the inline attach.** Remove the `⇄`/`↻` toggles from the Call card (or repurpose
   them to "drop a chained mv/rot wired after this"). Once no parts use attached transforms,
   remove the inline-strip rendering + `xformSocketAt` + `attachedTransforms` + STRIP_* geom.
3. **Migration (load-bearing).** Existing parts embed attached transforms — add a hydrate
   migration that MATERIALIZES each attached mv/rot into a standalone node wired into the
   chain (so old parts open identically). Verify a few real parts (g_dp_*, stacks) bake the
   same before + after.
4. **xform (combined rot+mv).** Same treatment — either a standalone xform icon or just
   chain an mv + a rot.

## Payoff / risk
Payoff: one transform code path; transforms are first-class chainable nodes (generative +
networkable); simpler Call card. Risk: the migration — attached transforms are used by
shipped parts, so the hydrate converter must be exact (bake-parity tested) before removing
the inline path. Pairs with typed ports (#13/#20 — mv/rot get typed geometry sockets) and
the "networkable" builder direction (#11).
