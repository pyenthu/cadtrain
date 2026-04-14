#!/usr/bin/env python3
"""
Visual + assertion test of the RAG identification pipeline with GIF recording.

For each test case:
  1. Load /reverse
  2. Upload a primitive variation PNG
  3. Click Identify — intercepts /api/identify response
  4. Wait for the 3D render
  5. Assert response component_id matches the expected library id
  6. (Optional) Click Save to Training — default skipped to avoid cache pollution

Every run:
  - captures screenshots into static/tmp/rag_frames/
  - assembles static/tmp/rag.gif (served as /tmp/rag.gif in dev)
  - prints a pass/fail summary and exits non-zero on any miss

Flags:
  --record-training   re-enable the Save-to-Training click
  --headless          run the browser headless (default: visible, slow_mo=200)

Expected library IDs are derived from src/lib/components/library.ts, which
is the source of truth for what /api/identify can return.
"""

import argparse
import re
import shutil
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = Path("/Users/neerajsethi/Desktop/GitHub/cadtrain")
FRAMES_DIR = ROOT / "static" / "tmp" / "rag_frames"
GIF_PATH = ROOT / "static" / "tmp" / "rag.gif"
LIBRARY_TS = ROOT / "src" / "lib" / "components" / "library.ts"

# (label, image_path_rel_to_ROOT, expected_library_id)
#
# Library IDs come from src/lib/components/library.ts. The prim_* directory
# name does not always match the library id — e.g. prim_slip_assembly → "slips",
# prim_setting_cone → "cone". /api/identify always returns the library id
# because Claude is prompted from the library catalog.
TEST_CASES = [
    ("Hollow Cylinder",  "training_data/prim_hollow_cylinder/images/var_1.png",   "hollow_cylinder"),
    ("Slip Assembly",    "training_data/prim_slip_assembly/images/var_1.png",     "slips"),
    ("Setting Cone",     "training_data/prim_setting_cone/images/var_1.png",      "cone"),
    ("Grooved Cylinder", "training_data/prim_grooved_cylinder/images/var_1.png",  "grooved_cylinder"),
    ("Slotted Cylinder", "training_data/prim_slotted_cylinder/images/var_1.png",  "slotted_cylinder"),
    ("Taper Cone",       "training_data/prim_taper_cone/images/var_1.png",        "taper"),
]


def load_library_names() -> dict:
    """Parse library.ts and return {id: name} for every ComponentDef entry.

    Uses a regex scan rather than JS eval — the file format is stable
    (`id: "...",\\n    name: "...",`) and we only need the string pairs.
    """
    text = LIBRARY_TS.read_text()
    pattern = re.compile(r'id:\s*"([^"]+)",\s*\n\s*name:\s*"([^"]+)"')
    return dict(pattern.findall(text))


def norm(s):
    return (s or "").strip().lower()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--record-training",
        action="store_true",
        help="Click 'Save to Training' after each identification. Default is to skip, to avoid polluting the weighted retrieval cache with test runs.",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Run the browser headless. Default is visible (slow_mo=200) so you can watch the run.",
    )
    args = parser.parse_args()

    library_names = load_library_names()
    print(f"Loaded {len(library_names)} library component names")

    # Clean previous run — only when invoked as a script.
    shutil.rmtree(FRAMES_DIR, ignore_errors=True)
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)

    frame_num = [0]

    def save_frame(page, label):
        frame_num[0] += 1
        path = FRAMES_DIR / f"{frame_num[0]:03d}_{label}.png"
        try:
            page.screenshot(path=str(path))
            print(f"  frame {frame_num[0]}: {label}")
        except Exception as e:
            print(f"  ! frame {frame_num[0]} ({label}) failed: {e}")

    results = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=args.headless, slow_mo=200)
            page = browser.new_page(viewport={"width": 1500, "height": 900})

            for i, (label, rel_path, expected_id) in enumerate(TEST_CASES):
                print(f"\n=== Test {i + 1}/{len(TEST_CASES)}: {label} ===")
                img_path = ROOT / rel_path
                expected_name = library_names.get(expected_id, "?")

                result = {
                    "label": label,
                    "expected_id": expected_id,
                    "expected_name": expected_name,
                    "got_id": None,
                    "got_name": None,
                    "confidence": None,
                    "api_ok": False,
                    "dom_ok": False,
                    "error": None,
                }

                try:
                    page.goto("http://localhost:3333/reverse", wait_until="networkidle")
                    time.sleep(3)
                    save_frame(page, f"{i}_01_empty")

                    page.set_input_files("input[type=file]", str(img_path))
                    time.sleep(2)
                    save_frame(page, f"{i}_02_uploaded")

                    # Intercept /api/identify while clicking the button.
                    # expect_response is the canonical sync-API pattern — it
                    # buffers the response body so .json() is safe below.
                    with page.expect_response(
                        "**/api/identify", timeout=60_000
                    ) as resp_info:
                        page.click(".identify-btn")
                    save_frame(page, f"{i}_03_identifying")

                    api_json = resp_info.value.json()
                    result["got_id"] = api_json.get("component_id")
                    result["got_name"] = api_json.get("component_name")
                    result["confidence"] = api_json.get("confidence")

                    # Existing UI settle: wait until canvas + comp-info render
                    for _ in range(40):
                        if page.query_selector("canvas") and page.query_selector(".comp-info"):
                            break
                        time.sleep(1)
                    time.sleep(4)
                    save_frame(page, f"{i}_04_identified")

                    # DOM cross-check against rendered component name
                    dom_el = page.query_selector(".result-info strong")
                    dom_text = dom_el.text_content() if dom_el else ""

                    # Primary assertion
                    result["api_ok"] = result["got_id"] == expected_id
                    # Secondary (informational) — does the rendered name match
                    # what the library says for this id?
                    result["dom_ok"] = norm(dom_text) == norm(expected_name)

                    if result["api_ok"]:
                        print(f"  ✓ got {result['got_id']!r} (expected {expected_id!r})")
                    else:
                        print(f"  ✗ got {result['got_id']!r} (expected {expected_id!r})")

                    # Suppress Save to Training unless explicitly opted in.
                    if args.record_training:
                        save_btn = page.query_selector(".save-btn")
                        if save_btn:
                            save_btn.click()
                            time.sleep(3)
                            save_frame(page, f"{i}_05_saved")

                except Exception as e:
                    result["error"] = str(e)
                    print(f"  ! ERROR: {e}")
                    save_frame(page, f"{i}_99_error")

                results.append(result)
                time.sleep(1)

            browser.close()
    finally:
        # Always assemble the GIF — even on failure — so a broken run
        # still produces a visual artifact for inspection.
        print(f"\n=== Assembling GIF ===")
        frames = sorted(FRAMES_DIR.glob("*.png"))
        print(f"Found {len(frames)} frames")
        if frames:
            images = []
            for f in frames:
                img = Image.open(f).convert("RGB")
                img.thumbnail((800, 500), Image.Resampling.LANCZOS)
                images.append(img)
            images[0].save(
                GIF_PATH,
                save_all=True,
                append_images=images[1:],
                duration=1200,
                loop=0,
                optimize=True,
            )
            size_mb = GIF_PATH.stat().st_size / 1024 / 1024
            print(f"GIF saved: {GIF_PATH} ({size_mb:.1f} MB)")
            print(f"View at: http://localhost:3333/tmp/rag.gif")

    # Summary
    print("\n=== RAG Identification Results ===")
    passed = 0
    for r in results:
        mark = "✓" if r["api_ok"] else "✗"
        if isinstance(r["confidence"], (int, float)):
            conf = f"conf={r['confidence']:.2f}"
        else:
            conf = "conf=?"
        if r["error"]:
            print(f" {mark} {r['label']:<20} | ERROR: {r['error']}")
        else:
            dom_tag = "" if r["dom_ok"] else "  [DOM name mismatch]"
            expected = str(r["expected_id"])
            got = str(r["got_id"])
            print(f" {mark} {r['label']:<20} | expected={expected:<17} got={got:<17} {conf}{dom_tag}")
        if r["api_ok"]:
            passed += 1
    total = len(results)
    pct = (passed / total * 100) if total else 0.0
    print(f"\n {passed}/{total} passed ({pct:.1f}%)")

    sys.exit(0 if passed == total and total > 0 else 1)


if __name__ == "__main__":
    main()
