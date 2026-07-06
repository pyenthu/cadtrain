# Complex / object params + a `list<part>` producer — data-driven assemblies (TODO #38)

**Status:** planning (2026-07-06). Grounded in a read of the live graph model,
emit path, port-type registry, and the volume type library.

**Goal.** Turn an N-string well (today: 18 hand-wired `Call` cards) into ONE
`list<StringSpec>` param (a table of rows) + ONE producer node that instantiates
one part per row. This is the payoff of three shipped/in-flight tracks:

- **#13 typed-ports** (`docs/plans/typed-ports.md`) — the `PortType` registry +
  composite `record` types + the volume `types/` library.
- **#926 typed-expression-outputs** (`docs/plans/typed-expression-outputs.md`) —
  structural inference + typed output sockets + plain-language wire checks.
- **#11 expression-as-builder** (`docs/plans/expression-list-builder.md`) — the
  `list<point>` producer (functional `map` + imperative accumulator) that already
  emits a mapped `Array.from(...)` feeding a consumer.

#38 is the geometry-valued sibling of #11: where #11 produces `list<point>`, #38
produces `list<part>` — and where params today are scalars, #38 adds `record` and
`list<record>` params so the DATA that drives the map lives on the part.

---

## 0. What exists today (the load-bearing facts)

### Params are flat scalars
`ParamSchema` (`src/lib/cad/composition-graph-types.ts:519`):

```ts
export type ParamSchema = {
  default: number | string | boolean;
  min?: number; max?: number; step?: number; unit?: string; label?: string;
};
```

- `graph.params: Record<string, ParamSchema>` (`composition-graph-types.ts:554`).
- Emit writes params **verbatim**: `emitGraph` → `meta.params = graph.params`
  (`composition-emit.ts:313`) and `serialiseGraph` → `params: graph.params`
  (`composition-emit.ts:711`), pretty-printed by `stringifyTyped`
  (`composition-emit.ts:748`) — which **already recurses into nested
  objects/arrays** (lines 754–765). So a record/list default serialises for free.
- Hydrate passes params through unchanged: `params: serialised.params ?? {}`
  (`composition-graph-hydrate.ts:434`).
- The function signature is `fn(p)` whenever any param exists
  (`composition-emit.ts:322`); a param ArgValue emits as `p.<name>`
  (`emitValueExpr`, `composition-emit.ts:606`).

**Consequence:** the serialize / hydrate / signature machinery needs **no change**
to carry a record or list default — it is already structural. The work is in the
TYPE, the EDITOR, the value-EMIT for field access, and the producer node.

### ArgValue is scalar-only
`ArgValue` (`composition-graph-types.ts:31`): `literal | expr | param`. A `param`
ArgValue carries only `{ kind:'param', param:string }` → emits `p.<name>`. There is
no field-path today (no `p.spec.od`).

### The typed-port + record machinery is already built
`src/lib/cad/port-types.ts`:
- `PortType { id, elem, card, of?, fields?, feeds? }` with `elem` ∈
  `scalar|flag|point|op|transform|geometry|object` and `card ∈ one|list`.
- `defineRecordType(id,label,fields)` (`port-types.ts:103`) registers a nominal
  `elem:'object'` record; `listOf(elemTypeId)` (`:119`) derives `list<Casing>`.
- `canFeed` (`:62`) — records are **nominal** (a `Casing` only feeds a `Casing`
  or `list<Casing>`); a single record **broadcasts** into `list<thatRecord>`.
- `PT_GEOMETRY` (`:154`) = a baked solid; there is NO `list<geometry>` yet.

`src/lib/cad/struct-type.ts` already models `{ kind:'record'; fields }` and
`{ kind:'list'; of; len? }` (`struct-type.ts:37`), and `structColor` already
renders `record`/`list<record>` violet (`port-types.ts:186`).

### The volume type library IS the record schema source
`/api/primitives/types` (`src/routes/api/primitives/types/+server.ts`) stores one
`TypeDef` per file at `<volume>/types/<id>.json`:

```jsonc
{ "id": "Casing", "label": "Casing",
  "fields": [ { "name": "od", "typeId": "scalar", "list": false }, … ] }
```

Editable in the ◇ definer (`src/routes/primitives/types/+page.svelte`). It is the
existing, shared, atomic-write (Rule 4) store for user record types.
**Decision: reuse it as the record-param schema source** — a `record` param names a
`typeId` that resolves to a `TypeDef` here. No parallel schema store.

### The list producers that already emit a mapped array
- `RepeatNode` (`composition-graph-types.ts:140`) emits
  `Array.from({length:N}, (_,i) => …)` via `RepeatKind.emitExpr`
  (`src/lib/cad/nodes/kinds/repeat.ts:15`); `op:'list'` returns the bare array,
  `stack`/`place` wrap it. `computeListProducers` (`composition-emit.ts:631`) marks
  `repeat` with `op:'list'` so a Stack spreads it.
- `ExprNode` + `ExprDef` (`composition-graph-types.ts:369–407`) emit a numeric
  prelude only; a `list` output (`ExprOut.shape:'list'`, elem `point|op|…`,
  `composition-emit.ts:499`) compiles the formula via
  `graph-exprs.compileListFormula` or `expr-imperative.compileImperative`
  (`expr-imperative.ts:333`) to a JS array — but the elements are POINTS/numbers,
  never geometry.

**No node today outputs `list<part>`.** That is the core new capability.

---

## 1. Complex / object params — `ParamSchema` becomes a discriminated union

### Schema shape (recommended)

Add an OPTIONAL `kind` discriminant; **absent ⇒ `'number'`** so every existing
file is unchanged.

```ts
// composition-graph-types.ts
export type NumberParam = {
  kind?: 'number';                       // absent on legacy files → number
  default: number | string | boolean;    // (today's ParamSchema, verbatim)
  min?: number; max?: number; step?: number; unit?: string; label?: string;
};
export type RecordParam = {
  kind: 'record';
  typeId: string;                        // → a <volume>/types/<id>.json TypeDef
  default: Record<string, number | string | boolean>;   // { od: 9.625, wall: 0.5, … }
  label?: string;
};
export type ListParam = {
  kind: 'list';
  of: { record: string } | { scalar: true };  // list<Casing> | list<number>
  default: Array<Record<string, number|string|boolean> | number>;  // the rows
  label?: string;
};
export type ParamSchema = NumberParam | RecordParam | ListParam;
```

Rationale:
- `kind?` optional keeps `NumberParam` structurally identical to today; a
  `hasKind(p)` helper (`p.kind ?? 'number'`) is the single narrowing point.
- `of` mirrors the `TypeDef.fields[].list` flag style — a list of records names the
  `TypeDef` id; a list of scalars is the degenerate case.
- Defaults are plain JSON objects/arrays → `stringifyTyped` already emits them and
  hydrate already round-trips them (§0). **No emit/hydrate change for serialization.**

### (De)serialization + hydrate
- **Serialize:** unchanged — `serialiseGraph`/`emitGraph` write `graph.params`
  wholesale; `stringifyTyped` renders the nested record/list defaults.
- **Hydrate:** `composition-graph-hydrate.ts:434` passes `serialised.params`
  through. Add a tiny normalizer so a legacy `{default:5}` reads as
  `{kind:'number', default:5}` at the seams that branch on kind (or just default
  `p.kind ?? 'number'` at every read — preferred, zero migration write).
- `STACK_REF_PARAM` special-case (`composition-emit.ts:218`) reads
  `params[STACK_REF_PARAM].default` — it is always a number param; guard it with
  `hasKind === 'number'` so a future record named `stack_ref` can't crash it.

### Emit / `p.<name>` bindings — field access
A record param `spec` emits as the object `p.spec`; a Call arg wired to a field
needs `p.spec.od`. Two supported forms:

1. **Producer-internal (the common case):** inside the `parts_map` lambda the row
   binding is `s`, so field access is `s.od` — emitted by the producer, needs **no
   ArgValue change** (§2).
2. **Direct consumption (a single record param feeding one Call):** extend the
   `param` ArgValue with an optional field path:
   ```ts
   | { kind: 'param'; param: string; field?: string };
   ```
   and `emitValueExpr` (`composition-emit.ts:598`) gains
   `` `p.${v.param}${v.field ? '.'+v.field : ''}` ``. Sparse/optional ⇒ existing
   param ArgValues (no `field`) emit byte-identically. `validateGraph`'s param
   check (`checkArg`, `node-kind.ts:127`) already keys on `param` — the field is
   validated against the resolved `TypeDef.fields` in a new arm.

### Reuse the `types/` registry as the record schema
Yes. A `record`/`list<record>` param stores only the `typeId`; the field set is
resolved from `<volume>/types/<typeId>.json` at edit time (the ParamsCard fetches
`/api/primitives/types`) and registered into `port-types` via `defineRecordType` +
`listOf` so socket colouring + `canFeed` work. The definer (◇) is the authoring UI
for the schema; the ParamsCard authors the DATA (rows).

---

## 2. The `list<part>` producer expression

### The new port type
Register `PT_LIST_GEOMETRY = listOf('geometry')` → `list<geometry>` (violet-ish,
`glyph:'[]'`). Extend `ExprOutElem` (`composition-graph-types.ts:363`) with
`'geometry'` so a list output can be typed `shape:'list', elem:'geometry'`. In
`struct-type` add nothing — geometry is already outside the structural model (it
falls through as "allowed", `struct-type.ts:399`), which is correct: geometry wires
are checked nominally by `canFeed`, not structurally.

### The producer node (recommended: a dedicated `parts_map` kind)
`ExprNode` emits numeric consts only and lives in a separate prelude namespace;
overloading it to build geometry is a poor fit. Add a first-class node — the
geometry sibling of the repeat/expr list-producers:

```ts
export type PartsMapNode = {
  id: NodeId;
  type: 'parts_map';
  src: string;                 // volume part id to instantiate — 'g_casing'
  list: ArgValue;              // the rows — {kind:'param', param:'strings'} (a list param)
  loopVar?: string;            // default 's' (the row); 'i' is the index (like repeat)
  /** part-arg name → how to fill it from the row `s` / index `i`. Each value is an
   *  ArgValue: {kind:'expr', expr:'s.od'} for a field, or a literal/param/expr. */
  argMap: Record<string, ArgValue>;
  op?: 'list' | 'stack' | 'place';   // default 'list' (feed a container)
};
```

Register `PartsMapKind` in `src/lib/cad/nodes/registry.ts` (alongside `RepeatKind`)
implementing the `NodeKind` interface (`node-kind.ts:95`).

### Emit
`PartsMapKind.emitExpr(node, ctx)` (mirrors `RepeatKind`, `repeat.ts:15`):

```ts
const rows  = ctx.emitValue(node.list);              // p.strings
const s = node.loopVar || 's';
const call  = ctx.emitCall(node.src, node.argMap);   // g_casing({ od: s.od, wall: s.wall, length: s.length })
const array = `Array.from(${rows}, (${s}, i) => ${call})`;
const op = node.op ?? 'list';
return op === 'stack' ? `stack(${array})` : op === 'place' ? `place(${array})` : array;
```

- `ctx.emitCall` (`node-kind.ts:28`, wired from `emitCallExpr`,
  `composition-emit.ts:578`) renders the object-style call; the `argMap` values
  reference the row binding `s` via `{kind:'expr', expr:'s.od'}` (positional
  `g_casing(s.od, s.wall, s.length)` also works — `emitCall` is object-style, which
  the loader's `__adapt` shim accepts either way, see the compiled well script's
  `__adapt`).
- Mark it a **list producer**: extend `computeListProducers`
  (`composition-emit.ts:631`) to add `parts_map` with `op:'list'`, so a parent
  `Stack`/root `list` spreads it (`...`) exactly like a `repeat` with `op:'list'`.
- It is a normal root-list child → falls straight into the Output filter
  (`computeConsumedSet`, `composition-emit.ts:640`) with no special-casing.

Emitted body sketch:

```js
const strings = Array.from(p.strings, (s, i) => g_casing({ od: s.od, wall: s.wall, length: s.length }));
return strings;   // (or stack(...) if the strings mate end-to-end)
```

### Typed-output support it needs from #926
- The producer's OUTPUT socket is typed `list<geometry>` (nominal). #926's
  structural inference is for `list<point|number>` and does not model geometry —
  the geometry wire is checked by `canFeed` (nominal, `port-types.ts:62`), NOT
  `checkFeed`. So #38 adds `PT_LIST_GEOMETRY` + a `canFeed` path (a
  `list<geometry>` feeds a container child slot / Output) and otherwise **reuses**
  #926's socket-colouring + reject-banner plumbing.
- The producer's INPUT (`list` slot) is typed `list<Casing>` and accepts a
  `list<record>` param output; `canFeed`'s nominal record rule already permits a
  `Casing` param → `list<Casing>` broadcast.

---

## 3. Param editor — "add object / add row" + the loop

### ParamsCard changes (`src/lib/shared/graph-editor/ParamsCard.svelte`)
Today each param is an SVG chip with a numeric `<input>` (`dragNumber`) + an output
socket (`ParamsCard.svelte:75–108`). The add-param popover (`onOpenAddParamPop`,
Phase C, still in GEP) is number-only.

Additions (respect UI conventions: **popups over inline editors**
[[feedback_popup_over_inline]], **ƒ chip stays** [[feedback_keep_fx_button]]):

1. **Add-param popover gains a KIND toggle** — `number | record | list`. For
   record/list, a second `<select>` lists `TypeDef`s from `/api/primitives/types`
   (+ a "＋ new type…" link to the ◇ definer). Registers the type into `port-types`
   on select.
2. **Chip render by kind:**
   - `number` → today's inline `<input>` (unchanged).
   - `record` → a compact summary chip (`Casing{od:9.6, wall:0.5}`) with a ✎ that
     opens a **FloatingPanel** (anchored to the chip, `floating_panel_z_index`) — a
     one-row field editor keyed by the `TypeDef.fields`.
   - `list<record>` → a summary chip (`Casing[18]`) with ✎ opening a **table
     FloatingPanel**: columns = record fields, rows = the array; `+ row` /
     duplicate / delete-row / drag-reorder; per-cell numeric inputs with the same
     `dragNumber`. This IS the "18 strings as a spreadsheet" surface.
3. **Output socket** stays; its colour comes from `structColor` / the registered
   `PortType` (`port-types.ts:181`) — violet for records, `[]`-glyphed for lists.
   A wire from a `list<Casing>` param output → a `parts_map` `list` input is the
   whole data flow.

UX sketch:

```
PARAMS
┌─────────────────────────────┐
│ 📌 p.od           9.625      │   ← number (inline)
│ 📌 p.strings   Casing[18] ✎ │◇  ← list<record>; ◇ = list<Casing> output socket
└─────────────────────────────┘
        │ ✎ opens ▼
   ┌────────────────────────────────────────┐
   │ Casing  strings          [+ row]        │
   │  #  od     wall   length  grade         │
   │  1  9.625  0.545  4200    L80    ⧉  🗑   │
   │  2  7.000  0.408  6100    P110   ⧉  🗑   │
   │  …                                       │
   └────────────────────────────────────────┘
```

### How the loop consumes the list
Drop a **Parts producer** node (`parts_map`), set `src = g_casing`, wire its `list`
input to the `p.strings` output socket, and map its `argMap` (part arg → row field)
in the node card (a small field-picker per part arg, defaulting name-matched:
`od→s.od`). Its `list<geometry>` output wires into the root `list` (or a `Stack` if
strings mate). One producer replaces N Call cards.

A `Repeat`-based alternative (iterate a list param by index, binding `s =
p.strings[i]`) is possible but muddier — `Repeat` is count-driven and its `child`
is a graph subtree, so the row→arg mapping would have to live in per-arg `expr`
ArgValues (`p.strings[i].od`). The dedicated `parts_map` keeps the mapping
first-class and the emit trivial. **Recommend `parts_map`; note Repeat as fallback.**

---

## 4. Migration / back-compat

- **Numeric params unchanged.** `kind` absent ⇒ `'number'`; `NumberParam` is
  byte-identical to today's `ParamSchema`. No file rewrite.
- **Serialization is already structural** — record/list defaults ride
  `stringifyTyped` + the verbatim `params:` pass-through, so a part that uses them
  emits cleanly and a part that doesn't is untouched.
- **Golden emit stays green.** `src/lib/cad/nodes/emit-golden.test.ts` ("every
  volume part re-emits byte-identical", `:87`) is unaffected because: (a) no
  existing part has a non-number param, (b) `parts_map`/`list<geometry>` code paths
  only fire on the new node type, (c) `emitValueExpr` gains a `field?` branch that
  is inert when `field` is absent.
- **Hydrate** default-fills `kind:'number'` at read time; no destructive migration
  write (Rule 4 — no store rewrite needed).
- **Unregistered `TypeDef`** (a record param whose `typeId` is missing from the
  volume) surfaces as a validation error chip (new `validate` arm), never a silent
  bad bake — same philosophy as `missingRef` (`composition-emit.ts:410`).

---

## 5. Phased plan

Each phase is independently shippable; the gate everywhere is **golden-emit green +
a new unit test** and `bun run build` + `bun run test` (vitest, NOT `bun test`).

| Phase | Deliverable | Risk | Gate |
|---|---|---|---|
| **P1 — Schema** | `ParamSchema` discriminated union (`kind?`); `hasKind` helper; hydrate default-fill; `emitValueExpr` `field?` branch; guard `STACK_REF_PARAM`. Register `PT_LIST_GEOMETRY`. NO editor yet. | Low — additive, optional discriminant. | golden-emit byte-identical; new `param-kind.test.ts` (record + list default round-trips serialize→hydrate→emit; a `field` ArgValue emits `p.spec.od`). |
| **P2 — Param editor** | ParamsCard: kind toggle in add-popover; record + `list<record>` chips + FloatingPanel table editor; `TypeDef` fetch + `port-type` registration; violet/`[]` output sockets. | Med — SVG-card + FloatingPanel UI; multi-pane `scene` rule N/A (params card is per-pane state). Verify in **/primitives multi-tab** ([[feedback_verify_the_right_scenario]]). | Build green; author a `list<Casing>` param by hand in the UI, confirm it serializes + reloads; e2e recorded (Rule 12). |
| **P3 — Producer expr** | `PartsMapNode` + `PartsMapKind` (emit/validate/inputRefs/size/sockets); `computeListProducers` extension; NodeCard render arm + arg-map field-picker; wire `list<record>`→`list` input, `list<geometry>`→container output. | Med — new node kind touches emit + wire-state; nominal `canFeed` path. | New `parts-map.test.ts` (emits `Array.from(p.strings,(s,i)=>g_casing({…}))`; `op:list/stack/place`); golden-emit unaffected; bake a 3-row list end-to-end via `/api/primitives/preview` (report verts / z-extent). |
| **P4 — The well example** | Rebuild `w_multi_string_dev` as one `list<StringSpec>` param + one `parts_map`. Author the `StringSpec` record `TypeDef`. Doc it in `docs/parts/` (Rule 14). | Low — composition of P1–P3. | Baked geometry matches the 18-card version (same string count / z-extent); node count 18→~2; committed as the reference part. |

### Relation to the sibling tracks
- **#13 typed-ports** supplies `PortType`/`defineRecordType`/`listOf`/`canFeed` +
  the `types/` library — P1/P2 consume them directly, adding only
  `PT_LIST_GEOMETRY`.
- **#926 typed-expression-outputs** supplies socket colouring (`structColor`),
  the wire-reject banner, and `ExprOutElem` — P2/P3 reuse the colour/reject
  plumbing; #38 extends `elem` with `'geometry'` and checks geometry wires
  nominally (not structurally).
- **#11 expression-as-builder** is the pattern P3 copies: `list<point>`'s mapped
  `Array.from` emit (`expr-imperative.ts`) → `list<part>`'s mapped `Array.from`.
  #38 IS the geometry-valued generalization: **`list<record> → list<part>`**.

---

## 6. Worked example — `w_multi_string_dev` (18 cards → 2 nodes)

### Before (today)
18 `Call` cards, one per string, each a `g_casing` / `g_tubing` instance with
hand-typed `od` / `wall` / `length` args, all children of the root `list` (plus
mv/txfmn wrappers to stack them). Roughly:

```js
export function w_multi_string_dev(p) {
  const A = g_casing({ od: 9.625, wall: 0.545, length: 4200 });
  const B = g_casing({ od: 7.000, wall: 0.408, length: 6100 });
  // … 16 more hand-wired Call cards …
  return [A, B, /* … */ R];
}
```

Node count: **18 Calls + ~18 transform wrappers + 1 root list ≈ 37 cards.**

### After (data-driven)
- One record `TypeDef` `StringSpec { od, wall, length, grade }` in `<volume>/types/`.
- One `list` param `strings : list<StringSpec>` holding the 18 rows (the table).
- One `parts_map` producer: `src='g_casing'`, `list=p.strings`, `argMap =
  { od: s.od, wall: s.wall, length: s.length }`, `op:'stack'` (strings mate).

`meta.params` (excerpt):

```ts
params: {
  strings: {
    kind: 'list', of: { record: 'StringSpec' },
    default: [
      { od: 9.625, wall: 0.545, length: 4200, grade: 'L80' },
      { od: 7.000, wall: 0.408, length: 6100, grade: 'P110' },
      // … 16 more rows …
    ],
  },
},
```

Emitted body:

```js
export function w_multi_string_dev(p) {
  const strings = stack(Array.from(p.strings, (s, i) => g_casing({ od: s.od, wall: s.wall, length: s.length })));
  return strings;
}
```

Node count: **1 param + 1 producer (+ root list) ≈ 2 cards.** Adding a 19th string
is one new table row, not a new card + wiring. Changing every string's grade is one
column edit.

---

## Open questions / deferred
- **Per-row part TYPE** (`s.part = 'g_casing' | 'g_tubing'`) — a `parts_map` with a
  single `src` handles one part type; a mixed string uses a `src` field on the row +
  a dispatch in the map (`(s.part==='g_tubing'?g_tubing:g_casing)(…)`). Defer to a
  P3.5 once the single-type path ships.
- **Nested records / `list<list>`** — out of scope; the research's flat-list
  decision (`struct-type.ts` header) holds. Records are one level deep.
- **Deviation per row** (each string on its own `axisPath`) — a row field carrying a
  `list<point3>` default; needs the record default to hold an array value
  (`stringifyTyped` already emits it) + the producer to pass `s.axisPath` through.
  Naturally supported by the schema; validate after P4.
</content>
</invoke>
