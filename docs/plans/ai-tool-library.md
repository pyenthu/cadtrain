# Plan — AI Function Library: the capability SOURCE OF TRUTH

**Status:** proposed (2026-07-01). PLANNING + AUDIT only — no implementation in
this doc's commit. Detail sheet under **`docs/plans/ai-master-plan.md` (the
north star)** — this = P0 (registry foundation) + P1 (complete-the-tools,
`addSpline` first); the registry it defines is the source of truth the whole
system generates from.

**Trigger.** A user asked the in-browser AI to "add a circular spline" and it
refused: *"the tools don't include a way to create a spline node (only addCall /
edit polygon points)."* The AI's tool library (`EDITOR_TOOLS`, 12 tools) is a
strict SUBSET of what the editor can actually do, and nothing ties user intent →
editor function. There is no `addSpline` tool even though the picker creates
splines and `addSpline` has been a public mutator since TODO #15.

**Why this is foundational (not cosmetic).** Under the data-residency constraint
(memory `ai_data_residency_local_first`): the shipped runtime AI must be
LOCAL-first — a WebLLM/MLC small model, no prompt data leaving the browser
(#2, #28). Everything downstream is GENERATED from the tool library:

- the cloud tool schema (`toClaudeTools()`),
- the prose/TS prompt (`toolListText()`),
- the local model's grammar (a proposed `toJsonSchema()` / XGrammar CFG),
- the #28 synthetic `{prompt → call}` dataset,
- the #27 few-shot corpus (RAG-P3 nearest-pair injection).

If a capability is missing or undocumented in the library, the synthetic data,
the few-shot examples, and any local fine-tune are ALL blind to it. A complete,
compact, well-documented library is the precondition for the local model to be
as capable as the editor. "Add a spline" must not be able to silently become
impossible again.

Related: #1 (RAG assist), #2 (web-llm), #27 (feedback/RL DB), #28 (synthetic +
fine-tune), memory `ai_data_residency_local_first`. Supersedes the ad-hoc §E of
`docs/plans/ai-multishot-assist.md` (see §5 — §E is itself incomplete: it never
lists the spline).

---

## 1. AUDIT — capability → tool gap

### 1.1 The 12 shipped tools

`src/lib/cad/editor-tools-schema.ts` (`EDITOR_TOOLS`) + dispatch
`src/lib/cad/editor-tools.ts` (`dispatchEditorTool`):

| Tool | Backing mutator | Area |
|---|---|---|
| getEditorState | `readEditorState` (read) | orient |
| addParam | `addParam` | params |
| setParamSchema | `setParamSchema` | params |
| wireArgToParam | `wireArg` | wiring |
| setCallArg | `setCallArg` | wiring |
| addPolygonPoint | `addPolygonPoint` | polygon |
| setPolygonCoord | `setPolygonCoord` | polygon |
| addCall | `addCall` | create |
| removeNode | `removeNode` | structural |
| moveNode | `addMv` | transform |
| rotateNode | `addRot` | transform |
| csg | `addMethod` | structural |

### 1.2 Real capability surface

- **Picker-creatable node types** (GraphEditorPane imports): Call, Polygon,
  Sketch, Spline, Expr (def + instance), Stack/Container, Repeat, Method/CSG,
  Mv/Rot/Txfmn transforms.
- **Node types** (`composition-graph-types.ts`): call · list/stack/group ·
  method · mv · rot · txfmn · repeat · polygon · poly_repeat · sketch ·
  sketch_repeat · expr (+ exprDefs) · spline.
- **Public mutators** (`composition-graph-mutate.ts`): ~110 exported functions.

### 1.3 Gap table (capability → does an AI tool exist? → mutator)

**CREATE (picker parity) — the headline gap:**

| Capability | AI tool? | Mutator |
|---|---|---|
| Add a Call (instance a part) | ✅ addCall | `addCall` |
| Add a Polygon | ❌ MISSING | `addPolygon` |
| Add a Sketch | ❌ MISSING | `addSketch` |
| **Add a Spline** (the trigger) | ❌ **MISSING** | `addSpline` |
| Add an Expr def / instance | ❌ MISSING | `addExprDef` / `addExprInstance` |
| Add a Stack / container | ❌ MISSING | `addStackPlaceholder` / `addContainer` |
| Add a Repeat | ❌ MISSING | `addRepeatPlaceholder` |
| Add a CSG method (unwired) | ⚠️ partial | `addMethodPlaceholder` (only atomic `csg` exists) |
| Add a Move / Rotate | ✅ moveNode/rotateNode | `addMv` / `addRot` (legacy — not `addTxfmn`) |
| Add a unified Transform | ❌ MISSING | `addTxfmnPlaceholder` / `addTxfmn` |

**SPLINE (entirely AI-invisible — this is the reported bug):**

| Capability | AI tool? | Mutator |
|---|---|---|
| Create spline | ❌ MISSING | `addSpline` |
| Set control points | ❌ MISSING | `setSplinePoints` |
| Set sample count | ❌ MISSING | `setSplineSamples` |
| Close the loop (→ "circular spline") | ❌ MISSING | `setSplineClosed` |

> The user's exact ask, "add a circular spline", = `addSpline` + `setSplineClosed(true)`
> + optionally `setSplinePoints`. **Zero of the three exist as tools.**

**SKETCH (0 of ~12 mutators exposed):**

| Capability | AI tool? | Mutator |
|---|---|---|
| Add op (line/spline/fillet/chamfer) | ❌ MISSING | `addSketchOp` |
| Set op field (r/z/radius/dist) | ❌ MISSING | `setSketchOpField` |
| Line↔spline / abs↔rel / move / remove | ❌ MISSING | `setSketchOpKind` / `setSketchOpMode` / `moveSketchOp` / `removeSketchOp` |
| Segments / scale | ❌ MISSING | `setSketchSegments` / `setSketchScale` |
| Spline through-points + handles | ❌ MISSING | `addSketchSplinePoint` / `setSketchSplinePoint` / `removeSketchSplinePoint` / `setSketchSplineHandle` / `clearSketchSplineHandle` |

**POLYGON (create + remove/reorder + repeat/expr wiring missing):**

| Capability | AI tool? | Mutator |
|---|---|---|
| Add / set-coord | ✅ addPolygonPoint / setPolygonCoord | `addPolygonPoint` / `setPolygonCoord` |
| Remove / reorder point | ❌ MISSING | `removePolygonPoint` / `movePolygonPoint` |
| Add a repeat block / expr-list ref | ❌ MISSING | `addPolygonRepeat` / `addPolygonExprListRef` / `addPolygonExprList` |
| Close polygon (`setPolygonClosed`) | ❌ MISSING | **no backing fn** — PolygonNode has no `closed` field (always a closed ring); needs a new field if wanted |

**EXPRESSION def/instance (the whole builder is AI-invisible):**

| Capability | AI tool? | Mutator |
|---|---|---|
| Add def / instance | ❌ MISSING | `addExprDef` / `addExprInstance` |
| Rename / remove def | ❌ MISSING | `setExprDefName` / `removeExprDef` |
| Add/set/remove param·const·var·output | ❌ MISSING | `addExprDefParam`…`removeExprDefOutput` (16 setters) |
| Set output shape (scalar/list/point) | ❌ MISSING | `setExprDefOutputShape` |
| Wire / clear instance input binding | ❌ MISSING | `setExprInputBinding` / `clearExprInputBinding` |

**REPEAT (create + all knobs missing):**

| Capability | AI tool? | Mutator |
|---|---|---|
| Add repeat | ❌ MISSING | `addRepeatPlaceholder` / `addRepeat` |
| Count / op / child | ❌ MISSING | `setRepeatCount` / `setRepeatOp` / `setRepeatChild` / `addRepeatChild` |
| Loop var / bindings / modifiers / per-part | ❌ MISSING | `setRepeatLoopVar` + binding/modifier/partModifier families |

**CONTAINER / STACK:**

| Capability | AI tool? | Mutator |
|---|---|---|
| Add stack / container | ❌ MISSING | `addStackPlaceholder` / `addContainer` |
| Append / remove child | ❌ MISSING | `appendContainerChild` / `removeContainerChildAt` |
| Per-child stack ref / count | ❌ MISSING | `setStackChildRef` / `setStackChildCount` |

**METHOD / CSG:**

| Capability | AI tool? | Mutator |
|---|---|---|
| Atomic obj OP arg | ✅ csg | `addMethod` |
| Drop unwired CSG + wire slots | ❌ MISSING | `addMethodPlaceholder` / `setMethodInput` |

**TRANSFORMS (beyond the wrap-and-offset moveNode/rotateNode):**

| Capability | AI tool? | Mutator |
|---|---|---|
| Set a transform axis to a value/expr/param | ❌ MISSING | `setTransformAxisValue` / `setTxfmnAxis` |
| Wrap / unwrap / rebind child | ❌ MISSING | `wrapInTransform` / `unwrapTransform` / `setTransformChild` / `setTxfmnChild` |

**PARAMS (inverse ops missing):**

| Capability | AI tool? | Mutator |
|---|---|---|
| Remove a param (report orphans) | ❌ MISSING | `removeParam` |
| Unwire an arg back to a literal | ❌ MISSING | `unwireArg` |
| Add the reserved stack-ref param | ❌ MISSING | `addStackRef` |

**PART PROPERTIES:**

| Capability | AI tool? | Mutator |
|---|---|---|
| Set outer / inner colour | ❌ MISSING | `setPartColorOuter` / `setPartColorInner` |
| Set material | ❌ MISSING | `setPartMaterial` |
| Per-part appearance | ❌ MISSING | `setPartAppearance` |

**READ:**

| Capability | AI tool? | Mutator |
|---|---|---|
| Whole-graph snapshot | ✅ getEditorState | `readEditorState` (omits args, points, children, exprDefs) |
| Inspect ONE node in full | ❌ MISSING | `describeNode` (new read) |

### 1.4 Headline missing tools (minimum set to close the gap)

`addSpline` · `setSplinePoints` · `setSplineSamples` · `setSplineClosed` ·
`addSketch` · `addSketchOp` · `setSketchOpField` · `removeSketchOp` ·
`addPolygon` · `setPolygonClosed`* · `removePolygonPoint` · `addExprDef` ·
`addExprInstance` · `setExprInputBinding` · `addRepeat` · `setRepeatCount` ·
`setRepeatOp` · `setRepeatChild` · `addContainer`/`addStack` ·
`appendContainerChild` · `addMethodPlaceholder` · `setMethodInput` ·
`setTransformAxisValue` · `wrapInTransform` · `unwireArg` · `removeParam` ·
`setPartColor` · `setPartMaterial` · `describeNode`.

(*`setPolygonClosed` has no backing mutator today — polygons are always closed
rings; only add it if a `closed` field is introduced.)

### 1.5 What §E of `ai-multishot-assist.md` already named (vs. what it missed)

§E.1/E.2/E.3 named-but-unbuilt: `describeNode`, `addCsg`(`addMethodPlaceholder`),
`setMethodInput`, `addMove`/`addRotate`, `setTransformAxisValue`, `addRepeat` +
`setRepeatCount`/`Op`/`Child`, `wrapInTransform`, `unwireArg`, `removeParam`,
`addSketchOp`, `setSketchOpField`, `removeSketchOp`, `setPartColor`,
`setPartMaterial`.

**§E NEVER lists** (its own incompleteness — this is why the bug happened): the
entire **Spline** node (`addSpline`/`setSplinePoints`/`setSplineClosed` —
postdates the plan), `addPolygon`/`addSketch` (create verbs), the whole
**Expr def/instance** surface, `addContainer`/`appendContainerChild`, and the
**typed expr-list wiring** (`addPolygonExprListRef`, `addSketchExprListRef`,
`addPolygonRepeat`). A per-plan hand-maintained list drifts; §2 replaces it with
a single generated registry + a sync test so drift is impossible.

---

## 2. PLAN — one registry, many generated forms

### 2.1 The registry (source of truth)

Grow `editor-tools-schema.ts` into THE canonical library. One entry per editor
operation, each carrying BOTH the human doc and the machine schema:

```ts
type ToolDef = {
  name: string;
  intent: string[];          // user-intent phrasings ("add a spline",
                             //   "circular spline", "close the curve")
  desc: string;              // one-line semantic description (prompt/prose)
  params: Record<string, ToolParam>;
  mutator: string;           // the composition-graph fn it dispatches (doc + sync test)
  nodeType?: NodeType;       // for picker-parity coverage checks
  category: 'read'|'create'|'params'|'wiring'|'polygon'|'sketch'|
            'spline'|'expr'|'repeat'|'container'|'csg'|'transform'|'props';
  atomic?: boolean;          // true for combo tools (subtractPart, repeatNode)
};
```

`intent` + `desc` + `mutator` ARE the documentation the md-ingest (#27 Phase 2)
indexes — the registry IS the "function library documentation", not a separate
`.md`.

### 2.2 Generated machine forms (never hand-maintained, never drift)

All lowered from the ONE array:

- `toClaudeTools()` — Anthropic `{name, description, input_schema}` (cloud; EXISTS).
- `toolListText()` — prose/TS dump for the system prompt (EXISTS; extend to emit
  the compact TypeScript-notation form #28 wants for the local model).
- `toJsonSchema()` / `toGrammar()` — **NEW.** A JSON-schema union of all tool
  calls + an XGrammar-compatible CFG constrained to our `EDITOR_TOOLS` /
  `ArgValue` syntax (the #28 / #2 local-model decode path). Emitted from the same
  `params` schemas so the local grammar can never diverge from the cloud schema.

### 2.3 Seeds the AI data pipeline (#27 / #28)

- **#28 synthetic generation** iterates `EDITOR_TOOLS × domain vocab` to produce
  `{user_prompt, minimized_call}` pairs — `intent[]` gives the prompt seeds,
  `params` gives the call shape. A tool that isn't in the registry generates no
  data (hence completeness first).
- **#27 few-shot** retrieves nearest `intent`/pair matches (RAG-P3 embeddings)
  and injects top-3 — no training needed to lift coverage.
- Both read the SAME registry, so "documented" = "trainable" = "callable".

### 2.4 Sync test (drift guard — CI)

A vitest (`editor-tools-coverage.test.ts`) that FAILS when the library drifts
from the editor:

1. **Picker parity** — every picker-creatable node type (Call, Polygon, Sketch,
   Spline, Expr, Stack, Repeat, CSG, Transform) has ≥1 `create`-category tool
   whose `nodeType` matches. (This test, had it existed, would have failed on
   `spline` → caught the bug.)
2. **Mutator existence** — every `ToolDef.mutator` is a real export of
   `composition-graph` (import + `typeof === 'function'`).
3. **Allow-listed coverage** — every PUBLIC mutator is either referenced by some
   tool OR in an explicit `NOT_A_TOOL` allow-list (layout/finalize/emit
   internals, per §E.4). A new unlisted public mutator fails the test until the
   author either adds a tool or allow-lists it — forcing the decision.
4. **Round-trip** — `toClaudeTools()` and `toJsonSchema()` cover the same
   `name` set (cloud/local parity).

### 2.5 Keep-off list (semantic surface only)

Not tools (per `ai-multishot-assist` §E.4): `finalize`, `setLayout`/viewport,
`collectEdges`, hydrate/emit internals, `defaultCallPosition`, alias allocators.
These go in the `NOT_A_TOOL` allow-list so the coverage test stays green.

---

## 3. Sequencing

1. **Complete the missing create/edit tools** — `addSpline` +
   `setSplineClosed`/`setSplinePoints`/`setSplineSamples` FIRST (the trigger),
   then the rest of §1.4. Each wraps an already-pure Graph→Graph mutator; add a
   dispatcher case + a schema entry. Low risk.
2. **Land the registry shape** (`intent`, `mutator`, `nodeType`, `category`) +
   the sync test (§2.4) so completeness is enforced, not aspirational.
3. **Add the generated forms** `toJsonSchema()`/`toGrammar()` (§2.2).
4. **Wire into the pipeline** — #28 synthetic generation + #27 few-shot read the
   registry (§2.3).

Ties: #1 (RAG assist consumes the tools), #2 (web-llm grammar = §2.2),
#27 (few-shot corpus = §2.3), #28 (synthetic dataset = §2.3), memory
`ai_data_residency_local_first` (the local model is trained/constrained entirely
from this registry).

---

## 4. Acceptance

- "add a circular spline" resolves to `addSpline` → `setSplineClosed(true)` and
  the AI performs it (no refusal).
- The coverage test fails on a new picker node type or public mutator with no
  tool + no allow-list entry.
- Cloud schema, prompt text, and local grammar are all emitted from one array.
</content>
