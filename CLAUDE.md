# Tool 3D Modeling Pipeline

## Project Structure
```
duplicate/
├── CLAUDE.md                    # This file
├── HAL_WPS/                     # Halliburton Wireline catalog extraction
├── HAL_PACKERS/                 # Halliburton Packers catalog extraction
│   ├── perma_lach_pls_3d.html   # Packer 3D model (Three.js)
│   └── compare.html             # Side-by-side comparison
├── BOTTOM_SUB/
│   ├── original.png             # HAL10408 catalog drawing
│   └── manifold/                # ManifoldCAD parametric model
│       ├── assembly.ts          # Type definitions + default params
│       ├── build.ts             # Bun-side geometry builder
│       ├── geometry.js          # Pre-built geometry (auto-generated)
│       ├── params.json          # Current params (auto-generated)
│       ├── test_visual.mjs      # Playwright visual test
│       ├── vite.config.ts       # Vite dev server
│       └── threlte/             # Svelte/Threlte viewer app
│           ├── App.svelte       # Main layout
│           ├── Scene.svelte     # 3D scene
│           ├── ParamPanel.svelte # Parameter sidebar
│           ├── builder.ts       # Browser-side ManifoldCAD builder
│           ├── index.html       # Entry point
│           └── main.ts          # Svelte mount
├── training_data/               # VLM training data
│   ├── perma_lach_pls/          # Packer iterations
│   └── bottom_sub/             # Bottom sub iterations
├── vlm/                         # VLM comparison pipeline
│   ├── compare.py               # Visual comparison engine
│   ├── serve.py                 # Ollama management
│   └── fine_tune.py             # Fine-tuning scripts
├── pipeline.py                  # Training data capture
├── find_duplicates.py           # Duplicate photo finder
├── extract_all.py               # WPS catalog extractor
└── extract_packers.py           # Packers catalog extractor
```

## Running the Bottom Sub Viewer
```bash
cd BOTTOM_SUB/manifold
npx vite --config vite.config.ts
# Open http://localhost:3333
```

## Key Conventions
- **Z-down** axis convention (matches drilling)
- **MeshPhongMaterial** for Mac compatibility (not MeshPhysicalMaterial)
- **192 circular segments** for ManifoldCAD cylinders
- **Vertex colors** for red (outer) / grey (bore/cut) face classification
- **Custom Svelte sidebar** matching SVTC repo pattern
- **Playwright** for visual testing with persistent browser context
- Use **Bun** not Node for running scripts
- Test visually by opening browser AND taking Playwright screenshots
