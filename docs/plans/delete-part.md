# Delete-a-part (✕) in the /primitives Parts tab (2026-05-23)

> Status: PLANNING. Inverse of `loadPrimitive` ("Add"). Deletes a composite
> instance by splicing `editedSource`, then the existing recognize `$effect`
> re-scans + the canvas re-bakes; user clicks Save source. No new API endpoint.

## Recognizer gap + extension (`src/lib/server/recognize-composite.ts`)
Today the composition is only an opaque `compStart..compEnd` span — no per-operand
spans. Extend (all additive; set defaults at BOTH return sites so the no-fn
early return stays valid):
- **`operands: RecognizedCompositionOperand[]`** on `RecognizedComposite`. Each:
  `{ name|null, isBase, segStart, segEnd, argStart, argEnd, op|null }`. Computed
  in the `ReturnStatement` branch by walking the left-leaning member-call chain
  (`A.subtract(h1).add(ball)`): for each `CallExpression` with a `MemberExpression`
  callee, `op = callee.property.name`, the mid-chain SEGMENT span = `callee.object.end .. node.end`
  (the `.op(X)` text), the inner operand expr span = `argStart/argEnd`; step left
  via `callee.object`; the final non-call node is the BASE (`isBase`, `op:null`).
  `name` = the arg/base Identifier name, else null (non-deletable inline op).
- **`declStart/declEnd`** on `RecognizedInstance` = the enclosing `VariableDeclaration`
  statement span (so removing `const X = …;` incl. mv/rot wrappers is one splice;
  `initStart/initEnd` only cover the RHS).
- **`usesElems: {id,start,end}[]`** — per-element spans of the `meta.uses` array.
- **`entryStart/entryEnd`** on `RecognizedProfile` — the whole `name:{…}` entry
  span (to delete a solely-owned profile, not just its `value`).

## Delete algorithm (`deletePart(inst)` in PrimitiveView, all on `editedSource`)
Mirror `loadPrimitive`: build `{s,e,text}` edits from ONE `recognized` snapshot,
sort high→low, apply (never re-recognize mid-edit).
- **Guards**: `canEdit`; `inst.declStart>=0`; cross-instance-ref check (block).
- **(i) Remove declaration**: splice `declStart..declEnd` (+ trailing newline).
  Wrappers go with it (initStart/End already span the outermost mv/rot).
- **(ii) Remove composition operand** via `operands` lookup by name:
  - mid-chain → splice `segStart..segEnd` (drops `.op(X)`).
  - base with ≥1 mid remaining → promote next: replace `base.segStart .. firstMid.segEnd`
    with `editedSource.slice(firstMid.argStart, firstMid.argEnd)`.
  - sole operand → **block** ("can't delete the only part"; never emit `return ;`).
- **(iii) `meta.uses`**: count remaining callers of `inst.call` among OTHER
  instances; remove the `usesElems` entry ONLY if count==0 (deleting h1 keeps
  "r_cylinder" while h2 uses it). Swallow one adjacent comma.
- **(iv) `meta.profiles`**: remove an entry only if no remaining instance
  references `meta.profiles.<P>` (reuse `profileRefName`); swallow one comma.
- Apply edits (high→low) → set `editedSource`; drop the name from
  `pinnedParts`/`activeOpen`.

## Edge cases
- **Cross-instance ref** (`B=mv(B,[0,0,X.top])`, or another operand's base is X):
  DETECT (word-boundary identifier scan over other instances' arg/transform text
  + operands) → **block** with a friendly message; no partial edits.
- **Base promotion**: `X.subtract(h1).subtract(h2)` − X → `h1.subtract(h2)`.
- **Non-editable** (TS-annotated, `editable:false`): ✕ not rendered (like inline arg editors).
- **Operand name null** (inline op in return): block ("couldn't locate X").

## UI (`PrimitiveView.svelte`)
- ✕ button in the instance accordion head next to 📌 pin + ✎ profile
  (`e.stopPropagation()`); class `pv-part-del` (clone `pv-part-txdel`).
- **Confirm** via a small FloatingPanel anchored to the button (mirror txAdd /
  saveAs), previewing the effect ("removes its declaration + drops it from the
  composition" + conditional "removes 'r_cylinder' from meta.uses" / "keeps it
  (used by h2)").
- Round-trip: splice → `$effect` re-recognizes → canvas re-bakes → Save source enables.

## File-level steps + risks
1. Recognizer extension (additive, unit-testable) → 2. PrimitiveView logic+UI →
3. `bun run build` green → 4. Chrome verify (delete a mid-chain hole: row gone,
composition updates, shared meta.uses kept, re-bake, Save enables).
- **Risks**: comma handling on uses/profiles element removal (first/mid/last);
  base-promotion needs the inner-arg spans; cross-ref detection must be
  token-aware (not substring); apply all splices from one snapshot high→low.
- No API change (recognize spreads the new fields through; save persists).

### Critical files
`recognize-composite.ts` (extension) · `PrimitiveView.svelte` (logic + ✕ UI) ·
`api/primitives/recognize/+server.ts` (passes new fields through, no change).
