#!/usr/bin/env python3
"""
inspect_catalog_pdf.py

Classifies each page of a vendor catalog PDF by content type so a
downstream extractor knows what to do with it. Output is JSON,
written next to the source PDF as <basename>.inspect.json.

Per-page classification:
  cover            — almost no content (front/back covers, blank dividers)
  text_only        — text-dominated, very few vector paths and no rasters
  spec_table       — text + grid-line vector paths (table rendered as lines + text)
  mixed_schematic  — many vector paths + text (a labeled engineering drawing)
  photo_set        — embedded raster images dominate
  unknown          — none of the above thresholds matched cleanly

The thresholds are calibrated against the structure typically seen in
Halliburton's COMPLETIONS_TOOLS_DIAG chapters; tune in the THRESHOLDS
dict if a different vendor's PDFs misclassify.

Usage:
  python3 scripts/inspect_catalog_pdf.py <volume>/eval/catalog/halliburton/06_Packers.pdf
  python3 scripts/inspect_catalog_pdf.py path/to/file.pdf --out custom.json
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import fitz


THRESHOLDS = {
    # ≥ this many vector drawing paths and we treat the page as drawing-bearing
    "vector_heavy": 20,
    # ≥ this many embedded raster images and we treat as image-bearing
    "image_present": 1,
    "image_heavy": 3,
    # ≥ this many text blocks and we treat as text-bearing
    "text_present": 5,
    "text_heavy": 20,
    # below this total content count (paths + images + text blocks) → cover/blank
    "cover_total": 3,
}


def classify_page(n_paths: int, n_images: int, n_text_blocks: int) -> str:
    """Return one of the kinds in the module docstring."""
    total = n_paths + n_images + n_text_blocks

    if total <= THRESHOLDS["cover_total"]:
        return "cover"

    if n_images >= THRESHOLDS["image_heavy"] and n_paths < THRESHOLDS["vector_heavy"]:
        return "photo_set"

    if (
        n_paths >= THRESHOLDS["vector_heavy"]
        and n_text_blocks >= THRESHOLDS["text_present"]
    ):
        # Both vectors + text present. If text dominates and paths look like
        # straight grid lines we'd ideally call this spec_table, but the
        # vector/path count alone can't tell us "lines vs curves" cheaply.
        # Heuristic: very high text-to-path ratio → spec_table; otherwise
        # mixed_schematic.
        if n_text_blocks > n_paths * 1.5:
            return "spec_table"
        return "mixed_schematic"

    if n_paths >= THRESHOLDS["vector_heavy"]:
        return "mixed_schematic"

    if (
        n_text_blocks >= THRESHOLDS["text_heavy"]
        and n_paths < THRESHOLDS["vector_heavy"]
        and n_images < THRESHOLDS["image_present"]
    ):
        return "text_only"

    if n_images >= THRESHOLDS["image_present"]:
        return "photo_set"

    if n_text_blocks >= THRESHOLDS["text_present"]:
        return "text_only"

    return "unknown"


def inspect_pdf(pdf_path: Path) -> dict:
    doc = fitz.open(pdf_path)
    pages = []
    counts = Counter()

    for i, page in enumerate(doc):
        # get_drawings returns one entry per stroked/filled path
        try:
            n_paths = len(page.get_drawings())
        except Exception:
            n_paths = 0

        try:
            n_images = len(page.get_images(full=False))
        except Exception:
            n_images = 0

        try:
            text_blocks = page.get_text("blocks") or []
            n_text_blocks = len(text_blocks)
        except Exception:
            n_text_blocks = 0

        kind = classify_page(n_paths, n_images, n_text_blocks)
        counts[kind] += 1

        pages.append(
            {
                "page": i + 1,
                "kind": kind,
                "paths": n_paths,
                "images": n_images,
                "text_blocks": n_text_blocks,
            }
        )

    doc.close()

    return {
        "source": str(pdf_path),
        "page_count": len(pages),
        "thresholds": THRESHOLDS,
        "summary": dict(counts.most_common()),
        "pages": pages,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf", type=Path, help="Path to the catalog PDF to inspect.")
    ap.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Output JSON path. Defaults to <pdf>.inspect.json next to the source.",
    )
    ap.add_argument(
        "--print-summary",
        action="store_true",
        help="Also print the per-kind counts to stdout.",
    )
    args = ap.parse_args()

    if not args.pdf.exists():
        print(f"error: not found: {args.pdf}", file=sys.stderr)
        return 1

    out_path = args.out or args.pdf.with_name(args.pdf.stem + ".inspect.json")

    result = inspect_pdf(args.pdf)
    out_path.write_text(json.dumps(result, indent=2) + "\n")

    print(f"wrote {out_path}  ({result['page_count']} pages)")
    if args.print_summary:
        print("\nPer-kind counts:")
        for kind, n in result["summary"].items():
            print(f"  {kind:18s}  {n}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
