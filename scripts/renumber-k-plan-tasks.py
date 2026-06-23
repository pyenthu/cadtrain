#!/usr/bin/env python3
"""Renumber K-bundle /plan tasks to contiguous K.0..K.N (sorted by start week, then id).

Only rewrites each task's title PREFIX (the first K.NN before the em dash).
Cross-references in title bodies are left unchanged — duplicate legacy codes and
global replace would corrupt prefixes.
"""
import re
import sys
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "src/routes/plan/+page.svelte"

LINE_RE = re.compile(
    r"^(\s+\{ id: (\d+), bundle: 'K', lane: \d+, start: ([\d.]+),.*?title: ')K\.(\d+)( [—–-])"
)


def main() -> None:
    lines = PATH.read_text().splitlines(keepends=True)
    tasks: list[dict] = []

    for i, line in enumerate(lines):
        m = LINE_RE.match(line)
        if not m:
            continue
        tasks.append(
            {
                "line": i,
                "id": int(m.group(2)),
                "start": float(m.group(3)),
                "old": int(m.group(4)),
                "prefix": m.group(1),
                "dash": m.group(5),
            }
        )

    if not tasks:
        print("No K tasks found", file=sys.stderr)
        sys.exit(1)

    tasks.sort(key=lambda t: (t["start"], t["id"]))
    for n, t in enumerate(tasks):
        t["new"] = n

    print(f"Renumbering {len(tasks)} K tasks → K.0 .. K.{len(tasks) - 1}")
    changes = [t for t in tasks if t["old"] != t["new"]]
    for t in changes[:25]:
        print(f"  K.{t['old']:2d} → K.{t['new']:2d}  (#{t['id']})")
    if len(changes) > 25:
        print(f"  … and {len(changes) - 25} more")

    for t in tasks:
        line = lines[t["line"]]
        lines[t["line"]] = LINE_RE.sub(
            rf"\g<1>K.{t['new']}\g<5>",
            line,
            count=1,
        )

    PATH.write_text("".join(lines))
    print("Wrote", PATH)


if __name__ == "__main__":
    main()
