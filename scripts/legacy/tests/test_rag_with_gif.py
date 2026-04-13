#!/usr/bin/env python3
"""
Visual test of the RAG identification pipeline with GIF recording.

Walks through:
  1. Upload a hollow cylinder variation
  2. Identify (RAG + Claude)
  3. Show the rendered 3D model
  4. Save to training cache
  5. Upload a slip assembly variation
  6. Repeat

Each step captures a full-page screenshot. Frames are assembled into
a GIF saved at static/tmp/rag.gif (accessible as /tmp/rag.gif in dev).
"""

import time
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = Path("/Users/neerajsethi/Desktop/GitHub/cadtrain")
FRAMES_DIR = ROOT / "static" / "tmp" / "rag_frames"
GIF_PATH = ROOT / "static" / "tmp" / "rag.gif"

# Clean previous run
shutil.rmtree(FRAMES_DIR, ignore_errors=True)
FRAMES_DIR.mkdir(parents=True, exist_ok=True)

test_cases = [
    ("Hollow Cylinder", ROOT / "training_data/prim_hollow_cylinder/images/var_1.png"),
    ("Slip Assembly", ROOT / "training_data/prim_slip_assembly/images/var_1.png"),
    ("Setting Cone", ROOT / "training_data/prim_setting_cone/images/var_1.png"),
]

frame_num = 0

def save_frame(page, label):
    global frame_num
    frame_num += 1
    path = FRAMES_DIR / f"{frame_num:03d}_{label}.png"
    page.screenshot(path=str(path))
    print(f"  frame {frame_num}: {label}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False, slow_mo=200)
    page = browser.new_page(viewport={"width": 1500, "height": 900})

    for case_idx, (name, img_path) in enumerate(test_cases):
        print(f"\n=== Test {case_idx + 1}/{len(test_cases)}: {name} ===")

        # Fresh page load
        page.goto("http://localhost:3333/reverse", wait_until="networkidle")
        time.sleep(3)
        save_frame(page, f"{case_idx}_01_empty")

        # Upload
        page.set_input_files("input[type=file]", str(img_path))
        time.sleep(2)
        save_frame(page, f"{case_idx}_02_uploaded")

        # Click Identify
        page.click(".identify-btn")
        save_frame(page, f"{case_idx}_03_identifying")

        # Wait for result
        for i in range(40):
            time.sleep(1)
            if page.query_selector("canvas") and page.query_selector(".comp-info"):
                break
        time.sleep(4)
        save_frame(page, f"{case_idx}_04_identified")

        # Save to training
        save_btn = page.query_selector(".save-btn")
        if save_btn:
            save_btn.click()
            time.sleep(3)
            save_frame(page, f"{case_idx}_05_saved")

        time.sleep(2)

    browser.close()

# Assemble GIF
print(f"\n=== Assembling GIF ===")
frames = sorted(FRAMES_DIR.glob("*.png"))
print(f"Found {len(frames)} frames")

if frames:
    images = []
    for f in frames:
        img = Image.open(f).convert("RGB")
        # Downscale for GIF size
        img.thumbnail((800, 500), Image.Resampling.LANCZOS)
        images.append(img)

    images[0].save(
        GIF_PATH,
        save_all=True,
        append_images=images[1:],
        duration=1200,  # ms per frame
        loop=0,
        optimize=True,
    )
    size_mb = GIF_PATH.stat().st_size / 1024 / 1024
    print(f"GIF saved: {GIF_PATH} ({size_mb:.1f} MB)")
    print(f"View at: http://localhost:3333/tmp/rag.gif")

print("\nDone")
