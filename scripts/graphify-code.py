#!/usr/bin/env python
"""graphify-code.py — build a DETERMINISTIC code knowledge-graph of src/ using
ONLY graphify's tree-sitter AST pipeline. ZERO Anthropic/Claude tokens, no
network — this deliberately does NOT invoke the /graphify SKILL's semantic pass
(that pass is the only token-costing part of graphify).

Pipeline (all pure, offline — identical to `graphify update`'s `_rebuild_code`,
but writing to the repo-root `graphify-out/graph.json` instead of `src/graphify-out/`):

    detect(src)  -> list the code files (tree-sitter language detection)
    extract(...) -> per-file AST nodes + edges (contains / imports / calls ...)
    build        -> assemble into a NetworkX graph
    cluster      -> community detection (Leiden/greedy — no LLM)
    to_json      -> node-link graph.json

Invoked by the dev-only endpoint POST /api/design/graphify. Prints a single
JSON line to stdout: {"ok": true, "nodes": N, "edges": M, "communities": C, "out": "..."}.

Usage:  <wellvision-python> scripts/graphify-code.py [SRC_DIR] [OUT_DIR]
        defaults: SRC_DIR=src  OUT_DIR=graphify-out
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    src_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("src")
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("graphify-out")

    try:
        # Pure AST / graph modules only — NO anthropic, NO network.
        from graphify.detect import detect
        from graphify.extract import extract
        from graphify.build import build_from_json
        from graphify.cluster import cluster
        from graphify.export import to_json
    except Exception as exc:  # graphify not installed in this interpreter
        print(json.dumps({"ok": False, "reason": f"graphify import failed: {exc}"}))
        return 2

    if not src_dir.exists():
        print(json.dumps({"ok": False, "reason": f"source dir not found: {src_dir}"}))
        return 2

    # 1. detect — tree-sitter language detection (writes counts to stderr).
    detected = detect(src_dir)
    code_files = [Path(f) for f in detected.get("files", {}).get("code", [])]
    if not code_files:
        print(json.dumps({"ok": False, "reason": f"no code files found under {src_dir}"}))
        return 2

    # 2. extract — per-file AST nodes + edges (deterministic, no LLM).
    result = extract(code_files)

    # 3. build + 4. cluster — NetworkX assembly + community detection.
    G = build_from_json(result)
    communities = cluster(G)

    # 5. serialize node-link graph.json to the repo-root graphify-out/.
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "graph.json"
    to_json(G, communities, str(out_path))

    print(json.dumps({
        "ok": True,
        "nodes": G.number_of_nodes(),
        "edges": G.number_of_edges(),
        "communities": len(communities),
        "files": len(code_files),
        "out": str(out_path),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
