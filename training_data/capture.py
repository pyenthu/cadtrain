#!/usr/bin/env python3
"""
Capture a training screenshot from the live Threlte viewer.
Usage: python capture.py <iteration_name> [port]

Saves to training_data/bottom_sub/images/<iteration_name>.png
"""
import sys
import time
from pathlib import Path

def capture(name, port=3334):
    from playwright.sync_api import sync_playwright

    out = Path(__file__).parent / "bottom_sub" / "images" / f"{name}.png"
    out.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        page.goto(f"http://localhost:{port}/")
        time.sleep(6)
        page.screenshot(path=str(out))
        browser.close()

    print(f"Saved: {out}")
    return str(out)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python capture.py <iteration_name> [port]")
        sys.exit(1)
    name = sys.argv[1]
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 3334
    capture(name, port)
