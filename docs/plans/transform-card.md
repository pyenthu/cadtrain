# Plan: TXFMN — a single transform card replacing the mv/rot strips

**Status:** PROPOSED (not built). 2026-06-16.
**Scope:** `src/lib/graph/composition-graph-*.ts`, `composition-emit.ts`,
`src/lib/shared/graph-editor/{geom.ts,wire-state.svelte.ts,GraphEditorPane.svelte}`.
**Goal:** collapse the two separate `mv` + `rot` inline strips into ONE compact
**TXFMN** card with two sections (ROT / MV), each row carrying a ƒ-expr input
and an output… no — an **input** socket on the right for wiring a PARAM into
that axis. Reuse the existing socket↔wire geometry and `WireState`.

---

## 0. How it works today (baseline — read before editing)

- **Two node types.** `MvNode = { type:'mv'; child; offset:[ArgValue×3] }` and
  `RotNode = { type:'rot'; child; rot:[ArgValue×3] }`
  (`composition-graph-types.ts:85-86`). Each holds three `ArgValue`s
  (`literal | expr | param`).
- **They nest, they don't merge.** A transform wraps a single `child`. To get
  both a rotate and a translate on one Call you stack two wrapper nodes:
  `mv(rot(A,[…]),[…])`. `wrapInTransform` (mutate.ts:884) replaces the target in
  its parent container's `children` with the new wrapper.
- **Inline rendering = STRIPS.** `geom.ts` (`attachedTransforms`,
  `xformStripAt`, `xformSocketAt`, `xformOutputAt`, `xformArrows`,
  `STRIP_W/H/GAP/...`) collects every mv/rot whose `.child` chain bottoms out at
  a Call and renders each as a 92×44 strip hanging off the Call's right edge,
  cascading `col=⌊i/2⌋, row=i%2`. The strip render lives in
  `GraphEditorPane.svelte:4568-4607`; the 3 axis sockets per strip face
  outward (top edge row-0 / bottom edge row-1).
- **Standalone card** (when a transform wraps a Method/Stack, not a Call):
  `GraphEditorPane.svelte:4669-4776` — a 3-row xyz card with per-axis left-edge
  sockets, ƒ-expr popover, and a title-row output socket.
- **Wiring.** A PARAM chip's output socket → an axis socket calls
  `wire.endWireOnTransformAxis(ev, transformId, axis)` →
  `setTransformAxisValue(graph, id, axis, asParam(name))`
  (wire-state.svelte.ts:187 / mutate.ts:858). `unwireTransformAxis` reverts to a
  literal. Param→slot wires are denormalised into `graph.edges` by
  `collectEdges` as `{from:'p.<name>', to:'<id>.offset.<i>' | '<id>.rot.<i>'}`
  (mutate.ts:66-80).
- **Emit** (`composition-emit.ts:432-440`): `mv` → `mv(child,[x,y,z])`,
  `rot` → `rot(child,[rx,ry,rz])`; the nesting comes from `ref(node.child)`.
  Helpers: `mv` = `m.translate(v)` (carries datums), `rot` = `m.rotate(v)`
  (manifold-helpers.ts:310/322). **Z-down holds** (cad/CLAUDE.md): +Z is
  down-hole; this card touches no signs.
- **Creation:** `+` picker → *position* submenu → `dropMv`/`dropRot`
  (GraphEditorPane.svelte:2290) drop a placeholder; OR the ⇄/↻ glyphs on a Call
  card toggle an inline wrapper (`toggleInlineTransform`, :3607).

### Application-order question (load-bearing)

The intended convention is **rotate, then translate** ("rot then mv"): spin the
part about the origin, then move it into place. In Manifold that is
`A.rotate(r).translate(o)` = `mv(rot(A, r), o)` → **rot is the INNER call, mv is
the OUTER call.** The TXFMN emit must reproduce exactly this so existing baked
geometry is unchanged.

---

## 1. Data model — ONE `TxfmnNode`, mv/rot become its two fields

Add a new node type that carries BOTH triples. Do **not** keep composing two
nodes; the whole point is a single attached card.

```ts
// composition-graph-types.ts
export type TxfmnNode = {
  id: NodeId;
  type: 'txfmn';
  child: NodeId;                        // the shape this transform applies to
  rot:    [ArgValue, ArgValue, ArgValue];   // [rx, ry, rz] degrees   (applied FIRST)
  offset: [ArgValue, ArgValue, ArgValue];   // [x, y, z] translate    (applied SECOND)
};
```

- Reuses `child` (so all the chain/wrapper machinery in `geom.ts` works with a
  one-line type-guard change), and reuses the field NAMES `rot` + `offset` that
  `MvNode`/`RotNode` already use — so `setTransformAxisValue`, `collectEdges`,
  and the emit value-walk need the smallest possible diff.
- `GraphNode` union (types.ts:203) gains `| TxfmnNode`.
- Identity default: all six = `asLiteral(0)` → emits identity, bakes a no-op.

**Why one node, not "compose mv+rot":** a single card with two sections needs a
single owning node to hold layout, the attached-to-Call relationship, the output
socket identity, and the six edges. Two nodes would re-introduce the chain
nesting the strips already model — exactly what we're replacing. The emit
(§4) re-expands the one node into the `mv(rot(...))` nesting so the *generated
script and baked geometry are identical* to today's two-node form.

### Keep MvNode/RotNode as resolvable legacy types

Mirror the `PolygonRepeat` precedent (types.ts:116): `MvNode`/`RotNode` stay
declared so hydrate can recognise and MIGRATE them (§5), and so any
not-yet-migrated in-memory graph still type-checks. New code never CREATES them.

---

## 2. Mutators (`composition-graph-mutate.ts`)

| New / changed | Purpose |
|---|---|
| `addTxfmn(graph, child, parentId?)` | drop a TXFMN (identity defaults). Replaces `addMv`/`addRot`. |
| `addTxfmnPlaceholder(graph, parentId?)` | unwired (`child=''`) drop for the picker. |
| `wrapInTxfmn(graph, targetId)` | replace target in its parent container with a fresh identity TXFMN wrapping it (was `wrapInTransform`, now single-kind). |
| `unwrapTxfmn(graph, id)` | inverse — hoist child back (was `unwrapTransform`). |
| `setTransformChild` | unchanged signature; add `'txfmn'` to the type-guard. |
| `setTxfmnAxis(graph, id, field:'rot'\|'offset', axis, value:ArgValue)` | generalises `setTransformAxisValue` over the two fields (old fn keyed off node.type; now the field is explicit). Keep a thin `setTransformAxisValue` shim that infers `field` for legacy callers during migration. |
| `inlineTxfmnOf(graph, callId)` | was `inlineTransformOf(…, kind)`; one TXFMN per node now, so the `kind` arg disappears. |
| `collectEdges` | emit BOTH families for a txfmn: `…rot.<i>` and `…offset.<i>` (mutate.ts:66-80, add a `case 'txfmn'`). |

`removeNode` (mutate.ts:971) and `nodesUsing`/`predecessorsOf` type-guards
(`n.type==='mv'||n.type==='rot'`) all gain `||n.type==='txfmn'`. Grep
`'mv'\|'rot'` across `src/lib/graph` + `graph-editor` — every hit is a guard or a
render branch to extend.

---

## 3. The TXFMN card UI

### 3a. ASCII mock (compact table, two sections)

Attached form (hangs off a Call's right edge, replacing the strip cluster):

```
            ┌──────────────────┐
            │ TXFMN          × │      ← title row; × deletes/unwraps
            ├──────────────────┤
   child ●──┤ ROT              │      ← child input socket on LEFT edge (y≈title)
            │  RX [   0   ] ƒ ●│──○   ← per-row: label · input · ƒ · input-socket
            │  RY [ p.tilt ] ƒ ●│──○
            │  RZ [   0   ] ƒ ●│──○
            ├──────────────────┤
            │ MV               │
            │  X  [   0   ] ƒ ●│──○
            │  Y  [   0   ] ƒ ●│──○
            │  Z  [ p.len ] ƒ ●│──○
            ├──────────────────┤
            └──────────────────┘ ●→   ← single OUTPUT socket on right edge
```

- **Row anatomy** mirrors the params-card / standalone-xform row: `axis label`
  · numeric `input` (or `p.<name>` chip when wired) · `ƒ` button (opens the
  shared expression popover) · an **input socket** (`●`) on the right where a
  dragged PARAM output lands. The socket is an *input* (param flows IN); the
  card's single right-edge socket is the *output* (shape flows OUT).
- **Two section headers** (`ROT`, `MV`) with dividers — pure layout, like the
  PolyRepeat 2-section card (types.ts:152) and the standalone xform card.
- One TXFMN per Call → no `col/row` cascade, no sequence arrows. Drop
  `xformArrows` and the 2-up strip grid entirely for the attached form.

### 3b. Geometry (`geom.ts`) — reuse, retitle

Replace the strip helpers with table-row helpers (same math style as the
polygon/sketch row walk, `polyRowTop`/`polySockR`):

```ts
export const TXF_W = 150;            // card width (fits "RY [ p.tilt ] ƒ ●")
export const TXF_TITLE_H = 22;
export const TXF_SECTION_H = 16;     // ROT / MV header band
export const TXF_ROW_H = 22;         // one axis row
export const TXF_GAP = 4;            // card right edge → attached card

// card-LOCAL top-left of the attached TXFMN card on its Call
export function txfmnCardAt(graph, callId): {x:number;y:number} {
  const { w } = nodeSize(graph, graph.nodes[callId]);
  return { x: w + TXF_GAP, y: 0 };
}
// card-LOCAL Y of row r within field f ('rot'=section 0, 'offset'=section 1)
export function txfmnRowTop(field, axis): number { … }   // cumulative walk
// card-LOCAL centre of the per-row INPUT socket (right edge of the card)
export function txfmnAxisSocketAt(graph, callId, field, axis): {x,y} { … }
// card-LOCAL OUTPUT socket (right edge, vertical centre)
export function txfmnOutputAt(graph, callId): {x,y} { … }
export function txfmnCardSize(): {w,h};  // TITLE + 2×SECTION + 6×ROW
```

- `attachedTransforms` → `attachedTxfmn(graph, callId): NodeId | null`
  (≤1 now). `transformChainBase` collapses (depth ≤ 1) but KEEP a guard for the
  free-standing case.
- `isInlineWrapper`/`isAttachedTransform` → `isAttachedTxfmn` — true iff the
  txfmn's `.child` is a Call. (A txfmn wrapping a Method/Stack stays a
  standalone card, same rule as today.)
- `outputSocketAt` (geom.ts:529): the `mv/rot` branch becomes a `txfmn` branch
  → returns `nodePos(call) + txfmnOutputAt(call)` for the attached case;
  title-row right edge for the free-standing case. **This is the crown-jewel
  alignment point** — the visible output circle, the value the wire endpoint
  uses, and `outputSocketAt` must all read `txfmnOutputAt`.
- `inputSocketAt(…, 'child')`: keep the left-edge title-row position
  (geom.ts:563) for `txfmn`.
- `nodeSize`/`cardMinWidth`/`cardAutoWidth`: add a `txfmn` branch
  (`{w:TXF_W, h:txfmnCardSize().h}`); container child-label `cardAutoWidth`
  (geom.ts:236-240) maps `txfmn` → `'txfmn(…)'`.

### 3c. Wiring (`wire-state.svelte.ts`)

- `endWireOnTransformAxis(ev, id, axis)` → `endWireOnTxfmnAxis(ev, id,
  field:'rot'|'offset', axis)` — drops a `param-out` onto a specific
  field+axis via `setTxfmnAxis(…, asParam(name))`. (Field is now explicit
  because both live on one node.)
- `unwireTransformAxis(id, axis)` → `unwireTxfmnAxis(id, field, axis)`.
- All other `endWireOn*` are untouched.

### 3d. Component render (`GraphEditorPane.svelte`)

- DELETE the strip block (4568-4614) + the standalone mv/rot block
  (4669-4776), replace with ONE `{#if n.type==='txfmn'}` render used by BOTH the
  attached `<foreignObject>` (positioned at `txfmnCardAt`, drawn inside the
  Call's group) and the free-standing card (positioned at `nodePos`). The body
  is identical; only the origin differs — extract a `{#snippet txfmnBody(n)}`.
- Title row: `TXFMN` + × (delete → `unwrapTxfmn` when attached, else
  `deleteNode`).
- Two `{#each ['rot','offset']}` sections, each `{#each axisKeys}` row,
  re-using the existing per-row markup (number input + `use:dragNumber` +
  `p.<name>` chip + `ƒ` → `openTxfmnAxisExprPop`). The per-row input socket
  uses `txfmnAxisSocketAt`; `onpointerup={…endWireOnTxfmnAxis(ev,id,field,i)}`.
- The Call's ⇄/↻ glyphs (4409/4412) collapse to ONE glyph (e.g. `⤡` "transform")
  → `toggleTxfmn(callId)` (wrap/unwrap a single TXFMN).
- `+` picker *position* submenu (6646-6651): one item **txfmn** →
  `dropTxfmn()`; drop the separate mv/rot items.
- Handlers: `onTransformAxis`/`onTransformAxisExprEdit`/`openTransformAxisExprPop`
  (3304/3368/3393) gain a `field` arg.

---

## 4. Emit (`composition-emit.ts`) — rot inner, mv outer

Add a `case 'txfmn'` (alongside 432-440). Re-expand the single node into the
SAME nested helper calls the two-node form produced, in **rotate-then-translate**
order:

```ts
case 'txfmn': {
  const child = ref(node.child, 'child');
  const r = node.rot.map(emitValueExpr).join(', ');
  const o = node.offset.map(emitValueExpr).join(', ');
  const rotIsId = node.rot.every(isLiteralZero);
  const mvIsId  = node.offset.every(isLiteralZero);
  let e = child;
  if (!rotIsId) e = `rot(${e}, [${r}])`;   // INNER — applied first
  if (!mvIsId)  e = `mv(${e}, [${o}])`;     // OUTER — applied second
  return e || child;                         // both identity → passthrough
}
```

- **Identity elision** keeps emitted source clean (no `rot(A,[0,0,0])` noise)
  and guarantees a pure-mv or pure-rot TXFMN emits BYTE-IDENTICAL to today's
  single `mv(...)` / `rot(...)`. This is the regression guard for the existing
  19 BUILD_ORDER parts.
- The validity walk (emit.ts:121-127) `case 'mv'/'rot'` → add `case 'txfmn'`
  checking both `node.rot[i]` and `node.offset[i]`.
- The ghost-overlay forward-walk (emit.ts:256-263) `n.type==='mv'||'rot'` →
  include `'txfmn'`.

**Verify:** snapshot-emit a Call wrapped in {rot only}, {mv only}, {both} and
diff against the pre-change two-node emit. The first two MUST match byte-for-byte.

---

## 5. Migration (`composition-graph-hydrate.ts`)

Follow the `{kind:'repeat'}`→PolyRepeat precedent (hydrate.ts:76-118): a
forward, one-way, lossless migration during `hydrateGraph`.

For every loaded graph:

1. **Collapse adjacent mv+rot wrapper pairs.** Walk the nodes; for an `mv` whose
   `.child` is a `rot` (or vice-versa), and the inner's child is shared, fold
   both into one `txfmn` preserving the rot-inner/mv-outer semantics:
   - `mv(rot(C))`  → `txfmn{ child:C, rot:rot.rot, offset:mv.offset }`
   - `rot(mv(C))`  → keep as TWO txfmn? NO — that order is translate-then-rotate,
     which a single rot-then-mv card cannot express. **Emit a console.warn and
     leave that pair as two separate txfmn nodes** (each one-field), chained, so
     geometry is preserved even though it can't collapse to one card. In
     practice the editor only ever produced mv-outer (rot added first via the
     strips), so this branch is rare; document it, don't lose geometry.
2. **Lift lone mv / rot.** A solo `mv` → `txfmn{rot:0, offset:mv.offset}`; a solo
   `rot` → `txfmn{rot:rot.rot, offset:0}`. Rewrite the node id IN PLACE (keep the
   id so `child` references from parents/edges still resolve) and its
   `layout[id]`.
3. Rebuild `edges` via `collectEdges` at the end (hydrate already finalizes).

Migration runs only at hydrate; saved `meta.graph` JSON keeps the legacy mv/rot
shape until the next save re-emits txfmn. No on-disk rewrite needed — parts
re-save through the editor naturally (Rule 4 atomic writes unaffected).

**`geom.test.ts` + `graph-editor-bake.test.ts`:** the `inlineXformOrder` /
`inlineXformStrip` legacy shims (geom.ts:500-527) back the existing unit tests
— update those tests to the txfmn helpers, or keep the shims returning the
txfmn's single attached node for one release.

---

## 6. Phased rollout (each phase: `bun run build` + `bun test`; commit per Rule 7)

- **Phase 1 — model + emit + migration (no UI).** Add `TxfmnNode`, the mutators,
  `collectEdges`/emit `case 'txfmn'`, the hydrate migration, and unit tests
  (emit byte-identity for pure-mv/pure-rot; migration round-trip). Old strips
  still render the legacy nodes; new txfmn nodes won't render yet. Bake-verify a
  migrated part via `/api/primitives/preview` (report verts/z-extent).
- **Phase 2 — geometry helpers + tests.** `geom.ts`: txfmn card/row/socket/output
  math + `geom.test.ts` cases proving the per-row input socket Y matches the
  rendered row pitch (the socket↔DOM contract). Pure, no component changes.
- **Phase 3 — render the card.** Swap the strip + standalone blocks for the one
  `{#snippet txfmnBody}`, attached + free-standing. Wire
  `endWireOnTxfmnAxis`/`unwireTxfmnAxis`. Collapse the ⇄/↻ glyphs and the picker
  submenu to a single txfmn affordance. **Browser-verify** in `claude --chrome`
  (drag a part, add txfmn, type RZ + Z, wire a param to X, confirm bake).
- **Phase 4 — cleanup.** Remove dead strip consts/helpers
  (`STRIP_*`, `xformStripAt`, `xformArrows`, `attachedTransforms` 2-up logic) and
  the `addMv/addRot/wrapInTransform` exports once nothing imports them; keep
  `MvNode/RotNode` types + migration. Update `geom.test.ts`, `cad/CLAUDE.md`
  directory note, and this plan's status → SHIPPED.

### Risks / gotchas
- **Socket↔DOM Y-math is the fragile crown jewel** (geom.ts header). Every row
  socket Y must be a cumulative walk that matches the rendered `TXF_ROW_H`
  pitch, including the two section-header bands — unit-test it (Phase 2) before
  touching the component.
- **outputSocketAt parity** — the attached card's output must resolve through
  `txfmnOutputAt` in all three of: the rendered circle, `outputSocketAt`, and
  any downstream method wire, or wires detach (cf. the strip-cluster comment at
  GraphEditorPane.svelte:4616-4623).
- **Don't lose rot-outer geometry** in migration (§5.1) — warn + keep two nodes.
- HMR churns the giant `GraphEditorPane.svelte`; restart `:3333` after edits
  (root CLAUDE.md "Things to know"). Prefer an isolated-worktree subagent for
  the Phase-3 component surgery (memory `feedback_substantive_edits_in_subprocess`).
```
