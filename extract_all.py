#!/usr/bin/env python3
"""
Extract all content from Halliburton WPS catalog.
Assigns each page to its correct catalog section.
Identifies tool description pages (with specs, diagrams, images)
and saves them to a tools/ directory organized by section.
"""

import fitz
import os
import re
import json
import shutil

PDF_PATH = "/Users/neerajsethi/duplicate/Halliburton_WPS_CATALOG.pdf"
OUT_DIR = "/Users/neerajsethi/duplicate/extracted"

TEXT_DIR = f"{OUT_DIR}/text"
IMG_DIR = f"{OUT_DIR}/images"
SVG_DIR = f"{OUT_DIR}/svg"
TOOLS_DIR = f"{OUT_DIR}/tools"

# Catalog section boundaries (1-indexed page numbers)
SECTIONS = [
    (12,  "01_Knowledge_and_Data_Transfer"),
    (16,  "02_Reservoir_Evaluation_Services"),
    (72,  "03_Open_Hole_Wireline_Services"),
    (140, "04_Cased_Hole_Wireline_Services"),
    (196, "05_Perforating_Solutions"),
    (342, "06_Downhole_Video"),
    (382, "07_Mobilization"),
    (388, "08_Mnemonics"),
]

# Pages to skip (TOC, cover, roman numeral pages)
SKIP_PAGES = set(range(1, 12))  # pages 1-11 are cover + TOC


def get_section(page_num):
    """Return section name for a 1-indexed page number."""
    section = None
    for start, name in SECTIONS:
        if page_num >= start:
            section = name
        else:
            break
    return section


def is_tool_page(text, num_images, num_drawings):
    """
    A tool page typically has:
    - Specifications (diameter, length, temp, pressure ratings)
    - Tool name with trademark symbols
    - Technical diagrams or images
    - NOT just a TOC or pure text discussion
    """
    specs = re.findall(
        r"(?:diameter|OD|length|temperature|pressure|weight|rating|"
        r"max\.\s*temp|max\.\s*press|operating|specification|"
        r"tool\s+string|tool\s+diagram|tool\s+description|"
        r"logging\s+speed|vertical\s+resolution|depth\s+of\s+investigation)",
        text, re.I
    )

    has_tool_name = bool(re.search(r"[™®℠]", text))
    has_dimensions = bool(re.search(r"\d+[\./]\d+\s*(?:in\.|inch|mm|ft|°[FC]|psi|MPa)", text))
    has_figure = bool(re.search(r"(?:Figure|Fig\.|HAL\d+)", text, re.I))

    score = 0
    score += min(len(specs), 5)         # up to 5 points for spec keywords
    score += 3 if has_tool_name else 0   # tool names have TM/registered marks
    score += 2 if has_dimensions else 0  # physical dimensions
    score += 2 if has_figure else 0      # figure references
    score += 2 if num_images > 0 else 0  # embedded images (diagrams)
    score += 1 if num_drawings > 25 else 0  # complex vector diagrams

    return score >= 4


def extract_tool_name(text):
    """Try to extract the main tool name from a page."""
    lines = [l.strip() for l in text.split("\n") if l.strip()]

    # Look for lines with trademark symbols - likely tool names
    for line in lines[:15]:
        if re.search(r"[™®℠]", line) and len(line) < 80:
            return line

    # Look for a short heading-like line (all caps or title case)
    for line in lines[:10]:
        if len(line) < 60 and not re.match(r"^\d+-\d+$", line):
            if line[0].isupper() and not line.startswith("Table"):
                return line

    return lines[0] if lines else "Unknown"


def make_safe_name(name):
    return re.sub(r'[^\w\-.]', '_', name)[:60]


def main():
    # Clean tools dir for fresh run
    if os.path.exists(TOOLS_DIR):
        shutil.rmtree(TOOLS_DIR)

    for d in [TEXT_DIR, IMG_DIR, SVG_DIR, TOOLS_DIR]:
        os.makedirs(d, exist_ok=True)

    doc = fitz.open(PDF_PATH)
    total = len(doc)
    print(f"Processing {total} pages...\n")

    tool_index = []
    section_counts = {}

    for i in range(total):
        page_num = i + 1
        page = doc[i]
        text = page.get_text()
        drawings = page.get_drawings()
        images = page.get_images()

        # Save text for all pages
        with open(f"{TEXT_DIR}/page_{page_num:04d}.txt", "w") as f:
            f.write(text)

        # Save raster images for all pages
        for img_idx, img in enumerate(images):
            xref = img[0]
            try:
                base_image = doc.extract_image(xref)
                ext = base_image["ext"]
                with open(f"{IMG_DIR}/page_{page_num:04d}_img_{img_idx+1}.{ext}", "wb") as f:
                    f.write(base_image["image"])
            except Exception:
                pass

        # Save SVG for all pages
        svg = page.get_svg_image()
        with open(f"{SVG_DIR}/page_{page_num:04d}.svg", "w") as f:
            f.write(svg)

        # Skip non-content pages
        if page_num in SKIP_PAGES:
            continue

        section = get_section(page_num)
        if not section:
            continue

        # Check if this is a tool description page
        if not is_tool_page(text, len(images), len(drawings)):
            continue

        tool_name = extract_tool_name(text)
        safe_name = make_safe_name(tool_name)
        prefix = f"p{page_num:04d}_{safe_name}"

        # Save to section directory under tools/
        sec_dir = f"{TOOLS_DIR}/{section}"
        os.makedirs(sec_dir, exist_ok=True)

        with open(f"{sec_dir}/{prefix}.svg", "w") as f:
            f.write(svg)
        with open(f"{sec_dir}/{prefix}.txt", "w") as f:
            f.write(f"TOOL: {tool_name}\n")
            f.write(f"PAGE: {page_num}\n")
            f.write(f"SECTION: {section}\n")
            f.write(f"{'='*60}\n\n")
            f.write(text)

        for img_idx, img in enumerate(images):
            xref = img[0]
            try:
                base_image = doc.extract_image(xref)
                ext = base_image["ext"]
                with open(f"{sec_dir}/{prefix}_img_{img_idx+1}.{ext}", "wb") as f:
                    f.write(base_image["image"])
            except Exception:
                pass

        entry = {
            "page": page_num,
            "tool_name": tool_name,
            "section": section,
            "has_images": len(images) > 0,
            "vector_paths": len(drawings),
        }
        tool_index.append(entry)
        section_counts[section] = section_counts.get(section, 0) + 1

        if (i + 1) % 50 == 0:
            print(f"  processed {i+1}/{total} pages... ({len(tool_index)} tool pages found)")

    # Save index
    with open(f"{TOOLS_DIR}/tool_index.json", "w") as f:
        json.dump(tool_index, f, indent=2)

    # Save readable summary
    with open(f"{TOOLS_DIR}/SUMMARY.txt", "w") as f:
        f.write("Halliburton WPS Catalog - Tool Extraction Summary\n")
        f.write(f"{'='*60}\n\n")
        f.write(f"Total pages: {total}\n")
        f.write(f"Tool pages identified: {len(tool_index)}\n\n")

        for sec_name in dict.fromkeys(s[1] for s in SECTIONS):
            entries = [e for e in tool_index if e["section"] == sec_name]
            if not entries:
                continue
            f.write(f"\n{'─'*60}\n")
            f.write(f"{sec_name.replace('_', ' ').upper()} ({len(entries)} tool pages)\n")
            f.write(f"{'─'*60}\n")
            for e in entries:
                marker = " [IMG]" if e["has_images"] else ""
                f.write(f"  p.{e['page']:3d}  {e['tool_name']}{marker}\n")

    print(f"\n{'='*60}")
    print("DONE!")
    print(f"Total pages: {total}")
    print(f"Tool pages: {len(tool_index)}\n")
    print("By section:")
    for sec_name in dict.fromkeys(s[1] for s in SECTIONS):
        count = section_counts.get(sec_name, 0)
        if count:
            label = sec_name.replace("_", " ")
            print(f"  {label}: {count}")
    print(f"\nOutput: {TOOLS_DIR}")


if __name__ == "__main__":
    main()
