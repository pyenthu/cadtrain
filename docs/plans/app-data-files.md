# App data files — persistent workspace + data-file links

**Status:** headless build + unit tests GREEN; the File System Access + IndexedDB re-link is a
browser-only follow-up (steps below).

A `.app` is stateless — its DATA lives in local files (§0.5). This wires the app-harness studio
so a `.app` remembers *which* files back it (a main data source + sibling DLIS/LAS/… files) and
silently re-opens them on reload, instead of re-picking every file. Modeled directly on SVTC's
proven mechanism (`~/code/SVTC/src/lib/datasource/*`).

## Mechanism (mirrors SVTC)

- **One directory handle is the single anchor.** `showDirectoryPicker()` → the folder handle is
  persisted to **IndexedDB** (structured-cloneable). On reload we `queryPermission({mode:'readwrite'})`
  — if `'granted'`, re-adopt silently (no dialog); if `'prompt'`, stash it and offer a one-click
  *reconnect* (which calls `requestPermission`, the only call allowed to show UI, from a user gesture).
- **The `.app` stores REFERENCES, not handles or bytes.** Each linked slot persists
  `ref = { name, path, type }` where `path` is slash-joined **relative to the workspace root**.
  No handle, no data, no parsed content travels in the `.app`.
- **Resolve on load.** The reopened dir handle is walked into a `FileNode` tree (each node keeps
  its live handle). A ref resolves against the tree by **path → name**: an exact normalized-path
  match wins; otherwise a **unique** base-name match (a moved-but-uniquely-named file still binds;
  an ambiguous name stays "not linked" rather than binding to the wrong file). Then `getFile()` +
  parse — no per-file picker.
- **Fallback.** No File System Access (Safari/Firefox/SSR) → a plain `<input type=file>` one-off
  import. Its ref path == the bare name, so it re-links by name if the folder is opened later.

## Modules

| File | Role | Layer |
|---|---|---|
| `src/lib/appkit/manifest/types.ts` | `FileRef {name,path,type}`; `FileSlot.ref?` + `FileSlot.primary?`; `SlotValue.path?` | headless types |
| `src/lib/shared/harness/workspace-tree.ts` | PURE tree + ref matching (`normalizePath`, `makeRef`, `refFromNode`, `flattenFiles`, `resolveRefNode`, `linkStatus`) — Node-tested | pure |
| `src/lib/shared/harness/workspace-tree.test.ts` | unit tests for path-normalize / path-first + unique-name matching / ambiguity / status | test |
| `src/lib/shared/harness/workspace.svelte.ts` | browser store: IndexedDB dir-handle persist/restore, `autoReopen`/`reconnect`/`pickWorkspace`/`refresh`, `buildTreeFromHandle`, `resolveFile(ref)`, `pickFileFallback`. All FSA/IDB/DOM guarded | UI (Svelte-free logic + runes) |
| `src/lib/shared/harness/HarnessView.svelte` | resolve-on-mount: for each `app.files` slot with a `ref`, `autoReopen()` + `resolveFile()` + parse → populate the slot (client-only `onMount`) | runtime |
| `src/lib/shared/harness/AppSettings.svelte` | the two studio tabs (below) | studio UI |
| `src/routes/app_design/+page.svelte` | left-rail icon tabs 🗄 Persistent data · 📁 Data files | studio shell |

Constraint honored: `appkit/` stays headless — all FSA/IndexedDB/DOM lives under
`src/lib/shared/harness/`; only pure types + pure matching are shared.

## The two studio tabs

- **🗄 Persistent data** — the app's MAIN data source (`FileSlot.primary = true`). A workspace bar
  (open/change/reconnect/unlink the folder), the current main file (name · workspace-path · link
  badge), an editable `slot` name, and *Choose from folder* / *Pick file…* / *unlink*.
- **📁 Data files** — the sibling files. A list of non-primary `FileSlot`s (name · path · link
  badge · editable slot · remove), plus *Add from folder* / *Add file…* / *↻ Re-link all*.

Link badge: `● linked` (green) when the ref resolves against the open folder · `○ not linked`
(red) when it doesn't · `○ no folder` (grey) when no workspace is open. Styling reuses the
existing `.as-*` system-ui classes.

## Verify — browser follow-up (Chrome/Edge desktop)

1. Create `~/Desktop/SAMPLE/wsdata/` with e.g. `well-a.wson` + `logs/run1.las` + `logs/run1.dlis`.
2. `/app_design` → **＋** New (or 📂 open an app) → left rail **🗄 Persistent data**.
3. Click **open folder…** → pick `~/Desktop/SAMPLE/wsdata` (grant read/write). Bar shows `📁 wsdata`.
4. Click **▦ Choose from folder** → click `well-a.wson`. It becomes the main source; badge = `● linked`.
5. Left rail **📁 Data files** → **▦ Add from folder** → add `logs/run1.las` and `logs/run1.dlis`.
   Both show their `logs/…` path + `● linked`.
6. **💾 Save** the `.app`. Inspect it (＜/＞ Text view): `app.files` carries
   `{ slot, ref:{ name, path, type }, primary? }` — NO bytes/handles.
7. **Reload the page** (or reopen the saved `.app`) → open **🗄 Persistent data**. The folder is
   silently re-granted (or offers **reconnect** once) and every badge returns to `● linked` with
   NO per-file picker. Launch (↗) → the harness `onMount` re-resolves each slot and the panels
   render their data.
8. Move/rename a file so a ref can't path-match → its badge flips to `○ not linked`; re-pick it
   from the folder (unique-name files auto-recover by name).

Notes: IndexedDB + FSA permissions are per-origin, so the folder linked in `/app_design` is the
same one re-granted in the `/app/local/[token]` preview iframe and the `/app/[id]` launch.
