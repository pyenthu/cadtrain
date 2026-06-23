#!/usr/bin/env python3
"""Renumber non-done /plan tasks to A.1, A.2, B.1, … by bundle group.

Open/active/deferred tasks in each bundle that still has outstanding work
get a fresh letter (K→A, L→B, M→C, N→D, O→E, …) in BUNDLES array order.
Done tasks are untouched — historical K.0–K.74 etc. stay as-is.
"""
import re
import sys
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "src/routes/plan/+page.svelte"

# Bundle ids in chart order (must match BUNDLES in +page.svelte).
BUNDLE_ORDER = ["A", "D", "F", "G", "I", "J", "K", "L", "M", "N", "O"]

NON_DONE = {"open", "active", "deferred"}

TASK_RE = re.compile(
    r"^(\s+\{ id: (\d+), bundle: '([A-Z])', lane: \d+, start: ([\d.]+),"
    r" weeks: [\d.]+, priority: '[^']+',\s+status: '([^']+)',\s+title: )"
    r"(['\"])([A-Z])\.(\d+)( [—–-])"
)


def main() -> None:
    lines = PATH.read_text().splitlines(keepends=True)
    pending: list[dict] = []

    for i, line in enumerate(lines):
        m = TASK_RE.match(line)
        if not m:
            continue
        status = m.group(5)
        if status not in NON_DONE:
            continue
        pending.append(
            {
                "line": i,
                "id": int(m.group(2)),
                "bundle": m.group(3),
                "start": float(m.group(4)),
                "prefix": m.group(1),
                "quote": m.group(6),
                "old_letter": m.group(7),
                "old_num": int(m.group(8)),
                "dash": m.group(9),
            }
        )

    if not pending:
        print("No non-done tasks found", file=sys.stderr)
        sys.exit(1)

    # Which legacy bundles have outstanding work, in chart order?
    bundles_with_open = []
    seen = set()
    for bid in BUNDLE_ORDER:
        if any(t["bundle"] == bid for t in pending):
            bundles_with_open.append(bid)
            seen.add(bid)
    for t in pending:
        if t["bundle"] not in seen:
            bundles_with_open.append(t["bundle"])

    letter_for_bundle = {bid: chr(ord("A") + i) for i, bid in enumerate(bundles_with_open)}

    by_bundle: dict[str, list[dict]] = {bid: [] for bid in bundles_with_open}
    for t in pending:
        by_bundle[t["bundle"]].append(t)
    for bid in bundles_with_open:
        by_bundle[bid].sort(key=lambda t: (t["start"], t["id"]))

    print(f"Renumbering {len(pending)} non-done tasks across {len(bundles_with_open)} groups:")
    for bid in bundles_with_open:
        letter = letter_for_bundle[bid]
        group = by_bundle[bid]
        print(f"  {bid} → {letter}.1..{letter}.{len(group)}")
        for n, t in enumerate(group, start=1):
            t["new_letter"] = letter
            t["new_num"] = n

    for t in pending:
        line = lines[t["line"]]
        old = f"{t['quote']}{t['old_letter']}.{t['old_num']}{t['dash']}"
        new = f"{t['quote']}{t['new_letter']}.{t['new_num']}{t['dash']}"
        if old not in line:
            print(f"WARN: prefix not found on line {t['line']+1} id={t['id']}", file=sys.stderr)
            continue
        lines[t["line"]] = line.replace(old, new, 1)
        if t["old_letter"] != t["new_letter"] or t["old_num"] != t["new_num"]:
            print(f"  {t['old_letter']}.{t['old_num']} → {t['new_letter']}.{t['new_num']}  (#{t['id']} {t['bundle']})")

    PATH.write_text("".join(lines))
    print("Wrote", PATH)


if __name__ == "__main__":
    main()
