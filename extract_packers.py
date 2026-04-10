#!/usr/bin/env python3
"""
Extract all content from Halliburton Packers catalog (06_Packers.pdf).
Identifies packer/completion tool pages, tags them, and saves to tools/ directory.
"""

import fitz
import os
import re
import json

PDF_PATH = "/Users/neerajsethi/duplicate/HAL_PACKERS/06_Packers.pdf"
OUT_DIR = "/Users/neerajsethi/duplicate/HAL_PACKERS"

TEXT_DIR = f"{OUT_DIR}/text"
IMG_DIR = f"{OUT_DIR}/images"
SVG_DIR = f"{OUT_DIR}/svg"
TOOLS_DIR = f"{OUT_DIR}/tools"

for d in [TEXT_DIR, IMG_DIR, SVG_DIR, TOOLS_DIR]:
    os.makedirs(d, exist_ok=True)


def is_tool_page(text, num_images, num_drawings):
    """Check if page describes a specific packer or completion tool."""
    specs = re.findall(
        r"(?:diameter|OD|ID|length|temperature|pressure|weight|rating|"
        r"max\.?\s*temp|max\.?\s*press|operating|specification|"
        r"tool\s+description|bore\s+size|casing\s+size|"
        r"setting\s+method|release|inflation|deflation|"
        r"tubing\s+size|working\s+pressure|burst|collapse|tensile)",
        text, re.I
    )
    has_tool_name = bool(re.search(r"[™®℠]", text))
    has_dimensions = bool(re.search(r"\d+[\./]\d+\s*(?:in\.|inch|mm|ft|°[FC]|psi|MPa)", text))
    has_figure = bool(re.search(r"(?:Figure|Fig\.|HAL\d+)", text, re.I))

    score = 0
    score += min(len(specs), 5)
    score += 3 if has_tool_name else 0
    score += 2 if has_dimensions else 0
    score += 2 if has_figure else 0
    score += 2 if num_images > 0 else 0
    score += 1 if num_drawings > 25 else 0
    return score >= 4


# Packer sub-categories
CATEGORIES = {
    "retrievable_packer": re.compile(r"retrievable|retrieve", re.I),
    "permanent_packer": re.compile(r"permanent|cement", re.I),
    "production_packer": re.compile(r"production\s+packer|tubing\s+packer", re.I),
    "inflatable_packer": re.compile(r"inflat|ECP|external\s+casing", re.I),
    "bridge_plug": re.compile(r"bridge\s+plug|BP[- ]", re.I),
    "cement_retainer": re.compile(r"cement\s+retainer|retainer", re.I),
    "liner_packer": re.compile(r"liner\s+packer|liner\s+hanger|liner\s+top", re.I),
    "service_tool": re.compile(r"setting\s+tool|running\s+tool|mill|anchor|seal\s+assembly|seal\s+bore|locator", re.I),
    "test_packer": re.compile(r"test\s+packer|straddle|DST", re.I),
}


def classify(text):
    cats = []
    for name, pattern in CATEGORIES.items():
        if pattern.search(text):
            cats.append(name)
    return cats if cats else ["general_packer"]


def extract_tool_name(text):
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    for line in lines[:15]:
        if re.search(r"[™®℠]", line) and len(line) < 80:
            return line
    for line in lines[:10]:
        if len(line) < 60 and not re.match(r"^\d+-\d+$", line):
            if line[0].isupper() and not line.startswith("Table"):
                return line
    return lines[0] if lines else "Unknown"


def make_safe(name):
    return re.sub(r'[^\w\-.]', '_', name)[:60]


def main():
    doc = fitz.open(PDF_PATH)
    total = len(doc)
    print(f"Processing {total} pages from 06_Packers.pdf...\n")

    tool_index = []

    for i in range(total):
        page_num = i + 1
        page = doc[i]
        text = page.get_text()
        drawings = page.get_drawings()
        images = page.get_images()

        # Save text
        with open(f"{TEXT_DIR}/page_{page_num:04d}.txt", "w") as f:
            f.write(text)

        # Save raster images
        for img_idx, img in enumerate(images):
            xref = img[0]
            try:
                base_image = doc.extract_image(xref)
                ext = base_image["ext"]
                with open(f"{IMG_DIR}/page_{page_num:04d}_img_{img_idx+1}.{ext}", "wb") as f:
                    f.write(base_image["image"])
            except Exception:
                pass

        # Save SVG
        svg = page.get_svg_image()
        with open(f"{SVG_DIR}/page_{page_num:04d}.svg", "w") as f:
            f.write(svg)

        # Check if tool page
        if not is_tool_page(text, len(images), len(drawings)):
            continue

        tool_name = extract_tool_name(text)
        categories = classify(text)
        safe_name = make_safe(tool_name)
        prefix = f"p{page_num:04d}_{safe_name}"

        for cat in categories:
            cat_dir = f"{TOOLS_DIR}/{cat}"
            os.makedirs(cat_dir, exist_ok=True)

            with open(f"{cat_dir}/{prefix}.svg", "w") as f:
                f.write(svg)
            with open(f"{cat_dir}/{prefix}.txt", "w") as f:
                f.write(f"TOOL: {tool_name}\n")
                f.write(f"PAGE: {page_num}\n")
                f.write(f"CATEGORY: {cat}\n")
                f.write(f"{'='*60}\n\n")
                f.write(text)
            for img_idx, img in enumerate(images):
                xref = img[0]
                try:
                    base_image = doc.extract_image(xref)
                    ext = base_image["ext"]
                    with open(f"{cat_dir}/{prefix}_img_{img_idx+1}.{ext}", "wb") as f:
                        f.write(base_image["image"])
                except Exception:
                    pass

        entry = {
            "page": page_num,
            "tool_name": tool_name,
            "categories": categories,
            "has_images": len(images) > 0,
            "vector_paths": len(drawings),
        }
        tool_index.append(entry)

    # Save index
    with open(f"{TOOLS_DIR}/tool_index.json", "w") as f:
        json.dump(tool_index, f, indent=2)

    # Summary
    with open(f"{TOOLS_DIR}/SUMMARY.txt", "w") as f:
        f.write("Halliburton Packers Catalog - Tool Extraction Summary\n")
        f.write(f"{'='*60}\n\n")
        f.write(f"Total pages: {total}\n")
        f.write(f"Tool pages identified: {len(tool_index)}\n\n")

        by_cat = {}
        for e in tool_index:
            for c in e["categories"]:
                by_cat.setdefault(c, []).append(e)

        for cat, entries in sorted(by_cat.items()):
            f.write(f"\n{'─'*60}\n")
            f.write(f"{cat.upper()} ({len(entries)} pages)\n")
            f.write(f"{'─'*60}\n")
            for e in entries:
                marker = " [IMG]" if e["has_images"] else ""
                f.write(f"  p.{e['page']:3d}  {e['tool_name']}{marker}\n")

    print(f"{'='*60}")
    print(f"DONE!")
    print(f"Total pages: {total}")
    print(f"Tool pages: {len(tool_index)}\n")

    by_cat = {}
    for e in tool_index:
        for c in e["categories"]:
            by_cat.setdefault(c, []).append(e)
    print("By category:")
    for cat, entries in sorted(by_cat.items()):
        print(f"  {cat}: {len(entries)}")

    print(f"\nOutput: {OUT_DIR}")


if __name__ == "__main__":
    main()
