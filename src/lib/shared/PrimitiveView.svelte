<script lang="ts">
  // Generic surface for a single primitive — canvas on the left,
  // tabbed control panel on the right (Params | Source).
  //
  // Apply / Save contract (locked in plan per-primitive-svelte-views):
  //   - Drag a slider / type into a number input:  pending edit
  //                                                (orange-bar state)
  //   - Apply (Enter, or button):                  commit to runtime
  //                                                → re-render canvas
  //   - Save defaults:                             rewrite `default:`
  //                                                literals in source.ts
  //   - Save source:                               write current
  //                                                editor buffer
  //
  // Source.ts is canonical. Editing meta lives there as
  // `export const meta = {...}`. Save callbacks emit upward — this
  // component doesn't talk to the API itself.
  import PrimitiveDualCanvas from './PrimitiveDualCanvas.svelte';
  import CompositionEditor from './CompositionEditor.svelte';
  import { addAssemblyParam, removeAssemblyParam } from '$lib/cad/composition-tree';
  import ExtrudePartBuilder from '$lib/cad/builders/ExtrudePartBuilder.svelte';
  import RevolvePartBuilder from '$lib/cad/builders/RevolvePartBuilder.svelte';
  import { extractMetaParams } from '$lib/cad/inline-profile';
  // K.63 M2.5: the assembly-instances data layer is deleted. .asm.ts files
  // route to CompositionEditor (kind === 'asm' branch in the Parts panel
  // body); the old subtabs / atom rows / per-row ops / group markers /
  // definitions / expression sections are gone.
  import {
    parseDependencies, diffDependencies, buildSnapshots, writeDependencies,
    parseUses, type DependencyDiff,
  } from '$lib/cad/assembly-deps';
  import CodeEditor from './CodeEditor.svelte';
  import ProfileEditor from './ProfileEditor.svelte';
  import FloatingPanel from './FloatingPanel.svelte';
  import ParamGrid from './ParamGrid.svelte';
  import ProfilePalette from './ProfilePalette.svelte';
  import type { VolProfile } from './ProfilePalette.svelte';
  import { INSTANCE_PALETTE, colorsForInstance } from './instance-colors';
  import { tipHost } from './floating-tip';
  import ProfileFnEditor from './ProfileFnEditor.svelte';
  import { dragNumber } from './dragNumber';
  import { resolveProfile, PROFILE_REGISTRY, defaultsFor } from './profile-presets';
  import { untrack } from 'svelte';

  type ParamSchema = {
    label?: string;
    // 'profile' = a FUNCTION-ONLY profile param (a {kind,params} descriptor) —
    // normalized to 'polygon' + functionOnly in effectiveSchema so it renders
    // as the profile SELECTOR + lifted params, never a hand-edited vertex grid.
    type?: 'number' | 'boolean' | 'polygon' | 'enum' | 'profile';
    min?: number;
    max?: number;
    step?: number;
    options?: string[];
    default: number | [number, number][];
    unit?: string;
    /** Polygon params only: Z-down vertical axis for the Profile editor
     *  (revolve profiles are (r,z) with z increasing downward). */
    yDown?: boolean;
    hLabel?: string;
    vLabel?: string;
    /** Set when the param was declared `type: 'profile'` — function-only, so
     *  the vertex-grid affordance is suppressed (selector + lifted params only). */
    functionOnly?: boolean;
  };

  /** A meta.profiles entry — the Svelte-component encapsulated profile
   *  default. Same render flags as a polygon param, but the value lives in
   *  `value` (not `default`) and is edited by splicing meta.profiles in the
   *  source buffer (live edit → re-bake; Save source persists). */
  type ProfileSchema = {
    label?: string;
    type?: 'polygon';
    yDown?: boolean;
    hLabel?: string;
    vLabel?: string;
    value: [number, number][];
  };

  let {
    id,
    name = id,
    description = '',
    kind = 'prim',
    paramSchema,
    profileSchema = {},
    editable = false,
    initialSource = '',
    serverSource = '',
    onSaveSource,
    onSaveDefaults,
    onSaveAs,
    onReloadSource,
    onDuplicate,
    onDelete,
    catalog = [],
  }: {
    id: string;
    name?: string;
    description?: string;
    /** File-kind mid-extension (.exp/.rev/.asm/.prim). Drives the typed-builder
     *  dispatch — exp/rev mount the dedicated single-shape builders; asm/prim
     *  fall through to the existing assembly editor. Default 'prim' keeps
     *  legacy parts on the existing view. */
    kind?: 'prim' | 'exp' | 'rev' | 'asm';
    paramSchema: Record<string, ParamSchema>;
    /** meta.profiles — encapsulated profile defaults (Svelte-component model).
     *  Rendered as ProfileEditors in the Profiles tab; editing splices the
     *  meta.profiles.<name>.value literal in the source buffer. */
    profileSchema?: Record<string, ProfileSchema>;
    editable?: boolean;
    initialSource?: string;
    serverSource?: string;
    onSaveSource?: (newSource: string) => Promise<void> | void;
    onSaveDefaults?: (applied: Record<string, number>) => Promise<void> | void;
    /** Save As… — persist the CURRENT editor buffer under a NEW id, creating
     *  a new primitive without overwriting this one. Returns true on success
     *  (popup closes), false on rejection (collision / bad id — popup stays). */
    onSaveAs?: (newId: string, editedSource: string) => Promise<boolean> | boolean;
    onReloadSource?: () => Promise<void> | void;
    /** Duplicate this primitive into a new volume copy (icon button in the tab
     *  row). */
    onDuplicate?: () => void;
    /** Delete (archive) this primitive — omitted when not editable, so the
     *  trash button only shows for deletable parts. */
    onDelete?: () => void;
    /** Available primitives for the Parts-tab "Load" action (ids; params
     *  are fetched lazily on Load since the catalog list is id-only). */
    catalog?: Array<{ id: string }>;
  } = $props();

  // Session-added params (the "+ param" form) until Save reloads the primitive.
  // effectiveSchema merges them over the prop so the grid + args see them
  // immediately; they're ALSO spliced into editedSource (meta.params + the
  // function signature) so Save persists them and a parent assembly can drive them.
  let addedParams = $state<Record<string, ParamSchema>>({});
  // Session-deleted params (the ✕ on a param card) until Save reloads the
  // primitive — excluded from effectiveSchema so the grid hides them at once
  // (the `paramSchema` prop is set at load, so it still carries deleted keys).
  let removedParams = $state<Set<string>>(new Set());
  // Live meta.params re-parsed from the CURRENT editedSource. Lets the
  // typed-builder profile picker rewrite source → params reactively follow
  // (the parent's t.entry.params only refreshes after a save). Falls back
  // to paramSchema (prop) when extraction returns nothing — that path stays
  // valid for parts with non-standard meta shapes.
  let sourceParamSchema = $derived.by(() => {
    const fromSource = extractMetaParams(editedSource);
    if (Object.keys(fromSource).length === 0) return paramSchema;
    // Merge schemas — sourceParam values take precedence but inherit any
    // `type: 'profile'`/`type: 'polygon'` markers from paramSchema when the
    // source-parsed entry doesn't carry a type.
    const out: Record<string, ParamSchema> = {};
    for (const [k, v] of Object.entries(fromSource)) {
      const fromProp = (paramSchema as any)?.[k];
      out[k] = { ...(fromProp ?? {}), ...(v as any) } as ParamSchema;
    }
    return out;
  });
  let effectiveSchema = $derived(
    Object.fromEntries(
      Object.entries({ ...sourceParamSchema, ...addedParams })
        .filter(([k]) => !removedParams.has(k))
        // A `type: 'profile'` param is a function-only profile: render it with
        // the SAME machinery as a polygon param whose value is a {kind,params}
        // descriptor (selector + lifted params — exactly how r_rotate behaves),
        // but flag functionOnly so the vertex-grid affordance stays suppressed.
        .map(([k, v]) =>
          (v as ParamSchema)?.type === 'profile'
            ? [k, { ...(v as ParamSchema), type: 'polygon', functionOnly: true }]
            : [k, v],
        ),
    ),
  );
  let paramOrder = $derived(Object.keys(effectiveSchema));

  // Initial state from props is a deliberate one-time read (untrack).
  // Parent uses `{#key selected.id}` to remount on primitive change.
  // Values are `number` for scalar params and `[number, number][]` for
  // polygon params. The schema's `type` decides the renderer + how the
  // value flows into appliedArgs (polygons are JSON.stringify'd).
  let applied = $state<Record<string, number | [number, number][]>>(
    untrack(() => Object.fromEntries(Object.entries(paramSchema).map(([k, v]) => [k, v.default as any]))),
  );
  let pending = $state<Record<string, number | [number, number][]>>(untrack(() => ({ ...applied })));
  let editedSource = $state(untrack(() => initialSource));
  // Reconcile applied[] when effectiveSchema's KEYSET changes (typed-builder
  // picker swap rewrites source.meta.params: old profile keys disappear,
  // new ones appear). Engine keys (length/twist/divs/taper/segments) and
  // any matching key keep their existing applied value; newly-added keys
  // pick up the template default; keys that vanished from the schema get
  // dropped from applied so args don't carry stale slots.
  $effect(() => {
    const schemaKeys = Object.keys(effectiveSchema);
    const appliedKeys = Object.keys(applied);
    const next: Record<string, any> = {};
    let changed = false;
    for (const k of schemaKeys) {
      if (k in applied) {
        next[k] = applied[k];
      } else {
        next[k] = (effectiveSchema[k] as any)?.default;
        changed = true;
      }
    }
    for (const k of appliedKeys) {
      if (!(k in effectiveSchema)) { changed = true; }
    }
    if (changed) {
      applied = next;
      pending = { ...next };
    }
  });

  // Every polygon-typed param, in meta order — the merged Build tab renders a
  // ✎-profile card per entry below the scalar grid (opens the popup editor).
  // Composites that promoted inline profiles to named params can carry several.
  let polygonParamNames = $derived(paramOrder.filter((k) => effectiveSchema[k].type === 'polygon'));

  // Single merged "Build" tab (Parameters section + per-part accordion rows),
  // plus Source + AI. The dedicated Profiles/Profile tabs are gone — profile
  // editing is the ✎ popup everywhere (leaf polygon params + composite parts).
  let tab = $state<'build' | 'source' | 'ai'>('build');

  // ── Exclusive accordion (single-open unless pinned) ──────────────────────
  // Only ONE non-pinned row is open at a time (`activeOpen`); PINNED rows
  // (`pinnedParts`) stay open alongside it. A row is OPEN when it's pinned OR
  // it is the active row. The "Parameters" section uses the same model under
  // the synthetic key `__params__`, and starts open by default.
  let activeOpen = $state<string | null>('__params__');
  let pinnedParts = $state<Set<string>>(new Set());
  function isOpen(name: string): boolean {
    return pinnedParts.has(name) || activeOpen === name;
  }
  // Open a row (exclusively, unless pinned). Pinned rows are always open, so
  // this is a no-op for them beyond ensuring it's surfaced.
  function openPart(name: string) {
    if (pinnedParts.has(name)) return;
    activeOpen = name;
  }
  // Header click: pinned rows ignore collapse (un-pin to close); otherwise
  // toggle — open exclusively, or close if it was the active row.
  function togglePart(name: string) {
    if (pinnedParts.has(name)) return;
    activeOpen = activeOpen === name ? null : name;
  }
  // 📌 pin toggle. Pinning keeps a row open independently of the active row;
  // un-pinning collapses it (handing the single active slot back).
  function togglePin(name: string) {
    const next = new Set(pinnedParts);
    if (next.has(name)) {
      next.delete(name);
      // Was held open only by its pin → collapse it (clear active if it was).
      if (activeOpen === name) activeOpen = null;
    } else {
      next.add(name);
      // Free the exclusive slot if this row held it (now held by the pin).
      if (activeOpen === name) activeOpen = null;
    }
    pinnedParts = next;
  }

  // SOFT, non-fatal notice raised by an action (e.g. a profile we can't edit
  // visually). Shown inline above the Parameters accordion. Dismissible;
  // cleared by callers when the action retries.
  let profileEditNote = $state<string | null>(null);

  // Refresh the volume profile list when the Build tab opens (one fetch per
  // open, not per keystroke). Fresh each open so a just-saved/renamed profile's
  // schema + palette aren't shown stale (the cause of the briefly-stale "pink"
  // profile flash).
  $effect(() => { if (tab === 'build') void loadVolProfiles(true); });

  // ── Editing ─────────────────────────────────────────────────────────────
  // Editable when the part is a volume part (server says editable=true).
  // Stdlib (r_revolve, r_extrude, …) ship with editable=false.
  let canEdit = $derived(editable);
  function spliceSource(start: number, end: number, replacement: string) {
    if (start < 0 || end < 0) return;
    editedSource = editedSource.slice(0, start) + replacement + editedSource.slice(end);
  }

  // Per-part instanceColors swatches lived here for the old composite UI
  // (.prim.ts). The strip removed that path; CompositionEditor owns
  // per-instance colours for .asm.ts files now (its own swatch helpers).

  // ── Profile popup for instances of a profile-bearing primitive ──────────────
  // When a part's `call` resolves to a primitive that declares a `polygon`
  // param (r_revolve, r_extrude, …), surface a ✎-profile button on its row.
  // Clicking it opens the SAME ProfileEditor as a leaf's Profile tab — but
  // anchored in a FloatingPanel — seeded with the profile literal sliced out of
  // that instance's argsText. Apply round-trips the edited polygon back into
  // source.ts via the existing splice-by-offset path (→ Source dirty → re-bake).
  //
  // The leaf's param schema (which arg index is the polygon, plus its
  // yDown/labels) is fetched lazily + cached, keyed by the call id.
  // The leaf-profile cache (fetchLeafProfile / profileInfoFor / leafMetaCache
  // / splitTopLevelArgs) + composite popup state (profileEdit, profileRefName,
  // kindFromResolveCall, functionalProfileForSeg, …) all served the old
  // composite UI's per-instance profile editor. Removed with the strip.
  // Leaf polygon-param popups (`openLeafProfile`) still live below.

  // Build an SVG path `d` from profile polygon points, fitted into a
  // `size`×`size` box (with `pad` margin). MUST match ProfilePalette.thumb().
  //
  // REVOLVE (default): the points are a HALF-section in (r, z) where r is the
  // distance from the revolve axis (r=0). We MIRROR across r=0 (anchored at the
  // icon's horizontal CENTER) and emit TWO independent closed subpaths — one per
  // half — so a tube (inner edge at r>0) keeps a HOLLOW bore down the middle
  // instead of fusing into a solid bar. A solid (the half reaches r=0) has the
  // halves meet on the axis and reads as filled. Y is flipped (+y up the screen)
  // so the profile is right-side-up.
  //
  // CARTESIAN (revolve=false): a centered cross-section in (x, y), single path.
  function pathFor(pts: [number, number][] | null | undefined, size: number, pad = 1.5, revolve = true): string {
    if (!pts || pts.length < 2) return '';
    const right = pts as [number, number][];
    const left = pts.map((p) => [-p[0], p[1]] as [number, number]);
    const all = revolve ? [...right, ...left] : right;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of all) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const w = maxX - minX || 1, h = maxY - minY || 1;
    const span = size - pad * 2;
    const s = Math.min(span / w, span / h);
    // Center the shape; the mirror makes the revolve bbox symmetric about r=0,
    // so centering keeps r=0 at the icon's horizontal center.
    const ox = pad + (span - w * s) / 2, oy = pad + (span - h * s) / 2;
    const tx = (x: number) => ox + (x - minX) * s;
    // REVOLVE: z-down, z=0 at the top — matches the ProfileEditor / big preview
    // (do NOT flip). CARTESIAN: +y up.
    const ty = (y: number) => revolve ? oy + (y - minY) * s : oy + (maxY - y) * s;
    const sub = (half: [number, number][]) =>
      half.map((p, i) => `${i === 0 ? 'M' : 'L'}${tx(p[0]).toFixed(2)},${ty(p[1]).toFixed(2)}`).join(' ') + ' Z';
    // Two halves only for a real bore (min r > 0) → tube stays hollow; a solid
    // (r reaches the axis) is one fused loop with no center seam.
    const bore = revolve && Math.min(...right.map((p) => p[0])) > 1e-6;
    return !revolve ? sub(right)
      : bore ? `${sub(right)} ${sub(left)}`
      : sub([...right, ...[...left].reverse()]);
  }
  // Format a coordinate to MAX 2 decimal places (drops trailing zeros).
  function fmt2(n: number): string {
    return String(Math.round(n * 100) / 100);
  }

  // ── Leaf polygon-param profile popup ─────────────────────────────────────
  // A LEAF primitive (r_revolve, r_extrude, …) exposes its profile as a
  // `type: 'polygon'` PARAM (paramSchema), edited via `pending[name]` like any
  // other param — Apply/Enter commits → re-bake. Per the visual-editor plan we
  // surface it as a ✎ POPUP (not an inline editor / dedicated tab): the ✎ next
  // to the param name opens the SAME ProfileEditor in a FloatingPanel, seeded
  // from `pending[name]`. onChange updates pending (orange-bar dirty); Apply =
  // the existing global `apply()` (commit pending → applied → canvas re-bake).
  let leafEdit = $state<{ pname: string; px: number; py: number } | null>(null);
  // Volume-saved profiles (profile-system.md P2) — fetched lazily when a profile
  // popup first opens; merged with the built-in registry in ProfilePalette.
  let volProfiles = $state<VolProfile[]>([]);
  let volProfilesLoaded = $state(false);
  async function loadVolProfiles(force = false) {
    if (volProfilesLoaded && !force) return;
    volProfilesLoaded = true;
    try {
      const r = await fetch('/api/primitives/profiles/list');
      if (r.ok) { const d = await r.json(); volProfiles = (d?.profiles ?? d ?? []) as VolProfile[]; }
    } catch { /* offline / no volume — built-ins still work */ }
  }
  async function openLeafProfile(pname: string, ev: MouseEvent) {
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const kind = leafKindOf(pname);
    // Function-first polygon params (e.g. r_rotate's default { kind, params }) →
    // the function editor + palette, NOT the vertex editor (dragging vertices
    // would detach to raw points and break the function-first model).
    if (kind) {
      const seed = await seedForKind(kind);
      if (seed) {
        const set = paramSchema[pname]?.yDown ? 'revolve' : 'cartesian';
        fnEditor = { target: 'leaf', pname, set, seed, ...fnEditorPos(rect.left, rect.bottom) };
        return;
      }
    }
    leafEdit = {
      pname,
      px: Math.max(8, Math.min(rect.left - 380, window.innerWidth - 480)),
      py: Math.max(8, Math.min(rect.top, window.innerHeight - 360)),
    };
    void loadVolProfiles();
  }
  function closeLeafProfile() { leafEdit = null; }
  // Palette pick → set the leaf descriptor. Built-in → { kind, params } via the
  // existing setLeafKind; volume → its stored { kind, params } or { points }.
  function pickPaletteProfile(pname: string, id: string, origin: 'builtin' | 'volume') {
    if (origin === 'builtin') { setLeafKind(pname, id); return; }
    const v = volProfiles.find((x) => x.id === id);
    if (!v) return;
    if (Array.isArray(v.points)) pending = { ...pending, [pname]: { points: v.points } };
    else if (v.kind) pending = { ...pending, [pname]: { kind: v.kind, params: v.params ?? {} } };
  }
  // Save the current leaf descriptor to the volume (primitives/profiles/<id>/)
  // so it appears in the palette across sessions + primitives.
  let saveProfilePanel = $state<{ pname: string; id: string; label: string; px: number; py: number } | null>(null);
  let saveProfileBusy = $state(false);
  let saveProfileErr = $state<string | null>(null);
  function openSaveProfile(pname: string, ev: MouseEvent) {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const k = leafKindOf(pname) || pname || 'profile';
    saveProfileErr = null;
    saveProfilePanel = { pname, id: k, label: k, px: Math.max(8, Math.min(r.left - 150, window.innerWidth - 300)), py: Math.min(r.bottom + 6, window.innerHeight - 220) };
  }
  function closeSaveProfile() { saveProfilePanel = null; }
  async function submitSaveProfile() {
    if (!saveProfilePanel || saveProfileBusy) return;
    const { pname, id, label } = saveProfilePanel;
    const slug = id.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!slug) { saveProfileErr = 'id required'; return; }
    const d = leafDesc(pname);
    const set = paramSchema[pname]?.yDown ? 'revolve' : 'cartesian';
    const body: any = { id: slug, label: label.trim() || slug, set };
    if (d && typeof d === 'object' && 'kind' in d) { body.kind = d.kind; body.params = d.params ?? {}; }
    else { body.points = resolveProfile(d); }
    saveProfileBusy = true; saveProfileErr = null;
    try {
      const r = await fetch('/api/primitives/profiles/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (r.ok) { await loadVolProfiles(true); closeSaveProfile(); }
      else saveProfileErr = `save failed: ${await r.text()}`;
    } catch (e: any) { saveProfileErr = `error: ${e?.message ?? e}`; }
    finally { saveProfileBusy = false; }
  }
  // Apply the leaf-param edit = commit pending → applied (re-bake), then close.
  function applyLeafProfile() { apply(); closeLeafProfile(); }

  // ── Author a volume FUNCTION profile (K.22 P3b) ───────────────────────────
  // The `ƒ+` in the leaf popup opens ProfileFnEditor (params schema + build(p)
  // body + live server-resolved preview). On save it joins the palette (ƒ badge)
  // and we auto-pick it into the leaf so the part renders it immediately.
  // target 'leaf' = a standalone leaf primitive's polygon param (pickPaletteProfile);
  // 'instance' = a composite Parts-list instance's profile arg (pickProfileShape).
  let fnEditor = $state<{
    target: 'leaf'; pname: string | null;
    set: 'revolve' | 'cartesian'; seed: any;
    px: number; py: number;
  } | null>(null);
  // Profile identity (id/name/description/tags) is owned here so the title-bar ⚙
  // popover can edit it; ProfileFnEditor reads it as props. Reseeded on each open.
  let fnMeta = $state({ id: '', label: '', description: '', tags: '' });
  let fnMetaPop = $state<{ x: number; y: number } | null>(null);
  const fnAutoDesc = $derived(fnEditor ? (fnEditor.set === 'revolve' ? 'revolve half-section (r, z)' : 'cross-section profile') : '');
  $effect(() => {
    if (!fnEditor) return;
    const s = fnEditor.seed;
    fnMeta = {
      id: s?.id ?? '', label: s?.label ?? '', description: s?.description ?? '',
      tags: Array.isArray(s?.tags) ? s.tags.join(', ') : (s?.tags ?? ''),
    };
    fnMetaPop = null;
  });
  function toggleFnMetaPop(ev: MouseEvent) {
    if (fnMetaPop) { fnMetaPop = null; return; }
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    fnMetaPop = { x: Math.max(8, Math.min(r.left - 12, window.innerWidth - 296)), y: r.bottom + 8 };
  }
  function fnEditorPos(left: number, bottom: number) {
    return { px: Math.max(8, Math.min(left - 300, window.innerWidth - 580)), py: Math.max(8, Math.min(bottom + 6, window.innerHeight - 440)) };
  }
  // Default open position for the (single) editor: near the top, right-leaning so
  // it sits beside the right inspector (the ~430px panel) rather than over the
  // left sidebar — fixed height, so it doesn't need a content-based vertical spot.
  function editorOpenPos() {
    return { px: Math.max(258, Math.round(window.innerWidth - 1010)), py: 64 };
  }
  function openFnEditor(pname: string | null, set: 'revolve' | 'cartesian', ev: MouseEvent) {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    fnEditor = { target: 'leaf', pname, set, seed: null, ...fnEditorPos(r.left, r.bottom) };
  }
  // EDIT-EXISTING (K.22 D): fetch a saved function profile's source + params and
  // open the editor seeded from it. Save then UPDATES it (same id overwrites).
  function bodyOf(source: string): string {
    // Volume profile sources are full modules — meta + `export function
    // build(p) { ... }`. We want JUST the build body to seed the editor.
    // The old indexOf('{') + lastIndexOf('}') grabbed from the META opener
    // through the function closer, so seed.body ended up containing the
    // meta declarations AND the build wrapper itself; composeSource then
    // wrapped that mess in another `export function build(p) { ... }`,
    // and /api/primitives/profiles/resolve bailed with
    //   Transform failed: Expected ";" but found ":"
    // (the JSON-shaped meta object inside a function body is invalid JS).
    const m = source.match(/export\s+function\s+build\s*\(\s*p\s*\)\s*\{/);
    if (m) {
      const start = (m.index ?? 0) + m[0].length;
      let depth = 1, i = start;
      let inStr: string | null = null;
      while (i < source.length && depth > 0) {
        const ch = source[i]!;
        if (inStr) {
          if (ch === '\\') { i += 2; continue; }
          if (ch === inStr) inStr = null;
          i++; continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; i++; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) break; }
        i++;
      }
      if (depth === 0) return source.slice(start, i).replace(/^\n/, '').replace(/\n\s*$/, '');
    }
    // Legacy fallback — bare bodies (no `export function build(p) { … }`
    // wrapper) saved by older versions of the editor.
    const i = source.indexOf('{'), j = source.lastIndexOf('}');
    return i >= 0 && j > i ? source.slice(i + 1, j).replace(/^\n/, '').replace(/\n\s*$/, '') : source;
  }
  async function editFnProfile(pname: string | null, id: string) {
    try {
      const r = await fetch(`/api/primitives/profiles/source?id=${encodeURIComponent(id)}`);
      if (!r.ok) return;
      const p = await r.json();
      if (!p.source) return; // configured/drawn profile — no build() to edit
      fnEditor = {
        target: 'leaf', pname, set: p.set ?? 'revolve',
        seed: { id: p.id, label: p.label, description: p.description, tags: p.tags, params: p.params, body: bodyOf(p.source) },
        ...editorOpenPos(),
      };
    } catch { /* offline — ignore */ }
  }
  function closeFnEditor() { fnEditor = null; }
  // Derive an editable build() body from a compiled curated profile fn, so a
  // built-in can be forked/edited in the function editor.
  function curatedBody(build: (p: any) => any): string {
    try {
      const s = build.toString();
      const a = s.indexOf('=>');
      if (a < 0) return '';
      const after = s.slice(a + 2).trim();
      if (after.startsWith('{')) return after.slice(1, after.lastIndexOf('}')).trim();
      return 'return ' + after.replace(/;\s*$/, '') + ';';
    } catch { return ''; }
  }
  // ── Unified editor: a part's function profile opens the editor DIRECTLY, with
  // the profile selector in its title bar (no intermediate picker popup). ──────
  // Seed for a CURATED kind (from the registry); null when not curated (→ volume).
  function curatedSeed(kind: string): any {
    const def = PROFILE_REGISTRY[kind];
    if (!def) return null;
    return { id: def.id, label: def.label, description: '', tags: def.tags, params: def.params, body: curatedBody(def.build) };
  }
  // A VOLUME function profile WINS over the same-named curated kind (Option A —
  // consistent with the palette + the part bake): seed the editor from the
  // volume source if one exists for this id, else from the curated registry.
  // Returns null when the kind is neither a volume nor a curated profile.
  async function seedForKind(kind: string): Promise<any> {
    await loadVolProfiles();
    const vol = volProfiles.find((v) => v.id === kind && (v as any).hasSource);
    if (vol) {
      try {
        const r = await fetch(`/api/primitives/profiles/source?id=${encodeURIComponent(kind)}`);
        if (r.ok) { const p = await r.json(); if (p.source) return { id: p.id, label: p.label, description: p.description, tags: p.tags, params: p.params, body: bodyOf(p.source) }; }
      } catch { /* fall through to curated */ }
    }
    return curatedSeed(kind);
  }
  // openInstanceFnEditor / swapEditorProfile / partProfile{Kind,Fn,Loc,
  // ParamsView,Names}, profileSchemaForKind, parseDescriptor, applyPart-
  // ProfileRaw, setPartProfileParamRaw, openProfileSwap / closeProfileSwap /
  // regenRevolveSource / swapPartProfile / leafKindOptions — all served
  // the old composite UI's part-row profile selector + functional editor
  // binding. Removed with the strip.

  async function onFnSaved(id: string) {
    const ed = fnEditor;
    await loadVolProfiles(true);
    if (ed?.target === 'leaf' && ed.pname) pickPaletteProfile(ed.pname, id, 'volume');
    fnEditor = null;
  }

  // ── Parametric profile controls (leaf popup) ──────────────────────────────
  // pending[pname] holds a ProfileDescriptor: parametric { kind, params }, a
  // detached { points } (optionally re-linkable via _gen), or a legacy Pt[].
  function leafDesc(pname: string): any { return (pending[pname] ?? paramSchema[pname]?.default) as any; }
  function leafKindOf(pname: string): string {
    const d = leafDesc(pname);
    return d && typeof d === 'object' && !Array.isArray(d) && 'kind' in d ? d.kind : '';
  }

  // Switch parametric kind. '' = detach to a custom point list (resolve the
  // current shape so the hand-editor starts from what's on screen).
  function setLeafKind(pname: string, kind: string) {
    if (!kind) { pending = { ...pending, [pname]: { points: resolveProfile(leafDesc(pname)) } }; return; }
    const def = PROFILE_REGISTRY[kind];
    const prev = leafDesc(pname);
    const carry = prev && typeof prev === 'object' && 'params' in prev ? prev.params : {};
    const params: Record<string, number> = { ...defaultsFor(def) };
    for (const k in params) if (k in carry) params[k] = carry[k];
    pending = { ...pending, [pname]: { kind, params } };
  }
  function setLeafParam(pname: string, pkey: string, val: number) {
    const d = leafDesc(pname);
    if (!(d && typeof d === 'object' && 'kind' in d)) return;
    pending = { ...pending, [pname]: { kind: d.kind, params: { ...d.params, [pkey]: val } } };
  }
  // A vertex drag/add/delete DETACHES a parametric profile to custom points,
  // keeping the prior kind+params in _gen so it can be re-linked later.
  function setLeafPoints(pname: string, next: [number, number][]) {
    const d = leafDesc(pname);
    const gen = d && typeof d === 'object' && 'kind' in d ? { kind: d.kind, params: d.params } : (d && d._gen);
    pending = { ...pending, [pname]: gen ? { points: next, _gen: gen } : { points: next } };
  }

  // promoteProfile (inline literal → meta.profiles entry) was removed with
  // the old composite editor.

  // The sidebar Load + drag-from-sidebar-to-canvas part scaffolding
  // (loadPrimitive, loadPick, loadable, loadBusy, uniqueInstName,
  // defaultArgFor) — and the per-part delete (deletePart) — were the old
  // composite UI's only entry points; all gone with the strip. .asm.ts
  // assemblies still grow via CompositionEditor's own catalog row.
  let dragOverCanvas = $state(false); // retained as a no-op for the canvas-drop chrome

  // ── Add parameter ("+ param") ───────────────────────────────────────────
  // Splice a new meta.params entry + a function-signature param into the source
  // so this composite exposes a knob a PARENT assembly can drive. Reflected
  // immediately via addedParams/effectiveSchema; Save source persists it.
  let addParamPanel = $state<{ x: number; y: number } | null>(null);
  let apName = $state('');
  let apDefault = $state('1'), apMin = $state('0'), apMax = $state('10'), apStep = $state('0.1');
  let addParamError = $derived.by(() => {
    const n = apName.trim();
    if (!n) return null;
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(n)) return 'not a valid identifier';
    if (n in effectiveSchema) return 'already a param';
    return null;
  });
  function openAddParam(ev: MouseEvent) {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    apName = ''; apDefault = '1'; apMin = '0'; apMax = '10'; apStep = '0.1';
    addParamPanel = {
      x: Math.max(8, Math.min(r.left - 80, window.innerWidth - 300)),
      y: Math.min(r.bottom + 6, window.innerHeight - 260),
    };
  }
  function closeAddParam() { addParamPanel = null; }
  // For `.prim.ts` parts: find the `params: { … }` block in meta + the
  // function signature, return their insert positions (just before each
  // closing brace) so add-param can splice in the new entry + sig token.
  // Returns null when either span can't be located.
  function primParamInsertSpans(): {
    paramsInsertPos: number; paramsHasElems: boolean;
    sigInsertPos: number; sigHasParams: boolean;
  } | null {
    // meta.params { ... } — find the open brace, walk to the matching close.
    const pm = /\bparams\s*:\s*\{/.exec(editedSource);
    if (!pm) return null;
    let i = pm.index + pm[0].length, depth = 1;
    while (i < editedSource.length && depth > 0) {
      const c = editedSource[i++];
      if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    if (depth !== 0) return null;
    const paramsCloseIdx = i - 1;
    const paramsBody = editedSource.slice(pm.index + pm[0].length, paramsCloseIdx);
    const paramsHasElems = /\S/.test(paramsBody) && !/^[\s,]*$/.test(paramsBody);

    // export function <id>(...) — locate the signature's closing paren.
    const fm = new RegExp(`export\\s+function\\s+${id}\\s*\\(`).exec(editedSource);
    if (!fm) return null;
    let j = fm.index + fm[0].length, pdepth = 1;
    while (j < editedSource.length && pdepth > 0) {
      const c = editedSource[j++];
      if (c === '(') pdepth++;
      else if (c === ')') pdepth--;
    }
    if (pdepth !== 0) return null;
    const sigCloseIdx = j - 1;
    const sigBody = editedSource.slice(fm.index + fm[0].length, sigCloseIdx);
    const sigHasParams = /\S/.test(sigBody);
    return { paramsInsertPos: paramsCloseIdx, paramsHasElems, sigInsertPos: sigCloseIdx, sigHasParams };
  }
  function submitAddParam() {
    const n = apName.trim();
    if (!n || addParamError) return;
    const def = Number(apDefault) || 0, mn = Number(apMin) || 0, mx = Number(apMax) || 10, st = Number(apStep) || 0.1;

    // ASM path — no source-offset recognition. Use the composition-tree
    // helper which knows the assembly source shape (meta.params block +
    // `export function <id>(p0, …)` signature). The compose body is
    // auto-regenerated on every save but rewriteAssemblyFunctionBody
    // preserves whatever signature it finds, so this edit sticks.
    if (kind === 'asm') {
      editedSource = addAssemblyParam(editedSource, id, {
        name: n, label: n, min: mn, max: mx, step: st, default: def,
      });
      addedParams = { ...addedParams, [n]: { label: n, type: 'number', min: mn, max: mx, step: st, default: def } };
      applied = { ...applied, [n]: def };
      pending = { ...pending, [n]: def };
      closeAddParam();
      return;
    }

    // PRIM path — regex-locate meta.params + function signature, splice in
    // the new entry + sig token (high→low so earlier offsets stay valid).
    const r = primParamInsertSpans();
    if (!r) return;
    const entry = `${r.paramsHasElems ? ', ' : ''}${n}: { label: '${n}', min: ${mn}, max: ${mx}, step: ${st}, default: ${def} }`;
    const sigParam = `${r.sigHasParams ? ', ' : ''}${n}`;
    const edits = [
      { s: r.paramsInsertPos, e: r.paramsInsertPos, text: entry },
      { s: r.sigInsertPos, e: r.sigInsertPos, text: sigParam },
    ].sort((a, b) => b.s - a.s);
    let out = editedSource;
    for (const ed of edits) out = out.slice(0, ed.s) + ed.text + out.slice(ed.e);
    editedSource = out;
    addedParams = { ...addedParams, [n]: { label: n, type: 'number', min: mn, max: mx, step: st, default: def } };
    applied = { ...applied, [n]: def };
    pending = { ...pending, [n]: def };
    closeAddParam();
  }

  // ── Delete a parameter (✕ on a param card) ───────────────────────────────
  // Splice the param's `name: {…}` meta entry AND its signature token out of
  // the source (each with one adjacent comma), then drop it from the live
  // state maps. Blocks deletion when the function BODY still references the
  // name (would break the build) — same guard spirit as deletePart.
  function spanWithComma(s: number, e: number): { s: number; e: number } {
    let i = e;
    while (i < editedSource.length && /\s/.test(editedSource[i])) i++;
    if (editedSource[i] === ',') return { s, e: i + 1 };           // trailing comma
    let j = s - 1;
    while (j >= 0 && /\s/.test(editedSource[j])) j--;
    if (editedSource[j] === ',') return { s: j, e };               // else leading comma
    return { s, e };
  }
  // Why `name` can't be deleted — referenced in the geom body, or not found.
  // null = deletable. (Deleting a body-referenced param leaves a dangling ref.)
  function paramBlockedReason(name: string): string | null {
    // ASM path — assemblies don't run through recognize-composite. Scan
    // the function body (between the open `{` after the sig and the
    // closing `}`) for an unguarded `<name>` token; if found, refuse so
    // the user clears the reference first.
    if (kind === 'asm') {
      const fnRe = new RegExp(`export\\s+function\\s+${id}\\s*\\(([^)]*)\\)\\s*\\{`);
      const m = editedSource.match(fnRe);
      if (!m) return null; // signature missing — let removeAssemblyParam handle it
      const start = (m.index ?? 0) + m[0].length;
      let depth = 1, i = start;
      while (i < editedSource.length && depth > 0) {
        const ch = editedSource[i++];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
      const body = editedSource.slice(start, i - 1);
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?<![.\\w$])${esc}(?![\\w$])`).test(body)) {
        return `"${name}" — still referenced in the composition; clear those Call args first`;
      }
      return null;
    }
    // PRIM path — locate the `name: { … }` meta entry + the function body via
    // regex, then refuse if the body still references the name.
    const loc = primParamLoc(name);
    if (!loc) return `"${name}" — not found in the source meta`;
    const fnSig = new RegExp(`export\\s+function\\s+${id}\\s*\\(([^)]*)\\)\\s*\\{`).exec(editedSource);
    if (!fnSig) return null;
    const bodyStart = (fnSig.index ?? 0) + fnSig[0].length;
    let bodyDepth = 1, bi = bodyStart;
    while (bi < editedSource.length && bodyDepth > 0) {
      const ch = editedSource[bi++];
      if (ch === '{') bodyDepth++;
      else if (ch === '}') bodyDepth--;
    }
    const body = editedSource.slice(bodyStart, bi - 1);
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![.\\w$])${esc}(?![\\w$])`).test(body)) {
      return `"${name}" — still used in the function body; remove those references first`;
    }
    return null;
  }
  // For `.prim.ts`: locate the meta.params entry `<name>: { … }` + the
  // matching signature token (just the bare identifier between `(` and `)`).
  // Returns null when either side can't be located.
  function primParamLoc(name: string): {
    entryStart: number; entryEnd: number;
    sigStart: number; sigEnd: number;
  } | null {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // meta.params entry — find `name: {` then balance braces.
    const em = new RegExp(`(^|[\\s,{])(${esc})\\s*:\\s*\\{`, 'm').exec(editedSource);
    if (!em) return null;
    const entryStart = em.index + em[1].length;
    let i = em.index + em[0].length, depth = 1;
    while (i < editedSource.length && depth > 0) {
      const c = editedSource[i++];
      if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    if (depth !== 0) return null;
    const entryEnd = i;
    // Signature token — find `<name>` between the function's `(...)`.
    const fm = new RegExp(`export\\s+function\\s+${id}\\s*\\(`).exec(editedSource);
    if (!fm) return null;
    const sigOpen = fm.index + fm[0].length;
    let j = sigOpen, pdepth = 1;
    while (j < editedSource.length && pdepth > 0) {
      const c = editedSource[j++];
      if (c === '(') pdepth++;
      else if (c === ')') pdepth--;
    }
    if (pdepth !== 0) return null;
    const sigCloseIdx = j - 1;
    const sigBody = editedSource.slice(sigOpen, sigCloseIdx);
    const sm = new RegExp(`(?<![.\\w$])${esc}(?![\\w$])`).exec(sigBody);
    if (!sm) return { entryStart, entryEnd, sigStart: -1, sigEnd: -1 };
    return { entryStart, entryEnd, sigStart: sigOpen + sm.index, sigEnd: sigOpen + sm.index + name.length };
  }
  // ✕ on a param card → confirm popup (a native alert/confirm freezes the
  // in-browser automation, so we use a FloatingPanel). Blocked params surface
  // the reason immediately instead of opening the popup.
  let delParamPopup = $state<{ name: string; x: number; y: number } | null>(null);
  function requestDeleteParam(name: string, ev: MouseEvent) {
    if (!canEdit) return;
    const reason = paramBlockedReason(name);
    if (reason) { profileEditNote = `Can't delete ${reason}.`; return; }
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    delParamPopup = {
      name,
      x: Math.max(8, Math.min(r.left - 130, window.innerWidth - 248)),
      y: Math.min(r.bottom + 6, window.innerHeight - 140),
    };
  }
  function performDeleteParam(name: string) {
    if (!canEdit || paramBlockedReason(name)) { delParamPopup = null; return; }
    const drop = <T extends Record<string, any>>(o: T) => { const { [name]: _x, ...rest } = o; return rest as T; };

    // ASM path — composition-tree helper drops both the meta.params row
    // and the matching signature token.
    if (kind === 'asm') {
      editedSource = removeAssemblyParam(editedSource, id, name);
      addedParams = drop(addedParams);
      pending = drop(pending);
      applied = drop(applied);
      removedParams = new Set([...removedParams, name]);
      delParamPopup = null;
      return;
    }

    // PRIM path — regex-locate the entry + sig token, splice them out
    // (high→low so earlier offsets stay valid).
    const loc = primParamLoc(name);
    if (!loc) { delParamPopup = null; return; }
    const edits = [spanWithComma(loc.entryStart, loc.entryEnd)];
    if (loc.sigStart >= 0) edits.push(spanWithComma(loc.sigStart, loc.sigEnd));
    edits.sort((a, b) => b.s - a.s);
    let out = editedSource;
    for (const ed of edits) out = out.slice(0, ed.s) + out.slice(ed.e);
    editedSource = out;
    addedParams = drop(addedParams);
    pending = drop(pending);
    applied = drop(applied);
    removedParams = new Set([...removedParams, name]); // hide from the grid now
    delParamPopup = null;
  }

  // ── Delete a part (✕) ───────────────────────────────────────────────────
  // Remove the instance's `const X = …;` declaration + splice it out of the
  // composition (mid-chain `.op(X)` removed; base operand → next promoted).
  // Leaves an unused meta.uses dep (harmless). Edits the buffer only —
  // Revert/reload undoes; Save source persists.
  // ── Drag-reorder (new-style assemblies) ─────────────────────────────────
  // HTML5 drag inside the Parts accordion. A row drag → drop on another
  // row → splice the source row to the target row's position in
  // meta.instances and re-emit. Only active for assemblies that have a
  // meta.instances block (the new architecture); legacy bodies fall
  // through and stay non-reorderable.
  // K.63 M2.5: the entire assembly-instances state + helpers block lived
  // here (isAsmInstanced, filteredAsmParts, topLevelGroups, topLevelImports,
  // topLevelExpressions, partsSub, dragOverInstance, csgOpPopup,
  // addPartPopup, subtabCount, deleteImportOrExpression, deleteAssemblyGroup,
  // dropInstanceIntoGroup, promoteInstanceToTop, moveAssemblyInstance,
  // addPartFromPopup, addExpressionRowFromPopup, updateExpressionRow,
  // addEmptyGroupFromPopup, currentModeForInstance, anchorChoicesFor,
  // setInstanceMode/Anchor/At, applyInstancePatch, readInstanceField).
  // All deleted — .asm.ts files route to CompositionEditor.

  // deletePart, the per-arg ƒ expression picker (fxEdit / openFx /
  // openProfileFx / applyFx), the warp-at-end tools, and loadPrimitive (the
  // sidebar-drag-to-canvas scaffolder) were all owned by the old composite
  // UI. Removed with the strip.

  // ── AI tab ───────────────────────────────────────────────────────────
  // Mirrors the /components inspector AI tab. Talks directly to the
  // /api/primitives/{refine,prompts,instructions} endpoints (this view is
  // primitive-specific, so the no-API convention is relaxed just here).
  // Only shown for editable (volume) primitives — bundle primitives have
  // no on-volume <id>/ dir to hold prompts.json / instructions.md.
  let aiSub = $state<'prompt' | 'history'>('prompt');
  let aiPrompt = $state('');
  let aiStatus = $state<'idle' | 'sending' | 'pending' | 'error'>('idle');
  let aiProposal = $state<string | null>(null);
  let aiError = $state<string | null>(null);
  let aiHistory = $state<Array<{ prompt: string; ts: number; accepted?: boolean }>>([]);
  let instr = $state('');
  let instrStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
  let aiLoaded = $state(false);

  async function loadAi() {
    if (aiLoaded) return;
    aiLoaded = true;
    try {
      const r = await fetch(`/api/primitives/prompts?id=${encodeURIComponent(id)}`);
      if (r.ok) { const d = await r.json(); aiHistory = Array.isArray(d?.history) ? d.history : []; }
    } catch { /* no history yet */ }
    try {
      const r = await fetch(`/api/volume?path=${encodeURIComponent(`primitives/${id}/instructions.md`)}`, { cache: 'no-store' });
      if (r.ok) instr = await r.text();
    } catch { /* no instructions yet */ }
  }
  // Lazy-load history + instructions the first time the AI tab is opened.
  $effect(() => { if (tab === 'ai') loadAi(); });

  async function persistHistory() {
    try {
      await fetch('/api/primitives/prompts', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, history: aiHistory }),
      });
    } catch { /* best-effort */ }
  }

  async function submitRefine() {
    const prompt = aiPrompt.trim();
    if (!prompt || aiStatus === 'sending') return;
    aiStatus = 'sending';
    aiError = null;
    aiProposal = null;
    try {
      const r = await fetch('/api/primitives/refine', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, source: editedSource, prompt, instructions: instr }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) { aiStatus = 'error'; aiError = d?.error || `HTTP ${r.status}`; return; }
      aiProposal = d.source;
      aiStatus = 'pending';
    } catch (e: any) {
      aiStatus = 'error'; aiError = e?.message ?? String(e);
    }
  }
  function acceptProposal() {
    if (aiProposal == null) return;
    editedSource = aiProposal;
    aiHistory = [...aiHistory, { prompt: aiPrompt.trim(), ts: Date.now(), accepted: true }];
    aiProposal = null; aiStatus = 'idle'; aiPrompt = '';
    persistHistory();
  }
  function rejectProposal() {
    aiHistory = [...aiHistory, { prompt: aiPrompt.trim(), ts: Date.now(), accepted: false }];
    aiProposal = null; aiStatus = 'idle';
    persistHistory();
  }
  async function saveInstructions() {
    instrStatus = 'saving';
    try {
      const r = await fetch('/api/primitives/instructions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, instructions: instr }),
      });
      instrStatus = r.ok ? 'saved' : 'error';
    } catch { instrStatus = 'error'; }
  }

  // Polygon params travel to the server as JSON strings; scalars as
  // numbers. Order follows the meta param-order.
  let appliedArgs = $derived(paramOrder.map((k) => {
    const v = applied[k] ?? effectiveSchema[k].default;
    // Polygon params may hold a PARAMETRIC descriptor ({kind,params}) or a
    // detached {points} — resolve to a plain polygon before sending so the
    // primitive body (r_extrude/r_revolve) JSON.parses a Pt[] exactly as before.
    if (effectiveSchema[k].type === 'polygon') return JSON.stringify(resolveProfile(v as any));
    return v as number;
  }));

  // Dirty if any scalar mismatches OR any polygon's JSON serialization
  // differs (cheap structural compare via stringify).
  let paramsDirty = $derived(
    paramOrder.some((k) => {
      const p = pending[k] ?? effectiveSchema[k].default;
      const a = applied[k] ?? effectiveSchema[k].default;
      if (effectiveSchema[k].type === 'polygon') return JSON.stringify(p) !== JSON.stringify(a);
      return p !== a;
    }),
  );
  let sourceDirty = $derived(editedSource !== serverSource);
  // The APPLIED (committed, live-rendered) values differ from the source's
  // `default:` literals → "Save defaults" would persist a change. Without this
  // a param edit committed on Enter (pending===applied) read as "in sync" even
  // though the rendered value no longer matched the saved default.
  let defaultsDirty = $derived(
    paramOrder.some((k) => {
      const a = applied[k] ?? effectiveSchema[k].default;
      const d = effectiveSchema[k].default;
      if (effectiveSchema[k].type === 'polygon') return JSON.stringify(a) !== JSON.stringify(d);
      return a !== d;
    }),
  );

  function setPending(k: string, v: number) { pending = { ...pending, [k]: v }; }
  function apply() { applied = { ...pending }; }
  function revert() { pending = { ...applied }; }
  // Commit a single param (Enter / drag-scrub / enum / boolean) — mirrors
  // the /components prop-card behaviour where each param commits on its own
  // Enter or drag rather than waiting for a global Apply.
  function commitOne(k: string, v: number) {
    pending = { ...pending, [k]: v };
    applied = { ...applied, [k]: v };
  }

  let saving = $state(false);
  async function saveSource() {
    if (!onSaveSource) return;
    saving = true;
    try {
      // For assemblies — if meta.dependencies is missing or empty AND
      // meta.uses has entries, capture a baseline snapshot before saving.
      // Without this baseline the warning chip can never fire (there's
      // nothing to compare against). Done once per assembly at first save;
      // subsequent saves leave existing snapshots alone unless the user
      // explicitly clicks "Update snapshots" on the chip.
      let toSave = editedSource;
      if ((kind === 'asm' || kind === 'prim') && parseDependencies(toSave).length === 0) {
        const ids = parseUses(toSave);
        if (ids.length > 0) {
          const liveSources: Record<string, string> = {};
          for (const id of ids) {
            try {
              const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(id)}`);
              if (r.ok) liveSources[id] = (await r.json()).source ?? '';
            } catch { /* ignore */ }
          }
          const fresh = buildSnapshots(ids, liveSources);
          toSave = writeDependencies(toSave, fresh);
          editedSource = toSave;
        }
      }
      await onSaveSource(toSave);
    } finally { saving = false; }
  }
  async function saveDefaults() {
    if (!onSaveDefaults) return;
    saving = true;
    try { await onSaveDefaults(applied); } finally { saving = false; }
  }
  /** Inline default-rewriter — duplicates the parent's rewriteDefaultsInSource
   *  so we can build the combined save payload (editedSource + applied
   *  defaults) without round-tripping through the parent's serverSource path.
   *  Matches `<paramName>: { …, default: <number>, … }` and swaps the number. */
  function rewriteDefaultsInline(src: string, applied: Record<string, number | unknown>): string {
    let out = src;
    for (const [pname, value] of Object.entries(applied)) {
      if (typeof value !== 'number') continue;
      const re = new RegExp(`(\\b${pname}\\s*:\\s*\\{[^}]*\\bdefault\\s*:\\s*)-?\\d+(?:\\.\\d+)?`, 'g');
      out = out.replace(re, `$1${value}`);
    }
    return out;
  }
  /** Combined save for the TYPED-BUILDER save chip:
   *   * source-only dirty → write editedSource as-is.
   *   * defaults-only dirty → write serverSource with applied rewritten in.
   *   * BOTH dirty → write editedSource with applied rewritten in. (Was
   *     deferring to saveDefaults which uses serverSource — and dropped the
   *     source edits in the process.) */
  async function saveTyped() {
    if (!onSaveSource) return;
    if (!sourceDirty && !defaultsDirty) return;
    saving = true;
    try {
      let src = editedSource;
      if (defaultsDirty) src = rewriteDefaultsInline(src, applied);
      await onSaveSource(src);
      // Sync editedSource to the persisted shape — otherwise sourceDirty
      // (editedSource !== serverSource) stays true after a defaults-only
      // save because we wrote `src` (rewritten) but editedSource still
      // holds the pre-rewrite version. Parent's saveSourceFor will set
      // serverSource = src on success; we set editedSource = src here.
      editedSource = src;
    } finally { saving = false; }
  }
  // Combined dirty signal for the typed-builder save chip — true when EITHER
  // the source diverges from the server OR the user has changed default
  // param values since open.
  let combinedDirty = $derived(sourceDirty || defaultsDirty);

  // ── Assembly dependency-change warnings (K.56 Phase 2) ──────────────────
  // For kind === 'asm' parts, fetch each component listed in meta.uses,
  // compare its current source vs the snapshot stored in meta.dependencies,
  // and surface a yellow chip on the canvas when something drifted (params
  // added/removed/reordered, body hash changed). Click chip → confirm →
  // writes a fresh snapshot block via writeDependencies + marks dirty.
  let depDiffs = $state<DependencyDiff[]>([]);
  let depWarnPanel = $state<{ x: number; y: number } | null>(null);
  let depCheckSeq = $state(0);
  // Per-session cache of fetched dep sources so repeat checks don't re-hit
  // the network. Cleared when the user clicks "Update snapshots" so a fresh
  // probe of the live components fires.
  let depSourceCache = $state<Record<string, string>>({});
  // Debounce timer for the editedSource-driven check — without this every
  // keystroke fires N fetches.
  let depCheckTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    if (kind !== 'asm' && kind !== 'prim') return;
    const src = editedSource;
    if (!src) return;
    if (depCheckTimer) clearTimeout(depCheckTimer);
    depCheckTimer = setTimeout(() => {
      const ids = parseUses(src);
      if (ids.length === 0) { depDiffs = []; return; }
      const snapshots = parseDependencies(src);
      if (snapshots.length === 0) { depDiffs = []; return; }
      const seq = ++depCheckSeq;
      (async () => {
        const liveSources: Record<string, string> = { ...depSourceCache };
        const missing = ids.filter((id) => !(id in liveSources));
        for (const id of missing) {
          try {
            const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(id)}`);
            if (r.ok) liveSources[id] = (await r.json()).source ?? '';
          } catch { /* ignore */ }
        }
        if (seq !== depCheckSeq) return;     // stale
        depSourceCache = liveSources;
        depDiffs = diffDependencies(snapshots, liveSources).filter((d) => !d.ok);
      })();
    }, 1200);
  });
  // The yellow chip click → confirm → rewrite snapshots. Also clears the
  // dep-source cache so a fresh probe runs on the next debounced tick.
  function refreshDepSnapshots() {
    const ids = parseUses(editedSource);
    if (ids.length === 0) return;
    (async () => {
      const liveSources: Record<string, string> = {};
      for (const id of ids) {
        try {
          const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(id)}`);
          if (r.ok) liveSources[id] = (await r.json()).source ?? '';
        } catch { /* ignore */ }
      }
      depSourceCache = liveSources;
      const fresh = buildSnapshots(ids, liveSources);
      editedSource = writeDependencies(editedSource, fresh);
      depDiffs = [];
      depWarnPanel = null;
    })();
  }

  // ── Save As… popup ────────────────────────────────────────────────────
  // "File → Save As": persist the CURRENT editor buffer (editedSource —
  // INCLUDING unsaved edits like a just-changed profile) under a NEW id,
  // creating a new primitive. The original (this id) is untouched. Differs
  // from the route page's Duplicate, which clones the SAVED source.
  // FloatingPanel popup anchored to the trigger; commits on Enter.
  const ID_RE = /^[a-z][a-z0-9_]*$/i;
  let saveAsOpen = $state(false);
  let saveAsId = $state('');
  let saveAsX = $state(0);
  let saveAsY = $state(0);
  let saveAsBusy = $state(false);
  // Existing ids (this primitive's catalog) for the collision guard. The
  // catalog is the merged list + tests passed from the route; fall back to
  // at least excluding our own id.
  let existingIds = $derived(new Set<string>((catalog ?? []).map((e) => e.id)));
  // Default suggestion: `<id>_copy`, bumping a suffix until it's free.
  function suggestSaveAsId(): string {
    let cand = `${id}_copy`;
    let i = 2;
    while (existingIds.has(cand)) { cand = `${id}_copy${i}`; i++; }
    return cand;
  }
  // Live validation message (null = ok). Order: format → collision.
  let saveAsError = $derived.by(() => {
    const v = saveAsId.trim();
    if (!v) return null;                                // empty → no error yet, just disabled
    if (!ID_RE.test(v)) return 'Letters, digits, underscores; must start with a letter.';
    if (v === id) return 'Same as the current id — pick a different name.';
    if (existingIds.has(v)) return `"${v}" already exists — pick another name.`;
    return null;
  });
  let saveAsValid = $derived(!!saveAsId.trim() && saveAsError === null);
  function openSaveAs(ev: MouseEvent) {
    saveAsId = suggestSaveAsId();
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    // Anchor below-left of the trigger, clamped into the viewport.
    saveAsX = Math.max(8, Math.min(rect.left - 60, window.innerWidth - 320));
    saveAsY = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 200));
    saveAsOpen = true;
  }
  function closeSaveAs() { saveAsOpen = false; }
  async function confirmSaveAs() {
    if (!onSaveAs || !saveAsValid || saveAsBusy) return;
    saveAsBusy = true;
    try {
      const ok = await onSaveAs(saveAsId.trim(), editedSource);
      if (ok) closeSaveAs();
    } finally {
      saveAsBusy = false;
    }
  }

  // Drag-to-resize the right panel. Width is held in component state
  // and clamped to a sensible range so the user can't drag it off
  // either edge.
  let sideWidth = $state(420);
  let dragging = $state(false);
  function beginDrag(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = true;
  }
  function endDrag(e: PointerEvent) {
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    dragging = false;
  }
  function dragMove(e: PointerEvent) {
    if (!dragging) return;
    const container = (e.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const next = rect.right - e.clientX;
    sideWidth = Math.max(260, Math.min(900, next));
  }
</script>

<!-- Profile shape-icon: a tiny SVG that DRAWS the profile, with a hover tooltip
     ("profile") + a larger shape preview. The click action is owned by the
     wrapping button (opens the ✎ popup). `revolve` (default true) mirrors the
     half-section across r=0 so a tube shows its ID gap (matches ProfilePalette). -->
{#snippet shapeIcon(pts: [number, number][] | null | undefined, revolve: boolean = true)}
  <span class="pv-shape-ic" aria-hidden="true">
    {#if pts && pts.length >= 2}
      <svg viewBox="0 0 18 18" width="18" height="18">
        <path d={pathFor(pts, 18, 1.5, revolve)} fill="rgba(34,102,204,0.18)" stroke="#2266cc" stroke-width="1" stroke-linejoin="round" />
      </svg>
    {:else}
      <svg viewBox="0 0 18 18" width="18" height="18"><path d="M3 14 L9 4 L15 14 Z" fill="none" stroke="#2266cc" stroke-width="1" stroke-linejoin="round" /></svg>
    {/if}
    <span class="pv-shape-tip" role="tooltip">
      <span class="pv-shape-tip-label">profile</span>
      {#if pts && pts.length >= 2}
        <svg class="pv-shape-tip-svg" viewBox="0 0 72 72" width="72" height="72">
          <path d={pathFor(pts, 72, 6, revolve)} fill="rgba(34,102,204,0.15)" stroke="#2266cc" stroke-width="1.4" stroke-linejoin="round" />
        </svg>
      {/if}
    </span>
  </span>
{/snippet}

<div class="pv-root" use:tipHost>
  {#if kind === 'exp'}
    <!-- Typed dispatch: .exp.ts → ExtrudePartBuilder (embedded ProfileFnEditor
         in cartesian mode + dual canvas). Bypasses the AssemblyEditor layout
         entirely; the builder owns the full pv-root area.
         dirty + onSaveRequest wire the existing source-dirty + saveSource
         machinery through so the embedded editor's save chip works without
         duplicating that state. -->
    <!-- IMPORTANT: pass `appliedArgs` (paramOrder-aligned) not
         `Object.values(applied)` — keys inserted in non-meta order would
         pass args in the wrong slots and cause downstream errors like
         'profile needs ≥ 3 points' when sides arrives in the position
         meant for length. -->
    <ExtrudePartBuilder
      {id} {name} {description}
      source={editedSource}
      args={appliedArgs as (number | string)[]}
      paramSchema={effectiveSchema}
      onSourceChange={(s) => { editedSource = s; }}
      onParamsChange={(values) => { applied = { ...applied, ...values }; pending = { ...pending, ...values }; }}
      dirty={combinedDirty}
      onSaveRequest={saveTyped}
    />
  {:else if kind === 'rev'}
    <!-- Typed dispatch: .rev.ts → RevolvePartBuilder. -->
    <RevolvePartBuilder
      {id} {name} {description}
      source={editedSource}
      args={appliedArgs as (number | string)[]}
      paramSchema={effectiveSchema}
      onSourceChange={(s) => { editedSource = s; }}
      onParamsChange={(values) => { applied = { ...applied, ...values }; pending = { ...pending, ...values }; }}
      dirty={combinedDirty}
      onSaveRequest={saveTyped}
    />
  {:else}
  <div class="pv-split" style="--side-width: {sideWidth}px;">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="pv-canvas-pane"
      class:pv-drop-ok={dragOverCanvas}
      role="application"
      ondragleave={() => { dragOverCanvas = false; }}
    >
      <!-- Always pass `source` so the preview runs through the sandbox
           path (which has a first-export fallback when the function
           name differs from the directory id, e.g. dir
           `profile_extrude_v2` containing `export function profile_extrude`).
           The bundle fast-path can't handle that mismatch. -->
      <PrimitiveDualCanvas {id} {name} {description} args={appliedArgs} source={editedSource} showLabels={false} />
      <!-- Assembly dependency-change warning chip (K.56 Phase 2). Shows when
           a component referenced in meta.uses has changed since the
           snapshot recorded in meta.dependencies. Click → mini-panel with
           per-component drift + an Update-snapshots action that rewrites
           the assembly source and marks dirty. -->
      {#if depDiffs.length > 0 && (kind === 'asm' || kind === 'prim')}
        <button class="pv-dep-warn" type="button"
          title="{depDiffs.length} component{depDiffs.length > 1 ? 's' : ''} changed since this assembly was created"
          onclick={(ev) => { const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(); depWarnPanel = { x: r.left, y: r.bottom + 4 }; }}
        >
          ⚠ {depDiffs.length}
        </button>
        {#if depWarnPanel}
          <div class="pv-dep-pop-back" role="presentation" onclick={() => (depWarnPanel = null)}></div>
          <div class="pv-dep-pop" style="left: {depWarnPanel.x}px; top: {depWarnPanel.y}px;">
            <div class="pv-dep-pop-title">Components changed since snapshot</div>
            <div class="pv-dep-pop-list">
              {#each depDiffs as d (d.id)}
                <div class="pv-dep-row">
                  <div class="pv-dep-id">{d.id}</div>
                  <ul class="pv-dep-bullets">
                    {#if d.paramKeysAdded.length}<li>params added: <code>{d.paramKeysAdded.join(', ')}</code></li>{/if}
                    {#if d.paramKeysRemoved.length}<li>params removed: <code>{d.paramKeysRemoved.join(', ')}</code></li>{/if}
                    {#if d.paramKeysReordered}<li>params reordered</li>{/if}
                    {#if d.bodyHashChanged && !d.paramKeysAdded.length && !d.paramKeysRemoved.length && !d.paramKeysReordered}<li>body changed</li>{/if}
                  </ul>
                </div>
              {/each}
            </div>
            <div class="pv-dep-pop-acts">
              <button class="pv-dep-pop-act primary" type="button" onclick={refreshDepSnapshots}>Update snapshots</button>
              <button class="pv-dep-pop-act" type="button" onclick={() => (depWarnPanel = null)}>Close</button>
            </div>
          </div>
        {/if}
      {/if}
    </div>

    <div
      class="pv-resizer"
      class:dragging
      role="separator"
      aria-orientation="vertical"
      onpointerdown={beginDrag}
      onpointermove={dragMove}
      onpointerup={endDrag}
      onpointercancel={endDrag}
    ></div>

    <aside class="pv-side">
      <!-- SHARED action bar (one instance, shown on every tab — no per-pane
           duplication): dirty status + Reload / Save defaults / Save As /
           Save / Duplicate / Delete as icon buttons w/ tooltips. -->
      {#snippet actBtn(p: { title: string; d: string; onClick: () => void; disabled?: boolean; danger?: boolean; dirty?: boolean })}
        <button class="pv-act" class:danger={p.danger} class:dirty={p.dirty} type="button" title={p.title} aria-label={p.title} disabled={p.disabled} onclick={p.onClick}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={p.d} /></svg>
        </button>
      {/snippet}
      <div class="pv-actionbar">
        {#if onReloadSource}{@render actBtn({ title: 'Reload from the saved version (discard edits)', d: 'M21 12a9 9 0 1 1-2.64-6.36M21 4v4h-4', onClick: () => onReloadSource?.() })}{/if}
        {#if onSaveDefaults}{@render actBtn({ title: 'Save current parameter values as the defaults', d: 'M12 3v12m0 0 4-4m-4 4-4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2', onClick: saveDefaults, disabled: !editable || saving || !defaultsDirty, dirty: defaultsDirty && !sourceDirty })}{/if}
        {#if onSaveAs}{@render actBtn({ title: 'Save the current edits as a NEW primitive (original untouched)', d: 'M19 13V8l-5-5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h7M17 17v5m2.5-2.5h-5', onClick: openSaveAs })}{/if}
        {#if canEdit && onSaveSource}{@render actBtn({ title: 'Save source', d: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2ZM17 21v-8H7v8M7 3v5h8', onClick: saveSource, disabled: saving || !sourceDirty, dirty: sourceDirty })}{/if}
        {#if onDuplicate}{@render actBtn({ title: 'Duplicate to a new editable volume primitive', d: 'M9 8v3a1 1 0 0 1-1 1H5m11 4h2a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v1m4 3v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7.13a1 1 0 0 1 .24-.65L7.7 8.35A1 1 0 0 1 8.46 8H13a1 1 0 0 1 1 1Z', onClick: () => onDuplicate?.() })}{/if}
        {#if onDelete}{@render actBtn({ title: 'Delete (archive) this primitive', d: 'M5 7h14m-9 3v8m4-8v8M10 3h4a1 1 0 0 1 1 1v3H9V4a1 1 0 0 1 1-1ZM6 7h12v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7Z', onClick: () => onDelete?.(), danger: true })}{/if}
        <div class="pv-spacer"></div>
        <span class="pv-pill" class:dirty={paramsDirty || sourceDirty || defaultsDirty}>
          {paramsDirty ? 'params pending — Enter to apply' : sourceDirty ? 'source edited' : defaultsDirty ? 'values changed' : 'in sync'}
        </span>
      </div>

      <!-- Body: VERTICAL tab rail (left) + the active pane (right). -->
      <div class="pv-body">
        <div class="pv-tabrail" role="tablist">
          <button class="pv-vtab" class:active={tab === 'build'} onclick={() => (tab = 'build')} type="button" role="tab" title="Build">
            <span class="pv-ic">⚙</span><span class="pv-vtab-lbl">Build</span>
            {#if paramsDirty || sourceDirty || defaultsDirty}<span class="pv-dot"></span>{/if}
          </button>
          <button class="pv-vtab" class:active={tab === 'source'} onclick={() => (tab = 'source')} type="button" role="tab" title="Source">
            <span class="pv-ic">🛠</span><span class="pv-vtab-lbl">Source</span>
            {#if sourceDirty}<span class="pv-dot"></span>{/if}
          </button>
          {#if editable}
            <button class="pv-vtab" class:active={tab === 'ai'} onclick={() => (tab = 'ai')} type="button" role="tab" title="AI">
              <span class="pv-ic">✦</span><span class="pv-vtab-lbl">AI</span>
            </button>
          {/if}
        </div>
        <div class="pv-tabcontent">

      {#if tab === 'build'}
        <!-- Merged Build tab — Parameters section (ParamGrid + leaf polygon
             ✎ popups) on top, then ONE collapsible accordion row per
             recognized part (args + transform chain + ✎ profile inside).
             Mirrors the /components inspector accordion (.pg-acc-* + .pr-card). -->
        <div class="pv-pane pv-build">

          {#if !editable}
            <div class="pv-readonly-note">
              🔒 Built-in <strong>stdlib</strong> primitive — read-only. Edit it in <code>src/lib/cad/stdlib/</code> + redeploy, or <strong>Duplicate</strong> to fork an editable volume copy. Tweaking params here just previews (won't save).
            </div>
          {/if}

          <div class="pv-build-body">
            <!-- Parameters section: scalar/enum/bool via ParamGrid, polygon
                 leaf params get a ✎ popup card. -->
            <div class="pg-acc-wrap">
              <div class="pg-acc-head" class:collapsed={!isOpen('__params__')}
                role="button" tabindex="0"
                aria-expanded={isOpen('__params__')}
                onclick={() => togglePart('__params__')}
                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePart('__params__'); } }}>
                <button class="pv-pin" class:pinned={pinnedParts.has('__params__')} type="button" title={pinnedParts.has('__params__') ? 'Unpin (allow collapse)' : 'Pin open (stays open while other rows open)'} onclick={(e) => { e.stopPropagation(); togglePin('__params__'); }}>📌</button>
                <span class="pg-acc-title">Parameters</span>
                {#if paramsDirty}<span class="pv-dot"></span>{/if}
                <div class="pv-spacer"></div>
                <button class="pv-mini-btn" type="button" onclick={(e) => { e.stopPropagation(); apply(); }} disabled={!paramsDirty} title="Apply pending params → re-bake">Apply</button>
                <button class="pv-mini-btn" type="button" onclick={(e) => { e.stopPropagation(); revert(); }} disabled={!paramsDirty} title="Discard pending param edits">Revert</button>
                {#if canEdit}
                  <button class="pv-mini-btn" type="button" onclick={(e) => { e.stopPropagation(); openAddParam(e); }} title="Add a parameter — exposes a knob a parent assembly can drive">＋ param</button>
                {/if}
              </div>
              {#if isOpen('__params__')}
                <div class="pg-acc-body">
                  <ParamGrid
                    schema={effectiveSchema}
                    {pending}
                    {applied}
                    onPending={setPending}
                    onCommit={commitOne}
                    onDelete={canEdit ? requestDeleteParam : undefined}
                    variant="fn"
                  />
                  <!-- Polygon leaf params — ParamGrid skips these; each gets a
                       ✎ card that opens the ProfileEditor in a popup (editing
                       pending; Apply commits → re-bake). -->
                  {#each polygonParamNames as pname (pname)}
                    {@const cardPts = resolveProfile((pending[pname] ?? effectiveSchema[pname].default) as any)}
                    {@const cardKind = leafKindOf(pname)}
                    {@const cardRevolve = !!effectiveSchema[pname]?.yDown}
                    <div class="pr-card pv-poly-card" class:dirty={JSON.stringify(pending[pname] ?? []) !== JSON.stringify(applied[pname] ?? [])}>
                      <span class="pr-keyname" title={paramSchema[pname].label ?? pname}>{paramSchema[pname].label ?? pname}</span>
                      <span class="pv-poly-verts">{cardKind ? cardKind : `${cardPts.length} verts`}</span>
                      <div class="pv-spacer"></div>
                      <button class="pv-part-profile" type="button" title="Edit this profile in a popup" onclick={(e) => openLeafProfile(pname, e)}>{@render shapeIcon(cardPts, cardRevolve)}<span class="pv-part-profile-lbl">profile</span></button>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>

            <!-- SOFT, non-fatal notice (e.g. a leaf profile we can't draw).
                 Shown above whatever comes next; dismissible. -->
            {#if profileEditNote}
              <div class="pv-parts-note pv-soft-note" role="status">
                <span>{profileEditNote}</span>
                <button class="pv-soft-note-x" type="button" aria-label="Dismiss" title="Dismiss" onclick={() => (profileEditNote = null)}>×</button>
              </div>
            {/if}

            {#if kind === 'asm'}
              <!-- K.63 — .asm.ts files use the composition-tree editor. -->
              <CompositionEditor
                source={editedSource}
                {id}
                {canEdit}
                {catalog}
                onSourceChange={(s) => editedSource = s}
              />
            {/if}
            <!-- For .prim.ts + stdlib (default kind branch) the Parameters
                 accordion above is the entire Build pane. The old composite
                 Parts panel (recognized instances + per-row swatches /
                 transforms / profile selector / delete / construction tree /
                 warp) is gone — view the body in the Source tab to edit it. -->
          </div>
        </div>
      {:else if tab === 'ai'}
        <div class="pv-pane pv-ai">
          <div class="pv-pane-head">
            <button class="pv-subtab" class:active={aiSub === 'prompt'} onclick={() => (aiSub = 'prompt')} type="button">Prompt</button>
            <button class="pv-subtab" class:active={aiSub === 'history'} onclick={() => (aiSub = 'history')} type="button">History · {aiHistory.length}</button>
          </div>
          <div class="pv-ai-body">
            {#if aiSub === 'prompt'}
              <div class="pv-ai-sec">
                <div class="pv-ai-h">Refine source</div>
                <textarea class="pv-ai-prompt" rows="3" bind:value={aiPrompt} placeholder="Describe the change… e.g. 'add a chamfer param to the bore'"></textarea>
                <div class="pv-ai-row">
                  <button class="pv-btn primary" type="button" disabled={aiStatus === 'sending' || aiStatus === 'pending' || !aiPrompt.trim()} onclick={submitRefine}>
                    {aiStatus === 'sending' ? '✦ Refining…' : '✦ Refine source'}
                  </button>
                  {#if aiStatus === 'error'}<span class="pv-ai-err">{aiError}</span>{/if}
                </div>
                {#if aiProposal != null}
                  <div class="pv-ai-proposal">
                    <div class="pv-ai-h">Proposed source</div>
                    <pre class="pv-ai-pre">{aiProposal}</pre>
                    <div class="pv-ai-row">
                      <button class="pv-btn primary" type="button" onclick={acceptProposal}>Accept → Source</button>
                      <button class="pv-btn" type="button" onclick={rejectProposal}>Reject</button>
                    </div>
                    <p class="pv-ai-note">Accept loads it into the Source tab — review + Save source to persist.</p>
                  </div>
                {/if}
              </div>
              <div class="pv-ai-sec">
                <div class="pv-ai-h">Instructions <span class="pv-ai-sub">(sent with each refine)</span></div>
                <textarea class="pv-ai-prompt" rows="6" bind:value={instr} placeholder="Persistent notes about this primitive — vocabulary, constraints, conventions…"></textarea>
                <div class="pv-ai-row">
                  <button class="pv-btn" type="button" disabled={instrStatus === 'saving'} onclick={saveInstructions}>{instrStatus === 'saving' ? 'Saving…' : instrStatus === 'saved' ? 'Saved ✓' : 'Save instructions'}</button>
                </div>
              </div>
            {:else}
              {#if aiHistory.length === 0}
                <div class="pv-ai-empty">No prompts yet.</div>
              {:else}
                <div class="pv-ai-hist">
                  {#each [...aiHistory].reverse() as h (h.ts)}
                    <button class="pv-ai-hrow" type="button" onclick={() => { aiPrompt = h.prompt; aiSub = 'prompt'; }}>
                      <span class="pv-ai-hmark" class:ok={h.accepted === true} class:no={h.accepted === false}>{h.accepted === true ? '✓' : h.accepted === false ? '✗' : '·'}</span>
                      <span class="pv-ai-hprompt">{h.prompt}</span>
                    </button>
                  {/each}
                </div>
              {/if}
            {/if}
          </div>
        </div>
      {:else}
        <div class="pv-pane pv-source">
          <div class="pv-editor-wrap">
            <CodeEditor
              value={editedSource}
              lang="typescript"
              readonly={!editable}
              variant="default"
              onChange={(next) => { editedSource = next; }}
              onSave={editable ? () => saveSource() : undefined}
            />
          </div>
        </div>
      {/if}
        </div>
      </div>
    </aside>
  </div>

  <!-- The composite per-instance profileEdit FloatingPanel + warpPathEdit
       FloatingPanel were removed with the strip. -->

  {#if saveProfilePanel}
    <FloatingPanel title="Save profile → volume" visible={true} x={saveProfilePanel.px} y={saveProfilePanel.py} width="280px" onClose={closeSaveProfile}>
      <div class="pv-saveprof">
        <label class="pv-saveprof-row">id <input bind:value={saveProfilePanel.id} spellcheck="false" placeholder="my_flange" /></label>
        <label class="pv-saveprof-row">label <input bind:value={saveProfilePanel.label} spellcheck="false" placeholder="My Flange" /></label>
        {#if saveProfileErr}<div class="pv-saveprof-err">{saveProfileErr}</div>{/if}
        <div class="pv-saveprof-foot">
          <span class="pv-saveprof-note">→ <code>primitives/profiles/</code></span>
          <div class="pv-spacer"></div>
          <button class="pv-btn" type="button" onclick={closeSaveProfile}>Cancel</button>
          <button class="pv-btn primary" type="button" disabled={saveProfileBusy} onclick={submitSaveProfile}>{saveProfileBusy ? '…' : 'Save'}</button>
        </div>
      </div>
    </FloatingPanel>
  {/if}

  {#if leafEdit}
    {@const ps = paramSchema[leafEdit.pname]}
    {@const yd = ps.yDown ?? false}
    {@const lkind = leafKindOf(leafEdit.pname)}
    {@const lpts = resolveProfile(leafDesc(leafEdit.pname))}
    <FloatingPanel
      title={`Profile · ${ps.label ?? leafEdit.pname}`}
      visible={true}
      x={leafEdit.px}
      y={leafEdit.py}
      width="min(360px, 92vw)"
      maxHeight="70vh"
      onClose={closeLeafProfile}
    >
      <div class="pv-profile-pop">
        <!-- One bar: searchable shape dropdown + actions (no separate head). -->
        <div class="pv-prof-bar">
          <div class="pv-prof-combo">
            <ProfilePalette layout="dropdown" set={yd ? 'revolve' : 'cartesian'} current={lkind} volume={volProfiles} onPick={(id, origin) => pickPaletteProfile(leafEdit!.pname, id, origin)} onEdit={(id) => editFnProfile(leafEdit!.pname, id)} />
          </div>
          <button class="pv-iconbtn" type="button" title="Save this profile to the volume" onclick={(e) => openSaveProfile(leafEdit!.pname, e)}>＋</button>
          <button class="pv-iconbtn" type="button" title="Author a function profile (params + build())" onclick={(e) => openFnEditor(leafEdit!.pname, yd ? 'revolve' : 'cartesian', e)}>ƒ+</button>
          <button class="pv-iconbtn" type="button" disabled={!paramsDirty} title="Revert" onclick={revert}>↺</button>
          <button class="pv-btn primary" type="button" disabled={!paramsDirty} onclick={applyLeafProfile}>Apply</button>
        </div>
        {#if lkind}
          {@const def = PROFILE_REGISTRY[lkind]}
          {@const dp = (leafDesc(leafEdit.pname).params) ?? {}}
          <div class="pv-kindparams">
            {#each Object.entries(def.params) as [pk, spec] (pk)}
              {@const val = dp[pk] ?? spec.default}
              <div class="pv-kpcard">
                <span class="pv-kpcard-lbl" title={spec.label}>{spec.label}{#if spec.unit}<em> {spec.unit}</em>{/if}</span>
                <input class="pv-kpnum" type="number" min={spec.min} max={spec.max} step={spec.step} value={val}
                  oninput={(e) => setLeafParam(leafEdit!.pname, pk, +(e.currentTarget as HTMLInputElement).value)}
                  use:dragNumber={{ step: spec.step, min: spec.min, max: spec.max, get: () => (leafDesc(leafEdit!.pname).params?.[pk] ?? spec.default), set: (v) => setLeafParam(leafEdit!.pname, pk, v) }}
                  title="Type or drag to scrub" />
              </div>
            {/each}
          </div>
        {/if}
        <!-- Vertical split: editor (wider) | coordinates (narrow single column). -->
        <div class="pv-prof-split">
          <ProfileEditor
            value={lpts}
            width={232}
            height={200}
            yDown={yd}
            hLabel={ps.hLabel ?? (yd ? 'r →' : 'x →')}
            vLabel={ps.vLabel ?? (yd ? 'z ↓' : 'y ↑')}
            presetSet={yd ? 'revolve' : 'cartesian'}
            showAxis={yd}
            showPresets={false}
            onChange={(next) => setLeafPoints(leafEdit.pname, next)}
          />
          <div class="pv-coords-col">
            <div class="pv-coords-head"><span>#</span><span>{yd ? 'r' : 'x'}</span><span>{yd ? 'z' : 'y'}</span></div>
            <ol class="pv-coords-list pv-coords-tbl">
              {#each lpts as pt, i (i)}
                <li><span class="pv-coords-i">{i}</span><span class="pv-coords-n">{fmt2(pt[0])}</span><span class="pv-coords-n">{fmt2(pt[1])}</span></li>
              {/each}
            </ol>
          </div>
        </div>
      </div>
    </FloatingPanel>
  {/if}

  <!-- profileSwap FloatingPanel (per-instance profile picker) was removed
       with the composite UI strip. -->

  {#if fnEditor}
    <!-- key on the fnEditor object so the editor REMOUNTS each open — its state
         seeds from `seed` only on mount, so reusing the instance kept the first
         seed (the rect default) even after picking a different profile. -->
    {#key fnEditor}
      <FloatingPanel
        title=""
        subtitle={`${fnMeta.label || fnMeta.id || 'New profile'} · ${fnMeta.description || fnAutoDesc}`}
        visible={true} x={fnEditor.px} y={fnEditor.py} width="auto" maxHeight="86vh" onClose={closeFnEditor}>
        {#snippet titleAction()}
          <button
            class="pv-meta-gear" type="button"
            title={`Edit name · description · tags\nname: ${fnMeta.label || '(unnamed)'}\ndescription: ${fnMeta.description || fnAutoDesc}\ntags: ${fnMeta.tags || '(none)'}`}
            onmousedown={(e) => e.stopPropagation()} onclick={toggleFnMetaPop} aria-label="Edit profile name, description and tags">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
        {/snippet}
        <ProfileFnEditor
          set={fnEditor.set} seed={fnEditor.seed}
          id={fnMeta.id} label={fnMeta.label} description={fnMeta.description} tags={fnMeta.tags}
          onSaved={onFnSaved} onClose={closeFnEditor} />
      </FloatingPanel>
    {/key}
    {#if fnMetaPop}
      <FloatingPanel title="Profile details" visible={true} x={fnMetaPop.x} y={fnMetaPop.y} width="288px" onClose={() => (fnMetaPop = null)}>
        <div class="pv-meta-form">
          <label><span>id</span><input bind:value={fnMeta.id} placeholder="casing_coupling" spellcheck="false" /></label>
          <label><span>name</span><input bind:value={fnMeta.label} placeholder="Casing coupling" /></label>
          <label><span>description</span><input bind:value={fnMeta.description} placeholder={fnAutoDesc} /></label>
          <label><span>tags</span><input bind:value={fnMeta.tags} placeholder="coupling, casing" /></label>
        </div>
      </FloatingPanel>
    {/if}
  {/if}

  {#if addParamPanel}
    <FloatingPanel title="Add parameter" visible={true} x={addParamPanel.x} y={addParamPanel.y} width="280px" maxHeight="70vh" onClose={closeAddParam}>
      <div style="display:flex; flex-direction:column; gap:6px; padding:4px;">
        <label style="font:11px Arial; color:#555; display:flex; flex-direction:column; gap:2px;">name
          <input bind:value={apName} placeholder="e.g. boreR" spellcheck="false"
            onkeydown={(e) => { if (e.key === 'Enter' && apName.trim() && !addParamError) submitAddParam(); }}
            style="font:11px ui-monospace, monospace; padding:3px 5px; border:1px solid {addParamError ? '#cc2222' : '#ccc'}; border-radius:4px;" />
        </label>
        {#if addParamError}<span style="font:10px Arial; color:#cc2222;">{addParamError}</span>{/if}
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
          <label style="font:11px Arial; color:#555; display:flex; flex-direction:column; gap:2px;">default<input type="number" bind:value={apDefault} style="font:11px ui-monospace,monospace; padding:3px 5px; border:1px solid #ccc; border-radius:4px;" /></label>
          <label style="font:11px Arial; color:#555; display:flex; flex-direction:column; gap:2px;">step<input type="number" bind:value={apStep} style="font:11px ui-monospace,monospace; padding:3px 5px; border:1px solid #ccc; border-radius:4px;" /></label>
          <label style="font:11px Arial; color:#555; display:flex; flex-direction:column; gap:2px;">min<input type="number" bind:value={apMin} style="font:11px ui-monospace,monospace; padding:3px 5px; border:1px solid #ccc; border-radius:4px;" /></label>
          <label style="font:11px Arial; color:#555; display:flex; flex-direction:column; gap:2px;">max<input type="number" bind:value={apMax} style="font:11px ui-monospace,monospace; padding:3px 5px; border:1px solid #ccc; border-radius:4px;" /></label>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:6px; margin-top:2px;">
          <button class="pv-btn" type="button" onclick={closeAddParam}>Cancel</button>
          <button class="pv-btn primary" type="button" disabled={!apName.trim() || !!addParamError} onclick={submitAddParam}>Add</button>
        </div>
        <p style="font:10px Arial; color:#888; margin:2px 0 0;">Adds <code>{apName.trim() || 'name'}</code> to meta.params + the function signature. Reference it bare in part args; <strong>Save source</strong> to persist.</p>
      </div>
    </FloatingPanel>
  {/if}

  <!-- K.63 M2.5: csgOpPopup + addPartPopup FloatingPanels removed. The
       former was the ⊕⊖∩ ops picker; the latter the + popup for atom /
       group / import / expression. Both are assembly-only and have moved
       to CompositionEditor (M3). -->

  {#if delParamPopup}
    <FloatingPanel title="Delete parameter" visible={true} x={delParamPopup.x} y={delParamPopup.y} width="232px" onClose={() => (delParamPopup = null)}>
      <div style="display:flex; flex-direction:column; gap:9px; padding:4px;">
        <p style="font:12px Arial; color:#333; margin:0; line-height:1.4;">Remove <code style="font-family:'SF Mono',Menlo,monospace; color:#c4392f;">{delParamPopup.name}</code> from this primitive's parameters?</p>
        <p style="font:10px Arial; color:#888; margin:0;">Removes it from <code>meta.params</code> + the function signature. <strong>Save source</strong> to persist.</p>
        <div style="display:flex; justify-content:flex-end; gap:6px;">
          <button class="pv-btn" type="button" onclick={() => (delParamPopup = null)}>Cancel</button>
          <button class="pv-btn danger" type="button" onclick={() => performDeleteParam(delParamPopup!.name)}>Delete</button>
        </div>
      </div>
    </FloatingPanel>
  {/if}

  <!-- colorPopup (per-instance outer/inner swatch picker), fxEdit (ƒ
       expression picker for a part arg), and txAdd (add-transform picker)
       FloatingPanels were removed with the composite UI strip. -->

  {#if saveAsOpen}
    <FloatingPanel
      title="Save As…"
      visible={true}
      x={saveAsX}
      y={saveAsY}
      width="min(320px, 90vw)"
      maxHeight="60vh"
      onClose={closeSaveAs}
    >
      <div class="pv-saveas-pop">
        <p class="pv-saveas-note">
          Save the current edits — including anything not yet saved — as a
          <strong>new</strong> primitive. <code>{id}</code> stays untouched.
        </p>
        <label class="pv-saveas-label" for="pv-saveas-input">New id / name</label>
        <input
          id="pv-saveas-input"
          class="pv-saveas-input"
          class:invalid={saveAsId.trim() !== '' && saveAsError !== null}
          bind:value={saveAsId}
          spellcheck="false"
          autocomplete="off"
          placeholder="e.g. {id}_copy"
          title="Enter to save · Esc/× to cancel"
          onkeydown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); confirmSaveAs(); }
            else if (e.key === 'Escape') { e.preventDefault(); closeSaveAs(); }
          }}
        />
        {#if saveAsId.trim() !== '' && saveAsError}
          <div class="pv-saveas-err">{saveAsError}</div>
        {/if}
        <div class="pv-saveas-row">
          <button class="pv-btn" type="button" onclick={closeSaveAs}>Cancel</button>
          <div class="pv-spacer"></div>
          <button class="pv-btn primary" type="button" disabled={!saveAsValid || saveAsBusy} onclick={confirmSaveAs}>
            {saveAsBusy ? 'Saving…' : 'Save As'}
          </button>
        </div>
      </div>
    </FloatingPanel>
  {/if}
  {/if}<!-- end typed-builder dispatch -->
</div>

<style>
  /* Profile Function title-bar ⚙ (edits name/description/tags) + its popover form */
  .pv-fn-sel { width: 190px; display: flex; align-items: center; }
  .pv-meta-gear { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: 1.5px solid #2a2a2a; background: #fff; border-radius: 4px; cursor: pointer; color: #2a2a2a; padding: 0; }
  .pv-meta-gear:hover { color: #c4392f; border-color: #c4392f; background: #fceeec; }
  .pv-meta-form { display: flex; flex-direction: column; gap: 8px; font: 11px Arial; }
  .pv-meta-form label { display: grid; grid-template-columns: 78px 1fr; align-items: center; gap: 8px; }
  .pv-meta-form span { font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: #999; }
  .pv-meta-form input { font: 11px Arial; padding: 4px 7px; border: 1px solid #d8d8e2; border-radius: 5px; min-width: 0; }
  .pv-meta-form input:focus { outline: none; border-color: #c4392f; box-shadow: 0 0 0 2px rgba(196,57,47,.14); }
  /* Single-row layout — the canvas sits at the TOP of the split (no header,
     no padding above the canvas pane). Title + description now live INSIDE
     the canvas (PrimitiveDualScene <HTML> overlay). */
  .pv-root { display: grid; grid-template-rows: 1fr; height: 100%; min-height: 0; font: 13px Arial; color: #222; padding: 0 6px 6px; box-sizing: border-box; }

  .pv-split { display: grid; grid-template-columns: 1fr 6px var(--side-width, 420px); min-height: 0; height: 100%; gap: 0; }

  .pv-canvas-pane { background: #1a1a1a; min-height: 0; overflow: hidden; border-radius: 4px; padding: 0; position: relative; }
  .pv-canvas-pane.pv-drop-ok { outline: 2px dashed #2266cc; outline-offset: -2px; }
  /* Assembly dep-change warning chip — bottom-left, yellow, count shows
     how many used components drifted since the assembly's last snapshot. */
  .pv-dep-warn { position: absolute; left: 8px; bottom: 8px; z-index: 20; padding: 4px 10px; font: 700 11px Arial; color: #4a3700; background: #fff3a0; border: 1px solid #e0c200; border-radius: 4px; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.15); }
  .pv-dep-warn:hover { background: #ffea60; border-color: #c4a800; }
  .pv-dep-pop-back { position: fixed; inset: 0; z-index: 1000; background: transparent; }
  .pv-dep-pop { position: fixed; z-index: 1001; min-width: 280px; max-width: 420px; background: #fff; border: 1px solid #d0d0d8; border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,0.2); padding: 10px 12px; font: 11px Arial; color: #333; }
  .pv-dep-pop-title { font: 700 12px Arial; color: #4a3700; margin-bottom: 6px; }
  .pv-dep-pop-list { display: flex; flex-direction: column; gap: 6px; max-height: 320px; overflow-y: auto; }
  .pv-dep-row { padding: 4px 6px; background: #fff8d6; border-left: 3px solid #e0c200; border-radius: 3px; }
  .pv-dep-id { font: 600 11px ui-monospace, Menlo, monospace; color: #222; margin-bottom: 2px; }
  .pv-dep-bullets { margin: 2px 0 0 14px; padding: 0; }
  .pv-dep-bullets li { font: 10px Arial; color: #555; }
  .pv-dep-bullets code { font: 10px ui-monospace, Menlo, monospace; background: #ffeb80; padding: 1px 3px; border-radius: 2px; }
  .pv-dep-pop-acts { display: flex; gap: 6px; margin-top: 8px; }
  .pv-dep-pop-act { font: 600 11px Arial; padding: 4px 10px; border: 1px solid #d0d0d8; background: #fff; color: #444; border-radius: 4px; cursor: pointer; }
  .pv-dep-pop-act.primary { background: #c4392f; color: #fff; border-color: #c4392f; }
  .pv-dep-pop-act.primary:hover { background: #b23329; }
  .pv-dep-pop-act:hover:not(.primary) { background: #f4f4f4; }
  /* Per-instance CSG op picker in the assembly's part-row head. Sits
     between the call signature and the colour swatches; pointer events
     stopped on click so it doesn't trip the row's expand/collapse. */
  .pv-instop { font: 10px Arial; color: #c4392f; background: #fdf8f7; border: 1px solid #e3c4bf; border-radius: 3px; padding: 1px 4px; cursor: pointer; margin-left: 6px; }
  .pv-instop:hover { background: #fceeec; border-color: #c4392f; }
  .pv-instop:focus { outline: none; border-color: #c4392f; box-shadow: 0 0 0 1px rgba(196, 57, 47, 0.3); }

  .pv-resizer { background: transparent; cursor: col-resize; position: relative; }
  .pv-resizer::before { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; transform: translateX(-50%); background: #eee; transition: background 0.15s; }
  .pv-resizer:hover::before, .pv-resizer.dragging::before { background: #cc2222; }

  .pv-side { display: flex; flex-direction: column; min-height: 0; min-width: 0; border: 1px solid #eee; border-radius: 4px; background: #fff; overflow: hidden; }
  /* Shared top action bar — dirty pill + icon buttons (Reload / Save defaults /
     Save As / Save / Duplicate / Delete). Shown on every tab. */
  .pv-actionbar { display: flex; align-items: center; gap: 3px; padding: 1px 4px; border-bottom: 1px solid #eee; background: #fafafa; flex-shrink: 0; }
  .pv-act { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 22px; border: 1px solid #4a4a4a; background: #fff; cursor: pointer; color: #1f1f1f; border-radius: 4px; flex: 0 0 auto; }
  .pv-act:hover:not(:disabled) { color: #000; background: #eaeaea; border-color: #000; }
  .pv-act:disabled { opacity: 0.3; cursor: default; }
  .pv-act.dirty { color: #cc2222; }
  .pv-act.danger:hover:not(:disabled) { color: #cc2222; background: #fdecec; }
  /* Body = vertical tab rail (left) + active pane (right). */
  .pv-body { display: flex; flex: 1; min-height: 0; }
  .pv-tabrail { display: flex; flex-direction: column; gap: 2px; flex-shrink: 0; padding: 6px 0; border-right: 1px solid #eee; background: #fafafa; }
  /* Vertical tab: icon on top, label rotated to read bottom→top (vertical
     text), so the rail is a narrow side strip. */
  .pv-vtab { position: relative; display: flex; flex-direction: column; align-items: center; gap: 7px; width: 26px; padding: 14px 1px; border: 0; background: transparent; color: #666; cursor: pointer; clip-path: polygon(0 14%, 100% 0, 100% 100%, 0 86%); }
  .pv-vtab:hover { color: #cc2222; background: #f0f0f0; }
  .pv-vtab.active { color: #cc2222; background: #fff; }
  .pv-vtab .pv-ic { font-size: 15px; opacity: 0.9; }
  .pv-vtab-lbl { writing-mode: vertical-rl; transform: rotate(180deg); font: 600 11px Arial; letter-spacing: 1.5px; line-height: 1; }
  .pv-vtab .pv-dot { position: absolute; top: 6px; right: 6px; }
  .pv-tabcontent { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
  .pv-dot { width: 6px; height: 6px; border-radius: 50%; background: #cc2222; }
  .pv-ic { font-size: 11px; opacity: 0.85; line-height: 1; }

  .pv-pane { display: flex; flex-direction: column; min-height: 0; flex: 1; }
  .pv-pane-head { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid #eee; flex-wrap: wrap; }
  .pv-spacer { flex: 1; }

  .pv-poly-verts { font: 10px Arial; color: #888; }
  .pv-mini-btn { padding: 2px 8px; border: 1px solid #ccc; border-radius: 4px; background: #fff; font: 10px Arial; cursor: pointer; }
  .pv-mini-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .pv-mini-btn.on { background: #2266cc; border-color: #2266cc; color: #fff; }
  .pv-warp-row { display: flex; gap: 6px; align-items: center; margin-top: 4px; }
  .pv-saveprof { display: flex; flex-direction: column; gap: 8px; }
  .pv-saveprof-row { display: flex; align-items: center; gap: 8px; font: 11px Arial; color: #555; }
  .pv-saveprof-row input { flex: 1; font: 11px ui-monospace, monospace; padding: 3px 6px; border: 1px solid #d4d4dc; border-radius: 4px; }
  .pv-saveprof-foot { display: flex; align-items: center; gap: 6px; }
  .pv-saveprof-note { font: 10px Arial; color: #999; }
  .pv-saveprof-err { font: 10px Arial; color: #c0392b; }

  /* ── Merged Build tab — Parameters section + per-part accordion rows ───── */
  .pv-build { padding: 0; }
  .pv-build-body { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 6px 8px; display: flex; flex-direction: column; gap: 2px; }
  /* Dark/white delegated tooltip (via tipHost on .pv-root). */
  :global(.floating-tip) { position: fixed; z-index: 2000; background: #1a1a1a; color: #fff; padding: 4px 8px; border-radius: 4px; font: 500 11px/1.35 Arial; max-width: 300px; width: max-content; white-space: pre-line; box-shadow: 0 2px 8px rgba(0,0,0,0.4); pointer-events: none; }

  /* Accordion shell — adopted from the /components inspector (.pg-acc-*). */
  .pg-acc-wrap { border: 3px solid #d4d4dc; border-radius: 4px; background: #fff; padding: 0 3px 1px; margin: 0; }
  .pg-acc-wrap:first-of-type { margin-top: 0; }
  /* Instance (part) wraps get the thinner red-tinted outline + colour stripe. */
  .pg-acc-wrap.instance { border-width: 2px; border-color: #f0c8c8; background: #fff8f8; border-left-width: 4px; border-left-color: var(--inst-color, #f0c8c8); }
  .pg-acc-head {
    display: flex; align-items: center; gap: 6px;
    padding: 2px 4px; margin: 0;
    background: transparent; border: 0;
    cursor: pointer;
    border-radius: 3px;
  }
  .pg-acc-head:hover { background: #ececf2; color: #cc2222; }
  .pg-acc-head.collapsed { background: #fafafa; }
  /* Drag-reorder visual cue — a 2px top border indicates "drop will land
   * above this row". Cursor changes to `grab` on the head to signal the
   * row is draggable. (Only applies for new-style assemblies, where the
   * `draggable` attribute is dynamically true.) */
  .pg-acc-head.instance[draggable="true"] { cursor: grab; }
  .pg-acc-head.instance[draggable="true"]:active { cursor: grabbing; }
  .pg-acc-head.instance.drag-over { box-shadow: inset 0 2px 0 0 #cc2222; }

  /* K.63 M2.5: assembly-only CSS deleted (.pv-parts-subtabs, .pv-subtab*,
   * .pv-add-part, .pv-addpart*, .pv-defs-section, .pv-def-*,
   * .pv-expr-*, .pv-group-*, .pv-opbar, .pv-opbtn, .pv-opchip*,
   * .pv-opspicker*, .pv-show-on-its-own). All moved to CompositionEditor.svelte. */
  .pg-acc-title { font: bold 13px Arial; color: #333; flex: 0 0 auto; }
  .pg-acc-head.instance .pg-acc-title { font: bold 13px ui-monospace, SFMono-Regular, Menlo, monospace; color: #cc2222; }
  .pg-acc-sig { font: bold 13px ui-monospace, SFMono-Regular, Menlo, monospace; color: #cc2222; margin-left: -3px; }
  /* Body cap — keeps tall parts scrollable rather than pushing the rest of
     the chain off-screen (memory: accordion-body-scroll-cap). */
  .pg-acc-body {
    max-height: 220px; overflow-y: auto; overscroll-behavior: contain;
    background: #fff; border-radius: 3px;
    padding: 6px 4px;
  }
  .pv-part-body { display: flex; flex-direction: column; gap: 3px; }

  /* Polygon-param card in the Parameters section — same .pr-card shell as the
     scalar cards, with a ✎ profile trigger on the right. */
  .pv-poly-card { margin-top: 4px; }
  .pv-poly-card.dirty { background: #fff8e6; border-color: #f0d8a8; }
  .pv-poly-card .pr-keyname { font: 12px monospace; color: #333; flex: 0 0 auto; max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Bridge: ParamGrid's .pr-grid lives in its own component scope; give the
     polygon cards the same single-row card look here. */
  .pv-poly-card { display: flex; align-items: center; gap: 4px; padding: 3px 6px; background: #fafafa; border: 1px solid #eaeaef; border-radius: 3px; min-width: 0; }

  /* Parts tools row (Load / Add / Re-scan + part count). */
  .pv-parts-tools { display: flex; align-items: center; gap: 6px; padding: 6px 2px 2px; }
  .pv-parts-count { font: 10px Arial; color: #888; }

  /* Recognized-instance body content (args / transforms / live values). */
  .pv-part-name { font: 700 13px monospace; color: #cc2222; }
  .pv-part-args { margin-top: 4px; font: 11px ui-monospace, monospace; color: #555; white-space: pre-wrap; word-break: break-word; }
  .pv-part-tx { margin-top: 3px; font: 11px ui-monospace, monospace; color: #888; }
  .pv-part-txdel { margin-left: 6px; border: none; background: transparent; color: #c4392f; cursor: pointer; font-size: 11px; line-height: 1; padding: 0 3px; opacity: 0.4; }
  .pv-part-tx:hover .pv-part-txdel { opacity: 0.85; }
  .pv-part-txdel:hover { opacity: 1; }
  .pv-part-edit { margin-top: 4px; width: 100%; box-sizing: border-box; font: 11px ui-monospace, monospace; color: #333; padding: 3px 6px; border: 1px solid #d8d8e0; border-radius: 4px; background: #fff; }
  .pv-part-edit:focus { outline: 1px solid #cc2222; border-color: #cc2222; }
  .pv-part-edit-tx { width: auto; min-width: 170px; margin: 0 2px; padding: 1px 5px; }
  /* Live-resolved values (Option A reactive link) — green, updates as you
     drag a param slider. */
  .pv-part-live { margin-top: 2px; font: 11px ui-monospace, monospace; color: #1a8a3a; }
  .pv-part-compose { padding: 6px 9px; font: 12px Arial; color: #444; border-top: 1px dashed #ddd; }
  .pv-part-compose code { font: 11px ui-monospace, monospace; color: #333; background: #f0f0f0; padding: 1px 5px; border-radius: 3px; }
  .pv-parts-note { font: 10px Arial; color: #999; padding: 2px 0; }
  .pv-readonly-note { font: 11px Arial; color: #2b4a6b; background: #eaf2fb; border: 1px solid #cfe0f4; border-radius: 6px; padding: 6px 9px; margin: 6px 8px 2px; line-height: 1.4; }
  .pv-readonly-note code { background: #dce9f8; padding: 0 3px; border-radius: 3px; }
  .pv-parts-empty { font: 12px Arial; color: #999; padding: 14px 4px; line-height: 1.4; }
  .pv-parts-empty code { background: #eee; padding: 0 4px; border-radius: 3px; }
  .pv-parts-err { font: 11px ui-monospace, monospace; color: #c4392f; padding: 10px 4px; white-space: pre-wrap; }
  /* Soft non-fatal notice — sits above the parts list (never replaces it). */
  .pv-soft-note { display: flex; align-items: flex-start; gap: 6px; font: 11px Arial; color: #8a6d00; background: #fff8e1; border: 1px solid #f0e0a0; border-radius: 5px; padding: 5px 7px; margin: 4px 0; line-height: 1.35; }
  .pv-soft-note span { flex: 1; min-width: 0; }
  .pv-soft-note-x { flex: 0 0 auto; border: 0; background: transparent; color: #b08a00; font: 13px Arial; line-height: 1; cursor: pointer; padding: 0 2px; }
  .pv-soft-note-x:hover { color: #8a6d00; }
  .pv-load-pick { font: 11px monospace; padding: 3px 4px; border: 1px solid #ccc; border-radius: 4px; background: #fff; max-width: 150px; cursor: pointer; }
  .pv-load-pick:hover { border-color: #cc2222; }
  /* profile trigger on a part row — shape-icon + "profile" label; opens the
     ProfileEditor popup on click. */
  .pv-part-profile { display: inline-flex; align-items: center; gap: 4px; font: 600 10px Arial; color: #2266cc; background: #eef3fb; border: 1px solid #d4e1f5; border-radius: 4px; padding: 2px 6px; cursor: pointer; white-space: nowrap; }
  .pv-part-profile:hover { background: #2266cc; color: #fff; border-color: #2266cc; }
  .pv-part-profile:hover :global(.pv-shape-ic path) { stroke: #fff; }
  .pv-part-profile-lbl { line-height: 1; }
  .pv-part-fxedit { font: 600 12px Arial; color: #2266cc; background: #eef3fb; border: 1px solid #d4e1f5; border-radius: 4px; padding: 2px 7px; cursor: pointer; line-height: 1; }
  .pv-part-fxedit:hover { background: #2266cc; color: #fff; border-color: #2266cc; }
  /* Function-profile params surfaced inside a part row (the "body" instance). */
  .pv-profile-params { margin: 5px 0 2px; padding: 5px 7px; border: 1px dashed #d4e1f5; border-radius: 5px; background: #f7faff; }
  .pv-pp-head { display: flex; align-items: center; gap: 6px; font: 700 8px Arial; text-transform: uppercase; letter-spacing: .05em; color: #2266cc; margin-bottom: 5px; }
  .pv-pp-head code { font-family: 'SF Mono', Menlo, monospace; text-transform: none; letter-spacing: 0; color: #1a4fa0; }
  .pv-pp-btn { font: 600 9px Arial; text-transform: none; letter-spacing: 0; color: #2266cc; background: #eef3fb; border: 1px solid #d4e1f5; border-radius: 4px; padding: 2px 6px; cursor: pointer; white-space: nowrap; }
  .pv-pp-btn:hover { background: #2266cc; color: #fff; border-color: #2266cc; }

  /* ── Profile shape-icon (draws the polygon) + hover preview ──────────────── */
  .pv-shape-ic { position: relative; display: inline-flex; align-items: center; }
  .pv-shape-ic svg { display: block; }
  /* Hover preview — a larger shape + the "profile" label, body-styled card. */
  .pv-shape-tip {
    position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%);
    display: none; flex-direction: column; align-items: center; gap: 4px;
    background: #1a1a1a; color: #fff; border-radius: 6px; padding: 7px 9px;
    box-shadow: 0 4px 14px rgba(0,0,0,0.3); z-index: 1200; pointer-events: none;
  }
  .pv-shape-ic:hover .pv-shape-tip { display: flex; }
  .pv-shape-tip-label { font: 600 10px Arial; letter-spacing: 0.3px; }
  .pv-shape-tip-svg { background: #2a2a2a; border-radius: 4px; }

  /* ── Pin (📌) toggle on accordion headers ────────────────────────────────── */
  .pv-pin { border: 0; background: transparent; cursor: pointer; padding: 0 2px; font-size: 12px; line-height: 1; opacity: 0.28; filter: grayscale(1); transition: opacity 0.12s; flex: 0 0 auto; }
  .pv-pin:hover { opacity: 0.7; }
  .pv-pin.pinned { opacity: 1; filter: none; }
  /* Per-part outer/inner colour swatches in the accordion title. */
  .pv-swatch { flex: 0 0 auto; width: 13px; height: 13px; margin-left: 4px; padding: 0; border: 1px solid rgba(0,0,0,0.35); border-radius: 3px; cursor: pointer; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.4); }
  .pv-swatch:hover { outline: 1px solid #4a78c0; outline-offset: 1px; }
  .pv-swatch-inner { margin-left: 2px; border-radius: 50%; }

  /* ── Coordinates section in the profile popups ───────────────────────────── */
  .pv-coords { margin: 4px 4px 0; font: 11px Arial; color: #555; }
  .pv-coords > summary { cursor: pointer; font: 600 11px Arial; color: #444; padding: 2px 0; user-select: none; }
  .pv-coords-list { margin: 4px 0 0; padding: 0; list-style: none; max-height: 140px; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 1px 8px; }
  .pv-coords-list li { display: flex; align-items: center; gap: 5px; font: 11px ui-monospace, monospace; }
  .pv-coords-i { color: #aaa; min-width: 16px; text-align: right; }
  .pv-coords-list code { color: #2266cc; }
  /* ＋ transform trigger — opens the transform palette popover. */
  .pv-part-addtx { font: 600 10px Arial; color: #1a8a3a; background: #eafaef; border: 1px solid #cce8d4; border-radius: 4px; padding: 2px 7px; cursor: pointer; white-space: nowrap; }
  .pv-part-addtx:hover { background: #1a8a3a; color: #fff; border-color: #1a8a3a; }

  /* Add-transform palette popover (FloatingPanel). */
  .pv-txadd-pop { display: flex; flex-direction: column; gap: 4px; padding: 4px 2px; }
  .pv-txadd-item { display: flex; align-items: center; gap: 8px; text-align: left; background: #fafafa; border: 1px solid #eaeaef; border-radius: 5px; padding: 7px 9px; cursor: pointer; font: 12px Arial; color: #333; }
  .pv-txadd-item:hover { background: #eafaef; border-color: #cce8d4; }
  .pv-txadd-glyph { font-size: 15px; width: 18px; text-align: center; color: #1a8a3a; }
  .pv-txadd-label { font-weight: 600; flex: 1; }
  .pv-txadd-op { font: 10px ui-monospace, monospace; color: #888; }
  .pv-txadd-note { margin: 4px 2px 0; font: 10px Arial; color: #888; line-height: 1.3; }
  .pv-txadd-note code { font: 10px ui-monospace, monospace; color: #cc2222; background: #f6f6f8; padding: 0 4px; border-radius: 3px; }

  /* Profile-editor popup body (FloatingPanel). */
  .pv-profile-pop { display: flex; flex-direction: column; min-height: 0; gap: 4px; padding: 2px; }
  /* Give the embedded ProfileEditor (flex:1, no intrinsic height) a fixed
     drawing area so the SVG renders inside the auto-sized FloatingPanel. */
  .pv-profile-pop :global(.pe-root) { flex: 0 0 auto; }
  .pv-profile-pop :global(.pe-svg-wrap) { height: 280px; flex: 0 0 auto; }
  /* Profile popup: one bar (search dropdown + actions) + a vertical editor|coords split. */
  .pv-prof-bar { display: flex; align-items: center; gap: 5px; margin: 0 0 6px; }
  .pv-prof-combo { flex: 1; min-width: 0; }
  .pv-iconbtn { flex: 0 0 auto; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid #ccc; border-radius: 5px; background: #fff; color: #555; font: 14px Arial; cursor: pointer; padding: 0; }
  .pv-iconbtn:hover:not(:disabled) { border-color: #2266cc; color: #2266cc; background: #f5f8fe; }
  .pv-iconbtn:disabled { opacity: 0.4; cursor: not-allowed; }
  .pv-prof-split { display: flex; align-items: flex-start; gap: 8px; }
  .pv-prof-split :global(.pe-root) { width: 232px; flex: 0 0 232px; }
  .pv-prof-split :global(.pe-svg-wrap) { height: 200px; }
  .pv-coords-col { flex: 1; min-width: 0; display: flex; flex-direction: column; max-height: 224px; }
  /* Tidy 3-column points table: # | x | y, header + zebra + right-aligned nums. */
  .pv-coords-head { display: grid; grid-template-columns: 22px 1fr 1fr; gap: 6px; font: 700 9px Arial; color: #999; text-transform: uppercase; letter-spacing: 0.04em; padding: 0 4px 3px; border-bottom: 1px solid #eee; }
  .pv-coords-head span:not(:first-child) { text-align: right; }
  .pv-coords-tbl { grid-template-columns: 1fr !important; max-height: 200px; gap: 0 !important; }
  .pv-coords-tbl li { display: grid; grid-template-columns: 22px 1fr 1fr; gap: 6px; padding: 1px 4px; border-radius: 3px; }
  .pv-coords-tbl li:nth-child(even) { background: #f7f7fa; }
  .pv-coords-n { text-align: right; color: #2266cc; font: 11px ui-monospace, monospace; }
  /* Parametric-kind param controls: 2-col grid of draggable number boxes
     (drag-to-scrub, no spinner arrows) — compact, like the Parts panel. */
  .pv-kindparams { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 10px; margin: 6px 0; padding-bottom: 6px; border-bottom: 1px solid #eee; max-height: 200px; overflow-y: auto; }
  .pv-kpcard { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .pv-kpcard-lbl { flex: 1; min-width: 0; font: 11px Arial; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pv-kpcard-lbl em { color: #999; font-style: normal; }
  .pv-kpnum { flex: 0 0 58px; width: 58px; font: 11px ui-monospace, monospace; padding: 2px 5px; border: 1px solid #ccc; border-radius: 3px; cursor: ew-resize; background: #fff; }
  .pv-kpnum::-webkit-inner-spin-button, .pv-kpnum::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .pv-kpnum { -moz-appearance: textfield; appearance: textfield; }
  .pv-profile-pop-head { display: flex; align-items: center; gap: 6px; padding: 2px 4px 4px; }
  .pv-profile-pop-note { margin: 2px 4px 0; font: 10px Arial; color: #888; line-height: 1.3; }
  .pv-profile-pop-note code { font: 10px ui-monospace, monospace; color: #cc2222; background: #f6f6f8; padding: 0 4px; border-radius: 3px; }
  .pv-profile-pop-tag { font: 10px Arial; color: #2266cc; }
  .pv-profile-pop-tag code { font: 10px ui-monospace, monospace; color: #2266cc; background: #eef3fb; padding: 0 4px; border-radius: 3px; }

  /* Save As… popup body (FloatingPanel). */
  .pv-saveas-pop { display: flex; flex-direction: column; gap: 8px; padding: 6px 4px 4px; }
  .pv-saveas-note { margin: 0; font: 11px Arial; color: #666; line-height: 1.35; }
  .pv-saveas-note code { font: 11px ui-monospace, monospace; color: #cc2222; background: #f6f6f8; padding: 0 4px; border-radius: 3px; }
  .pv-saveas-label { font: 600 11px Arial; color: #444; }
  .pv-saveas-input { width: 100%; box-sizing: border-box; font: 12px ui-monospace, monospace; padding: 6px 8px; border: 1px solid #ccc; border-radius: 4px; background: #fff; }
  .pv-saveas-input:focus { outline: 1px solid #cc2222; border-color: #cc2222; }
  .pv-saveas-input.invalid { border-color: #c4392f; }
  .pv-saveas-input.invalid:focus { outline-color: #c4392f; }
  .pv-saveas-err { font: 11px Arial; color: #c4392f; line-height: 1.3; }
  .pv-saveas-row { display: flex; align-items: center; gap: 6px; margin-top: 2px; }

  .pv-source { padding: 0; }
  .pv-editor-wrap { flex: 1; min-height: 0; border-top: 1px solid #eee; padding: 0 0 8px 0; display: flex; flex-direction: column; overflow: hidden; }
  .pv-editor-wrap :global(.cm-editor) { flex: 1; }
  .pv-editor-wrap :global(.cm-scroller) { padding-bottom: 24px; }

  .pv-pill { font: 10px Arial; color: #555; background: #f0f0f0; padding: 2px 8px; border-radius: 10px; }
  .pv-pill.dirty { background: #fff8e6; color: #6a5500; }

  .pv-btn { padding: 4px 10px; border: 1px solid #ccc; border-radius: 4px; background: #fff; font: 11px Arial; cursor: pointer; }
  .pv-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .pv-btn.primary { background: #cc2222; color: #fff; border-color: #cc2222; }
  .pv-btn.primary:disabled { background: #888; border-color: #888; }
  .pv-btn.danger { background: #cc2222; color: #fff; border-color: #a8302a; }
  .pv-btn.danger:hover { background: #b21f1f; }

  /* AI tab — mirrors the /components ai-pane look (purple accent). */
  .pv-tab-ai.active { color: #7c4dff; border-bottom-color: #7c4dff; }
  .pv-tab-ai:hover { color: #7c4dff; }
  .pv-subtab { background: transparent; border: 0; padding: 4px 8px; font: 600 11px Arial; color: #888; cursor: pointer; border-radius: 4px; }
  .pv-subtab.active { color: #7c4dff; background: #f0eafe; }
  .pv-ai { padding: 0; }
  .pv-ai-body { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 14px; }
  .pv-ai-sec { display: flex; flex-direction: column; gap: 6px; }
  .pv-ai-h { font: 600 11px Arial; color: #444; }
  .pv-ai-sub { font: 10px Arial; color: #999; font-weight: 400; }
  .pv-ai-prompt { width: 100%; box-sizing: border-box; font: 12px ui-monospace, monospace; padding: 6px 8px; border: 1px solid #ccc; border-radius: 4px; resize: vertical; }
  .pv-ai-prompt:focus { outline: 1px solid #7c4dff; border-color: #7c4dff; }
  .pv-ai-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .pv-ai-err { font: 11px Arial; color: #c4392f; }
  .pv-ai-proposal { border: 1px solid #d8d4e8; border-radius: 4px; padding: 8px; background: #faf8ff; display: flex; flex-direction: column; gap: 6px; }
  .pv-ai-pre { margin: 0; max-height: 240px; overflow: auto; font: 11px ui-monospace, monospace; background: #fff; border: 1px solid #eee; border-radius: 3px; padding: 8px; white-space: pre-wrap; word-break: break-word; }
  .pv-ai-note { margin: 0; font: 10px Arial; color: #888; }
  .pv-ai-empty { font: 12px Arial; color: #888; padding: 16px 4px; }
  .pv-ai-hist { display: flex; flex-direction: column; gap: 2px; }
  .pv-ai-hrow { display: flex; align-items: flex-start; gap: 6px; text-align: left; background: transparent; border: 0; border-radius: 3px; padding: 5px 6px; cursor: pointer; font: 11px ui-monospace, monospace; color: #444; }
  .pv-ai-hrow:hover { background: #f4f4f8; }
  .pv-ai-hmark { flex-shrink: 0; color: #aaa; width: 12px; text-align: center; }
  .pv-ai-hmark.ok { color: #2e7d32; }
  .pv-ai-hmark.no { color: #c4392f; }
  .pv-ai-hprompt { flex: 1; overflow: hidden; text-overflow: ellipsis; }
</style>
