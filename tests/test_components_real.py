#!/usr/bin/env python3
"""
Component recognition eval.

Sends one var_1.png per primitive directory to /api/identify,
records the response, scores classification correctness against
the catalog ID, and writes per-case JSON for the /tests/components
viewer.

Usage:
  python tests/test_components_real.py                # default port 5181 (CLI mode)
  python tests/test_components_real.py --port 5174    # API mode

Pure stdlib (urllib + json). Sequential to avoid Pro/Max rate
windows when running through the CLI backend.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# training.json uses long ids ("nc_numbered_connection") but the live
# catalog (src/lib/components/library.ts) uses short ids ("thread_nc").
# This map is the bridge between the two — what the model is told vs
# what the training data labels things.
DIRNAME_TO_CATALOG_ID = {
    "prim_eue_external_upset_end":  "thread_eue",
    "prim_fh_full_hole":            "thread_fh",
    "prim_grooved_cylinder":        "grooved_cylinder",
    "prim_hollow_cylinder":         "hollow_cylinder",
    "prim_if_internal_flush":       "thread_if",
    "prim_j-latch_profile":         "j_latch",
    "prim_ltc_long_thread_coupled": "thread_ltc",
    "prim_nc_numbered_connection":  "thread_nc",
    "prim_packer_element":          "packer_element",
    "prim_reg_regular":             "thread_reg",
    "prim_seal_bore_polished":      "seal_bore",
    "prim_setting_cone":            "cone",
    "prim_shoulder_step":           "shoulder",
    "prim_slip_assembly":           "slips",
    "prim_slotted_cylinder":        "slotted_cylinder",
    "prim_taper_cone":              "taper",
    "prim_threaded_box_female":     "threaded_box",
    "prim_threaded_pin_male":       "threaded_pin",
}


def post_identify(base_url: str, png_path: Path) -> dict:
    boundary = "----compBoundary" + str(int(time.time() * 1000))
    body = bytearray()
    body += f"--{boundary}\r\n".encode()
    body += (
        f'Content-Disposition: form-data; name="image"; filename="{png_path.name}"\r\n'
        f"Content-Type: image/png\r\n\r\n"
    ).encode()
    body += png_path.read_bytes()
    body += f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        f"{base_url}/api/identify",
        data=bytes(body),
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.loads(resp.read().decode())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default="5181")
    ap.add_argument("--save-results", default="/tmp/components_eval")
    ap.add_argument("--variant", default="var_1.png", help="which variant png to use per primitive")
    args = ap.parse_args()

    base = f"http://localhost:{args.port}"
    out_dir = Path(args.save_results)
    out_dir.mkdir(parents=True, exist_ok=True)

    pairs = []
    for dirname, expected_id in DIRNAME_TO_CATALOG_ID.items():
        d = ROOT / "training_data" / dirname
        png = d / "images" / args.variant
        if not png.exists():
            png = d / "images" / "default.png"
        if png.exists():
            pairs.append((dirname, expected_id, png))

    print(f"Found {len(pairs)} primitives to test")
    print(f"Posting to {base}/api/identify\n")

    rows = []
    correct = 0
    for i, (dirname, expected_id, png) in enumerate(pairs, 1):
        print(f"[{i}/{len(pairs)}] {dirname}  (expected: {expected_id})")
        t0 = time.time()
        try:
            resp = post_identify(base, png)
        except Exception as e:
            print(f"  ✗ POST failed: {e}\n")
            rows.append({
                "dirname": dirname,
                "expected_id": expected_id,
                "image": str(png),
                "error": str(e),
            })
            continue
        elapsed = time.time() - t0
        predicted_id = resp.get("component_id")
        is_correct = predicted_id == expected_id
        if is_correct:
            correct += 1
        marker = "✓" if is_correct else "✗"
        print(f"  {marker} predicted={predicted_id!r}  conf={resp.get('confidence')}  {elapsed:.1f}s  backend={resp.get('_backend')}")
        rows.append({
            "dirname": dirname,
            "expected_id": expected_id,
            "image": str(png),
            "predicted_id": predicted_id,
            "predicted_name": resp.get("component_name"),
            "confidence": resp.get("confidence"),
            "reasoning": resp.get("reasoning"),
            "estimated_params": resp.get("estimated_params"),
            "retrieved_examples": resp.get("retrieved_examples", []),
            "is_correct": is_correct,
            "elapsed_ms": int(elapsed * 1000),
            "backend": resp.get("_backend"),
            "model": resp.get("_model"),
        })
        # Write per-case file
        (out_dir / f"{dirname}.result.json").write_text(json.dumps(rows[-1], indent=2))

    # Summary
    print("\n" + "=" * 78)
    print(f"{'dirname':<32}  {'expected':<18}  {'predicted':<18}  result")
    print("-" * 78)
    for r in rows:
        if "error" in r:
            print(f"{r['dirname']:<32}  {r['expected_id']:<18}  ERROR  {r['error'][:40]}")
            continue
        marker = "✓" if r["is_correct"] else "✗"
        print(f"{r['dirname']:<32}  {r['expected_id']:<18}  {str(r['predicted_id']):<18}  {marker}")
    print("=" * 78)
    print(f"Top-1 accuracy: {correct}/{len(pairs)} = {100*correct/len(pairs):.1f}%")

    (out_dir / "_summary.json").write_text(json.dumps({
        "rows": rows,
        "total": len(pairs),
        "correct": correct,
        "accuracy": correct / len(pairs) if pairs else 0,
    }, indent=2))

    sys.exit(0 if correct == len(pairs) else 1)


if __name__ == "__main__":
    main()
