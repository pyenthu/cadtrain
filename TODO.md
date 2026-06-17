### Open — build work

1. **RAG multi-shot AI + tab context** — engine MERGED (`ge-assist.`*). LEFT: mount the
  panel/button in GraphEditorPane + add `route` to EditorContext/readEditorState +
   populate `selectedId` (node-click) + optional `/api/ai/fix-errors` sink.
   Plan: `docs/plans/ai-rag-system.md`.
2. **web-llm local backend** — in-browser Qwen2.5-1.5B + XGrammar, default-OFF, local
  few-shot DB (no data leaves org). Plan: `docs/research/web-llm-functionary.md`.
3. **Modularize round 2** — A/B/C/D **and E Step 1 done** (`SketchState` per-instance
  class, ~233 refs rewired, GEP 8029→7384, browser-verified). LEFT: **Phase E Step 2**
   = SketchEditorPane + SketchNodeCard components (both take the `sketch` instance);
  - dead-code prune (builder.ts/library.ts chain). Plans: `docs/plans/graph-editor-pane.md`
  - `modularize-round2.md`.
4. **Right nav menu restructure** — group the RightPane rail into VIEW/DATA + pinned
  settings. Plan: `docs/plans/right-nav-menu.md`.
5. **Sketch repeat** — poly_repeat-style loop in the sketch. *(Blocked on #3 E+F.)*
  Plan: `docs/plans/repeat-and-sketch-repeat.md`.
6. **/design svelte-flow architecture graph** — interactive route/api graph (needs the
  `@xyflow/svelte` dep). Plan: `docs/plans/design-route-svelteflow.md`.
7. **Repeat windowed editor** — open the Repeat card in its own in-tab window (sketch-
  overlay pattern): PARAMS + iterators on top, two tabs (Loop body / graphical
   modifiers). *(Blocked on #3 E+F.)* Plan: `docs/plans/repeat-and-sketch-repeat.md`.
8. **Client-side execution + server-builder** — server stays the compiler (graph→script),
  client executes in a Worker (Manifold first, OCCT via replicad); preserve the server
   Manifold+OCCT builder under `/api/server-builder/`. Also retires the deja-vu bake bug.
   Plan: `docs/plans/client-side-execution.md`.
9. **TXFMN transform card** — ✅ DONE. Model (`e267231`) + standalone ROT/MV card render
  (`e4bc3c9`): 6-row card (rx/ry/rz·x/y/z) + ƒ expr-toggle + param sockets + 'xform' picker
   entry; browser-verified. NEXT (PARKED #9): make it a MULTI-transform table — addable,
   wireable rows of sequential mv/rot/… ops (TxfmnNode → a list of transform steps).
10. **Conditional expressions tab** — third tab beside PARAMS/PROPS; `e.<name>` calculated
  /conditional expressions (sparse `graph.exprs[]`, topo eval). Plan: `docs/plans/expressions-tab.md`.

### Quick / contained (not yet done)

- **Deja-vu bake bug** (`bake-cache.ts`) — cache key ignores dep bodies → stale parent
mesh when a dep changes. Medium fix (plumb dep sources to `hashBakeKey`), or let #8
retire it structurally.

### PARKED

1. New revolve/extrude parts default to **sketch** not polygon. *(May be partly done in
  the BREP session — verify.)*
2. Auto-layout: the PARAMS + PROPERTIES card must never overlap other cards (repel all).
  *(Likely already done — K.79 made them auto-layout obstacles; verify, then close.)*
3. We need cability of having params, props and calculated. Basicallty the calculated fields are based on the params and are functions of the params. They can be in the thrid tab, in a table. Similar popover for the function. Then those can be wired into other params in other parts.
4. In the sketch editor can we also have the expansion for scale in x and y direction? the setings button can be in the tool bar on the top.
5. In the design page we should have a sub-route for each of the panes desribing the component layout and if possible, optionally show the nodal connections bettwenn them.
6. Explore this for possibility of improving cad generation. [https://arxiv.org/html/2606.05515v1](https://arxiv.org/html/2606.05515v1)
7. Bug in the part cad. when an expression becomes too big, the input box mecmes bigger than the card. this should be limited.
8. PLAN We need to introduce the concept of units here. Like diameter in inches or mm generslly, z in m or ft. We ill need a centralized units repository.
9. The TXForm card is to allow multiple instances of sequential mv/rot or others in the same table as an option. so we need a section with rows of parsms that can be wired and where more txforms cn be added. Right now there is a redundancy in each card's operation. There should be a selactor of what we want for each row. and the ability to move one transform up or down.
10. Can we make the output card less wide. Each item in there can have a tool tip. And it should be high enoug only for the rows we have added, plus one more row spare to add more.

