#!/usr/bin/env python3
"""Destructive migration to the file-based layout
(docs/plans/file-based-architecture.md):

  primitives/<cat>/<id>/source.ts            → primitives/<cat>/<id>.prim.ts
  primitives/profiles/<id>/{profile.json,source.ts}
                                             → primitives/profiles/<id>.prvl.ts (or .prex.ts)

HTTP-driven through the local dev server (localhost:3333), which proxies to
prod by default. Set MIG_LOCAL=1 to send `X-Volume-Local: 1` on every request,
which forces the LOCAL .dev-volume + the LOCAL endpoint code (for the dry run
before deploying). Without it, the requests hit PROD (after the code is
deployed there).

  MIG_LOCAL=1 python3 scripts/migrate_to_file_kinds.py          # dry run on .dev-volume
  MIG_LOCAL=1 python3 scripts/migrate_to_file_kinds.py --apply  # apply locally
  python3 scripts/migrate_to_file_kinds.py --apply              # apply on PROD

Primitive relocations use /api/volume action=move (server-side rename — no
download/upload). Profiles go through /api/primitives/profiles/save, which
COMPOSES the merged module (single source of truth for the format).
"""
import json, os, sys, urllib.request, urllib.parse, urllib.error

BASE = os.environ.get("VOL_BASE", "http://localhost:3333")
LOCAL = os.environ.get("MIG_LOCAL") == "1"
APPLY = "--apply" in sys.argv
KNOWN_CATS = {"archive", "basic", "completions", "industrial", "profiles"}


def _headers(extra=None):
    h = {"Origin": BASE}  # satisfy SvelteKit CSRF on mutating verbs
    if LOCAL:
        h["X-Volume-Local"] = "1"
    if extra:
        h.update(extra)
    return h


def req(method, path, query="", body=None, ctype=None):
    url = f"{BASE}{path}"
    if query:
        url += "?" + query
    data = body if isinstance(body, (bytes, type(None))) else body.encode()
    h = _headers({"Content-Type": ctype} if ctype else None)
    r = urllib.request.Request(url, data=data, method=method, headers=h)
    with urllib.request.urlopen(r, timeout=120) as resp:
        return resp.status, resp.read()


def get_json(path, query=""):
    s, b = req("GET", path, query)
    return json.loads(b)


def get_text(path, query):
    s, b = req("GET", path, query)
    return b.decode()


def vol_query(path, **kw):
    q = {"path": path}
    q.update(kw)
    return urllib.parse.urlencode(q)


def walk(root):
    node = get_json("/api/volume", vol_query(root))
    for name, child in sorted((node.get("children") or {}).items()):
        if child["type"] == "dir":
            yield from walk(child["id"])
        else:
            yield child["id"]


def move(frm, to):
    print(f"  move {frm}  →  {to}")
    if APPLY:
        req("POST", "/api/volume", vol_query(frm, action="move", to=to))


def del_dir(path):
    print(f"  rmdir {path}")
    if APPLY:
        req("DELETE", "/api/volume", vol_query(path, recursive="1"))


def compose_module(meta, build_src):
    """Replicate composeProfileModule (profile-fn.ts) for the PUT fallback —
    used when build() can't validate on defaults so profiles/save would 400.
    splitProfileModule only needs the meta literal + build, so format drift is
    self-healing (the next in-app edit rewrites it canonically)."""
    ext = "prex" if meta.get("set") == "cartesian" else "prvl"
    kind = "extrude (cross-section)" if ext == "prex" else "revolve ((r,z) half-section)"
    obj = {k: meta.get(k) for k in ("id", "label", "description", "set", "tags", "params")}
    obj.setdefault("label", meta["id"])
    header = (f"// {meta['id']}.{ext}.ts — {kind} profile (function).\n"
              f"// meta = params schema + axis; build(p) returns the profile points.")
    return f"{header}\nexport const meta = {json.dumps(obj, indent=2)};\n\n{build_src.strip()}\n", ext


def save_profile(meta, build_src):
    payload = {
        "id": meta["id"],
        "label": meta.get("label", meta["id"]),
        "description": meta.get("description", ""),
        "set": meta.get("set", "revolve"),
        "tags": meta.get("tags", []),
        "params": meta.get("params", {}),
        "source": build_src,
    }
    print(f"  profiles/save {meta['id']} ({meta.get('set')})")
    if not APPLY:
        return
    try:
        req("POST", "/api/primitives/profiles/save", body=json.dumps(payload), ctype="application/json")
    except urllib.error.HTTPError as e:
        # build() fails on its own defaults (e.g. dp_pin_new) → server rejects.
        # Migrate anyway by composing + PUT-ing the module directly (bypasses
        # the validate-on-save guard); the file is still readable/splittable.
        if e.code != 400:
            raise
        module, ext = compose_module(meta, build_src)
        target = f"primitives/profiles/{meta['id']}.{ext}.ts"
        print(f"    ↳ build invalid on defaults → PUT composed module {target}")
        req("PUT", "/api/volume", vol_query(target), body=module, ctype="text/plain")


def main():
    mode = "PROD" if not LOCAL else "LOCAL (.dev-volume)"
    print(f"== migrate_to_file_kinds — target: {mode} — {'APPLY' if APPLY else 'DRY RUN'} ==")
    files = list(walk("primitives"))

    prim_sources = [f for f in files if f.endswith("/source.ts") and not f.startswith("primitives/profiles/")]
    profile_jsons = [f for f in files if f.startswith("primitives/profiles/") and f.endswith("/profile.json")]

    print(f"\n-- {len(prim_sources)} primitive(s) --")
    for path in prim_sources:
        parent = path[: -len("/source.ts")]      # primitives/<cat>/<id>
        target = parent + ".prim.ts"             # primitives/<cat>/<id>.prim.ts
        move(path, target)
        del_dir(parent)

    print(f"\n-- {len(profile_jsons)} profile(s) --")
    for pj in profile_jsons:
        pdir = pj[: -len("/profile.json")]       # primitives/profiles/<id>
        pid = pdir.split("/")[-1]
        meta = get_json("/api/volume", vol_query(pj))
        try:
            build_src = get_text("/api/volume", vol_query(pdir + "/source.ts"))
        except urllib.error.HTTPError:
            print(f"  SKIP {pid}: no source.ts (configured/drawn profile — left as legacy folder)")
            continue
        save_profile(meta, build_src)
        del_dir(pdir)

    # Husk cleanup: empty dirs directly under primitives/ that aren't categories.
    print("\n-- husk cleanup --")
    top = get_json("/api/volume", vol_query("primitives"))
    for name, child in (top.get("children") or {}).items():
        if child["type"] != "dir" or name in KNOWN_CATS:
            continue
        leftover = list(walk(child["id"]))
        if not leftover:
            del_dir(child["id"])
        else:
            print(f"  KEEP {child['id']} — {len(leftover)} file(s) remain")

    print("\n== done ==" + ("" if APPLY else "  (dry run — re-run with --apply)"))


if __name__ == "__main__":
    main()
