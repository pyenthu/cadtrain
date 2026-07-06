/**
 * folder-tree.ts — snapshot of the src/ directory (files + LOC) for the /design
 * "Folder tree" treemap tab (FolderTreemap.svelte). Rectangle area ∝ LOC.
 * Generated 2026-07-06 by scripts/gen-folder-tree.mjs
 * (`bun scripts/gen-folder-tree.mjs`) — a curated snapshot, refresh on demand.
 * 506 files · 110,292 LOC across src/.
 */

export interface FolderNode {
  name: string;
  path: string;
  loc?: number;              // leaf files only
  children?: FolderNode[];   // directories only
}

export const FOLDER_TREE: FolderNode = {
  "name": "src",
  "path": "src",
  "children": [
    {
      "name": "app.css",
      "path": "app.css",
      "loc": 50
    },
    {
      "name": "hooks.server.ts",
      "path": "hooks.server.ts",
      "loc": 256
    },
    {
      "name": "lib",
      "path": "lib",
      "children": [
        {
          "name": "authoring",
          "path": "lib/authoring",
          "children": [
            {
              "name": "compjson-to-profile.ts",
              "path": "lib/authoring/compjson-to-profile.ts",
              "loc": 306
            },
            {
              "name": "proposal-translator.ts",
              "path": "lib/authoring/proposal-translator.ts",
              "loc": 167
            },
            {
              "name": "rule-translator-graph.test.ts",
              "path": "lib/authoring/rule-translator-graph.test.ts",
              "loc": 100
            },
            {
              "name": "rule-translator.ts",
              "path": "lib/authoring/rule-translator.ts",
              "loc": 588
            }
          ]
        },
        {
          "name": "cad",
          "path": "lib/cad",
          "children": [
            {
              "name": "__spline_bake_verify.test.ts",
              "path": "lib/cad/__spline_bake_verify.test.ts",
              "loc": 76
            },
            {
              "name": "__spline_closed_verify.test.ts",
              "path": "lib/cad/__spline_closed_verify.test.ts",
              "loc": 121
            },
            {
              "name": "__spline_plot_flag.test.ts",
              "path": "lib/cad/__spline_plot_flag.test.ts",
              "loc": 61
            },
            {
              "name": "__spline_pointsexpr_bake.test.ts",
              "path": "lib/cad/__spline_pointsexpr_bake.test.ts",
              "loc": 64
            },
            {
              "name": "__spline_pointsexpr_verify.test.ts",
              "path": "lib/cad/__spline_pointsexpr_verify.test.ts",
              "loc": 65
            },
            {
              "name": "annular-sweep.test.ts",
              "path": "lib/cad/annular-sweep.test.ts",
              "loc": 152
            },
            {
              "name": "bake-client.ts",
              "path": "lib/cad/bake-client.ts",
              "loc": 244
            },
            {
              "name": "bake-worker-core.test.ts",
              "path": "lib/cad/bake-worker-core.test.ts",
              "loc": 131
            },
            {
              "name": "bake-worker-core.ts",
              "path": "lib/cad/bake-worker-core.ts",
              "loc": 297
            },
            {
              "name": "bake-worker.ts",
              "path": "lib/cad/bake-worker.ts",
              "loc": 66
            },
            {
              "name": "client-bake-color-by-source.test.ts",
              "path": "lib/cad/client-bake-color-by-source.test.ts",
              "loc": 101
            },
            {
              "name": "composition-bake.ts",
              "path": "lib/cad/composition-bake.ts",
              "loc": 100
            },
            {
              "name": "composition-emit-profile.ts",
              "path": "lib/cad/composition-emit-profile.ts",
              "loc": 273
            },
            {
              "name": "composition-emit.ts",
              "path": "lib/cad/composition-emit.ts",
              "loc": 1178
            },
            {
              "name": "composition-graph-hydrate.ts",
              "path": "lib/cad/composition-graph-hydrate.ts",
              "loc": 474
            },
            {
              "name": "composition-graph-mutate.ts",
              "path": "lib/cad/composition-graph-mutate.ts",
              "loc": 2253
            },
            {
              "name": "composition-graph-types.ts",
              "path": "lib/cad/composition-graph-types.ts",
              "loc": 655
            },
            {
              "name": "composition-graph.test.ts",
              "path": "lib/cad/composition-graph.test.ts",
              "loc": 702
            },
            {
              "name": "composition-graph.ts",
              "path": "lib/cad/composition-graph.ts",
              "loc": 28
            },
            {
              "name": "composition-layout.test.ts",
              "path": "lib/cad/composition-layout.test.ts",
              "loc": 366
            },
            {
              "name": "composition-layout.ts",
              "path": "lib/cad/composition-layout.ts",
              "loc": 475
            },
            {
              "name": "composition-material.test.ts",
              "path": "lib/cad/composition-material.test.ts",
              "loc": 126
            },
            {
              "name": "composition-tree.test.ts",
              "path": "lib/cad/composition-tree.test.ts",
              "loc": 118
            },
            {
              "name": "composition-tree.ts",
              "path": "lib/cad/composition-tree.ts",
              "loc": 799
            },
            {
              "name": "crease-normals.test.ts",
              "path": "lib/cad/crease-normals.test.ts",
              "loc": 282
            },
            {
              "name": "csg-2d.ts",
              "path": "lib/cad/csg-2d.ts",
              "loc": 137
            },
            {
              "name": "cutaway-perbody-skip.test.ts",
              "path": "lib/cad/cutaway-perbody-skip.test.ts",
              "loc": 61
            },
            {
              "name": "editor-tools-schema.ts",
              "path": "lib/cad/editor-tools-schema.ts",
              "loc": 268
            },
            {
              "name": "editor-tools.test.ts",
              "path": "lib/cad/editor-tools.test.ts",
              "loc": 162
            },
            {
              "name": "editor-tools.ts",
              "path": "lib/cad/editor-tools.ts",
              "loc": 295
            },
            {
              "name": "expr-emit.test.ts",
              "path": "lib/cad/expr-emit.test.ts",
              "loc": 265
            },
            {
              "name": "expr-imperative.test.ts",
              "path": "lib/cad/expr-imperative.test.ts",
              "loc": 330
            },
            {
              "name": "expr-imperative.ts",
              "path": "lib/cad/expr-imperative.ts",
              "loc": 353
            },
            {
              "name": "expr-list.test.ts",
              "path": "lib/cad/expr-list.test.ts",
              "loc": 239
            },
            {
              "name": "expr-loops.test.ts",
              "path": "lib/cad/expr-loops.test.ts",
              "loc": 62
            },
            {
              "name": "expr-loops.ts",
              "path": "lib/cad/expr-loops.ts",
              "loc": 105
            },
            {
              "name": "expr-multiline.test.ts",
              "path": "lib/cad/expr-multiline.test.ts",
              "loc": 65
            },
            {
              "name": "expr-node.test.ts",
              "path": "lib/cad/expr-node.test.ts",
              "loc": 142
            },
            {
              "name": "expr-schema.ts",
              "path": "lib/cad/expr-schema.ts",
              "loc": 140
            },
            {
              "name": "expr-validate.test.ts",
              "path": "lib/cad/expr-validate.test.ts",
              "loc": 115
            },
            {
              "name": "graph-exprs.test.ts",
              "path": "lib/cad/graph-exprs.test.ts",
              "loc": 168
            },
            {
              "name": "graph-exprs.ts",
              "path": "lib/cad/graph-exprs.ts",
              "loc": 689
            },
            {
              "name": "graph-to-tf.test.ts",
              "path": "lib/cad/graph-to-tf.test.ts",
              "loc": 397
            },
            {
              "name": "graph-to-tf.ts",
              "path": "lib/cad/graph-to-tf.ts",
              "loc": 943
            },
            {
              "name": "manifold-helpers-meta.ts",
              "path": "lib/cad/manifold-helpers-meta.ts",
              "loc": 162
            },
            {
              "name": "manifold-helpers.ts",
              "path": "lib/cad/manifold-helpers.ts",
              "loc": 588
            },
            {
              "name": "manifold-mesh.ts",
              "path": "lib/cad/manifold-mesh.ts",
              "loc": 962
            },
            {
              "name": "math-lib.ts",
              "path": "lib/cad/math-lib.ts",
              "loc": 51
            },
            {
              "name": "mesh-serial.test.ts",
              "path": "lib/cad/mesh-serial.test.ts",
              "loc": 42
            },
            {
              "name": "mesh-serial.ts",
              "path": "lib/cad/mesh-serial.ts",
              "loc": 122
            },
            {
              "name": "param-keys.ts",
              "path": "lib/cad/param-keys.ts",
              "loc": 101
            },
            {
              "name": "part-id.ts",
              "path": "lib/cad/part-id.ts",
              "loc": 71
            },
            {
              "name": "port-suggest.test.ts",
              "path": "lib/cad/port-suggest.test.ts",
              "loc": 99
            },
            {
              "name": "port-suggest.ts",
              "path": "lib/cad/port-suggest.ts",
              "loc": 203
            },
            {
              "name": "port-types.test.ts",
              "path": "lib/cad/port-types.test.ts",
              "loc": 125
            },
            {
              "name": "port-types.ts",
              "path": "lib/cad/port-types.ts",
              "loc": 226
            },
            {
              "name": "primitive-sandbox.ts",
              "path": "lib/cad/primitive-sandbox.ts",
              "loc": 63
            },
            {
              "name": "primitive-stub.test.ts",
              "path": "lib/cad/primitive-stub.test.ts",
              "loc": 96
            },
            {
              "name": "primitive-stub.ts",
              "path": "lib/cad/primitive-stub.ts",
              "loc": 232
            },
            {
              "name": "profile-templates.ts",
              "path": "lib/cad/profile-templates.ts",
              "loc": 489
            },
            {
              "name": "render-helpers.ts",
              "path": "lib/cad/render-helpers.ts",
              "loc": 979
            },
            {
              "name": "revolve-axial.test.ts",
              "path": "lib/cad/revolve-axial.test.ts",
              "loc": 120
            },
            {
              "name": "sketch-collayout.test.ts",
              "path": "lib/cad/sketch-collayout.test.ts",
              "loc": 117
            },
            {
              "name": "sketch-layout.ts",
              "path": "lib/cad/sketch-layout.ts",
              "loc": 109
            },
            {
              "name": "sketch-repeat.test.ts",
              "path": "lib/cad/sketch-repeat.test.ts",
              "loc": 224
            },
            {
              "name": "sketch-repeat.ts",
              "path": "lib/cad/sketch-repeat.ts",
              "loc": 125
            },
            {
              "name": "sketch.test.ts",
              "path": "lib/cad/sketch.test.ts",
              "loc": 330
            },
            {
              "name": "sketch.ts",
              "path": "lib/cad/sketch.ts",
              "loc": 280
            },
            {
              "name": "spline-eval.test.ts",
              "path": "lib/cad/spline-eval.test.ts",
              "loc": 87
            },
            {
              "name": "spline-eval.ts",
              "path": "lib/cad/spline-eval.ts",
              "loc": 87
            },
            {
              "name": "spline-resample.test.ts",
              "path": "lib/cad/spline-resample.test.ts",
              "loc": 162
            },
            {
              "name": "spline-resample.ts",
              "path": "lib/cad/spline-resample.ts",
              "loc": 173
            },
            {
              "name": "stack.test.ts",
              "path": "lib/cad/stack.test.ts",
              "loc": 297
            },
            {
              "name": "stdlib",
              "path": "lib/cad/stdlib",
              "children": [
                {
                  "name": "r_cuboid.ts",
                  "path": "lib/cad/stdlib/r_cuboid.ts",
                  "loc": 48
                },
                {
                  "name": "r_helical_surface.ts",
                  "path": "lib/cad/stdlib/r_helical_surface.ts",
                  "loc": 199
                },
                {
                  "name": "r_loft.ts",
                  "path": "lib/cad/stdlib/r_loft.ts",
                  "loc": 160
                },
                {
                  "name": "r_revolve.test.ts",
                  "path": "lib/cad/stdlib/r_revolve.test.ts",
                  "loc": 222
                },
                {
                  "name": "r_revolve.ts",
                  "path": "lib/cad/stdlib/r_revolve.ts",
                  "loc": 212
                },
                {
                  "name": "r_surface.ts",
                  "path": "lib/cad/stdlib/r_surface.ts",
                  "loc": 161
                },
                {
                  "name": "r_sweep.ts",
                  "path": "lib/cad/stdlib/r_sweep.ts",
                  "loc": 116
                },
                {
                  "name": "r_weld_extrude.ts",
                  "path": "lib/cad/stdlib/r_weld_extrude.ts",
                  "loc": 139
                },
                {
                  "name": "stale",
                  "path": "lib/cad/stdlib/stale",
                  "children": [
                    {
                      "name": "r_extrude.ts",
                      "path": "lib/cad/stdlib/stale/r_extrude.ts",
                      "loc": 107
                    }
                  ]
                }
              ]
            },
            {
              "name": "struct-type.test.ts",
              "path": "lib/cad/struct-type.test.ts",
              "loc": 198
            },
            {
              "name": "struct-type.ts",
              "path": "lib/cad/struct-type.ts",
              "loc": 418
            },
            {
              "name": "subdivide-axial.test.ts",
              "path": "lib/cad/subdivide-axial.test.ts",
              "loc": 163
            },
            {
              "name": "sweep-cap-triangulation.test.ts",
              "path": "lib/cad/sweep-cap-triangulation.test.ts",
              "loc": 178
            },
            {
              "name": "sweep-rmf.test.ts",
              "path": "lib/cad/sweep-rmf.test.ts",
              "loc": 112
            },
            {
              "name": "sweep-self-intersection.test.ts",
              "path": "lib/cad/sweep-self-intersection.test.ts",
              "loc": 76
            },
            {
              "name": "tf-wat-emit.test.ts",
              "path": "lib/cad/tf-wat-emit.test.ts",
              "loc": 132
            },
            {
              "name": "tf-wat-emit.ts",
              "path": "lib/cad/tf-wat-emit.ts",
              "loc": 166
            },
            {
              "name": "warp-geom.test.ts",
              "path": "lib/cad/warp-geom.test.ts",
              "loc": 48
            },
            {
              "name": "warp-geom.ts",
              "path": "lib/cad/warp-geom.ts",
              "loc": 39
            },
            {
              "name": "warp-mesh-js.test.ts",
              "path": "lib/cad/warp-mesh-js.test.ts",
              "loc": 35
            },
            {
              "name": "warp-node.test.ts",
              "path": "lib/cad/warp-node.test.ts",
              "loc": 111
            },
            {
              "name": "warp-spline.test.ts",
              "path": "lib/cad/warp-spline.test.ts",
              "loc": 136
            },
            {
              "name": "warp-spline.ts",
              "path": "lib/cad/warp-spline.ts",
              "loc": 626
            },
            {
              "name": "wire-check.test.ts",
              "path": "lib/cad/wire-check.test.ts",
              "loc": 102
            },
            {
              "name": "wire-check.ts",
              "path": "lib/cad/wire-check.ts",
              "loc": 110
            }
          ]
        },
        {
          "name": "rate_limit.ts",
          "path": "lib/rate_limit.ts",
          "loc": 26
        },
        {
          "name": "server",
          "path": "lib/server",
          "children": [
            {
              "name": "__brep_sweep_spike.test.ts",
              "path": "lib/server/__brep_sweep_spike.test.ts",
              "loc": 162
            },
            {
              "name": "bake-cache.test.ts",
              "path": "lib/server/bake-cache.test.ts",
              "loc": 102
            },
            {
              "name": "bake-cache.ts",
              "path": "lib/server/bake-cache.ts",
              "loc": 280
            },
            {
              "name": "brep-occt.ts",
              "path": "lib/server/brep-occt.ts",
              "loc": 607
            },
            {
              "name": "dep-inherit.test.ts",
              "path": "lib/server/dep-inherit.test.ts",
              "loc": 41
            },
            {
              "name": "manifold-bake.ts",
              "path": "lib/server/manifold-bake.ts",
              "loc": 541
            },
            {
              "name": "part-colors.test.ts",
              "path": "lib/server/part-colors.test.ts",
              "loc": 84
            },
            {
              "name": "part-colors.ts",
              "path": "lib/server/part-colors.ts",
              "loc": 309
            },
            {
              "name": "primitive-loader.ts",
              "path": "lib/server/primitive-loader.ts",
              "loc": 926
            },
            {
              "name": "primitive-paths.test.ts",
              "path": "lib/server/primitive-paths.test.ts",
              "loc": 70
            },
            {
              "name": "primitive-paths.ts",
              "path": "lib/server/primitive-paths.ts",
              "loc": 205
            },
            {
              "name": "primitives-meta.ts",
              "path": "lib/server/primitives-meta.ts",
              "loc": 190
            },
            {
              "name": "profile-fn.ts",
              "path": "lib/server/profile-fn.ts",
              "loc": 118
            },
            {
              "name": "rag-corpus.ts",
              "path": "lib/server/rag-corpus.ts",
              "loc": 283
            },
            {
              "name": "rag-l1.ts",
              "path": "lib/server/rag-l1.ts",
              "loc": 187
            },
            {
              "name": "rag-prompt.ts",
              "path": "lib/server/rag-prompt.ts",
              "loc": 216
            },
            {
              "name": "rag-query.ts",
              "path": "lib/server/rag-query.ts",
              "loc": 174
            },
            {
              "name": "recognize-composite.ts",
              "path": "lib/server/recognize-composite.ts",
              "loc": 482
            },
            {
              "name": "script-cache.ts",
              "path": "lib/server/script-cache.ts",
              "loc": 120
            },
            {
              "name": "script-compile.test.ts",
              "path": "lib/server/script-compile.test.ts",
              "loc": 183
            },
            {
              "name": "stdlib.ts",
              "path": "lib/server/stdlib.ts",
              "loc": 121
            },
            {
              "name": "volume.ts",
              "path": "lib/server/volume.ts",
              "loc": 175
            }
          ]
        },
        {
          "name": "shared",
          "path": "lib/shared",
          "children": [
            {
              "name": "_shaft_bisect.test.ts",
              "path": "lib/shared/_shaft_bisect.test.ts",
              "loc": 144
            },
            {
              "name": "anthropic-api.ts",
              "path": "lib/shared/anthropic-api.ts",
              "loc": 20
            },
            {
              "name": "brep-adapter.test.ts",
              "path": "lib/shared/brep-adapter.test.ts",
              "loc": 60
            },
            {
              "name": "brep-adapter.ts",
              "path": "lib/shared/brep-adapter.ts",
              "loc": 61
            },
            {
              "name": "CacheBrowser.svelte",
              "path": "lib/shared/CacheBrowser.svelte",
              "loc": 444
            },
            {
              "name": "CompJsonSilhouette.svelte",
              "path": "lib/shared/CompJsonSilhouette.svelte",
              "loc": 198
            },
            {
              "name": "dragNumber.ts",
              "path": "lib/shared/dragNumber.ts",
              "loc": 81
            },
            {
              "name": "floating-tip.ts",
              "path": "lib/shared/floating-tip.ts",
              "loc": 92
            },
            {
              "name": "FolderTreeSidebar.svelte",
              "path": "lib/shared/FolderTreeSidebar.svelte",
              "loc": 365
            },
            {
              "name": "graph-editor",
              "path": "lib/shared/graph-editor",
              "children": [
                {
                  "name": "AiMenu.svelte",
                  "path": "lib/shared/graph-editor/AiMenu.svelte",
                  "loc": 232
                },
                {
                  "name": "args.ts",
                  "path": "lib/shared/graph-editor/args.ts",
                  "loc": 80
                },
                {
                  "name": "AutoWireSuggestPanel.svelte",
                  "path": "lib/shared/graph-editor/AutoWireSuggestPanel.svelte",
                  "loc": 121
                },
                {
                  "name": "BakeMenu.svelte",
                  "path": "lib/shared/graph-editor/BakeMenu.svelte",
                  "loc": 106
                },
                {
                  "name": "canvas-interaction.svelte.ts",
                  "path": "lib/shared/graph-editor/canvas-interaction.svelte.ts",
                  "loc": 97
                },
                {
                  "name": "CanvasMenu.svelte",
                  "path": "lib/shared/graph-editor/CanvasMenu.svelte",
                  "loc": 119
                },
                {
                  "name": "delete-confirm.svelte.ts",
                  "path": "lib/shared/graph-editor/delete-confirm.svelte.ts",
                  "loc": 78
                },
                {
                  "name": "expr",
                  "path": "lib/shared/graph-editor/expr",
                  "children": [
                    {
                      "name": "ExprCodeEditor.svelte",
                      "path": "lib/shared/graph-editor/expr/ExprCodeEditor.svelte",
                      "loc": 132
                    },
                    {
                      "name": "ExpressionBuilderPopup.svelte",
                      "path": "lib/shared/graph-editor/expr/ExpressionBuilderPopup.svelte",
                      "loc": 523
                    },
                    {
                      "name": "ExpressionsMenu.svelte",
                      "path": "lib/shared/graph-editor/expr/ExpressionsMenu.svelte",
                      "loc": 264
                    },
                    {
                      "name": "ExpressionSrcPane.svelte",
                      "path": "lib/shared/graph-editor/expr/ExpressionSrcPane.svelte",
                      "loc": 196
                    },
                    {
                      "name": "ExprImperativeBlocks.svelte",
                      "path": "lib/shared/graph-editor/expr/ExprImperativeBlocks.svelte",
                      "loc": 486
                    }
                  ]
                },
                {
                  "name": "ge-assist.svelte.ts",
                  "path": "lib/shared/graph-editor/ge-assist.svelte.ts",
                  "loc": 187
                },
                {
                  "name": "ge-assist.test.ts",
                  "path": "lib/shared/graph-editor/ge-assist.test.ts",
                  "loc": 197
                },
                {
                  "name": "ge-assist.ts",
                  "path": "lib/shared/graph-editor/ge-assist.ts",
                  "loc": 235
                },
                {
                  "name": "geom.test.ts",
                  "path": "lib/shared/graph-editor/geom.test.ts",
                  "loc": 224
                },
                {
                  "name": "geom.ts",
                  "path": "lib/shared/graph-editor/geom.ts",
                  "loc": 585
                },
                {
                  "name": "graph-editor-bake.svelte.ts",
                  "path": "lib/shared/graph-editor/graph-editor-bake.svelte.ts",
                  "loc": 128
                },
                {
                  "name": "graph-editor-bake.test.ts",
                  "path": "lib/shared/graph-editor/graph-editor-bake.test.ts",
                  "loc": 80
                },
                {
                  "name": "graph-editor-bake.ts",
                  "path": "lib/shared/graph-editor/graph-editor-bake.ts",
                  "loc": 51
                },
                {
                  "name": "graph-layout-actions.ts",
                  "path": "lib/shared/graph-editor/graph-layout-actions.ts",
                  "loc": 175
                },
                {
                  "name": "GraphEditorPane.svelte",
                  "path": "lib/shared/graph-editor/GraphEditorPane.svelte",
                  "loc": 4457
                },
                {
                  "name": "MaterialEditorPopover.svelte",
                  "path": "lib/shared/graph-editor/MaterialEditorPopover.svelte",
                  "loc": 112
                },
                {
                  "name": "NodeCard.svelte",
                  "path": "lib/shared/graph-editor/NodeCard.svelte",
                  "loc": 2454
                },
                {
                  "name": "ParamsCard.svelte",
                  "path": "lib/shared/graph-editor/ParamsCard.svelte",
                  "loc": 169
                },
                {
                  "name": "pointer-capture.ts",
                  "path": "lib/shared/graph-editor/pointer-capture.ts",
                  "loc": 20
                },
                {
                  "name": "poly-preview-state.svelte.ts",
                  "path": "lib/shared/graph-editor/poly-preview-state.svelte.ts",
                  "loc": 383
                },
                {
                  "name": "PolyPreview.svelte",
                  "path": "lib/shared/graph-editor/PolyPreview.svelte",
                  "loc": 443
                },
                {
                  "name": "popover-clamp.test.ts",
                  "path": "lib/shared/graph-editor/popover-clamp.test.ts",
                  "loc": 37
                },
                {
                  "name": "popover-clamp.ts",
                  "path": "lib/shared/graph-editor/popover-clamp.ts",
                  "loc": 66
                },
                {
                  "name": "Popovers.svelte",
                  "path": "lib/shared/graph-editor/Popovers.svelte",
                  "loc": 570
                },
                {
                  "name": "profile-preview-state.svelte.ts",
                  "path": "lib/shared/graph-editor/profile-preview-state.svelte.ts",
                  "loc": 200
                },
                {
                  "name": "ProfilePreview.svelte",
                  "path": "lib/shared/graph-editor/ProfilePreview.svelte",
                  "loc": 167
                },
                {
                  "name": "PropertiesCard.svelte",
                  "path": "lib/shared/graph-editor/PropertiesCard.svelte",
                  "loc": 178
                },
                {
                  "name": "RepeatEditorPane.svelte",
                  "path": "lib/shared/graph-editor/RepeatEditorPane.svelte",
                  "loc": 299
                },
                {
                  "name": "RightPane.svelte",
                  "path": "lib/shared/graph-editor/RightPane.svelte",
                  "loc": 786
                },
                {
                  "name": "sketch-state.svelte.ts",
                  "path": "lib/shared/graph-editor/sketch-state.svelte.ts",
                  "loc": 774
                },
                {
                  "name": "SketchEditorPane.svelte",
                  "path": "lib/shared/graph-editor/SketchEditorPane.svelte",
                  "loc": 646
                },
                {
                  "name": "SketchNodeCard.svelte",
                  "path": "lib/shared/graph-editor/SketchNodeCard.svelte",
                  "loc": 269
                },
                {
                  "name": "spline-state.svelte.ts",
                  "path": "lib/shared/graph-editor/spline-state.svelte.ts",
                  "loc": 150
                },
                {
                  "name": "SplineEditorPopup.svelte",
                  "path": "lib/shared/graph-editor/SplineEditorPopup.svelte",
                  "loc": 254
                },
                {
                  "name": "SplineScene.svelte",
                  "path": "lib/shared/graph-editor/SplineScene.svelte",
                  "loc": 283
                },
                {
                  "name": "tf-recipe-timing.test.ts",
                  "path": "lib/shared/graph-editor/tf-recipe-timing.test.ts",
                  "loc": 70
                },
                {
                  "name": "tf-recipe-timing.ts",
                  "path": "lib/shared/graph-editor/tf-recipe-timing.ts",
                  "loc": 53
                },
                {
                  "name": "wire-state.svelte.ts",
                  "path": "lib/shared/graph-editor/wire-state.svelte.ts",
                  "loc": 445
                },
                {
                  "name": "WireLayer.svelte",
                  "path": "lib/shared/graph-editor/WireLayer.svelte",
                  "loc": 552
                }
              ]
            },
            {
              "name": "instance-colors.ts",
              "path": "lib/shared/instance-colors.ts",
              "loc": 72
            },
            {
              "name": "material-preset.test.ts",
              "path": "lib/shared/material-preset.test.ts",
              "loc": 34
            },
            {
              "name": "material-preset.ts",
              "path": "lib/shared/material-preset.ts",
              "loc": 64
            },
            {
              "name": "material-textures.test.ts",
              "path": "lib/shared/material-textures.test.ts",
              "loc": 64
            },
            {
              "name": "material-textures.ts",
              "path": "lib/shared/material-textures.ts",
              "loc": 180
            },
            {
              "name": "NavMenu.svelte",
              "path": "lib/shared/NavMenu.svelte",
              "loc": 132
            },
            {
              "name": "ParamGrid.svelte",
              "path": "lib/shared/ParamGrid.svelte",
              "loc": 210
            },
            {
              "name": "PrimitiveDualCanvas.svelte",
              "path": "lib/shared/PrimitiveDualCanvas.svelte",
              "loc": 1057
            },
            {
              "name": "PrimitiveDualScene.svelte",
              "path": "lib/shared/PrimitiveDualScene.svelte",
              "loc": 1097
            },
            {
              "name": "PrimitiveSvgView.svelte",
              "path": "lib/shared/PrimitiveSvgView.svelte",
              "loc": 587
            },
            {
              "name": "profile-fn-compose.test.ts",
              "path": "lib/shared/profile-fn-compose.test.ts",
              "loc": 133
            },
            {
              "name": "profile-fn-compose.ts",
              "path": "lib/shared/profile-fn-compose.ts",
              "loc": 294
            },
            {
              "name": "profile-presets.test.ts",
              "path": "lib/shared/profile-presets.test.ts",
              "loc": 73
            },
            {
              "name": "profile-presets.ts",
              "path": "lib/shared/profile-presets.ts",
              "loc": 391
            },
            {
              "name": "ProfileFn3DCanvas.svelte",
              "path": "lib/shared/ProfileFn3DCanvas.svelte",
              "loc": 95
            },
            {
              "name": "ProfileFnEditor.svelte",
              "path": "lib/shared/ProfileFnEditor.svelte",
              "loc": 926
            },
            {
              "name": "ProfilePalette.svelte",
              "path": "lib/shared/ProfilePalette.svelte",
              "loc": 201
            },
            {
              "name": "scene-state.svelte.ts",
              "path": "lib/shared/scene-state.svelte.ts",
              "loc": 191
            },
            {
              "name": "SceneControls.svelte",
              "path": "lib/shared/SceneControls.svelte",
              "loc": 235
            },
            {
              "name": "svg-camera.ts",
              "path": "lib/shared/svg-camera.ts",
              "loc": 103
            },
            {
              "name": "svg-emit.ts",
              "path": "lib/shared/svg-emit.ts",
              "loc": 469
            },
            {
              "name": "svg-reduce.test.ts",
              "path": "lib/shared/svg-reduce.test.ts",
              "loc": 83
            },
            {
              "name": "svg-reduce.ts",
              "path": "lib/shared/svg-reduce.ts",
              "loc": 131
            },
            {
              "name": "tf_examples",
              "path": "lib/shared/tf_examples",
              "children": [
                {
                  "name": "bored_pipe.ts",
                  "path": "lib/shared/tf_examples/bored_pipe.ts",
                  "loc": 27
                },
                {
                  "name": "box.ts",
                  "path": "lib/shared/tf_examples/box.ts",
                  "loc": 20
                },
                {
                  "name": "cone.ts",
                  "path": "lib/shared/tf_examples/cone.ts",
                  "loc": 33
                },
                {
                  "name": "dp_joint.test.ts",
                  "path": "lib/shared/tf_examples/dp_joint.test.ts",
                  "loc": 89
                },
                {
                  "name": "dp_joint.ts",
                  "path": "lib/shared/tf_examples/dp_joint.ts",
                  "loc": 114
                },
                {
                  "name": "dp_pin.ts",
                  "path": "lib/shared/tf_examples/dp_pin.ts",
                  "loc": 43
                },
                {
                  "name": "dp_stand.test.ts",
                  "path": "lib/shared/tf_examples/dp_stand.test.ts",
                  "loc": 121
                },
                {
                  "name": "dp_stand.ts",
                  "path": "lib/shared/tf_examples/dp_stand.ts",
                  "loc": 103
                },
                {
                  "name": "excluded.ts",
                  "path": "lib/shared/tf_examples/excluded.ts",
                  "loc": 29
                },
                {
                  "name": "execute.test.ts",
                  "path": "lib/shared/tf_examples/execute.test.ts",
                  "loc": 475
                },
                {
                  "name": "execute.ts",
                  "path": "lib/shared/tf_examples/execute.ts",
                  "loc": 466
                },
                {
                  "name": "extrude.test.ts",
                  "path": "lib/shared/tf_examples/extrude.test.ts",
                  "loc": 330
                },
                {
                  "name": "extrude.ts",
                  "path": "lib/shared/tf_examples/extrude.ts",
                  "loc": 155
                },
                {
                  "name": "helix.ts",
                  "path": "lib/shared/tf_examples/helix.ts",
                  "loc": 33
                },
                {
                  "name": "index.test.ts",
                  "path": "lib/shared/tf_examples/index.test.ts",
                  "loc": 56
                },
                {
                  "name": "index.ts",
                  "path": "lib/shared/tf_examples/index.ts",
                  "loc": 84
                },
                {
                  "name": "mandrel.test.ts",
                  "path": "lib/shared/tf_examples/mandrel.test.ts",
                  "loc": 94
                },
                {
                  "name": "mandrel.ts",
                  "path": "lib/shared/tf_examples/mandrel.ts",
                  "loc": 57
                },
                {
                  "name": "mule_shoe.test.ts",
                  "path": "lib/shared/tf_examples/mule_shoe.test.ts",
                  "loc": 58
                },
                {
                  "name": "mule_shoe.ts",
                  "path": "lib/shared/tf_examples/mule_shoe.ts",
                  "loc": 71
                },
                {
                  "name": "nipple_f.test.ts",
                  "path": "lib/shared/tf_examples/nipple_f.test.ts",
                  "loc": 88
                },
                {
                  "name": "nipple_f.ts",
                  "path": "lib/shared/tf_examples/nipple_f.ts",
                  "loc": 69
                },
                {
                  "name": "r_cyl.ts",
                  "path": "lib/shared/tf_examples/r_cyl.ts",
                  "loc": 21
                },
                {
                  "name": "revolve.test.ts",
                  "path": "lib/shared/tf_examples/revolve.test.ts",
                  "loc": 93
                },
                {
                  "name": "revolve.ts",
                  "path": "lib/shared/tf_examples/revolve.ts",
                  "loc": 114
                },
                {
                  "name": "s_cyl.ts",
                  "path": "lib/shared/tf_examples/s_cyl.ts",
                  "loc": 29
                },
                {
                  "name": "s_tub_st.test.ts",
                  "path": "lib/shared/tf_examples/s_tub_st.test.ts",
                  "loc": 50
                },
                {
                  "name": "s_tub_st.ts",
                  "path": "lib/shared/tf_examples/s_tub_st.ts",
                  "loc": 106
                },
                {
                  "name": "s_tube_demo.test.ts",
                  "path": "lib/shared/tf_examples/s_tube_demo.test.ts",
                  "loc": 56
                },
                {
                  "name": "s_tube_demo.ts",
                  "path": "lib/shared/tf_examples/s_tube_demo.ts",
                  "loc": 113
                },
                {
                  "name": "s_tube_no_ext.ts",
                  "path": "lib/shared/tf_examples/s_tube_no_ext.ts",
                  "loc": 60
                },
                {
                  "name": "tf-weld.test.ts",
                  "path": "lib/shared/tf_examples/tf-weld.test.ts",
                  "loc": 157
                },
                {
                  "name": "tf-weld.ts",
                  "path": "lib/shared/tf_examples/tf-weld.ts",
                  "loc": 172
                },
                {
                  "name": "warp-densify.test.ts",
                  "path": "lib/shared/tf_examples/warp-densify.test.ts",
                  "loc": 151
                },
                {
                  "name": "warp-pipeline.test.ts",
                  "path": "lib/shared/tf_examples/warp-pipeline.test.ts",
                  "loc": 132
                },
                {
                  "name": "weld_extrude_demo.ts",
                  "path": "lib/shared/tf_examples/weld_extrude_demo.ts",
                  "loc": 62
                }
              ]
            },
            {
              "name": "tf-bake-client.ts",
              "path": "lib/shared/tf-bake-client.ts",
              "loc": 199
            },
            {
              "name": "tf-worker-core.test.ts",
              "path": "lib/shared/tf-worker-core.test.ts",
              "loc": 135
            },
            {
              "name": "tf-worker-core.ts",
              "path": "lib/shared/tf-worker-core.ts",
              "loc": 141
            },
            {
              "name": "tf-worker.ts",
              "path": "lib/shared/tf-worker.ts",
              "loc": 56
            },
            {
              "name": "trueform-adapter.test.ts",
              "path": "lib/shared/trueform-adapter.test.ts",
              "loc": 292
            },
            {
              "name": "trueform-adapter.ts",
              "path": "lib/shared/trueform-adapter.ts",
              "loc": 384
            },
            {
              "name": "trueform-client.test.ts",
              "path": "lib/shared/trueform-client.test.ts",
              "loc": 253
            },
            {
              "name": "trueform-client.ts",
              "path": "lib/shared/trueform-client.ts",
              "loc": 559
            },
            {
              "name": "TypeDefinerPanel.svelte",
              "path": "lib/shared/TypeDefinerPanel.svelte",
              "loc": 253
            },
            {
              "name": "TypeDefinerPopover.svelte",
              "path": "lib/shared/TypeDefinerPopover.svelte",
              "loc": 66
            },
            {
              "name": "vertex-alpha-partition.test.ts",
              "path": "lib/shared/vertex-alpha-partition.test.ts",
              "loc": 82
            },
            {
              "name": "vertex-alpha-partition.ts",
              "path": "lib/shared/vertex-alpha-partition.ts",
              "loc": 89
            },
            {
              "name": "warp.ts",
              "path": "lib/shared/warp.ts",
              "loc": 195
            },
            {
              "name": "WellSideNav.svelte",
              "path": "lib/shared/WellSideNav.svelte",
              "loc": 477
            }
          ]
        },
        {
          "name": "test-stubs",
          "path": "lib/test-stubs",
          "children": [
            {
              "name": "env-dynamic-private.ts",
              "path": "lib/test-stubs/env-dynamic-private.ts",
              "loc": 6
            }
          ]
        },
        {
          "name": "wells",
          "path": "lib/wells",
          "children": [
            {
              "name": "assemble.test.ts",
              "path": "lib/wells/assemble.test.ts",
              "loc": 73
            },
            {
              "name": "assemble.ts",
              "path": "lib/wells/assemble.ts",
              "loc": 128
            },
            {
              "name": "dtx.ts",
              "path": "lib/wells/dtx.ts",
              "loc": 95
            },
            {
              "name": "registry.ts",
              "path": "lib/wells/registry.ts",
              "loc": 81
            },
            {
              "name": "samples.ts",
              "path": "lib/wells/samples.ts",
              "loc": 29
            },
            {
              "name": "schematic3d.test.ts",
              "path": "lib/wells/schematic3d.test.ts",
              "loc": 340
            },
            {
              "name": "threeD",
              "path": "lib/wells/threeD",
              "children": [
                {
                  "name": "direction.ts",
                  "path": "lib/wells/threeD/direction.ts",
                  "loc": 212
                },
                {
                  "name": "index.ts",
                  "path": "lib/wells/threeD/index.ts",
                  "loc": 68
                },
                {
                  "name": "manifoldCut.ts",
                  "path": "lib/wells/threeD/manifoldCut.ts",
                  "loc": 510
                },
                {
                  "name": "parametric",
                  "path": "lib/wells/threeD/parametric",
                  "children": [
                    {
                      "name": "bakerPacker.ts",
                      "path": "lib/wells/threeD/parametric/bakerPacker.ts",
                      "loc": 98
                    },
                    {
                      "name": "index.ts",
                      "path": "lib/wells/threeD/parametric/index.ts",
                      "loc": 99
                    },
                    {
                      "name": "ParametricComponent.ts",
                      "path": "lib/wells/threeD/parametric/ParametricComponent.ts",
                      "loc": 90
                    }
                  ]
                },
                {
                  "name": "profile.ts",
                  "path": "lib/wells/threeD/profile.ts",
                  "loc": 140
                }
              ]
            },
            {
              "name": "WellScene.svelte",
              "path": "lib/wells/WellScene.svelte",
              "loc": 83
            },
            {
              "name": "WellSchematic3D.svelte",
              "path": "lib/wells/WellSchematic3D.svelte",
              "loc": 532
            },
            {
              "name": "wson-2d.test.ts",
              "path": "lib/wells/wson-2d.test.ts",
              "loc": 207
            },
            {
              "name": "wson-2d.ts",
              "path": "lib/wells/wson-2d.ts",
              "loc": 507
            },
            {
              "name": "wson-mutate.test.ts",
              "path": "lib/wells/wson-mutate.test.ts",
              "loc": 73
            },
            {
              "name": "wson-mutate.ts",
              "path": "lib/wells/wson-mutate.ts",
              "loc": 57
            },
            {
              "name": "wson.test.ts",
              "path": "lib/wells/wson.test.ts",
              "loc": 54
            },
            {
              "name": "wson.ts",
              "path": "lib/wells/wson.ts",
              "loc": 160
            }
          ]
        }
      ]
    },
    {
      "name": "routes",
      "path": "routes",
      "children": [
        {
          "name": "+layout.svelte",
          "path": "routes/+layout.svelte",
          "loc": 41
        },
        {
          "name": "+layout.ts",
          "path": "routes/+layout.ts",
          "loc": 3
        },
        {
          "name": "+page.svelte",
          "path": "routes/+page.svelte",
          "loc": 426
        },
        {
          "name": "api",
          "path": "routes/api",
          "children": [
            {
              "name": "__dev_restart",
              "path": "routes/api/__dev_restart",
              "children": [
                {
                  "name": "+server.ts",
                  "path": "routes/api/__dev_restart/+server.ts",
                  "loc": 53
                }
              ]
            },
            {
              "name": "brep",
              "path": "routes/api/brep",
              "children": [
                {
                  "name": "preview",
                  "path": "routes/api/brep/preview",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/brep/preview/+server.ts",
                      "loc": 63
                    }
                  ]
                }
              ]
            },
            {
              "name": "cache",
              "path": "routes/api/cache",
              "children": [
                {
                  "name": "bake-stats",
                  "path": "routes/api/cache/bake-stats",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/cache/bake-stats/+server.ts",
                      "loc": 92
                    }
                  ]
                },
                {
                  "name": "clear",
                  "path": "routes/api/cache/clear",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/cache/clear/+server.ts",
                      "loc": 23
                    }
                  ]
                },
                {
                  "name": "delete",
                  "path": "routes/api/cache/delete",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/cache/delete/+server.ts",
                      "loc": 117
                    }
                  ]
                },
                {
                  "name": "entry",
                  "path": "routes/api/cache/entry",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/cache/entry/+server.ts",
                      "loc": 65
                    }
                  ]
                },
                {
                  "name": "list",
                  "path": "routes/api/cache/list",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/cache/list/+server.ts",
                      "loc": 95
                    }
                  ]
                },
                {
                  "name": "stats",
                  "path": "routes/api/cache/stats",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/cache/stats/+server.ts",
                      "loc": 25
                    }
                  ]
                }
              ]
            },
            {
              "name": "manifest",
              "path": "routes/api/manifest",
              "children": [
                {
                  "name": "+server.ts",
                  "path": "routes/api/manifest/+server.ts",
                  "loc": 72
                }
              ]
            },
            {
              "name": "primitives",
              "path": "routes/api/primitives",
              "children": [
                {
                  "name": "bake-preview",
                  "path": "routes/api/primitives/bake-preview",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/primitives/bake-preview/+server.ts",
                      "loc": 116
                    }
                  ]
                },
                {
                  "name": "compile",
                  "path": "routes/api/primitives/compile",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/primitives/compile/+server.ts",
                      "loc": 90
                    }
                  ]
                },
                {
                  "name": "delete",
                  "path": "routes/api/primitives/delete",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/primitives/delete/+server.ts",
                      "loc": 65
                    }
                  ]
                },
                {
                  "name": "describe",
                  "path": "routes/api/primitives/describe",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/primitives/describe/+server.ts",
                      "loc": 75
                    }
                  ]
                },
                {
                  "name": "folder",
                  "path": "routes/api/primitives/folder",
                  "children": [
                    {
                      "name": "delete",
                      "path": "routes/api/primitives/folder/delete",
                      "children": [
                        {
                          "name": "+server.ts",
                          "path": "routes/api/primitives/folder/delete/+server.ts",
                          "loc": 57
                        }
                      ]
                    },
                    {
                      "name": "move",
                      "path": "routes/api/primitives/folder/move",
                      "children": [
                        {
                          "name": "+server.ts",
                          "path": "routes/api/primitives/folder/move/+server.ts",
                          "loc": 50
                        }
                      ]
                    },
                    {
                      "name": "rename",
                      "path": "routes/api/primitives/folder/rename",
                      "children": [
                        {
                          "name": "+server.ts",
                          "path": "routes/api/primitives/folder/rename/+server.ts",
                          "loc": 39
                        }
                      ]
                    }
                  ]
                },
                {
                  "name": "instructions",
                  "path": "routes/api/primitives/instructions",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/primitives/instructions/+server.ts",
                      "loc": 60
                    }
                  ]
                },
                {
                  "name": "list",
                  "path": "routes/api/primitives/list",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/primitives/list/+server.ts",
                      "loc": 202
                    }
                  ]
                },
                {
                  "name": "mkdir",
                  "path": "routes/api/primitives/mkdir",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/primitives/mkdir/+server.ts",
                      "loc": 32
                    }
                  ]
                },
                {
                  "name": "move",
                  "path": "routes/api/primitives/move",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/primitives/move/+server.ts",
                      "loc": 73
                    }
                  ]
                },
                {
                  "name": "preview",
                  "path": "routes/api/primitives/preview",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/primitives/preview/+server.ts",
                      "loc": 379
                    }
                  ]
                },
                {
                  "name": "profiles",
                  "path": "routes/api/primitives/profiles",
                  "children": [
                    {
                      "name": "delete",
                      "path": "routes/api/primitives/profiles/delete",
                      "children": [
                        {
                          "name": "+server.ts",
                          "path": "routes/api/primitives/profiles/delete/+server.ts",
                          "loc": 21
                        }
                      ]
                    },
                    {
                      "name": "list",
                      "path": "routes/api/primitives/profiles/list",
                      "children": [
                        {
                          "name": "+server.ts",
                          "path": "routes/api/primitives/profiles/list/+server.ts",
                          "loc": 66
                        }
                      ]
                    },
                    {
                      "name": "resolve",
                      "path": "routes/api/primitives/profiles/resolve",
                      "children": [
                        {
                          "name": "+server.ts",
                          "path": "routes/api/primitives/profiles/resolve/+server.ts",
                          "loc": 46
                        }
                      ]
                    },
                    {
                      "name": "save",
                      "path": "routes/api/primitives/profiles/save",
                      "children": [
                        {
                          "name": "+server.ts",
                          "path": "routes/api/primitives/profiles/save/+server.ts",
                          "loc": 76
                        }
                      ]
                    },
                    {
                      "name": "source",
                      "path": "routes/api/primitives/profiles/source",
                      "children": [
                        {
                          "name": "+server.ts",
                          "path": "routes/api/primitives/profiles/source/+server.ts",
                          "loc": 50
                        }
                      ]
                    }
                  ]
                },
                {
                  "name": "prompts",
                  "path": "routes/api/primitives/prompts",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/primitives/prompts/+server.ts",
                      "loc": 98
                    }
                  ]
                },
                {
                  "name": "recognize",
                  "path": "routes/api/primitives/recognize",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/primitives/recognize/+server.ts",
                      "loc": 21
                    }
                  ]
                },
                {
                  "name": "refine",
                  "path": "routes/api/primitives/refine",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/primitives/refine/+server.ts",
                      "loc": 299
                    }
                  ]
                },
                {
                  "name": "rename",
                  "path": "routes/api/primitives/rename",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/primitives/rename/+server.ts",
                      "loc": 123
                    }
                  ]
                },
                {
                  "name": "restore",
                  "path": "routes/api/primitives/restore",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/primitives/restore/+server.ts",
                      "loc": 48
                    }
                  ]
                },
                {
                  "name": "save",
                  "path": "routes/api/primitives/save",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/primitives/save/+server.ts",
                      "loc": 97
                    }
                  ]
                },
                {
                  "name": "source",
                  "path": "routes/api/primitives/source",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/primitives/source/+server.ts",
                      "loc": 101
                    }
                  ]
                },
                {
                  "name": "types",
                  "path": "routes/api/primitives/types",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/primitives/types/+server.ts",
                      "loc": 65
                    }
                  ]
                }
              ]
            },
            {
              "name": "rag",
              "path": "routes/api/rag",
              "children": [
                {
                  "name": "assist",
                  "path": "routes/api/rag/assist",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/rag/assist/+server.ts",
                      "loc": 158
                    }
                  ]
                },
                {
                  "name": "prompt",
                  "path": "routes/api/rag/prompt",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/rag/prompt/+server.ts",
                      "loc": 92
                    }
                  ]
                },
                {
                  "name": "rebuild",
                  "path": "routes/api/rag/rebuild",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/rag/rebuild/+server.ts",
                      "loc": 24
                    }
                  ]
                },
                {
                  "name": "scan-refs",
                  "path": "routes/api/rag/scan-refs",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/rag/scan-refs/+server.ts",
                      "loc": 186
                    }
                  ]
                },
                {
                  "name": "stats",
                  "path": "routes/api/rag/stats",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/rag/stats/+server.ts",
                      "loc": 17
                    }
                  ]
                }
              ]
            },
            {
              "name": "tf",
              "path": "routes/api/tf",
              "children": [
                {
                  "name": "compile",
                  "path": "routes/api/tf/compile",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/tf/compile/+server.ts",
                      "loc": 153
                    }
                  ]
                },
                {
                  "name": "compile-wasm",
                  "path": "routes/api/tf/compile-wasm",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/tf/compile-wasm/+server.ts",
                      "loc": 64
                    }
                  ]
                }
              ]
            },
            {
              "name": "vocab",
              "path": "routes/api/vocab",
              "children": [
                {
                  "name": "bake-proposed",
                  "path": "routes/api/vocab/bake-proposed",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/vocab/bake-proposed/+server.ts",
                      "loc": 89
                    }
                  ]
                },
                {
                  "name": "infer",
                  "path": "routes/api/vocab/infer",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/vocab/infer/+server.ts",
                      "loc": 120
                    }
                  ]
                },
                {
                  "name": "promote",
                  "path": "routes/api/vocab/promote",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/vocab/promote/+server.ts",
                      "loc": 107
                    }
                  ]
                },
                {
                  "name": "promote-proposed",
                  "path": "routes/api/vocab/promote-proposed",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/vocab/promote-proposed/+server.ts",
                      "loc": 126
                    }
                  ]
                },
                {
                  "name": "regenerate",
                  "path": "routes/api/vocab/regenerate",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/vocab/regenerate/+server.ts",
                      "loc": 161
                    }
                  ]
                }
              ]
            },
            {
              "name": "volume",
              "path": "routes/api/volume",
              "children": [
                {
                  "name": "+server.ts",
                  "path": "routes/api/volume/+server.ts",
                  "loc": 217
                },
                {
                  "name": "backup",
                  "path": "routes/api/volume/backup",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/volume/backup/+server.ts",
                      "loc": 110
                    }
                  ]
                },
                {
                  "name": "onedrive",
                  "path": "routes/api/volume/onedrive",
                  "children": [
                    {
                      "name": "+server.ts",
                      "path": "routes/api/volume/onedrive/+server.ts",
                      "loc": 53
                    },
                    {
                      "name": "diff",
                      "path": "routes/api/volume/onedrive/diff",
                      "children": [
                        {
                          "name": "+server.ts",
                          "path": "routes/api/volume/onedrive/diff/+server.ts",
                          "loc": 126
                        }
                      ]
                    },
                    {
                      "name": "sync-paths",
                      "path": "routes/api/volume/onedrive/sync-paths",
                      "children": [
                        {
                          "name": "+server.ts",
                          "path": "routes/api/volume/onedrive/sync-paths/+server.ts",
                          "loc": 180
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "name": "design",
          "path": "routes/design",
          "children": [
            {
              "name": "+page.svelte",
              "path": "routes/design/+page.svelte",
              "loc": 578
            },
            {
              "name": "ArchGraph.svelte",
              "path": "routes/design/ArchGraph.svelte",
              "loc": 425
            },
            {
              "name": "architecture.ts",
              "path": "routes/design/architecture.ts",
              "loc": 760
            },
            {
              "name": "c4.ts",
              "path": "routes/design/c4.ts",
              "loc": 313
            },
            {
              "name": "C4View.svelte",
              "path": "routes/design/C4View.svelte",
              "loc": 483
            },
            {
              "name": "gep-modules.ts",
              "path": "routes/design/gep-modules.ts",
              "loc": 266
            },
            {
              "name": "GepModuleGraph.svelte",
              "path": "routes/design/GepModuleGraph.svelte",
              "loc": 319
            },
            {
              "name": "nodes",
              "path": "routes/design/nodes",
              "children": [
                {
                  "name": "ArchNode.svelte",
                  "path": "routes/design/nodes/ArchNode.svelte",
                  "loc": 135
                },
                {
                  "name": "ContainerNode.svelte",
                  "path": "routes/design/nodes/ContainerNode.svelte",
                  "loc": 148
                }
              ]
            }
          ]
        },
        {
          "name": "graph-editor",
          "path": "routes/graph-editor",
          "children": [
            {
              "name": "+page.svelte",
              "path": "routes/graph-editor/+page.svelte",
              "loc": 32
            }
          ]
        },
        {
          "name": "plan",
          "path": "routes/plan",
          "children": [
            {
              "name": "+page.svelte",
              "path": "routes/plan/+page.svelte",
              "loc": 728
            },
            {
              "name": "details.ts",
              "path": "routes/plan/details.ts",
              "loc": 220
            }
          ]
        },
        {
          "name": "primitives",
          "path": "routes/primitives",
          "children": [
            {
              "name": "+page.svelte",
              "path": "routes/primitives/+page.svelte",
              "loc": 2298
            },
            {
              "name": "primitives-tree.test.ts",
              "path": "routes/primitives/primitives-tree.test.ts",
              "loc": 139
            },
            {
              "name": "primitives-tree.ts",
              "path": "routes/primitives/primitives-tree.ts",
              "loc": 191
            },
            {
              "name": "profiles",
              "path": "routes/primitives/profiles",
              "children": [
                {
                  "name": "+page.svelte",
                  "path": "routes/primitives/profiles/+page.svelte",
                  "loc": 187
                }
              ]
            },
            {
              "name": "types",
              "path": "routes/primitives/types",
              "children": [
                {
                  "name": "+page.svelte",
                  "path": "routes/primitives/types/+page.svelte",
                  "loc": 31
                }
              ]
            }
          ]
        },
        {
          "name": "research",
          "path": "routes/research",
          "children": [
            {
              "name": "[slug]",
              "path": "routes/research/[slug]",
              "children": [
                {
                  "name": "+page.svelte",
                  "path": "routes/research/[slug]/+page.svelte",
                  "loc": 137
                }
              ]
            },
            {
              "name": "+page.svelte",
              "path": "routes/research/+page.svelte",
              "loc": 140
            },
            {
              "name": "docs.ts",
              "path": "routes/research/docs.ts",
              "loc": 122
            }
          ]
        },
        {
          "name": "vocab",
          "path": "routes/vocab",
          "children": [
            {
              "name": "_tabs",
              "path": "routes/vocab/_tabs",
              "children": [
                {
                  "name": "BrowsePane.svelte",
                  "path": "routes/vocab/_tabs/BrowsePane.svelte",
                  "loc": 105
                },
                {
                  "name": "CuratedDetail.svelte",
                  "path": "routes/vocab/_tabs/CuratedDetail.svelte",
                  "loc": 169
                },
                {
                  "name": "InferredTab.svelte",
                  "path": "routes/vocab/_tabs/InferredTab.svelte",
                  "loc": 216
                },
                {
                  "name": "ProposedTab.svelte",
                  "path": "routes/vocab/_tabs/ProposedTab.svelte",
                  "loc": 272
                }
              ]
            },
            {
              "name": "+page.server.ts",
              "path": "routes/vocab/+page.server.ts",
              "loc": 38
            },
            {
              "name": "+page.svelte",
              "path": "routes/vocab/+page.svelte",
              "loc": 1006
            }
          ]
        },
        {
          "name": "volume",
          "path": "routes/volume",
          "children": [
            {
              "name": "+page.svelte",
              "path": "routes/volume/+page.svelte",
              "loc": 912
            }
          ]
        },
        {
          "name": "wells",
          "path": "routes/wells",
          "children": [
            {
              "name": "+page.svelte",
              "path": "routes/wells/+page.svelte",
              "loc": 806
            },
            {
              "name": "label-layout.test.ts",
              "path": "routes/wells/label-layout.test.ts",
              "loc": 91
            },
            {
              "name": "label-layout.ts",
              "path": "routes/wells/label-layout.ts",
              "loc": 118
            },
            {
              "name": "view-settings.ts",
              "path": "routes/wells/view-settings.ts",
              "loc": 71
            },
            {
              "name": "WellCompPopup.svelte",
              "path": "routes/wells/WellCompPopup.svelte",
              "loc": 189
            },
            {
              "name": "WellDepthRuler.svelte",
              "path": "routes/wells/WellDepthRuler.svelte",
              "loc": 157
            },
            {
              "name": "WellElementRail.svelte",
              "path": "routes/wells/WellElementRail.svelte",
              "loc": 158
            },
            {
              "name": "WellPopover.svelte",
              "path": "routes/wells/WellPopover.svelte",
              "loc": 124
            },
            {
              "name": "WellSchematic2D.svelte",
              "path": "routes/wells/WellSchematic2D.svelte",
              "loc": 302
            },
            {
              "name": "WellTimingBadge.svelte",
              "path": "routes/wells/WellTimingBadge.svelte",
              "loc": 76
            },
            {
              "name": "WellToolbar.svelte",
              "path": "routes/wells/WellToolbar.svelte",
              "loc": 141
            },
            {
              "name": "WellViewControls.svelte",
              "path": "routes/wells/WellViewControls.svelte",
              "loc": 253
            },
            {
              "name": "WellViewPlaceholder.svelte",
              "path": "routes/wells/WellViewPlaceholder.svelte",
              "loc": 213
            },
            {
              "name": "workspace-cache.test.ts",
              "path": "routes/wells/workspace-cache.test.ts",
              "loc": 87
            },
            {
              "name": "workspace-cache.ts",
              "path": "routes/wells/workspace-cache.ts",
              "loc": 256
            },
            {
              "name": "wson-summary.ts",
              "path": "routes/wells/wson-summary.ts",
              "loc": 154
            }
          ]
        }
      ]
    },
    {
      "name": "volume_backup",
      "path": "volume_backup",
      "children": [
        {
          "name": "ai",
          "path": "volume_backup/ai",
          "children": [
            {
              "name": "eval",
              "path": "volume_backup/ai/eval",
              "children": [
                {
                  "name": "catalog",
                  "path": "volume_backup/ai/eval/catalog",
                  "children": [
                    {
                      "name": "halliburton",
                      "path": "volume_backup/ai/eval/catalog/halliburton",
                      "children": [
                        {
                          "name": "06_Packers.inspect.json",
                          "path": "volume_backup/ai/eval/catalog/halliburton/06_Packers.inspect.json",
                          "loc": 622
                        },
                        {
                          "name": "manifest.json",
                          "path": "volume_backup/ai/eval/catalog/halliburton/manifest.json",
                          "loc": 19
                        }
                      ]
                    }
                  ]
                },
                {
                  "name": "components",
                  "path": "volume_backup/ai/eval/components",
                  "children": [
                    {
                      "name": "index.json",
                      "path": "volume_backup/ai/eval/components/index.json",
                      "loc": 412
                    }
                  ]
                },
                {
                  "name": "wells",
                  "path": "volume_backup/ai/eval/wells",
                  "children": [
                    {
                      "name": "ABJF-610.extracted.api.haiku.json",
                      "path": "volume_backup/ai/eval/wells/ABJF-610.extracted.api.haiku.json",
                      "loc": 760
                    },
                    {
                      "name": "ABJF-610.extracted.api.opus.json",
                      "path": "volume_backup/ai/eval/wells/ABJF-610.extracted.api.opus.json",
                      "loc": 883
                    },
                    {
                      "name": "ABJF-610.extracted.api.sonnet.json",
                      "path": "volume_backup/ai/eval/wells/ABJF-610.extracted.api.sonnet.json",
                      "loc": 888
                    },
                    {
                      "name": "Ananas_W-6_-Rig109_Workover_Report__Convert_to_Disposal__Mar.extracted.api.haiku.json",
                      "path": "volume_backup/ai/eval/wells/Ananas_W-6_-Rig109_Workover_Report__Convert_to_Disposal__Mar.extracted.api.haiku.json",
                      "loc": 140
                    },
                    {
                      "name": "Ananas_W-6_-Rig109_Workover_Report__Convert_to_Disposal__Mar.extracted.api.opus.json",
                      "path": "volume_backup/ai/eval/wells/Ananas_W-6_-Rig109_Workover_Report__Convert_to_Disposal__Mar.extracted.api.opus.json",
                      "loc": 121
                    },
                    {
                      "name": "Ananas_W-6_-Rig109_Workover_Report__Convert_to_Disposal__Mar.extracted.api.sonnet.json",
                      "path": "volume_backup/ai/eval/wells/Ananas_W-6_-Rig109_Workover_Report__Convert_to_Disposal__Mar.extracted.api.sonnet.json",
                      "loc": 131
                    },
                    {
                      "name": "Ananas_W-6_-Rig109_Workover_Report__Convert_to_Disposal__Mar.extracted.cli.haiku.json",
                      "path": "volume_backup/ai/eval/wells/Ananas_W-6_-Rig109_Workover_Report__Convert_to_Disposal__Mar.extracted.cli.haiku.json",
                      "loc": 114
                    },
                    {
                      "name": "Ananas_W-6_-Rig109_Workover_Report__Convert_to_Disposal__Mar.extracted.cli.opus.json",
                      "path": "volume_backup/ai/eval/wells/Ananas_W-6_-Rig109_Workover_Report__Convert_to_Disposal__Mar.extracted.cli.opus.json",
                      "loc": 123
                    },
                    {
                      "name": "Ananas_W-6_-Rig109_Workover_Report__Convert_to_Disposal__Mar.extracted.cli.sonnet.json",
                      "path": "volume_backup/ai/eval/wells/Ananas_W-6_-Rig109_Workover_Report__Convert_to_Disposal__Mar.extracted.cli.sonnet.json",
                      "loc": 119
                    },
                    {
                      "name": "Ananas_W-6_-Rig109_Workover_Report__Convert_to_Disposal__Mar.truth.json",
                      "path": "volume_backup/ai/eval/wells/Ananas_W-6_-Rig109_Workover_Report__Convert_to_Disposal__Mar.truth.json",
                      "loc": 199
                    },
                    {
                      "name": "Ananas-13_Completion_Report_2016-06-08.extracted.api.haiku.json",
                      "path": "volume_backup/ai/eval/wells/Ananas-13_Completion_Report_2016-06-08.extracted.api.haiku.json",
                      "loc": 71
                    },
                    {
                      "name": "Ananas-13_Completion_Report_2016-06-08.extracted.api.opus.json",
                      "path": "volume_backup/ai/eval/wells/Ananas-13_Completion_Report_2016-06-08.extracted.api.opus.json",
                      "loc": 70
                    },
                    {
                      "name": "Ananas-13_Completion_Report_2016-06-08.extracted.api.sonnet.json",
                      "path": "volume_backup/ai/eval/wells/Ananas-13_Completion_Report_2016-06-08.extracted.api.sonnet.json",
                      "loc": 91
                    },
                    {
                      "name": "Ananas-13_Completion_Report_2016-06-08.extracted.cli.haiku.json",
                      "path": "volume_backup/ai/eval/wells/Ananas-13_Completion_Report_2016-06-08.extracted.cli.haiku.json",
                      "loc": 15
                    },
                    {
                      "name": "Ananas-13_Completion_Report_2016-06-08.extracted.cli.opus.json",
                      "path": "volume_backup/ai/eval/wells/Ananas-13_Completion_Report_2016-06-08.extracted.cli.opus.json",
                      "loc": 95
                    },
                    {
                      "name": "Ananas-13_Completion_Report_2016-06-08.truth.json",
                      "path": "volume_backup/ai/eval/wells/Ananas-13_Completion_Report_2016-06-08.truth.json",
                      "loc": 154
                    },
                    {
                      "name": "Ananas-13-Rig109-Workover_Report_CEW_ESP_WSO-BP_-Dec_11_2021.extracted.api.haiku.json",
                      "path": "volume_backup/ai/eval/wells/Ananas-13-Rig109-Workover_Report_CEW_ESP_WSO-BP_-Dec_11_2021.extracted.api.haiku.json",
                      "loc": 120
                    },
                    {
                      "name": "Ananas-13-Rig109-Workover_Report_CEW_ESP_WSO-BP_-Dec_11_2021.extracted.api.opus.json",
                      "path": "volume_backup/ai/eval/wells/Ananas-13-Rig109-Workover_Report_CEW_ESP_WSO-BP_-Dec_11_2021.extracted.api.opus.json",
                      "loc": 129
                    },
                    {
                      "name": "Ananas-13-Rig109-Workover_Report_CEW_ESP_WSO-BP_-Dec_11_2021.extracted.api.sonnet.json",
                      "path": "volume_backup/ai/eval/wells/Ananas-13-Rig109-Workover_Report_CEW_ESP_WSO-BP_-Dec_11_2021.extracted.api.sonnet.json",
                      "loc": 129
                    },
                    {
                      "name": "Ananas-13-Rig109-Workover_Report_CEW_ESP_WSO-BP_-Dec_11_2021.extracted.cli.haiku.json",
                      "path": "volume_backup/ai/eval/wells/Ananas-13-Rig109-Workover_Report_CEW_ESP_WSO-BP_-Dec_11_2021.extracted.cli.haiku.json",
                      "loc": 126
                    },
                    {
                      "name": "Ananas-13-Rig109-Workover_Report_CEW_ESP_WSO-BP_-Dec_11_2021.extracted.cli.opus.json",
                      "path": "volume_backup/ai/eval/wells/Ananas-13-Rig109-Workover_Report_CEW_ESP_WSO-BP_-Dec_11_2021.extracted.cli.opus.json",
                      "loc": 130
                    },
                    {
                      "name": "Ananas-13-Rig109-Workover_Report_CEW_ESP_WSO-BP_-Dec_11_2021.extracted.cli.sonnet.json",
                      "path": "volume_backup/ai/eval/wells/Ananas-13-Rig109-Workover_Report_CEW_ESP_WSO-BP_-Dec_11_2021.extracted.cli.sonnet.json",
                      "loc": 130
                    },
                    {
                      "name": "Ananas-13-Rig109-Workover_Report_CEW_ESP_WSO-BP_-Dec_11_2021.truth.json",
                      "path": "volume_backup/ai/eval/wells/Ananas-13-Rig109-Workover_Report_CEW_ESP_WSO-BP_-Dec_11_2021.truth.json",
                      "loc": 214
                    },
                    {
                      "name": "Hammal_-20-rig66_completion_report_gravel_packer_ESP_.extracted.api.haiku.json",
                      "path": "volume_backup/ai/eval/wells/Hammal_-20-rig66_completion_report_gravel_packer_ESP_.extracted.api.haiku.json",
                      "loc": 81
                    },
                    {
                      "name": "Hammal_-20-rig66_completion_report_gravel_packer_ESP_.extracted.api.opus.json",
                      "path": "volume_backup/ai/eval/wells/Hammal_-20-rig66_completion_report_gravel_packer_ESP_.extracted.api.opus.json",
                      "loc": 81
                    },
                    {
                      "name": "Hammal_-20-rig66_completion_report_gravel_packer_ESP_.extracted.api.sonnet.json",
                      "path": "volume_backup/ai/eval/wells/Hammal_-20-rig66_completion_report_gravel_packer_ESP_.extracted.api.sonnet.json",
                      "loc": 95
                    },
                    {
                      "name": "Hammal_-20-rig66_completion_report_gravel_packer_ESP_.extracted.cli.haiku.json",
                      "path": "volume_backup/ai/eval/wells/Hammal_-20-rig66_completion_report_gravel_packer_ESP_.extracted.cli.haiku.json",
                      "loc": 14
                    },
                    {
                      "name": "Hammal_-20-rig66_completion_report_gravel_packer_ESP_.extracted.cli.opus.json",
                      "path": "volume_backup/ai/eval/wells/Hammal_-20-rig66_completion_report_gravel_packer_ESP_.extracted.cli.opus.json",
                      "loc": 94
                    },
                    {
                      "name": "Hammal_-20-rig66_completion_report_gravel_packer_ESP_.extracted.cli.sonnet.json",
                      "path": "volume_backup/ai/eval/wells/Hammal_-20-rig66_completion_report_gravel_packer_ESP_.extracted.cli.sonnet.json",
                      "loc": 28
                    },
                    {
                      "name": "Hammal_-20-rig66_completion_report_gravel_packer_ESP_.truth.json",
                      "path": "volume_backup/ai/eval/wells/Hammal_-20-rig66_completion_report_gravel_packer_ESP_.truth.json",
                      "loc": 218
                    },
                    {
                      "name": "Hammal-19_New_well_ESP_workover_report_2015_11_17.extracted.api.haiku.json",
                      "path": "volume_backup/ai/eval/wells/Hammal-19_New_well_ESP_workover_report_2015_11_17.extracted.api.haiku.json",
                      "loc": 81
                    },
                    {
                      "name": "Hammal-19_New_well_ESP_workover_report_2015_11_17.extracted.api.opus.json",
                      "path": "volume_backup/ai/eval/wells/Hammal-19_New_well_ESP_workover_report_2015_11_17.extracted.api.opus.json",
                      "loc": 81
                    },
                    {
                      "name": "Hammal-19_New_well_ESP_workover_report_2015_11_17.extracted.api.sonnet.json",
                      "path": "volume_backup/ai/eval/wells/Hammal-19_New_well_ESP_workover_report_2015_11_17.extracted.api.sonnet.json",
                      "loc": 101
                    },
                    {
                      "name": "Hammal-19_New_well_ESP_workover_report_2015_11_17.extracted.cli.haiku.json",
                      "path": "volume_backup/ai/eval/wells/Hammal-19_New_well_ESP_workover_report_2015_11_17.extracted.cli.haiku.json",
                      "loc": 13
                    },
                    {
                      "name": "Hammal-19_New_well_ESP_workover_report_2015_11_17.extracted.cli.opus.json",
                      "path": "volume_backup/ai/eval/wells/Hammal-19_New_well_ESP_workover_report_2015_11_17.extracted.cli.opus.json",
                      "loc": 76
                    },
                    {
                      "name": "Hammal-19_New_well_ESP_workover_report_2015_11_17.extracted.cli.sonnet.json",
                      "path": "volume_backup/ai/eval/wells/Hammal-19_New_well_ESP_workover_report_2015_11_17.extracted.cli.sonnet.json",
                      "loc": 67
                    },
                    {
                      "name": "Hammal-19_New_well_ESP_workover_report_2015_11_17.truth.json",
                      "path": "volume_backup/ai/eval/wells/Hammal-19_New_well_ESP_workover_report_2015_11_17.truth.json",
                      "loc": 164
                    },
                    {
                      "name": "Hammal-5_Workover_Report_20140707.extracted.api.haiku.json",
                      "path": "volume_backup/ai/eval/wells/Hammal-5_Workover_Report_20140707.extracted.api.haiku.json",
                      "loc": 90
                    },
                    {
                      "name": "Hammal-5_Workover_Report_20140707.extracted.api.opus.json",
                      "path": "volume_backup/ai/eval/wells/Hammal-5_Workover_Report_20140707.extracted.api.opus.json",
                      "loc": 109
                    },
                    {
                      "name": "Hammal-5_Workover_Report_20140707.extracted.api.sonnet.json",
                      "path": "volume_backup/ai/eval/wells/Hammal-5_Workover_Report_20140707.extracted.api.sonnet.json",
                      "loc": 118
                    },
                    {
                      "name": "Hammal-5_Workover_Report_20140707.extracted.cli.haiku.json",
                      "path": "volume_backup/ai/eval/wells/Hammal-5_Workover_Report_20140707.extracted.cli.haiku.json",
                      "loc": 61
                    },
                    {
                      "name": "Hammal-5_Workover_Report_20140707.extracted.cli.opus.json",
                      "path": "volume_backup/ai/eval/wells/Hammal-5_Workover_Report_20140707.extracted.cli.opus.json",
                      "loc": 125
                    },
                    {
                      "name": "Hammal-5_Workover_Report_20140707.extracted.cli.sonnet.json",
                      "path": "volume_backup/ai/eval/wells/Hammal-5_Workover_Report_20140707.extracted.cli.sonnet.json",
                      "loc": 114
                    },
                    {
                      "name": "Hammal-5_Workover_Report_20140707.truth.json",
                      "path": "volume_backup/ai/eval/wells/Hammal-5_Workover_Report_20140707.truth.json",
                      "loc": 193
                    },
                    {
                      "name": "index.json",
                      "path": "volume_backup/ai/eval/wells/index.json",
                      "loc": 199
                    },
                    {
                      "name": "Mooz_S-3_PCM_PCP_completion_report_Oct__7_2015.extracted.api.haiku.json",
                      "path": "volume_backup/ai/eval/wells/Mooz_S-3_PCM_PCP_completion_report_Oct__7_2015.extracted.api.haiku.json",
                      "loc": 80
                    },
                    {
                      "name": "Mooz_S-3_PCM_PCP_completion_report_Oct__7_2015.extracted.api.opus.json",
                      "path": "volume_backup/ai/eval/wells/Mooz_S-3_PCM_PCP_completion_report_Oct__7_2015.extracted.api.opus.json",
                      "loc": 102
                    },
                    {
                      "name": "Mooz_S-3_PCM_PCP_completion_report_Oct__7_2015.extracted.api.sonnet.json",
                      "path": "volume_backup/ai/eval/wells/Mooz_S-3_PCM_PCP_completion_report_Oct__7_2015.extracted.api.sonnet.json",
                      "loc": 77
                    },
                    {
                      "name": "Mooz_S-3_PCM_PCP_completion_report_Oct__7_2015.extracted.cli.haiku.json",
                      "path": "volume_backup/ai/eval/wells/Mooz_S-3_PCM_PCP_completion_report_Oct__7_2015.extracted.cli.haiku.json",
                      "loc": 71
                    },
                    {
                      "name": "Mooz_S-3_PCM_PCP_completion_report_Oct__7_2015.extracted.cli.opus.json",
                      "path": "volume_backup/ai/eval/wells/Mooz_S-3_PCM_PCP_completion_report_Oct__7_2015.extracted.cli.opus.json",
                      "loc": 109
                    },
                    {
                      "name": "Mooz_S-3_PCM_PCP_completion_report_Oct__7_2015.extracted.cli.sonnet.json",
                      "path": "volume_backup/ai/eval/wells/Mooz_S-3_PCM_PCP_completion_report_Oct__7_2015.extracted.cli.sonnet.json",
                      "loc": 93
                    },
                    {
                      "name": "Mooz_S-3_PCM_PCP_completion_report_Oct__7_2015.truth.json",
                      "path": "volume_backup/ai/eval/wells/Mooz_S-3_PCM_PCP_completion_report_Oct__7_2015.truth.json",
                      "loc": 216
                    }
                  ]
                }
              ]
            },
            {
              "name": "kb",
              "path": "volume_backup/ai/kb",
              "children": [
                {
                  "name": "api",
                  "path": "volume_backup/ai/kb/api",
                  "children": [
                    {
                      "name": "bha-reference.json",
                      "path": "volume_backup/ai/kb/api/bha-reference.json",
                      "loc": 9
                    },
                    {
                      "name": "casing-tubing-data.json",
                      "path": "volume_backup/ai/kb/api/casing-tubing-data.json",
                      "loc": 8984
                    },
                    {
                      "name": "drill-pipe-identification.json",
                      "path": "volume_backup/ai/kb/api/drill-pipe-identification.json",
                      "loc": 83
                    },
                    {
                      "name": "drill-pipe-specs.json",
                      "path": "volume_backup/ai/kb/api/drill-pipe-specs.json",
                      "loc": 9
                    },
                    {
                      "name": "tubing-hanger.json",
                      "path": "volume_backup/ai/kb/api/tubing-hanger.json",
                      "loc": 133
                    }
                  ]
                },
                {
                  "name": "index.json",
                  "path": "volume_backup/ai/kb/index.json",
                  "loc": 70
                }
              ]
            },
            {
              "name": "kb-sources",
              "path": "volume_backup/ai/kb-sources",
              "children": [
                {
                  "name": "_index.json",
                  "path": "volume_backup/ai/kb-sources/_index.json",
                  "loc": 37
                }
              ]
            }
          ]
        },
        {
          "name": "archive",
          "path": "volume_backup/archive",
          "children": [
            {
              "name": "figures",
              "path": "volume_backup/archive/figures",
              "children": [
                {
                  "name": "gallery.json",
                  "path": "volume_backup/archive/figures/gallery.json",
                  "loc": 245
                }
              ]
            },
            {
              "name": "legacy_components",
              "path": "volume_backup/archive/legacy_components",
              "children": [
                {
                  "name": "casing_joint_threaded.ts",
                  "path": "volume_backup/archive/legacy_components/casing_joint_threaded.ts",
                  "loc": 77
                },
                {
                  "name": "extract_52.ts",
                  "path": "volume_backup/archive/legacy_components/extract_52.ts",
                  "loc": 165
                },
                {
                  "name": "new_tube.ts",
                  "path": "volume_backup/archive/legacy_components/new_tube.ts",
                  "loc": 16
                },
                {
                  "name": "tubing_joint_threaded.ts",
                  "path": "volume_backup/archive/legacy_components/tubing_joint_threaded.ts",
                  "loc": 80
                }
              ]
            }
          ]
        },
        {
          "name": "components",
          "path": "volume_backup/components",
          "children": [
            {
              "name": "casing_joint_threaded.ts",
              "path": "volume_backup/components/casing_joint_threaded.ts",
              "loc": 77
            },
            {
              "name": "extract_52.ts",
              "path": "volume_backup/components/extract_52.ts",
              "loc": 165
            },
            {
              "name": "new_tube.ts",
              "path": "volume_backup/components/new_tube.ts",
              "loc": 16
            },
            {
              "name": "test",
              "path": "volume_backup/components/test",
              "children": [
                {
                  "name": "conn_box_dp",
                  "path": "volume_backup/components/test/conn_box_dp",
                  "children": [
                    {
                      "name": "meta.json",
                      "path": "volume_backup/components/test/conn_box_dp/meta.json",
                      "loc": 11
                    },
                    {
                      "name": "part.json",
                      "path": "volume_backup/components/test/conn_box_dp/part.json",
                      "loc": 28
                    }
                  ]
                },
                {
                  "name": "conn_dp_box",
                  "path": "volume_backup/components/test/conn_dp_box",
                  "children": [
                    {
                      "name": "part.json",
                      "path": "volume_backup/components/test/conn_dp_box/part.json",
                      "loc": 104
                    }
                  ]
                },
                {
                  "name": "dp_new_box",
                  "path": "volume_backup/components/test/dp_new_box",
                  "children": [
                    {
                      "name": "part.json",
                      "path": "volume_backup/components/test/dp_new_box/part.json",
                      "loc": 57
                    }
                  ]
                },
                {
                  "name": "e2e_stub_1779824094286",
                  "path": "volume_backup/components/test/e2e_stub_1779824094286",
                  "children": [
                    {
                      "name": "component.ts",
                      "path": "volume_backup/components/test/e2e_stub_1779824094286/component.ts",
                      "loc": 17
                    }
                  ]
                },
                {
                  "name": "extract_49",
                  "path": "volume_backup/components/test/extract_49",
                  "children": [
                    {
                      "name": "part.json",
                      "path": "volume_backup/components/test/extract_49/part.json",
                      "loc": 446
                    },
                    {
                      "name": "prompts.json",
                      "path": "volume_backup/components/test/extract_49/prompts.json",
                      "loc": 7
                    }
                  ]
                },
                {
                  "name": "extract_50",
                  "path": "volume_backup/components/test/extract_50",
                  "children": [
                    {
                      "name": "part.json",
                      "path": "volume_backup/components/test/extract_50/part.json",
                      "loc": 124
                    }
                  ]
                },
                {
                  "name": "hollow_cylinder",
                  "path": "volume_backup/components/test/hollow_cylinder",
                  "children": [
                    {
                      "name": "component.ts",
                      "path": "volume_backup/components/test/hollow_cylinder/component.ts",
                      "loc": 27
                    }
                  ]
                },
                {
                  "name": "inner_1",
                  "path": "volume_backup/components/test/inner_1",
                  "children": [
                    {
                      "name": "part.json",
                      "path": "volume_backup/components/test/inner_1/part.json",
                      "loc": 51
                    }
                  ]
                },
                {
                  "name": "overnight_assembly_01",
                  "path": "volume_backup/components/test/overnight_assembly_01",
                  "children": [
                    {
                      "name": "part.json",
                      "path": "volume_backup/components/test/overnight_assembly_01/part.json",
                      "loc": 111
                    }
                  ]
                },
                {
                  "name": "overnight_simple_00",
                  "path": "volume_backup/components/test/overnight_simple_00",
                  "children": [
                    {
                      "name": "part.json",
                      "path": "volume_backup/components/test/overnight_simple_00/part.json",
                      "loc": 63
                    }
                  ]
                },
                {
                  "name": "taper",
                  "path": "volume_backup/components/test/taper",
                  "children": [
                    {
                      "name": "component.ts",
                      "path": "volume_backup/components/test/taper/component.ts",
                      "loc": 29
                    }
                  ]
                },
                {
                  "name": "tube_part",
                  "path": "volume_backup/components/test/tube_part",
                  "children": [
                    {
                      "name": "part.json",
                      "path": "volume_backup/components/test/tube_part/part.json",
                      "loc": 29
                    }
                  ]
                },
                {
                  "name": "tube_threaded",
                  "path": "volume_backup/components/test/tube_threaded",
                  "children": [
                    {
                      "name": "part.json",
                      "path": "volume_backup/components/test/tube_threaded/part.json",
                      "loc": 125
                    }
                  ]
                }
              ]
            },
            {
              "name": "tubing_joint_threaded.ts",
              "path": "volume_backup/components/tubing_joint_threaded.ts",
              "loc": 80
            }
          ]
        },
        {
          "name": "primitives",
          "path": "volume_backup/primitives",
          "children": [
            {
              "name": "archive",
              "path": "volume_backup/primitives/archive",
              "children": [
                {
                  "name": "dp_newpin.prim.ts",
                  "path": "volume_backup/primitives/archive/dp_newpin.prim.ts",
                  "loc": 21
                },
                {
                  "name": "e_tube_test.prim.ts",
                  "path": "volume_backup/primitives/archive/e_tube_test.prim.ts",
                  "loc": 22
                },
                {
                  "name": "profile_extrude_v5.prim.ts",
                  "path": "volume_backup/primitives/archive/profile_extrude_v5.prim.ts",
                  "loc": 87
                },
                {
                  "name": "r_extrude.prim.ts",
                  "path": "volume_backup/primitives/archive/r_extrude.prim.ts",
                  "loc": 49
                },
                {
                  "name": "r_revolve.prim.ts",
                  "path": "volume_backup/primitives/archive/r_revolve.prim.ts",
                  "loc": 34
                },
                {
                  "name": "r_rotate.prim.ts",
                  "path": "volume_backup/primitives/archive/r_rotate.prim.ts",
                  "loc": 50
                },
                {
                  "name": "t_barrel_scoop.prim.ts",
                  "path": "volume_backup/primitives/archive/t_barrel_scoop.prim.ts",
                  "loc": 8
                },
                {
                  "name": "t_bolt_driven.prim.ts",
                  "path": "volume_backup/primitives/archive/t_bolt_driven.prim.ts",
                  "loc": 21
                },
                {
                  "name": "t_bolt_hexhead.prim.ts",
                  "path": "volume_backup/primitives/archive/t_bolt_hexhead.prim.ts",
                  "loc": 9
                },
                {
                  "name": "t_cup_knob.prim.ts",
                  "path": "volume_backup/primitives/archive/t_cup_knob.prim.ts",
                  "loc": 8
                },
                {
                  "name": "t_diamond_bore.prim.ts",
                  "path": "volume_backup/primitives/archive/t_diamond_bore.prim.ts",
                  "loc": 8
                },
                {
                  "name": "t_finial.prim.ts",
                  "path": "volume_backup/primitives/archive/t_finial.prim.ts",
                  "loc": 9
                },
                {
                  "name": "t_goblet_bored.prim.ts",
                  "path": "volume_backup/primitives/archive/t_goblet_bored.prim.ts",
                  "loc": 8
                },
                {
                  "name": "t_goblet_plus_cut.prim.ts",
                  "path": "volume_backup/primitives/archive/t_goblet_plus_cut.prim.ts",
                  "loc": 12
                },
                {
                  "name": "t_hex_countersink.prim.ts",
                  "path": "volume_backup/primitives/archive/t_hex_countersink.prim.ts",
                  "loc": 9
                },
                {
                  "name": "t_hex_nut.prim.ts",
                  "path": "volume_backup/primitives/archive/t_hex_nut.prim.ts",
                  "loc": 8
                },
                {
                  "name": "t_hex_revolve_pocket.prim.ts",
                  "path": "volume_backup/primitives/archive/t_hex_revolve_pocket.prim.ts",
                  "loc": 9
                },
                {
                  "name": "t_plus_boss.prim.ts",
                  "path": "volume_backup/primitives/archive/t_plus_boss.prim.ts",
                  "loc": 8
                },
                {
                  "name": "t_rounded_hex.prim.ts",
                  "path": "volume_backup/primitives/archive/t_rounded_hex.prim.ts",
                  "loc": 9
                },
                {
                  "name": "t_spinner.prim.ts",
                  "path": "volume_backup/primitives/archive/t_spinner.prim.ts",
                  "loc": 9
                },
                {
                  "name": "t_star_bore.prim.ts",
                  "path": "volume_backup/primitives/archive/t_star_bore.prim.ts",
                  "loc": 8
                },
                {
                  "name": "t_tee_slot.prim.ts",
                  "path": "volume_backup/primitives/archive/t_tee_slot.prim.ts",
                  "loc": 8
                },
                {
                  "name": "t_tube_hexcap.prim.ts",
                  "path": "volume_backup/primitives/archive/t_tube_hexcap.prim.ts",
                  "loc": 8
                },
                {
                  "name": "t_valve_port.prim.ts",
                  "path": "volume_backup/primitives/archive/t_valve_port.prim.ts",
                  "loc": 18
                },
                {
                  "name": "t_vase_clip.prim.ts",
                  "path": "volume_backup/primitives/archive/t_vase_clip.prim.ts",
                  "loc": 8
                },
                {
                  "name": "warp_along_spline.prim.ts",
                  "path": "volume_backup/primitives/archive/warp_along_spline.prim.ts",
                  "loc": 125
                }
              ]
            },
            {
              "name": "basic",
              "path": "volume_backup/primitives/basic",
              "children": [
                {
                  "name": "dp_box.prim.ts",
                  "path": "volume_backup/primitives/basic/dp_box.prim.ts",
                  "loc": 19
                },
                {
                  "name": "dp_pin.prim.ts",
                  "path": "volume_backup/primitives/basic/dp_pin.prim.ts",
                  "loc": 19
                },
                {
                  "name": "r_ball.prim.ts",
                  "path": "volume_backup/primitives/basic/r_ball.prim.ts",
                  "loc": 26
                },
                {
                  "name": "r_cone.prim.ts",
                  "path": "volume_backup/primitives/basic/r_cone.prim.ts",
                  "loc": 23
                },
                {
                  "name": "r_cube_ball.prim.ts",
                  "path": "volume_backup/primitives/basic/r_cube_ball.prim.ts",
                  "loc": 24
                },
                {
                  "name": "r_cube.prim.ts",
                  "path": "volume_backup/primitives/basic/r_cube.prim.ts",
                  "loc": 36
                },
                {
                  "name": "r_cylinder.prim.ts",
                  "path": "volume_backup/primitives/basic/r_cylinder.prim.ts",
                  "loc": 38
                },
                {
                  "name": "r_tapered_tube.prim.ts",
                  "path": "volume_backup/primitives/basic/r_tapered_tube.prim.ts",
                  "loc": 27
                },
                {
                  "name": "r_thread_full.prim.ts",
                  "path": "volume_backup/primitives/basic/r_thread_full.prim.ts",
                  "loc": 148
                },
                {
                  "name": "r_threads.prim.ts",
                  "path": "volume_backup/primitives/basic/r_threads.prim.ts",
                  "loc": 194
                },
                {
                  "name": "r_tube.prim.ts",
                  "path": "volume_backup/primitives/basic/r_tube.prim.ts",
                  "loc": 25
                }
              ]
            },
            {
              "name": "completions",
              "path": "volume_backup/primitives/completions",
              "children": [
                {
                  "name": "drill_pipe",
                  "path": "volume_backup/primitives/completions/drill_pipe",
                  "children": [
                    {
                      "name": "dp_pin_test.prim.ts",
                      "path": "volume_backup/primitives/completions/drill_pipe/dp_pin_test.prim.ts",
                      "loc": 30
                    }
                  ]
                }
              ]
            },
            {
              "name": "profiles",
              "path": "volume_backup/primitives/profiles",
              "children": [
                {
                  "name": "barrel.prvl.ts",
                  "path": "volume_backup/primitives/profiles/barrel.prvl.ts",
                  "loc": 47
                },
                {
                  "name": "cone.prvl.ts",
                  "path": "volume_backup/primitives/profiles/cone.prvl.ts",
                  "loc": 38
                },
                {
                  "name": "cylinder.prvl.ts",
                  "path": "volume_backup/primitives/profiles/cylinder.prvl.ts",
                  "loc": 40
                },
                {
                  "name": "dp_spec_box.prvl.ts",
                  "path": "volume_backup/primitives/profiles/dp_spec_box.prvl.ts",
                  "loc": 112
                },
                {
                  "name": "dp_spec_pin.prvl.ts",
                  "path": "volume_backup/primitives/profiles/dp_spec_pin.prvl.ts",
                  "loc": 117
                },
                {
                  "name": "drill_pipe_box.prvl.ts",
                  "path": "volume_backup/primitives/profiles/drill_pipe_box.prvl.ts",
                  "loc": 108
                },
                {
                  "name": "tapered_tube.prvl.ts",
                  "path": "volume_backup/primitives/profiles/tapered_tube.prvl.ts",
                  "loc": 67
                },
                {
                  "name": "tube.prvl.ts",
                  "path": "volume_backup/primitives/profiles/tube.prvl.ts",
                  "loc": 55
                }
              ]
            }
          ]
        }
      ]
    }
  ]
};
