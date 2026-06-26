# Repeat editor → draggable/resizable popover with wireable params

**Status:** planned 2026-06-26 (screenshot-driven session). Parity with the
2026-06-26 Expression-builder popover redesign (`expression-builder.md §v3.10`),
which is the reusable template for the chrome.

## Goal

Replace the full-tab `RepeatEditorPane.svelte` overlay with a **`RepeatBuilderPopup`**
— a draggable + resizable popover whose LEFT pane authors **wireable params**
that feed the **repeat loop** (parts + per-iteration transforms) in the RIGHT
pane. The collapsed node card then surfaces those params above the parts.

## Current state (what already exists)

- `RepeatEditorPane.svelte` (~298 lines) — full-tab overlay with: an iterators
  strip (count / op / loopVar), a PARAMS section (`bindings[]` = `name = expr`,
  per-iteration values usable in transforms), a PARTS section (each child + its
  `partModifiers` mv/rot stack), and a LOOP BODY (wired ⇄ code override).
- Repeat node model (no change needed):
  `{ count, op, loopVar, bindings[]{name,value:ArgValue}, children[], partModifiers{}, bodyExpr }`.
- Mutators already present: `addRepeatBinding` / `setRepeatBindingName` /
  `setRepeatBindingValue` / `removeRepeatBinding`, `addPartModifier` … , etc.

So this is mostly **re-housing + new wire plumbing**, not new modelling.

## Target layout

```
┌─ ↻  [draggable header]                              ⤢ ✕ ┐
│ PARAMS (left 30%)        │  THE LOOP (right 70%)          │
│  ○ spacing = [wire]      │  count [ ]  op [▾]  var [ i ]  │
│  ○ angle   = i*360/N     │  PARTS                         │
│  + add param             │   0  partA  ⊕mv  ▲ ▼  ×        │
│   (each ○ = a wireable    │       ⇄mv  x y z              │
│    INPUT socket)         │   1  partB  …                  │
│                          │  LOOP BODY   wired │ code       │
└──────────────────────────┴────────────────────────────────┘   (resize grip ⌟)
```

- **LEFT 30% — PARAMS** (the `bindings`): editable `name = value`, each with an
  **input-socket** node so the param can be *wired* (an upstream output /
  expression output / part param → the param), not only typed. `+ add param`.
- **RIGHT 70% — THE LOOP**: iterators (count / op / loopVar) on top, then PARTS
  + per-part mv/rot transforms (consume `i`, `N`, and the params), then the
  wired/code LOOP BODY. This is the loop the params feed.

## Node card (collapsed view)

- Render the param rows **just above the parts**, each with a connector socket on
  the card's left edge — **only when params are defined in the popover** (no
  bindings ⇒ no param section, card shows parts as today).
- The popover is the authoring surface (define / edit / delete params); the card
  mirrors what's defined + exposes the sockets for quick wiring.

## Phases (each shippable + browser-verified; build green between)

1. **Popover shell** — new `RepeatBuilderPopup.svelte` reusing the EXACT
   drag/resize/clamp pattern from `ExpressionBuilderPopup` (header grab handle,
   `pos` overrides the click anchor, `resize: both` corner grip, min 520×320).
   Launch from the repeat card's ✎ at the click point. Decide: retire
   `RepeatEditorPane` or keep it behind a flag during transition.
2. **Left pane params** — relocate the `bindings` rows; add the per-row input
   socket dot + `+ add param`.
3. **Right pane loop** — relocate iterators + PARTS + per-part transforms +
   LOOP BODY (wired/code).
4. **Card: params above parts** — render binding rows + left-edge sockets on the
   repeat node card, above the parts, gated on `bindings.length > 0`.
5. **Wire + emit** — make param sockets real wire TARGETS (output → repeat
   param); the binding value resolves from the wired source. **Verify emit/bake
   is byte-identical** for existing repeats that aren't wired.

## Decisions locked

- **Full wireable sockets** (not visual-only) — params are real wire targets.
- **Card shows params only if defined in the popover** — popover is the authoring
  surface; empty bindings ⇒ no param section on the card.
- Params are INPUTS (fed); the loop's single geometry OUTPUT socket already
  exists on the card — unchanged.

## Open questions (resolve at build time)

- Retire `RepeatEditorPane` outright, or keep both during transition?
- Iterators (count/op/loopVar): top of the right pane vs the header?
- Does the popover need a NAME field (like expr defs)? Repeat is inline + not
  reusable → probably no name; keep header minimal (↻ + actions).

## Reuse / risk

- Chrome (drag/resize/clamp CSS + handlers) is lifted verbatim from
  `ExpressionBuilderPopup` → low risk.
- **Net-new:** wiring an external output INTO a repeat param socket (Phase 5) is
  the only genuine wire-system addition; everything else is relocation.
