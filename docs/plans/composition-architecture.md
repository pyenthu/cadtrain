# Composition architecture — graph as the model (no compat)

Status: **draft, 2026-06-06.** Supersedes K.67 (consolidated +
simplified per user direction: no backward compatibility, keep it
simple). Pairs with K.68 (generative authoring) + K.69 (vocabulary
editor + boolean_modify rule kind).

## TL;DR

- The **composition graph is the source of truth** for assemblies.
  Lives in `meta.graph: { nodes, edges, params, root }` on disk as a
  JSON literal. **Edits go to the graph, not the source.**
- The `.asm.ts` function body is **machine-generated** from the graph
  on every save. **It is never parsed back.** Read-only on disk for
  humans; the editor never round-trips through it.
- Each Call carries its **own literal arg values** (`A =
  shaft({pipeOD: 4.5, length: 12})`). Sharing dials across instances is
  done via explicit **edges** (`{from: 'p.pipeOD', to:
  'A.args.pipeOD'}`), NOT by name-collision magic.
- Aliases (A, B, C…) are allocated at instantiation from the free
  alphabet pool. Imports just declare what's available; they don't bind
  aliases.
- Bake skips JS sandbox eval for assemblies. The graph IS the recipe;
  a tree-walk interpreter (`composition-bake.ts`) consumes it.
- **No backward compatibility.** Existing assemblies that rely on
  source-parse get rebuilt by hand in the new editor or deleted. No
  fallback path; no migration shim; no "read meta.graph IF present".

## Why now

Current architecture (K.62/K.63):
- Source text is the source of truth.
- Editor parses source → in-memory TreeNode → user edits mutate the
  tree → `applyToSource()` emits a new source string →
  `onSourceChange()` triggers a re-parse from the saved text.

The bug class this produces (from the K.67 plan + this session's
mule_shoe debug):
- Parser and emitter must be perfect inverses. They aren't (e.g.
  `parseMetaParams` nested-brace bug; `composeSource` profile-editor
  bug; the K.66 livePK drift).
- Refs/literals/functions get mixed in Call args (text substitution of
  `p.length` literals inside object args).
- Silent unwired params (a `meta.params` row that nothing references
  looks fine in source but does nothing).
- K.66 drift detection has to RE-SNIFF source strings to figure out
  child param-key drift instead of comparing typed edges.
- Name-matching becomes a magic concept (rename `tube` → `tube_new`
  silently breaks downstream calls — K.60).
- tagManifold + partHashId both exist because the source-eval path
  loses the dependency edges; the graph would already carry them.

Every grown-up parametric system (Grasshopper · Houdini · FreeCAD ·
Onshape · Blender Geometry Nodes) converged on a graph as the model
+ text as a projection (or no text at all). This plan adopts that
model.

## Data shapes

```ts
// src/lib/cad/composition-graph.ts
export type NodeId = string;     // 'n_abc123' — short stable id, generated at create-time

export type GraphNode =
  | { id: NodeId; type: 'call'; src: string; alias: string; args: Record<string, GraphArg> }
  | { id: NodeId; type: 'method'; op: 'subtract' | 'add' | 'intersect'; obj: NodeId; arg: NodeId }
  | { id: NodeId; type: 'list'; children: NodeId[] }
  | { id: NodeId; type: 'stack'; children: NodeId[] }
  | { id: NodeId; type: 'mv'; child: NodeId; offset: [GraphExpr, GraphExpr, GraphExpr] }
  | { id: NodeId; type: 'rot'; child: NodeId; rot:    [GraphExpr, GraphExpr, GraphExpr] }
  | { id: NodeId; type: 'group'; children: NodeId[] };

export type GraphArg =
  | { kind: 'literal'; value: number | string | boolean }   // raw value at the slot
  | { kind: 'expr'; expr: string }                           // arbitrary expression (Math.PI, A.length/2)
  | { kind: 'param'; param: string };                        // typed edge — wires from a meta.params row

export type GraphExpr =
  | { kind: 'literal'; value: number }
  | { kind: 'expr'; expr: string }
  | { kind: 'param'; param: string };

export type Edge = { from: string; to: string };
  // from: 'p.<paramName>' OR '<nodeId>.<slot>'
  // to:   '<nodeId>.args.<key>' OR '<nodeId>.offset.<0|1|2>' OR similar
  // Edge is derived from GraphArg.kind === 'param' — kept as a denormalised
  // index so renames + reverse-lookups are O(1).

export type Graph = {
  nodes: Record<NodeId, GraphNode>;
  root: NodeId;
  params: Record<string, ParamSchema>;     // assembly-level meta.params (same shape as today)
  edges: Edge[];                            // derived; written + read but always rebuildable from args
};
```

### How aliases work

- Aliases A, B, C… are assigned at Call create-time via
  `nextAlias(taken)`. The pool is the set of A, B, C, …, AA, AB, … minus
  every existing Call alias in the graph.
- The alias is the **instance name** — it's what shows in the editor's
  Call row title.
- The `src` field is the **import** — it points at the volume primitive
  id (`dt_mule_shoe`).
- Two Call nodes can share the same `src` with different aliases. They
  are independent instances.

```ts
// Example graph fragment after the user clicks `+ dt_mule_shoe` twice:
{
  nodes: {
    n_root: { id: 'n_root', type: 'list', children: ['n_a', 'n_b'] },
    n_a: { id: 'n_a', type: 'call', src: 'dt_mule_shoe', alias: 'A',
            args: { pipeOD: { kind: 'literal', value: 3.56 }, boxLen: { kind: 'literal', value: 3 } /* … */ } },
    n_b: { id: 'n_b', type: 'call', src: 'dt_mule_shoe', alias: 'B',
            args: { pipeOD: { kind: 'literal', value: 4.5 }, boxLen: { kind: 'literal', value: 3 } /* … */ } },
  },
  root: 'n_root',
  params: {},
  edges: [],
}
```

### How wiring works (explicit edges)

User wants `A.pipeOD` and `B.pipeOD` to share an outer dial:

1. Click the Parameters accordion → `+ param` → `outerOD` (default 4).
2. Right-click `A.args.pipeOD` → "Wire to outer param" → picks `outerOD`.
3. Repeat for `B.args.pipeOD`.

The graph mutation: `A.args.pipeOD = { kind: 'param', param: 'outerOD' }`
(same for B); edges array gains two entries. Removing `outerOD` from
`params` walks edges, surfaces the two slots as orphaned, asks the user
to confirm before deleting (replacing with literal default values).

This is **the user-confirmed model: imports = definitions, aliases at
instantiation, args are literal by default with explicit opt-in
wiring.** The K.67 auto-wire chip + tree-body-drift auto-fire are
GONE — they were the implicit-wiring chrome that confused the model.

## .asm.ts file format (the projection)

```ts
// dt_mule_compose.asm.ts
export const meta = {
  id: 'dt_mule_compose',
  kind: 'asm',
  uses: ['dt_mule_shoe'],
  params: {},
  graph: { /* full JSON literal of Graph type above */ },
};

// AUTO-GENERATED from meta.graph by composition-emit.ts. Do not edit by
// hand — your edits will be wiped on the next Save inside the GUI.
export function dt_mule_compose() {
  const A = dt_mule_shoe({ pipeOD: 3.56, boxOD: 4.0, wall: 0.28, boxLen: 3, bodyLen: 6, cutAngle: 45, segments: 96 });
  const B = dt_mule_shoe({ pipeOD: 4.5,  boxOD: 5.25, wall: 0.31, boxLen: 3, bodyLen: 8, cutAngle: 30, segments: 96 });
  return [A, B];
}
```

The body is here for legibility / grep / git diff readability ONLY.
**The editor reads meta.graph.** When the file is saved, both
meta.graph + the function body are regenerated from the in-memory
graph. The body is never parsed.

Files without `meta.graph` (legacy `.asm.ts` from before this plan)
do NOT auto-migrate. The user opens them, sees the empty-graph
state, and rebuilds them in the editor (or deletes them). **No
backward compat.**

## Modules — what changes

| File | Status | Role |
|---|---|---|
| `src/lib/cad/composition-graph.ts` | **NEW** | Graph type + mutations: `addCall(graph, src, args?)` → returns `{graph, nodeId}` with fresh alias allocated; `removeNode`, `wireArg`, `unwireArg`, `addParam`, `removeParam`, etc. Pure functions returning new graphs (no in-place mutation). |
| `src/lib/cad/composition-emit.ts` | **NEW** | `emitGraph(graph): { meta: object; body: string }`. Walks the graph in topological order, emits `const A = <src>(<args>)` lines, returns lines for the function body + the meta object including the graph JSON literal. |
| `src/lib/cad/composition-bake.ts` | **NEW** | `bakeGraph(graph, paramValues, loadPrim): Promise<Manifold>`. Interprets the graph directly — no sandbox eval. Each Call node fetches its primitive's bake function via `loadPrim(src)`, calls it with resolved args, applies mv/rot/method wrappers, composes children. |
| `src/lib/cad/composition-tree.ts` | **DELETED** | The old TreeNode + applyToSource layer goes away. composition-graph.ts replaces it. |
| `src/lib/cad/assembly-deps.ts` | **DELETED** | The text-sniffing dep-snapshot becomes structural: edges + Call.src + Param schemas are the dependency set. No re-parsing of source needed. |
| `src/lib/shared/CompositionEditor.svelte` | **REWRITTEN** | Imports + Composition panes + Parameters accordion become direct views over the graph. `applyToSource` calls disappear. Drag-to-wire on slots. `$state` graph; `$derived` views; no source round-trip. Drops Auto-wire chip, drift refresh, K.66 chrome (the drift becomes a node-property hash diff at most). |
| `src/lib/server/primitive-loader.ts` | Updated | When loading an `.asm.ts` part, return `{ graph, params }` from `meta.graph`. Skip the regex `p`-injection ritual for asm parts — that lives in the bake interpreter. Primitive parts (`.prim.ts`, `.rev.ts`) keep their existing path. |
| `src/routes/api/primitives/preview/+server.ts` | Updated | When the part is asm + has `meta.graph`, route through `bakeGraph` directly. Otherwise existing path. |
| `src/routes/api/primitives/save/+server.ts` | Updated | Accepts `{ id, graph }` for assemblies. Calls `emitGraph` to produce the `.asm.ts` file content (meta + body). Old source-string saves still accepted for primitive kinds (`.prim.ts`, `.rev.ts`). |

## User-facing changes

| Today | After this plan |
|---|---|
| Imports section shows `B = dt_box` rows (alias bound to import). | Imports section shows `dt_box` rows (just the src). Alias is per-instance, assigned at the Call. |
| Click `+` on an import row → inserts a Call with args populated from the import's defaults BUT silently wires them as `paramKeys` refs to potentially-auto-lifted outer meta.params. | Click `+` → inserts a Call with **literal** arg values (the import's defaults). No auto-lift. New alias from the alphabet. |
| Wiring a slot to an outer param happens via ƒ-popup name typing (text substitution). | Wiring is a typed edge — right-click slot → "Wire to outer param" → pick from a list, or drag from the Parameters row to the slot. ƒ-popup still exists for arbitrary expressions (Math.PI, A.length/2). |
| Auto-wire chip on Call rows + auto-fire on tree-body drift. | **Gone.** Slot kinds are literal/expr/param; what each is, is explicit. |
| `meta.params` row can be silently unwired. | Adding a row immediately shows "no outgoing edges; dialing won't do anything; add an edge?" |
| Drift detection sniffs source strings. | Drift is a structural diff: `meta.graph.nodes[*].src` vs each src's current `params` schema. The same UI badge surfaces, but the engine underneath is typed. |
| Saving an edit may corrupt the source through parser/emitter inverse imperfection. | Edits mutate the in-memory graph (Svelte 5 `$state`). Save writes graph + emits body. Body is not parsed. |

## Case study — `mule_shoe` end-to-end

Step-by-step acceptance test (run in `/primitives` after this plan ships):

1. Create a new asm: `dt_mule_compose.asm.ts` in `basic/`.
2. Imports → `+` → pick `dt_mule_shoe` → `dt_mule_shoe` appears as an
   available row. **No alias on the import row.**
3. Composition → drag `dt_mule_shoe` into the tree → a Call node lands
   with alias `A`, args populated from dt_mule_shoe's defaults as
   literals.
4. Drag again → second Call lands with alias `B`, independent args.
5. Open A's accordion → change `pipeOD` to 5.5 → bake re-runs, only A
   re-bakes (B's geometry cached). Source on disk has not been
   written yet (edits are graph-state, not source).
6. Click **Save** → editor writes `dt_mule_compose.asm.ts` with:
   - `meta.graph = { … }` JSON literal carrying the two Call nodes
     and the list root.
   - Function body with `const A = dt_mule_shoe({pipeOD: 5.5, …}); const
     B = dt_mule_shoe({pipeOD: 3.56, …}); return [A, B];` —
     **regenerated, not edited**.
7. Reopen the file → editor reads `meta.graph`, the two Calls are
   present, A's pipeOD is 5.5. Body in the file matches.
8. Add a `meta.params` row → `outerOD` default 4. The "no edges"
   warning fires.
9. Right-click `A.args.pipeOD` → "Wire to outer param" → pick `outerOD`.
   The warning clears for A.
10. Edit the top-level `outerOD` dial → A re-bakes; B unaffected.
11. Right-click `B.args.pipeOD` → "Wire to outer param" → pick
    `outerOD`. Now A and B share the same dial.
12. Delete `outerOD` from `meta.params` → "Two outgoing edges; replace
    with literal default 4?" → confirm → A and B's pipeOD become
    literals again.

If any step doesn't behave as described, the plan has a bug. The
mule_shoe case study is the **acceptance contract** for the architecture.

## Rollout — vertical slices, NOT horizontal phases

**Principle (user direction, 2026-06-06):** the visual builder, the
bake interpretation, and the data structure MUST stay in sync. Doing
one layer at a time silos them; bugs surface late; the GUI feels
disconnected. Each slice ships **data + emit + bake + GUI together for
ONE feature**. After each slice, the model is verifiable end-to-end
in the GUI. ~1-2 days per slice, 6 slices total.

| # | Slice | Days | Data | Bake | GUI | mule_shoe steps |
|---|---|---|---|---|---|---|
| ✅ | **Foundation** (was Phase A) | done | `composition-graph.ts` + `composition-emit.ts` shipped. `addCall`, `setCallArg`, `addParam`, `wireArg`, `unwireArg`, `removeParam`, `removeNode`, `addContainer`, `addMethod`, `addMv`, `addRot`, `topoOrder`, `collectEdges`. 10/10 tests pass. | — | — | (data-layer coverage of 1-12) |
| **1** | **Hello graph — one Call renders** | 1.5 | already in foundation | NEW `composition-bake.ts` — single Call → `loadPrim(src)` → apply args → `Manifold`. | `/primitives` extension: opening `.asm.ts` with `meta.graph` shows a small Graph view next to the existing editor (NOT replacing). Sole control: "+ Call" picker dropping an instance of any src. Canvas renders. | Step 1 |
| **2** | **Two instances + per-Call edit** | 1.5 | (already there) — second `addCall` + `setCallArg` | List children compose; only re-bake the changed Call. | Per-Call accordion with `ArgValue` editors (literal number/text). Live re-bake on edit. | Steps 2-5 |
| **3** | **Outer params + wiring** | 1.5 | already in foundation | Resolve `kind:'param'` from `paramValues`. Orphan check at remove time. | Parameters accordion (matches `/primitives` style). "Wire to outer" per slot. Orphan warning chip on params with 0 edges. Remove modal lists orphans. | Steps 6-12 |
| **4** | **CSG operators** | 1.5 | `addMethod` (already there) | `.subtract(arg)` / `.add(arg)` / `.intersect(arg)` chain on the bake. | ⊖ ⊕ ⊗ toolbar in the Graph view; click pairs of nodes. | n/a — extends mule_shoe to multi-instance CSG |
| **5** | **mv / rot wrappers** | 1.0 | already there | `mv(child, [x,y,z])` / `rot(child, [rx,ry,rz])`. | Position + rotation inputs on each Call's row. | n/a — positioning |
| **6** | **Legacy banner + cutover** | 1.0 | — | drop the text-eval bake path for asm parts | Old `.asm.ts` without `meta.graph` open with amber "legacy — rebuild or delete" banner + read-only source pane. Save-as creates `meta.graph` version. Existing `CompositionEditor.svelte` is REPLACED by the Graph view; `composition-tree.ts` + `assembly-deps.ts` deleted. | (hybrid migration: Q3+Q4 resolved) |

**Total: ~7.5 days across 6 slices** (foundation already shipped).
Each slice is independently shippable + verifiable in the GUI.

## Why vertical slices

- **Drift impossible**: each slice forces all three layers to agree
  before merging. A data-layer change that breaks the bake or the GUI
  stops the slice; horizontal phases don't notice until late.
- **Verifiable cadence**: you can poke at the GUI every 1-2 days, not 7+
  days from now when three horizontal layers finally converge.
- **Smaller backtrack**: a bad slice = revert one commit + redo 1.5
  days. With horizontal phases a bake bug surfacing in the editor
  phase rewinds days of editor work.
- **mule_shoe contract walks naturally**: steps 1 / 2-5 / 6-12 map to
  slices 1 / 2 / 3 respectively. Acceptance becomes a natural
  milestone, not an end-of-phase audit.
- **Comprehensible per slice**: data + bake + GUI for ONE feature is
  one sitting; the whole architecture for none of them isn't.

## What the foundation (former Phase A) bought

The 10 tests in `composition-graph.test.ts` already cover the
mutations Slices 1-3 will exercise. The demo script
`scripts/demo-composition-graph.ts` prints the model behaviour for
every mule_shoe step. Nothing from Phase A gets thrown away — Slice 1
just adds the bake interpreter + a minimal GUI on top.

## What we delete (no compat)

- `src/lib/cad/composition-tree.ts` — replaced by `composition-graph.ts`.
- `src/lib/cad/assembly-deps.ts` — replaced by structural diffs on the graph.
- The text-eval bake path for asm parts in `primitive-loader.ts`.
- The K.66 drift chrome that sniffs source: rewritten as a graph-level diff.
- The K.67 auto-wire chip + tree-body-drift auto-fire (already declared
  dead in code via the `liftedSpecs` stub; removed entirely).
- `applyToSource` and the entire emit-back-to-text-then-re-parse cycle.
- `parseBody`, `parseComposition`, `parseImports`, `parseDependencies`
  — every parser that takes the asm body string as input.
- Legacy `.asm.ts` files that don't have `meta.graph` on disk become
  "empty composition" when opened. The user either rebuilds in the
  editor or deletes the file.

## How this plays with K.66, K.68, K.69

- **K.66 (Imports drift refresh)**: structurally subsumed. The drift is
  now `graph.nodes[*].src` vs each src's current `params` schema. The
  ⚠ badge + ↻ refresh per import row still ship — they just diff graph
  metadata against live `meta.params` instead of regex-sniffing the
  body. The K.66 line item in `/plan` gets marked `done by K.67/this
  plan`.

- **K.67 (Graph promotion)**: this plan IS K.67's content, simplified
  by the "no backward compat" decision (K.67's Phase 1/Phase 4 split
  collapses to one shipping pass).

- **K.68 (Generative authoring)**: the rule-translator already targets
  the K.62 TreeNode shape. Re-target it to the new graph shape (mostly
  mechanical — emit `GraphNode` objects instead of `TreeNode`). The
  vocabulary-graph + LLM tiers stay unchanged.

- **K.69 (Vocabulary editor + boolean_modify)**: unaffected. `mule_shoe`
  in `/vocab` already uses the proposal-translator (no
  source-roundtrip there — it goes direct from proposal JSON to the
  emitted `.prim.ts`). The Composition Tree visualisation I added in
  the Proposed tab (commit `285647f`) already shows the rule as a tree
  — under this plan it stays as a static visualisation since
  `boolean_modify` is a primitive-kind rule, not an asm.

## Resolved questions (signed off 2026-06-06)

1. **NodeId scheme**: random short id `n_<6 chars>` (e.g. `n_abc123`).
   Decoupled from the alias so renames don't cascade through edges.
   Aliases are user-facing labels; ids are internal identity.
2. **GraphArg/GraphExpr**: **unified** as a single `ArgValue` tagged
   union (`{kind: 'literal'|'expr'|'param', ...}`). Whether the parent
   holds them by key or by position is the parent's concern, not the
   value's.
3. **Volume migration**: **hybrid** — leave legacy `.asm.ts` files on
   disk; opening one shows an empty graph + a banner + a read-only
   source pane below for transcription. No destructive operation in
   Phase A; user self-paces the migration.
4. **Sidebar treatment of empty-graph asms**: **amber "legacy" chip**.
   Matches the existing palette for "attention without alarm". Tooltip
   explains; the read-only banner inside the editor is the workflow.

Recommendations + pros/cons table for each — see the session
2026-06-06 message exchange.
