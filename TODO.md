### Open — build work (PENDING)

1. **RAG multi-shot AI + tab context** — **PARTIAL.** Engine MERGED
   (`ge-assist.*` in `src/lib/shared/graph-editor/`). LEFT: mount the panel/button
   in GraphEditorPane + add `route` to `EditorContext`/`readEditorState` + populate
   `selectedId` (node-click) + optional `/api/ai/fix-errors` sink. Maybe involve functionary library.
   Plan: `docs/plans/ai-rag-system.md`.

2. **web-llm local backend** — in-browser Qwen2.5-1.5B + XGrammar, default-OFF, local
   few-shot DB (no data leaves org). `ge-assist` already accepts a `postTurn` override
   for this backend. Plan: `docs/research/web-llm-functionary.md`. Maybe involve functionary library

7. **Well schematic → 3D well diagram (`/wells`)** — **PARTIAL.** W0 + W1 + left tool rail
   (SVTC-style, 10 tools) shipped. **NEXT:** port SVTC 3D scene layer; DTX+scale; W1.3 real
   `g_*` bakes; flatten; curvature subdivision; W2 2D schematic; W3 editor/BOM + wire the
   tool rail to real placement. Plan: `docs/plans/well-schematic.md`.

8. in the repeat card... allow params just like parts. params section above parts, multiple
   params in a list with a node connecter.


### Shipped (recent) — 2026-06-25/26

- **Modularize round 2 — ✅ COMPLETE.** A–F + R2 knip + R6a + RepeatEditorPane +
  CanvasMenu + AiMenu → GEP **9455 → 5070**; R6b (module-map header + `$state` audit);
  R8 (vocab 1687→1005); R9 (profile-fn-compose, ProfileFnEditor 1156→925); **R7**
  (deleted library.ts + renamed builder.ts→`render-helpers.ts`, cut the dead ComponentDef
  path, kept `finalizeManifold` — bake-proof verified).
  Plans: `docs/plans/graph-editor-pane.md` · `modularize-round2.md`.
- **Sketch repeat op** (#805) — model + `expandSketchOps` + emit + `+ repeat` UI +
  sketch_repeat NodeCard; 13 tests; existing parts byte-identical. (optional left:
  re-wirable ref↔source SVG sockets). Plan: `docs/plans/sketch-repeat.md`.
- **Sketch per-axis scale** (#2) — whole-sketch scaleX/scaleY: `setSketchScale` +
  ⚙ popover in SketchEditorPane + `compileSketch(…, scaleX, scaleY)` + emit.
- **Output node redesign** (#13) — compact input-box + arrow, centered sockets,
  per-socket × delete, no title/labels/cog.
- **Repeat z-move fix** — preserves a part's inline z-move when wired into a Repeat
  (txfmn-aware child wiring); `mv(m,x,y,z)` scalar-arg acceptance.
- **UI polish wave** — global top-right NavMenu; `/primitives` sidebar → thin
  vertical-tab rail; SVTC-style `/wells` left tool rail (10 tools); restyled landing;
  SVG-view fit/dia/depth scale controls; z-slider 2× travel + half height;
  two-step confirm-on-delete (#15); simplified Repeat card (#14).
- **Dead-code sweep** — R2 knip dropped 8 archive-only deps (`d909e8c`); dropped 6
  unused exported helpers (`f0344c3`). `/fem` + `/forge` reconciled as ARCHIVED in docs.
- **Housekeeping** — pruned stale worktree `agent-ac817a651ab2c049b` (superseded
  sketch-scale backend); handoff memory refreshed to HEAD.

### PARKED

4. RESEARCH — explore for CAD generation improvement:
   [arxiv 2606.05515](https://arxiv.org/html/2606.05515v1).

5. Units — centralized repository (diameter in in/mm, z in m/ft, etc.).

7. `r_weld_extrude` phase angle — straighten spiralled triangles (lat/long-style
   perpendicular quads along latitude).

8. Option to promote and search for expressions to global library or personal user based library and search

16. Organize source and the server under lib and shared by categories that are logical. Organzie the folders/sub folders as per the categories that are logical.

