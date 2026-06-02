# Composition (K.63) — `.asm.ts` methodology + API reference

The `.asm.ts` assembly model is the second authoring shape on the cadtrain
volume, alongside the older `.prim.ts` primitive composite. A primitive
defines geometry by hand — typically a chain of `const X = r_*(…);` calls
the recognizer scans (Rule 20). An assembly defines geometry **declaratively**:
a typed import list, a tree of CSG / placement nodes, and a generated
function body. Edits go through `CompositionEditor` and commit by re-emitting
the whole body. This doc is the canonical reference for that pipeline.

Companion files (DON'T duplicate their content):

- `src/lib/cad/composition-tree.ts` — implementation.
- `src/lib/shared/CompositionEditor.svelte` — UI + editor-side semantics.
- `src/lib/server/part-colors.ts` — color LUT, `analyzeAssembly` branch.
- `src/lib/cad/part-id.ts` — `partHashId`, the per-instance hash.
- `src/lib/server/primitive-loader.ts` — `tagInstanceSources`, signature rewrite.
- Root `CLAUDE.md` Rules 13 / 17 / 20 / 21 — volume layout + authoring layers.

## 1. The K.63 assembly model

An `.asm.ts` file is a normal TypeScript module on the volume
(`primitives/<category>/<id>.asm.ts`), authored exclusively through the
`/primitives` UI. It carries five fields on `meta` and one auto-generated
function body. The function body is **never edited by hand** — the tree is
the source of truth.

```ts
export const meta = {
  name: 'my_assy',
  tags: ['assembly'],
  imports:       [ { name: 'A', src: 'shaft' }, { name: 'B', src: 'collar' } ],
  composition:   { type: 'method', id: '…', op: 'subtract', obj: {…}, arg: {…} },
  uses:          ['shaft', 'collar'],
  params:        { length: { label: 'L', min: 1, max: 20, step: 0.1, default: 8 } },
  instanceColors:{ A: { outer: '#cc2222' }, B: { inner: '#888888' } },
  dependencies:  [ { id: 'shaft',  paramKeys: ['od', 'id', 'length'] },
                   { id: 'collar', paramKeys: ['od', 'h']             } ],
};

export function my_assy(length) {
  const A = shaft;
  const B = collar;
  return __tag(A(…), 1090519041).subtract(__tag(B(…), 1342177280));
}
```

The fields:

- **`meta.imports`** — alias → src primitive id. **One row per dropped
  instance**, even when many use the same src (`A` and `B` can both
  `src: 'spiral'`). Alias allocation is monotonic A→B→…→Z→AA→AB and
  **never recycled** on delete; see commit `3bfe48c`. The editor view
  dedupes by src (`uniqueImports`), so the user sees one row per
  primitive while the underlying list grows per instance.
- **`meta.composition`** — a SINGLE `TreeNode` root (see Section 2). May
  be `null` when the assembly is freshly created; renders as an implicit
  empty list. Section 3 covers parse / emit / mutate.
- **`meta.params`** — assembly-level params surfaced as positional args
  in the exported function signature. The loader bundles them into
  `const p = {…}` so the body can reference `p.length` etc. — see Section 3
  on `addAssemblyParam` / `removeAssemblyParam` and `5e0d945` for the
  signature-rewrite rule.
- **`meta.uses`** — derived from `inferUses(imports, root)`: every
  `imports[i].src` plus any direct `Call.fn` that isn't an alias. The
  loader fetches each entry as a dep; stale entries cause "missing
  dependency" errors at bake time (`94814bc`).
- **`meta.instanceColors`** (optional) — keyed by alias, `{ outer, inner }`
  hex pairs. Drives per-instance bake colors via `analyzeAssembly`
  (Section 5).
- **`meta.dependencies`** (optional) — `[{ id, paramKeys }]` rows
  snapshotting upstream primitives' param-key order at last save. The
  editor uses this to label positional args on Call rows (Section 4);
  unsnapshotted imports fall back to a live `/api/primitives/source`
  fetch into `livePK`.

### Contrast with the older `.prim.ts` shape

A primitive composite is recognized by scanning `const X = r_*(…)` lines
(`recognizeComposite` in `src/lib/server/recognize-composite.ts`). It uses
NO `meta.composition`, NO `meta.imports`. The geometry function lives
verbatim in the source. The recognizer dispatches in
`analyzeParts(source)` (`part-colors.ts:47`):

```ts
if (metaForAsm?.composition && typeof metaForAsm.composition === 'object') {
  return analyzeAssembly(metaForAsm);
}
// otherwise fall through to the recognizer path
```

The two paths NEVER mix. An `.asm.ts` opts into the K.63 pipeline by
having `meta.composition` present; everything else stays on the older
recognizer.

## 2. TreeNode data shape

The composition tree is a discriminated union with nine variants. Every
node carries `id` (8-char alpha, `newNodeId()`) for editor identity and an
optional `name`. The variants:

```ts
type TreeNode =
  | { type: 'call';    id; name?; fn; args[]; mv?: [n,n,n]; rot?: [n,n,n] }
  | { type: 'method';  id; name?; obj; op: 'add'|'subtract'|'intersect'; arg }
  | { type: 'list';    id; name?; children[] }
  | { type: 'stack';   id; name?; children[] }
  | { type: 'overlay'; id; name?; anchor; child; at: 'head'|'tail'|'center' }
  | { type: 'mv';      id; name?; child; offset: [n,n,n] }
  | { type: 'rot';     id; name?; child; rot:    [n,n,n] }
  | { type: 'ref';     id; name?; target: string }
  | { type: 'literal'; id; name?; value:  string };
```

Categories used by the editor:

- **Folder kinds** (containers, render as expandable folders):
  `list / stack / method / overlay / mv / rot`.
- **File kinds** (leaves, render as one-line file rows):
  `call / ref / literal`.

### Inline `mv` / `rot` on Call

A `call` node may carry optional `mv` and `rot` triplets. `emitNode`
wraps the call expression as **mv inner, rot outer**:

```
rot(mv(fn(…args), [mvX, mvY, mvZ]), [rotX, rotY, rotZ])
```

This keeps single-leaf transforms flat (no folder node needed). The
standalone `mv` / `rot` folder nodes still exist for transforming a
multi-child group. The editor exposes the inline form via `↦ Transform ▾`
on a Call row's bottom toolbar (commit `ed2e13f`); editing the triplets
moves into the Call's expanded body (`78438cb`).

### Immutable mutation

`replaceNode` and `deleteNode` return a NEW root — they never mutate
in place. Svelte 5's identity-based reactivity needs this: a mutated-in-place
tree would skip the diff and the editor wouldn't re-render. Every
mutation in `CompositionEditor` follows the pattern `commit(imports,
mutate(composition))` where `mutate` is one of the immutable helpers.

### Delete = collapse for single-slot parents

`deleteNode` on a node whose parent is a method / overlay / mv / rot slot
replaces the slot with an empty `literal` placeholder. For `list`/`stack`
children, it splices out. The editor never offers "delete the obj side of
a method"; the natural workflow is delete the whole method, or replace
its operand via the picker.

### `parseDependencyParamKeys` for arg labels

The editor labels a Call's positional args using the upstream primitive's
`Object.keys(meta.params)` order. The snapshot is stored in
`meta.dependencies` at save time, parsed via `parseDependencyParamKeys`,
and looked up alias → src → paramKeys. Unsnapshotted imports fall back to
a live fetch (`livePK` in `CompositionEditor`).

## 3. Parse / Emit / Mutate API

All exports from `composition-tree.ts`. The contract is "you give source,
you get source back" — no intermediate write to the disk happens in this
file. The `/api/primitives/save` endpoint is the only writer.

### Parse

```ts
parseImports(source: string): ImportDef[]
parseComposition(source: string): TreeNode | null
parseDependencyParamKeys(source: string): Map<string, string[]>
```

Each scans a balanced top-level meta key (`imports:`, `composition:`,
`dependencies:`) via `findValueRange` — brace + bracket balanced, string-
aware. Nested descriptors like `default: { kind, params: { r, len } }`
parse correctly (this is the regression `ae5874c` fixed). All three are
TOTAL — they return `[]` / `null` / empty Map on missing or malformed
input rather than throwing.

`rehydrateNode` assigns fresh ids to any nodes missing one — so older or
hand-authored sources work.

### Walk

```ts
walkTree(root: TreeNode | null, fn: (n: TreeNode) => void): void  // pre-order DFS
childrenOf(node: TreeNode): TreeNode[]                            // direct children, normalized
findNode(root: TreeNode | null, id: string): TreeNode | null
findParent(root: TreeNode | null, id: string): NodeLocation | null
```

`NodeLocation.slot` enumerates every place a node can sit. Full list:

```
'args' | 'children' | 'obj' | 'arg' | 'anchor' | 'child' | 'offset' | 'rot' | 'mvInline' | 'rotInline'
```

`mvInline` / `rotInline` are the Call's inline triplet slots — distinct
from a standalone `mv`/`rot` folder's `offset`/`rot` slots. The editor
doesn't currently splice via `findParent`, but any future "move node"
operation needs this exhaustive list.

### Mutate (immutable)

```ts
replaceNode(root: TreeNode, id: string, replacement: TreeNode): TreeNode
deleteNode(root: TreeNode, id: string): TreeNode | null
```

Rules:

- `replaceNode` clones every container on the path to `id`. Containers
  off the path share identity with the source tree — safe to compare by
  reference.
- `deleteNode` returns `null` only when the ROOT itself is being deleted
  (the editor treats `null` as "empty composition", same as a fresh
  file).
- A single-slot parent (`method.obj`, `method.arg`, `overlay.anchor`, …)
  of a deleted node gets an empty `literal` placeholder so the tree
  stays well-formed.

### Emit

```ts
emitImports(imports: readonly ImportDef[]): string   // → '  const A = shaft;\n  const B = collar;'
emitNode(node: TreeNode): string                     // → JS expression
emitAssemblyBody(imports, root): string              // → full function body
```

The **critical detail** in `emitNode`: every Call gets wrapped in
`__tag(<expr>, partHashId(fn))`. This is what makes color-by-source work
through CSG — see Section 5. A pre-K.63 assembly on disk lacks the wraps
until the user edits and saves it again.

`emitNode` for a `list` produces `[a, b, c]` (a plain array). The
loader's `autoPlace` then flattens arrays into a `place(…)` group at the
top level (`primitive-loader.ts:244+`), so an assembly returning a list
gets a `Manifold.compose` placement rather than a fused union.

### Source-level read / write

```ts
writeImports(source, imports): string
writeComposition(source, root): string
writeUses(source, uses): string
rewriteAssemblyFunctionBody(source, id, body): string
applyToSource(source, id, imports, root): string  // ← the editor's entry point
```

`applyToSource` is the canonical commit path:

```ts
function applyToSource(source, id, imports, root) {
  let out = writeImports(source, imports);
  out = writeComposition(out, root);
  out = writeUses(out, inferUses(imports, root));
  out = rewriteAssemblyFunctionBody(out, id, emitAssemblyBody(imports, root));
  return out;
}
```

Editor callers must never hand-write the source. The four steps are
ordered: imports first (so `inferUses` sees the up-to-date list), uses
next (so the loader fetches the right deps), body last (so the regen
sees the new imports + uses).

`rewriteAssemblyFunctionBody` finds `export function <id>(…) {` and
brace-balances to find the closing `}`. The signature is untouched here
— it gets rewritten by `addAssemblyParam` / `removeAssemblyParam` and at
runtime by the loader (commit `5e0d945`).

### Assembly params

```ts
addAssemblyParam(source, id, spec): string     // splice into meta.params + sig
removeAssemblyParam(source, id, name): string  // remove from both
```

`spec` has the same shape as a primitive param entry (`name`, `label`,
`min`, `max`, `step`, `default`). Add is idempotent — re-adding an
existing name is a no-op.

The loader does an INDEPENDENT signature rewrite at runtime: it reads
`paramKeysOf(source)` (the canonical key list from `meta.params`) and
rewrites the function signature to those keys, preserving any trailing
positional args beyond `meta.params` (`primitive-loader.ts:199–229`).
This means changing meta.params automatically updates how the body
binds — no need to keep `addAssemblyParam` perfectly in sync with the
sig.

### `inferUses`

```ts
inferUses(imports, root): string[]
```

Walks the tree and collects every Call's `fn` that isn't an alias name,
plus every `imports[i].src`. The loader treats this list as a hard fetch:
stale entries from a removed primitive still get loaded and can cascade
failures (commit `94814bc` enriches the error to point at the parent).
`writeUses` is invoked from `applyToSource` so this stays in sync on
every edit.

## 4. The CompositionEditor contract

`CompositionEditor.svelte` is the only component that drives `.asm.ts`
edits. Props:

```ts
let {
  source,         // string  — the assembly's full .asm.ts text
  id,             // string  — the part id (for applyToSource)
  canEdit = false,
  catalog = [],   // Array<{ id: string }>
  onSourceChange, // (next: string) => void
} = $props();
```

`onSourceChange` fires on every commit. Parent (`PrimitiveView`) writes
to the volume via `/api/primitives/save`. The editor never persists.

### Imports section

- Rendered as a 2-column grid of `name = src` rows, deduplicated by src
  (`uniqueImports`). Two `{ name: 'A', src: 'spiral' }` + `{ name: 'B',
  src: 'spiral' }` show as ONE row labelled `spiral` with a `+` button
  to add another instance.
- `+ Import` opens a primitive picker (filtered against `catalog`). On
  pick, calls `addImport(primId)` → allocates a fresh alias via
  `nextAlias`, commits.
- The row's `+` button (`insertImportUse`) drops a new Call into the
  composition with a fresh alias; the row's trash button removes EVERY
  alias pointing at that src (`removeImportSrc`).
- Trash is **disabled** when any Call in the tree references one of that
  src's aliases (`hasInstancesOf`). The user has to delete the Call
  instances first — prevents orphaned references.

### Composition section (folder-tree)

- The section header IS the root row. `[ ] compose / ↓ compose / ⊖
  compose / …` depending on the root's kind, with `+ file` / `+ compose`
  buttons.
- Children render at `--depth: 1` when the root is a List or Stack
  (header serves as the list row); a scalar root renders as a single
  child at depth 1.
- An empty composition is conceptually an implicit `list`. Adding
  first via `+ file` creates a `list` root wrapping the new Call
  (`insertImportUse` / `createCallNode`).
- `+ file` opens a picker showing the imports-section srcs only
  (deduped). Picking creates a new Call with a fresh alias — multiple
  instances of `spiral` become `A: spiral`, `B: spiral`, `C: spiral`.
- `+ compose` opens a folder-kind picker (list / stack / method /
  overlay / mv / rot).
- Drag-and-drop from outside: dropping a primitive id (MIME
  `application/x-primitive-id`) onto the section or any list/stack
  folder calls `callWithDefaults(id)` and appends.

### Call file row

Title format: `<alias>: <src>` (commit `a94d0df`). Two small status dots
appear when `mv` or `rot` is set on the call (`↦` / `↻`). Per-instance
outer + inner color swatches sit before the dots; clicking opens
`INSTANCE_PALETTE` + custom-color popup (`eb1e695`).

The row uses an **exclusive-open accordion** model: at most one Call
body is "active" (`activeCall`), plus any number "pinned"
(`pinnedCalls`). Pin toggles via `📌`; clicking the whole row toggles
the active slot (`49f32f8`). Same behavior as `PrimitiveView`'s
`pinnedParts`.

The expanded body holds:

1. **Props grid** — positional args of the Call laid out 2 per row.
   Labels come from `aliasParamKeys.get(call.fn)` (the meta.dependencies
   snapshot or `livePK` fallback). A literal arg renders as an input;
   other types render read-only with `emitNode` as hover title.
2. **mv editor row** — 3 inputs + a trash button to remove the inline mv.
3. **rot editor row** — same for rot.
4. **`↦ Transform ▾`** / **`⊖ Method ▾`** bottom toolbar
   (`ed2e13f`). Transform opens an mv/rot picker that adds the inline
   triplet to the Call. Method opens a subtract/add/intersect picker
   that wraps the Call in a method node with a cloned sibling on the
   `.arg` side (`wrapCallInMethod`).

### Folder (method / list / stack / mv / rot / overlay) rows

Render with their kind badge or — for `method` — a colored op chip (`⊖
subtract` red, `⊕ add` green, `∩ intersect` blue). Clicking the op chip
opens a swap popup. Children render at `depth + 1`. List/stack folders
get the same `+ file` / `+ compose` buttons.

### Per-instance color popup

The editor reads / writes `meta.instanceColors[alias] = { outer, inner }`
directly via three small helpers (`instanceColorsSpan`,
`readInstanceColors`, `serializeInstanceColors`). These mirror the
primitive composite path's serialization shape — `analyzeAssembly` then
reads them at bake time. NOTE: the editor doesn't route this through
`applyToSource` because the change touches `meta.instanceColors`, not
imports/composition/uses.

## 5. Color-by-source pipeline

The end-to-end pipeline so a Call's swatch picks actually change render
color. Four stages:

### Stage 1 — emit-time tag

`emitNode` wraps every Call's expression in `__tag(<expr>,
partHashId(fn))`. `partHashId(alias)` is deterministic (FNV-1a over the
alias name, biased into the band `0x40000000..0x7FFFFFFF`). This band is
chosen so it can't collide with Manifold's auto-counter (lives in
`0..0x3FFFFFFF`) or its product sentinel `0xFFFFFFFF`. Two Call
instances with the same alias (impossible by construction — the editor
always allocates fresh aliases) would share a hashId; aliases with the
same `src` always have distinct hashIds.

### Stage 2 — runtime stamp

The sandbox injects `__tag` as `helpers.tagManifold` (see
`primitive-sandbox.ts`). At runtime:

```ts
export function tagManifold(m: any, hashId: number): any {
  if (!m || typeof m.getMesh !== 'function') return m;
  const mesh = m.getMesh();
  mesh.runOriginalID = new Uint32Array([hashId >>> 0]);
  mesh.runIndex = new Uint32Array([0]);
  return new Manifold(mesh);
}
```

The output Manifold carries that `originalID` per triangle. Through CSG
(`.add`/`.subtract`/`.intersect`), Manifold's mesh relation propagates
it run-by-run. `__tag` is a no-op on anything that isn't a Manifold
(e.g. a `resolveProfile` literal), so wrapping is always safe.

There is also a parallel path for `.prim.ts` composites:
`tagInstanceSources` in `primitive-loader.ts` splices `__tag(…)` around
each recognized `const X = r_*(…)` init. K.63 assemblies hit the emit-time
path; primitive composites hit the loader-time path. Both produce the
same originalID layout.

### Stage 3 — analyze

`analyzeParts(source)` in `part-colors.ts` is the dispatcher:

```ts
if (metaForAsm?.composition) return analyzeAssembly(metaForAsm);
// else fall through to the recognizer path
```

`analyzeAssembly`:

1. Walks `meta.composition`. For each Call, records its alias in either
   `additiveOrder` (default) or `subtractiveNames` (when the alias sits
   on the `.arg` side of a method, or is descended from a subtract /
   intersect op).
2. Picks the first additive alias as the "body" — its outer color
   becomes the unknown-surface fallback.
3. Builds two maps `partHashId(alias) → outer` / `partHashId(alias) →
   inner`. A user override in `meta.instanceColors[alias]` wins; the
   fallback is `INSTANCE_PALETTE[fnv1a(alias) % N]` via
   `colorsForInstance`.
4. Returns `{ outer, inner, subtractive, bodyId, bodyInner, bodyColor,
   active: true }`.

### Stage 4 — render

`colorBySourceGeo` in `builder.ts` (around line 689) reads
`mesh.runOriginalID` + `mesh.runIndex` via `triSourceIds`, then per
triangle:

```ts
if (id === SECTION_ID)       rgb = bodyInnerRgb;          // cross-section reveal
else if (subtractive.has(id)) rgb = innerRgb.get(id);     // cut/bore wall
else                          rgb = outerRgb.get(id);    // external skin
```

`SECTION_ID = 0xC0000000` is the half-cutaway plane (sits in its own
band above the part hashes). The GLB bake (`manifold-bake.ts`) shares
`triSourceIds` so the exported mesh matches what the live canvas shows.

### Invariants

- **Alias is the unit of color identity.** Two Calls of the same alias
  (impossible — aliases are unique by construction) would share a
  color; two Calls of the same src with different aliases always have
  distinct colors.
- **`meta.instanceColors[alias]` overrides the palette default.**
- **Changing one instance's color doesn't affect siblings.** This is the
  K.63 fix that landed in `db67c38`. Pre-fix assemblies emitted no
  `__tag` wraps, so the bake had a single fused mesh and all swatches
  drove the same triangles. Re-emit (any edit + save) installs the
  wraps and unlocks per-instance color.

## 6. Common pitfalls

Things that have bitten this codebase. Prime future agents:

- **Pre-K.63 assemblies don't auto-tag.** Existing `.asm.ts` on disk
  still have the OLD untagged body. Symptom: bake shows one color even
  though `meta.instanceColors` is set. Fix: edit anything, save — the
  next `applyToSource` re-emits the body with `__tag` wraps. (Commit
  `db67c38`.)
- **`meta.uses` is a hard fetch list.** Even if the body never calls a
  dep, the loader fetches every entry. Stale `r_threads` in `dp_box`'s
  uses bit `my_assy`'s bake. Commit `94814bc` enriches the error with
  the parent + chain. Trim uses when removing primitives — `applyToSource`
  does this automatically via `inferUses`, but manual edits to `.asm.ts`
  can drift.
- **`bodyOf` extracts the build() body, not the module.** When seeding
  `ProfileFnEditor` from a volume profile (`<id>.prvl.ts`), use the
  `export function build(p) {` matcher with brace-balance (`6f0bd36`);
  the old indexOf/lastIndexOf grabbed the whole module.
- **Verbatim composeSource needs destructure.** When `ProfileFnEditor`
  falls into the verbatim branch (multi-`Array.from`, named-spread
  bodies), prepend `const { od, bore, … } = p;` — the body references
  bare param names that exist in the part's signature but not in
  `build(p)` (`4901e49`).
- **`findProfileSlots` backward sweep handles multi-line consts.** The
  back-sweep balances braces+parens+brackets over multi-line `const X =
  Array.from({…}, (_, i) => { … });` declarations (`7f98a13`). A naive
  single-line const matcher misses these.
- **Letter allocation is monotonically growing.** `nextAlias` walks A →
  B → … → Z → AA → AB. Recycling on delete is intentionally NOT done
  (`3bfe48c`) — the alias is part of the identity record (history,
  per-instance color swatches), and recycling would silently merge two
  semantically distinct instances.
- **`composition` may be `null`.** Freshly created assemblies render
  the implicit empty list. First `+ file` wraps the new Call in a List
  root (`insertImportUse` / `createCallNode` synthesize one). Code that
  walks composition unconditionally must guard.
- **The editor reads `meta.instanceColors` directly, not via `applyToSource`.**
  Color edits bypass the imports/composition pipeline. This is fine
  because they don't touch any of the other meta fields, but a future
  agent adding "edit `meta.params` from the Call row" needs to wire
  through `addAssemblyParam` instead.
- **`name` collisions between an alias and a sandbox helper are
  resolved at load time.** If a user names an import the same as a
  sandbox helper (`tube`, `cyl`, `mv`), the loader aliases the dep to
  `__dep_N` and rewrites the body's calls (`primitive-loader.ts:170+`).
  Volume primitives win over sandbox helpers; alias names are picked by
  the editor (A, B, C, …) so this collision can only happen for a Call
  whose `fn` IS a sandbox name — rare in practice but supported.
