# Diagrams

Published explainer pages, newest first. Each row's **source** is the HTML in `docs/diagrams/` —
the artifact URL renders that exact file.

| Diagram | What it explains | Source | Published |
|---|---|---|---|
| **The local-model plan** | Objective → method → goal, in plain language: why the app-builder must run locally, the 46-point gap vs Claude, the five-step factory, and where the score stands today. **Start here.** | [`local-model-plan.html`](diagrams/local-model-plan.html) | https://claude.ai/code/artifact/c39f232d-4ea0-4886-901b-1930b3c3faeb |
| **The RAG factory gate** | Why the 2026-08-03 gate read run-to-run noise as a regression, and the noise-band fix (`RUNS=3`, band = `max(3pp, 2×pooled σ)`). Technical companion to the above. | [`rag-factory-gate.html`](diagrams/rag-factory-gate.html) | https://claude.ai/code/artifact/9dd1d5eb-0f19-4605-988f-8e19f9d7ad02 |
| **Overnight loops A/B/C/D** | The 2026-08-02 run report: what each loop does, the usage-limit spin that wasted ~8,000 calls, the measured token anatomy, and the circuit-breaker fix. Loops B and D have since been rewritten — read as history. | [`overnight-loops-abcd.html`](diagrams/overnight-loops-abcd.html) | *(not published)* |

Older artifacts that predate this index (component dispatch engine, autonomous-loop progress, ewells
theme directions, app-builder eval) exist on the account but have no source in-repo — browse them at
**claude.ai/code/artifacts**.

## Updating one

Edit the file in `docs/diagrams/`, then re-publish it to the **same URL** by passing that URL
explicitly — a session that didn't originally publish it will otherwise mint a new one:

> Update `docs/diagrams/local-model-plan.html` and republish to
> `https://claude.ai/code/artifact/c39f232d-4ea0-4886-901b-1930b3c3faeb`

## House rules

- **Self-contained.** A strict CSP blocks every external host — no CDN scripts, no font URLs, no remote
  images. Inline the CSS and embed assets as `data:` URIs.
- **Both themes.** Define the palette as custom properties on `:root`, redefine under
  `@media (prefers-color-scheme: dark)`, then again under `:root[data-theme="dark"]` /
  `[data-theme="light"]` so the viewer's toggle wins in both directions.
- **No skeleton tags.** The file is wrapped in `<!doctype html><head>…</head><body>` at publish time —
  write the page content directly, starting with `<title>`.
- **Artifacts are private** until shared from the page's share menu.
