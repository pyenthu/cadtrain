### Open — build work (PENDING)

1. **RAG multi-shot AI + tab context** — **PARTIAL.** Engine MERGED
   (`ge-assist.*` in `src/lib/shared/graph-editor/`). LEFT: mount the panel/button
   in GraphEditorPane + add `route` to `EditorContext`/`readEditorState` + populate
   `selectedId` (node-click) + optional `/api/ai/fix-errors` sink.
   Plan: `docs/plans/ai-rag-system.md`.

2. **web-llm local backend** — in-browser Qwen2.5-1.5B + XGrammar, default-OFF, local
   few-shot DB (no data leaves org). `ge-assist` already accepts a `postTurn` override
   for this backend. Plan: `docs/research/web-llm-functionary.md`.

3. **Modularize round 2** — SHIPPED: A–F + R2 knip + R6a + RepeatEditorPane + CanvasMenu
   + AiMenu → GEP **9455 → 5070**; R6b (module-map header + `$state` audit); R8 (vocab
   1687→1005); R9 (profile-fn-compose, ProfileFnEditor 1156→925). LEFT: **R7**
   `builder.ts`/`library.ts` retire (needs knip dead-chain confirm) — the last item.
   Plans: `docs/plans/graph-editor-pane.md` · `modularize-round2.md`.

4. **Sketch repeat op** — ✅ SHIPPED 2026-06-25 (PR1–3): model + `expandSketchOps` +
   emit + `+ repeat` UI + sketch_repeat NodeCard; 13 tests; existing parts byte-identical.
   LEFT (optional): re-wirable ref↔source SVG sockets. Plan: `docs/plans/sketch-repeat.md`.

7. **Well schematic → 3D well diagram (`/wells`)** — **PARTIAL.** W0 + W1 + left tool rail
   (SVTC-style, 10 tools) shipped. **NEXT:** port SVTC 3D scene layer; DTX+scale; W1.3 real
   `g_*` bakes; flatten; curvature subdivision; W2 2D schematic; W3 editor/BOM + wire the
   tool rail to real placement. Plan: `docs/plans/well-schematic.md`.

8. in the repeat card... allow params just like parts. params section above parts, multiple
   params in a list with a node connecter.

15. **Expression system — polish pass** (v3 shipped + works): dangling-def recovery;
    clean up migrated `e.newone`-style invalid formulas; Σ two-click/tooltip; per-output
    socket labels; live numeric preview. Plan: `docs/plans/expression-builder.md`.

16. **/design — mostly DONE.** Tree + C4-model tabs. LEFT (minor): expand-all fitView
    zooms small (drill in one container); legend overlap at fit-zoom. `src/routes/design/**`.


### Shipped (recent) — UI wave 2026-06-25/26

- ✅ **Global top-right nav menu** (NavMenu in +layout — route dropdown on every page)
- ✅ **/wells SVTC-style left tool rail** (10 grouped well-component tools + active state)
- ✅ **/primitives sidebar collapse → thin vertical-tab rail** (was PARKED #10)
- ✅ **SVG view fit + dia + depth scale** (matches the 3D pane; was PARKED #9)
- ✅ **Bake z-slider 2× part length + ½ height; scale popover click-outside-close** (#11/#12)
- ✅ **Repeat node card simplified** (de-cluttered + ellipsis on overflowing title; #14)
- ✅ **Sketch per-axis X/Y scale ⚙ toolbar popover** (was PARKED #2)
- ✅ Earlier: expr-builder redesign · /design Tree+C4 tabs · landing remodel · R8/R9 · sketch-repeat
- ⏳ **Confirm-on-delete** (card/param/node) — subagent in progress (was PARKED #15)


### PARKED

4. RESEARCH — explore for CAD generation improvement:
   [arxiv 2606.05515](https://arxiv.org/html/2606.05515v1).
5. Units — centralized repository (diameter in in/mm, z in m/ft, etc.).

7. `r_weld_extrude` phase angle — straighten spiralled triangles (lat/long-style
   perpendicular quads along latitude).

8. Option to promote and search for expressions to global library or personal user based library and search

13. The output icon/card needs to be made smaller. We need maybe an svg draggable that has a big arrow and a box on the left whch can accept inputs.. the arrow ha sa min size and the sockets on the left

16. Organize source and the server under lib and shared by categories that are logical. Organzie the folders/sub folders as per the categories that are logical.
