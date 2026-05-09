#!/usr/bin/env python3
"""
Real-world evaluation of /api/wells/extract.

Loops over PNG/WSON pairs in a directory, posts each PNG to the
running dev server, and prints a per-field diff against the ground
truth.

Usage:

  python tests/test_wells_real.py                                   # default port 5174, all files
  python tests/test_wells_real.py --port 3333
  python tests/test_wells_real.py --dir ~/Desktop/SAMPLE/schematics/xlsxtowson
  python tests/test_wells_real.py --limit 2                         # only first N (cost control)
  python tests/test_wells_real.py --only Ananas-13                  # name substring filter

Requires the dev server already running. Pure stdlib (urllib + json).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_DIR = Path("~/Desktop/SAMPLE/schematics/xlsxtowson").expanduser()


def post_extract(base_url: str, png_path: Path, model: str = "") -> dict[str, Any]:
    """Multipart POST one PNG; return parsed JSON or raise."""
    boundary = "----wellsBoundary" + str(int(time.time() * 1000))
    body = bytearray()
    body += f"--{boundary}\r\n".encode()
    body += (
        f'Content-Disposition: form-data; name="file"; filename="{png_path.name}"\r\n'
        f"Content-Type: image/png\r\n\r\n"
    ).encode()
    body += png_path.read_bytes()
    if model:
        body += f"\r\n--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="model"\r\n\r\n{model}'.encode()
    body += f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        f"{base_url}/api/wells/extract",
        data=bytes(body),
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.loads(resp.read().decode())


def num_close(a: Any, b: Any, rel: float = 0.05, abs_tol: float = 1.0) -> bool:
    """Numeric match within 5 percent or 1 unit, whichever is larger."""
    if a is None or b is None:
        return False
    try:
        a, b = float(a), float(b)
    except (TypeError, ValueError):
        return False
    return abs(a - b) <= max(abs_tol, rel * max(abs(a), abs(b)))


def diff_intervals(extracted: list[dict], truth: list[dict], keys=("top", "bot")) -> dict:
    """
    Greedy match: for each truth interval find the closest extracted one.
    Returns counts + a few example mismatches.
    """
    matched, missed = 0, []
    used = set()
    for t in truth:
        best, best_score = None, 1e9
        for i, e in enumerate(extracted):
            if i in used:
                continue
            score = sum(abs(float(e.get(k, 9e9)) - float(t.get(k, 0))) for k in keys)
            if score < best_score:
                best_score = score
                best = i
        if best is not None and all(num_close(extracted[best].get(k), t.get(k)) for k in keys):
            matched += 1
            used.add(best)
        else:
            missed.append(t)
    return {
        "truth_count": len(truth),
        "extracted_count": len(extracted),
        "matched": matched,
        "missed_examples": missed[:3],
    }


def evaluate(extracted: dict, truth: dict) -> dict:
    """Per-section comparison summary."""
    e_meta = extracted.get("meta") or {}
    t_meta = truth.get("meta") or {}
    meta = {
        "wellName": {
            "truth": t_meta.get("wellName"),
            "extracted": e_meta.get("wellName"),
            "match": (
                (e_meta.get("wellName") or "").strip().lower()
                == (t_meta.get("wellName") or "").strip().lower()
            ),
        },
        "td": {
            "truth": t_meta.get("td"),
            "extracted": e_meta.get("td"),
            "match": num_close(e_meta.get("td"), t_meta.get("td")),
        },
        "rkbToGl": {
            "truth": t_meta.get("rkbToGl"),
            "extracted": e_meta.get("rkbToGl"),
            "match": num_close(e_meta.get("rkbToGl"), t_meta.get("rkbToGl")),
        },
    }

    return {
        "meta": meta,
        "ch": diff_intervals(extracted.get("ch") or [], truth.get("ch") or []),
        "perf": diff_intervals(
            extracted.get("perforations") or [], truth.get("perforations") or []
        ),
        "comp": diff_intervals(
            extracted.get("completions") or [], truth.get("completions") or []
        ),
        "strata": diff_intervals(extracted.get("strata") or [], truth.get("strata") or []),
        "profile": {
            "truth_count": len(truth.get("profile") or []),
            "extracted_count": len(extracted.get("profile") or []),
        },
    }


def fmt_section(name: str, d: dict) -> str:
    if "matched" in d:
        return (
            f"{name:>8}: truth={d['truth_count']:>2} "
            f"got={d['extracted_count']:>2} "
            f"matched={d['matched']:>2}/{d['truth_count']}"
        )
    return f"{name:>8}: truth={d['truth_count']:>2} got={d['extracted_count']:>2}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default="5174")
    ap.add_argument("--dir", default=str(DEFAULT_DIR))
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--only", default=None, help="name substring filter")
    ap.add_argument("--save-results", default=None, help="write per-file JSON to this dir")
    ap.add_argument("--model", default="", help="override model id (e.g. claude-sonnet-4-6)")
    args = ap.parse_args()

    base = f"http://localhost:{args.port}"
    src = Path(args.dir).expanduser()
    pairs = []
    for png in sorted(src.glob("*.png")):
        wson = png.with_suffix(".wson")
        if not wson.exists():
            continue
        if args.only and args.only.lower() not in png.name.lower():
            continue
        pairs.append((png, wson))
    if args.limit:
        pairs = pairs[: args.limit]

    print(f"Found {len(pairs)} PNG/WSON pairs in {src}")
    print(f"Posting to {base}/api/wells/extract\n")

    out_dir = Path(args.save_results).expanduser() if args.save_results else None
    if out_dir:
        out_dir.mkdir(parents=True, exist_ok=True)

    summary_rows = []

    for i, (png, wson_path) in enumerate(pairs, 1):
        stem = png.stem
        print(f"[{i}/{len(pairs)}] {stem}")
        truth = json.loads(wson_path.read_text())
        t0 = time.time()
        try:
            resp = post_extract(base, png, model=args.model)
        except Exception as e:
            print(f"  ✗ POST failed: {e}\n")
            summary_rows.append((stem, "ERROR", str(e)[:80]))
            continue
        elapsed = time.time() - t0
        extracted = resp.get("wson") or {}
        issues = resp.get("issues") or []

        ev = evaluate(extracted, truth)
        m = ev["meta"]
        print(f"  model={resp.get('model')}  {elapsed:.1f}s  validator_issues={len(issues)}")
        print(
            f"  meta wellName: truth={m['wellName']['truth']!r:<25} "
            f"got={m['wellName']['extracted']!r:<25} "
            f"{'OK' if m['wellName']['match'] else 'MISS'}"
        )
        print(
            f"       td:       truth={m['td']['truth']!s:<10} "
            f"got={m['td']['extracted']!s:<10} "
            f"{'OK' if m['td']['match'] else 'MISS'}"
        )
        print(
            f"       rkbToGl:  truth={m['rkbToGl']['truth']!s:<10} "
            f"got={m['rkbToGl']['extracted']!s:<10} "
            f"{'OK' if m['rkbToGl']['match'] else 'MISS'}"
        )
        for sec in ("ch", "perf", "comp", "strata", "profile"):
            print("  " + fmt_section(sec, ev[sec]))

        if out_dir:
            (out_dir / f"{stem}.extracted.json").write_text(json.dumps(extracted, indent=2))
            (out_dir / f"{stem}.eval.json").write_text(json.dumps(ev, indent=2, default=str))

        # summary row
        ch = ev["ch"]
        perf = ev["perf"]
        comp = ev["comp"]
        summary_rows.append(
            (
                stem[:40],
                "OK" if m["wellName"]["match"] else "MISS",
                f"{ch['matched']}/{ch['truth_count']}",
                f"{perf['matched']}/{perf['truth_count']}",
                f"{comp['matched']}/{comp['truth_count']}",
            )
        )
        print()

    # Final table
    print("=" * 90)
    print(
        f"{'file':<40}  {'name':<5}  {'casings':<8}  {'perfs':<6}  {'comp':<6}"
    )
    print("-" * 90)
    for row in summary_rows:
        if row[1] == "ERROR":
            print(f"{row[0]:<40}  ERROR  {row[2]}")
        else:
            print(f"{row[0]:<40}  {row[1]:<5}  {row[2]:<8}  {row[3]:<6}  {row[4]:<6}")
    print("=" * 90)


if __name__ == "__main__":
    main()
