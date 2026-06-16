#!/usr/bin/env python3
"""Recursively walk /api/volume (via the local dev proxy → prod) and either
print the full file inventory or download every file into a backup dir.

Usage:
  python3 scripts/volume_walk.py list  <root-path>
  python3 scripts/volume_walk.py backup <root-path> <dest-dir>
"""
import json, os, sys, urllib.request

BASE = os.environ.get("VOL_BASE", "http://localhost:3333")


def get_json(path):
    url = f"{BASE}/api/volume?path={urllib.parse.quote(path)}"
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


def get_bytes(path):
    url = f"{BASE}/api/volume?path={urllib.parse.quote(path)}"
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def walk(path):
    """Yield (filepath, ) for every file under path, recursing dirs."""
    node = get_json(path)
    children = node.get("children") or {}
    for name, child in sorted(children.items()):
        cid = child["id"]
        if child["type"] == "dir":
            yield from walk(cid)
        else:
            yield cid


def main():
    import urllib.parse  # noqa
    mode = sys.argv[1]
    root = sys.argv[2]
    files = list(walk(root))
    if mode == "list":
        for f in files:
            print(f)
        print(f"# total files: {len(files)}", file=sys.stderr)
    elif mode == "backup":
        dest = sys.argv[3]
        for f in files:
            data = get_bytes(f)
            out = os.path.join(dest, f)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out, "wb") as fh:
                fh.write(data)
        print(f"# backed up {len(files)} files → {dest}", file=sys.stderr)


if __name__ == "__main__":
    import urllib.parse  # noqa
    main()
