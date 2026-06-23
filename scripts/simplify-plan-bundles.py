#!/usr/bin/env python3
"""Collapse /plan to three bundles (A=/components, B=/primitives, C=identity)
and strip embedded K.NN / E.NN title prefixes."""
import re
import sys
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "src/routes/plan/+page.svelte"

# Historical bundle → A | B | C (already-collapsed A/B/C lines are left alone)
BUNDLE_MAP = {
    "A": "A",
    "B": "B",
    "C": "C",
    "J": "A",
    "D": "A",
    "F": "A",
    "G": "A",
    "I": "A",
    "K": "B",
    "M": "B",
    "N": "B",
    "O": "B",
    "L": "C",
}
LANE = {"A": 0, "B": 1, "C": 2}
PREFIX_RE = re.compile(r"^[A-Z]\.\d+\s*[—–-]\s*")


def strip_title_prefix(line: str) -> str:
    for marker in ("title: '", 'title: "'):
        idx = line.find(marker)
        if idx == -1:
            continue
        start = idx + len(marker)
        rest = line[start:]
        m = PREFIX_RE.match(rest)
        if m:
            line = line[:start] + rest[m.end() :]
        break
    return line


def main() -> None:
    lines = PATH.read_text().splitlines(keepends=True)
    changed = 0
    counts = {"A": 0, "B": 0, "C": 0}

    for i, line in enumerate(lines):
        m = re.search(r"bundle: '([A-Z])'", line)
        if not m or "id:" not in line:
            continue
        old = m.group(1)
        new = BUNDLE_MAP.get(old, old)
        out = line.replace(f"bundle: '{old}'", f"bundle: '{new}'", 1) if old != new else line
        out = re.sub(r"lane: \d+", f"lane: {LANE.get(new, LANE.get(old, 0))}", out, count=1)
        out = strip_title_prefix(out)
        if out != line:
            changed += 1
        lines[i] = out
        counts[new] += 1

    PATH.write_text("".join(lines))
    print(f"Updated {changed} task lines → A:{counts['A']} B:{counts['B']} C:{counts['C']}")
    print("Wrote", PATH)


if __name__ == "__main__":
    main()
