{
  "app": "design",
  "title": "CAD Train — Architecture",
  "docType": "design",
  "theme": {
    "mode": "light",
    "accent": "#475569"
  },
  "structures": {
    "archNode": [
      {
        "name": "id"
      },
      {
        "name": "label"
      },
      {
        "name": "parentId"
      },
      {
        "name": "kind"
      },
      {
        "name": "tech"
      },
      {
        "name": "accent"
      },
      {
        "name": "href"
      },
      {
        "name": "blurb"
      },
      {
        "name": "planned",
        "type": "boolean"
      },
      {
        "name": "archived",
        "type": "boolean"
      }
    ],
    "archEdge": [
      {
        "name": "source"
      },
      {
        "name": "target"
      },
      {
        "name": "kind"
      },
      {
        "name": "label"
      }
    ]
  },
  "vars": {
    "nodes": [
      {
        "id": "sys-cadtrain",
        "label": "CAD Train",
        "kind": "system",
        "tech": "Software System",
        "accent": "#475569",
        "blurb": "The whole parametric-CAD pipeline — one SvelteKit app + WASM kernel over a persistent volume."
      },
      {
        "id": "c-webapp",
        "label": "Web App",
        "parentId": "sys-cadtrain",
        "kind": "container",
        "tech": "SvelteKit · Svelte 5",
        "accent": "#3b82f6",
        "blurb": "Client SPA — route pages, the GraphEditorPane editor, the Threlte viewer."
      },
      {
        "id": "c-api",
        "label": "API layer",
        "parentId": "sys-cadtrain",
        "kind": "container",
        "tech": "adapter-node",
        "accent": "#22c55e",
        "blurb": "SvelteKit server endpoints — proxy the volume, run server bakes, dispatch Claude."
      },
      {
        "id": "c-kernel",
        "label": "CAD kernel",
        "parentId": "sys-cadtrain",
        "kind": "container",
        "tech": "ManifoldCAD WASM",
        "accent": "#f97316",
        "blurb": "Graph → source → mesh: composition graph/emit/bake + the Manifold CSG core."
      },
      {
        "id": "c-volume",
        "label": "Volume store",
        "parentId": "sys-cadtrain",
        "kind": "container",
        "tech": "$APP_DATA_DIR",
        "accent": "#a855f7",
        "blurb": "One persistent volume — parts, vocabulary, RAG corpus, bake cache. Survives redeploys."
      },
      {
        "id": "r-primitives",
        "label": "/primitives",
        "parentId": "c-webapp",
        "kind": "route",
        "href": "/primitives",
        "blurb": "Sidebar of volume parts + multi-tab graph editor (N × GraphEditorPane)."
      },
      {
        "id": "r-graph-editor",
        "label": "/graph-editor",
        "parentId": "c-webapp",
        "kind": "route",
        "href": "/graph-editor",
        "blurb": "The CAD editor — single primitive, full-screen."
      },
      {
        "id": "r-vocab",
        "label": "/vocab",
        "parentId": "c-webapp",
        "kind": "route",
        "href": "/vocab",
        "blurb": "Vocabulary editor — browse, infer, bake, promote."
      },
      {
        "id": "r-wells",
        "label": "/wells",
        "parentId": "c-webapp",
        "kind": "route",
        "href": "/wells",
        "blurb": "WIP: 3D-first well schematic — WSON → 3D well diagram."
      },
      {
        "id": "l-gep",
        "label": "GraphEditorPane",
        "parentId": "c-webapp",
        "kind": "lib",
        "blurb": "THE CAD editor shell — node-graph canvas + bake."
      },
      {
        "id": "l-threlte",
        "label": "Threlte viewer",
        "parentId": "c-webapp",
        "kind": "lib",
        "blurb": "Declarative Three.js — mesh/GLB/SVG rendering, cutaway, Z-down."
      },
      {
        "id": "r-fem",
        "label": "/fem",
        "parentId": "c-webapp",
        "kind": "route",
        "archived": true,
        "blurb": "Archived — FEM stress + tension viewer (moved to archive/)."
      },
      {
        "id": "a-prim-data",
        "label": "/api/primitives (data)",
        "parentId": "c-api",
        "kind": "api",
        "blurb": "list · save · source · delete · move — proxied to the prod volume."
      },
      {
        "id": "a-prim-bake",
        "label": "/api/primitives (bake)",
        "parentId": "c-api",
        "kind": "api",
        "blurb": "preview · bake-preview · compile — stay LOCAL (fast WASM)."
      },
      {
        "id": "a-rag",
        "label": "/api/rag/*",
        "parentId": "c-api",
        "kind": "api",
        "blurb": "rebuild · prompt · assist — BM25 retrieval + Claude → composition graph."
      },
      {
        "id": "a-vocab",
        "label": "/api/vocab/*",
        "parentId": "c-api",
        "kind": "api",
        "blurb": "regenerate · infer · bake-proposed · promote — vocabulary lifecycle."
      },
      {
        "id": "l-comp-graph",
        "label": "composition-graph",
        "parentId": "c-kernel",
        "kind": "lib",
        "blurb": "Node-graph model: Call · Container · Method · Mv · Rot · Repeat · Polygon."
      },
      {
        "id": "l-emit",
        "label": "composition-emit",
        "parentId": "c-kernel",
        "kind": "lib",
        "blurb": "Graph → emitted TypeScript body. Parts carry meta.graph + body."
      },
      {
        "id": "l-comp-bake",
        "label": "composition-bake",
        "parentId": "c-kernel",
        "kind": "lib",
        "blurb": "Bake orchestration — emit → sandbox → Manifold."
      },
      {
        "id": "l-manifold",
        "label": "Manifold WASM",
        "parentId": "c-kernel",
        "kind": "lib",
        "blurb": "WASM CSG core — bakes emitted source into a triangle mesh."
      },
      {
        "id": "l-loader",
        "label": "primitive-loader",
        "parentId": "c-kernel",
        "kind": "lib",
        "blurb": "Resolves a part + its meta.uses deps (stdlib-first), feeds the sandbox."
      },
      {
        "id": "s-primitives-vol",
        "label": "primitives/ (parts)",
        "parentId": "c-volume",
        "kind": "store",
        "blurb": "Flat typed sources: <id>.prim.ts · .asm.ts across basic/ · completions/ · archive/."
      },
      {
        "id": "s-vocab-json",
        "label": "vocabulary.json",
        "parentId": "c-volume",
        "kind": "store",
        "blurb": "Curated vocabulary — the source of truth for part kinds, params, rules."
      },
      {
        "id": "s-bake-cache-vol",
        "label": "cache/ (bakes)",
        "parentId": "c-volume",
        "kind": "store",
        "blurb": "Persistent bake cache — mesh/GLB keyed by part + param hash."
      }
    ],
    "edges": [
      {
        "source": "c-webapp",
        "target": "c-api",
        "kind": "summary",
        "label": "calls /api/*"
      },
      {
        "source": "c-api",
        "target": "c-kernel",
        "kind": "summary",
        "label": "bakes via"
      },
      {
        "source": "c-kernel",
        "target": "c-volume",
        "kind": "summary",
        "label": "reads / writes"
      },
      {
        "source": "r-primitives",
        "target": "a-prim-data",
        "kind": "calls"
      },
      {
        "source": "r-primitives",
        "target": "a-prim-bake",
        "kind": "calls"
      },
      {
        "source": "r-graph-editor",
        "target": "a-prim-bake",
        "kind": "calls"
      },
      {
        "source": "r-vocab",
        "target": "a-vocab",
        "kind": "calls"
      },
      {
        "source": "r-primitives",
        "target": "a-rag",
        "kind": "calls",
        "label": "✨"
      },
      {
        "source": "r-vocab",
        "target": "a-rag",
        "kind": "calls"
      },
      {
        "source": "r-primitives",
        "target": "l-gep",
        "kind": "mounts",
        "label": "N tabs"
      },
      {
        "source": "r-graph-editor",
        "target": "l-gep",
        "kind": "mounts",
        "label": "full-screen"
      },
      {
        "source": "l-gep",
        "target": "l-comp-graph",
        "kind": "flow",
        "label": "edit"
      },
      {
        "source": "l-comp-graph",
        "target": "l-emit",
        "kind": "flow",
        "label": "graph→src"
      },
      {
        "source": "l-emit",
        "target": "l-comp-bake",
        "kind": "flow",
        "label": "body"
      },
      {
        "source": "l-comp-bake",
        "target": "l-manifold",
        "kind": "flow",
        "label": "exec"
      },
      {
        "source": "l-manifold",
        "target": "l-threlte",
        "kind": "flow",
        "label": "mesh/GLB"
      },
      {
        "source": "a-prim-bake",
        "target": "l-loader",
        "kind": "calls",
        "label": "preview"
      },
      {
        "source": "a-prim-bake",
        "target": "l-comp-bake",
        "kind": "calls"
      },
      {
        "source": "a-prim-data",
        "target": "s-primitives-vol",
        "kind": "writes",
        "label": "save/delete"
      },
      {
        "source": "a-vocab",
        "target": "s-vocab-json",
        "kind": "reads"
      },
      {
        "source": "l-loader",
        "target": "s-primitives-vol",
        "kind": "reads",
        "label": "source"
      },
      {
        "source": "l-manifold",
        "target": "s-bake-cache-vol",
        "kind": "writes",
        "label": "cache"
      }
    ],
    "c4nodes": [
      {
        "id": "user",
        "label": "CAD Author",
        "kind": "person",
        "tech": "Web browser",
        "blurb": "Engineer authoring downhole-tool parts — wires graphs, scrubs params, describes parts."
      },
      {
        "id": "sys",
        "label": "CAD Train",
        "parentId": "user",
        "kind": "system",
        "tech": "SvelteKit · ManifoldCAD",
        "accent": "#cc2222",
        "blurb": "Parametric 3D CAD pipeline — a node-graph editor over a typed parts library, baked by a real CSG kernel."
      },
      {
        "id": "anthropic",
        "label": "Anthropic API",
        "parentId": "sys",
        "kind": "external",
        "tech": "Claude · SDK",
        "blurb": "LLM backend for generative authoring + the ✨ graph-assist loop."
      },
      {
        "id": "railway",
        "label": "Railway + Volume",
        "parentId": "sys",
        "kind": "external",
        "tech": "Docker · volume",
        "blurb": "Production host + the redeploy-surviving data volume at $APP_DATA_DIR."
      },
      {
        "id": "fal",
        "label": "FAL · archived",
        "parentId": "sys",
        "kind": "external",
        "tech": "Hunyuan3D",
        "archived": true,
        "blurb": "image→3D service behind /forge — ARCHIVED 2026-06."
      }
    ],
    "c4edges": [
      {
        "source": "user",
        "target": "sys",
        "kind": "calls",
        "label": "Authors parts [HTTPS]"
      },
      {
        "source": "sys",
        "target": "anthropic",
        "kind": "calls",
        "label": "AI generate [/refine · /rag]"
      },
      {
        "source": "sys",
        "target": "railway",
        "kind": "writes",
        "label": "reads / writes [volume FS]"
      },
      {
        "source": "sys",
        "target": "fal",
        "kind": "flow",
        "label": "image → 3D [/forge]"
      }
    ]
  },
  "panels": [
    {
      "id": "title",
      "kind": "heading",
      "props": {
        "level": 1,
        "text": "CAD Train — Architecture"
      }
    },
    {
      "id": "subtitle",
      "kind": "text",
      "props": {
        "text": "Left→right architecture tree (system → containers → components) and the C4 system context — replicated from /design on the app harness (pure SSR-safe SVG, no xyflow).",
        "muted": true
      }
    },
    {
      "id": "views",
      "kind": "tabs",
      "props": {
        "labels": [
          "Tree",
          "C4"
        ]
      },
      "children": [
        {
          "id": "tree",
          "kind": "nodetree",
          "title": "Tree",
          "source": {
            "verb": "readVar",
            "args": {
              "name": "nodes"
            }
          },
          "props": {
            "title": "Architecture — system · containers · components",
            "nodesVar": "nodes",
            "edgesVar": "edges",
            "colWidth": 220,
            "rowGap": 46
          }
        },
        {
          "id": "c4",
          "kind": "nodetree",
          "title": "C4",
          "source": {
            "verb": "readVar",
            "args": {
              "name": "c4nodes"
            }
          },
          "props": {
            "title": "C4 — System Context",
            "nodesVar": "c4nodes",
            "edgesVar": "c4edges",
            "colWidth": 250,
            "rowGap": 70,
            "nodeWidth": 190
          }
        }
      ]
    }
  ]
}
