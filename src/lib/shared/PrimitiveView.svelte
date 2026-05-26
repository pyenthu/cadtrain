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
  import CodeEditor from './CodeEditor.svelte';
  import ProfileEditor from './ProfileEditor.svelte';
  import FloatingPanel from './FloatingPanel.svelte';
  import ParamGrid from './ParamGrid.svelte';
  import ConstructionTree from './ConstructionTree.svelte';
  import ProfilePalette from './ProfilePalette.svelte';
  import type { VolProfile } from './ProfilePalette.svelte';
  import ProfileFnEditor from './ProfileFnEditor.svelte';
  import { dragNumber } from './dragNumber';
  import { resolveProfile, PROFILE_REGISTRY, defaultsFor } from './profile-presets';
  import { untrack } from 'svelte';

  type ParamSchema = {
    label?: string;
    type?: 'number' | 'boolean' | 'polygon' | 'enum';
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
    paramSchema,
    profileSchema = {},
    editable = false,
    initialSource = '',
    serverSource = '',
    onSaveSource,
    onSaveDefaults,
    onSaveAs,
    onReloadSource,
    catalog = [],
  }: {
    id: string;
    name?: string;
    description?: string;
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
  let effectiveSchema = $derived(
    Object.fromEntries(Object.entries({ ...paramSchema, ...addedParams }).filter(([k]) => !removedParams.has(k))),
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

  // ── Parts recognition ───────────────────────────────────────────────────
  // Dual-control: the source.ts is the source of truth; the GUI introspects
  // it to recognize the individual instances (parts). Read-only for now.
  // A recognized instance is a PART when its call is in meta.uses; instances
  // calling the weld toolkit (weldAndBuild, …) are leaf locals, not parts.
  let recognized = $state<any>(null);
  let recogStatus = $state<'idle' | 'loading' | 'error'>('idle');
  let recogError = $state<string | null>(null);
  async function loadRecognition() {
    recogStatus = 'loading'; recogError = null;
    try {
      const r = await fetch('/api/primitives/recognize', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: editedSource }),
      });
      if (!r.ok) { recogError = await r.text(); recogStatus = 'error'; return; }
      recognized = await r.json();
      recogStatus = 'idle';
    } catch (e: any) { recogError = e?.message ?? String(e); recogStatus = 'error'; }
  }
  // Re-recognize whenever the Build tab is open and the source changes. The
  // Build tab needs the recognized instance spans (Parts accordion) AND the
  // meta.profiles value spans (the ✎ profile popups splice edits back here).
  $effect(() => { if (tab === 'build') { void editedSource; loadRecognition(); } });

  // ── Add-transform palette (mirrors the /components chain-op aid) ──────────
  // A clean visual coding aid: a `+` on each Parts-tab instance row opens a
  // palette of transforms. Picking one WRAPS the instance's init expression
  // with that operator in editedSource — `const X = cyl(…)` becomes
  // `const X = mv(cyl(…), [0, 0, 0])`. Extensible: add an entry here for each
  // new transform helper (it just emits `op(<inner>, <args>)`).
  type TxDef = { id: string; label: string; glyph: string; op: string; args: string; hint: string };
  const TRANSFORMS: TxDef[] = [
    { id: 'translate', label: 'Translate', glyph: '↔', op: 'mv',  args: '[0, 0, 0]',  hint: 'Move along X / Y / Z (Z-down: +z is deeper).' },
    { id: 'rotate',    label: 'Rotate',    glyph: '⟳', op: 'rot', args: '[0, 0, 0]',  hint: 'Rotate about X / Y / Z in degrees.' },
    // Future transforms (scale, mirror, twist, …) drop in here — each just
    // emits `op(<inner>, <args>)` and the recognizer renders the new ↳ row.
  ];
  let txAdd = $state<{ instName: string; initStart: number; initEnd: number; px: number; py: number } | null>(null);
  function openTxAdd(inst: any, ev: MouseEvent) {
    if (!canEdit || inst.initStart < 0) return;
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    txAdd = {
      instName: inst.name, initStart: inst.initStart, initEnd: inst.initEnd,
      px: Math.max(8, Math.min(rect.left - 40, window.innerWidth - 240)),
      py: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 220)),
    };
  }
  function closeTxAdd() { txAdd = null; }
  function addTransform(t: TxDef) {
    if (!txAdd) return;
    const inner = editedSource.slice(txAdd.initStart, txAdd.initEnd);
    // Wrap the WHOLE init expr → the new op becomes the OUTERMOST transform
    // (applied last), matching how the recognizer reads the chain.
    spliceSource(txAdd.initStart, txAdd.initEnd, `${t.op}(${inner}, ${t.args})`);
    closeTxAdd();
  }
  // Delete a transform = UNWRAP it: replace `op(inner, args)` with just `inner`.
  function deleteTransform(t: any) {
    if (!t || typeof t.callStart !== 'number' || t.callStart < 0) return;
    spliceSource(t.callStart, t.callEnd, editedSource.slice(t.innerStart, t.innerEnd));
  }

  let usesSet = $derived(new Set<string>(recognized?.uses ?? []));
  let parts = $derived((recognized?.instances ?? []).filter((i: any) => usesSet.has(i.call)));
  let locals = $derived((recognized?.instances ?? []).filter((i: any) => !usesSet.has(i.call)));

  // Option A — the client-generated "rune" layer. Resolve a part's arg
  // expression (recognized source text) against the LIVE params so the GUI
  // shows the parts LINKED to the params: drag a param and the resolved
  // values update instantly (the geometry then re-bakes on Apply). Refs to
  // non-param locals can't resolve client-side → returns null (raw text shown).
  function fmtVal(v: any): string {
    if (Array.isArray(v)) {
      // Short numeric vec (e.g. mv's [x,y,z]) → inline; nested/long arrays
      // (polygon profiles) → collapse so the row stays readable.
      if (v.length <= 4 && v.every((x) => typeof x === 'number')) {
        return '[' + v.map((n) => Math.round(n * 1000) / 1000).join(', ') + ']';
      }
      return '[…]';
    }
    if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
    return String(v);
  }
  function resolveArgsText(argsText: string, p: Record<string, any>): string | null {
    try {
      const names = Object.keys(p);
      const out = new Function(...names, `return [${argsText}]`)(...names.map((n) => p[n]));
      return out.map(fmtVal).join(', ');
    } catch { return null; }
  }
  // Reactive over `pending` — re-derives the instant a slider/input changes.
  let resolvedParts = $derived(parts.map((inst: any) => ({
    ...inst,
    resolvedArgs: resolveArgsText(inst.argsText, pending),
    txs: (inst.transforms ?? []).map((t: any) => ({ ...t, resolved: resolveArgsText(t.argsText, pending) })),
  })));

  // Round-trip: editable only when this is a volume primitive AND the
  // source parsed from the ORIGINAL (positions map back). Editing an arg
  // splices the new text into editedSource at the recognized offsets,
  // making the Source dirty (Save persists). The recognition $effect then
  // re-scans editedSource → fresh offsets.
  let canEdit = $derived(editable && !!recognized?.editable);
  function spliceSource(start: number, end: number, replacement: string) {
    if (start < 0 || end < 0) return;
    editedSource = editedSource.slice(0, start) + replacement + editedSource.slice(end);
  }
  // Splice ONE recognized arg (offsets are relative to the instance's argsText).
  // Edit one arg per commit — the recognition $effect re-scans between edits, so
  // later args' offsets stay correct.
  function spliceArg(inst: any, a: { start: number; end: number }, value: string) {
    spliceSource(inst.argsStart + a.start, inst.argsStart + a.end, ' ' + value.trim());
  }

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
  type LeafProfile = { argIndex: number; yDown: boolean; hLabel: string; vLabel: string; revolve: boolean };
  let leafProfileCache = $state<Record<string, LeafProfile | null>>({});
  // Ordered param NAMES per leaf call → labels for the per-arg cards in the
  // Parts tab. Populated by fetchLeafProfile (same fetch as the profile cache).
  let leafMetaCache = $state<Record<string, string[]>>({});

  async function fetchLeafProfile(call: string): Promise<LeafProfile | null> {
    if (call in leafProfileCache) return leafProfileCache[call];
    let result: LeafProfile | null = null;
    try {
      const res = await fetch(`/api/primitives/source?name=${encodeURIComponent(call)}`);
      if (res.ok) {
        const data = await res.json();
        const params = data?.params ?? {};
        const keys = Object.keys(params);
        leafMetaCache = { ...leafMetaCache, [call]: keys };
        const idx = keys.findIndex((k) => params[k]?.type === 'polygon');
        if (idx >= 0) {
          const ps = params[keys[idx]];
          const yDown = !!ps.yDown;
          result = {
            argIndex: idx,
            yDown,
            hLabel: ps.hLabel ?? (yDown ? 'r →' : 'x →'),
            vLabel: ps.vLabel ?? (yDown ? 'z ↓' : 'y ↑'),
            revolve: yDown, // revolve profiles use the Z-down (r,z) editor
          };
        }
      }
    } catch { /* leaf unavailable → no profile button */ }
    leafProfileCache = { ...leafProfileCache, [call]: result };
    return result;
  }

  // Whether a recognized part exposes a profile we can edit in the popup.
  // Derives from the lazily-populated cache; the load $effect below fills it.
  function profileInfoFor(call: string): LeafProfile | null {
    return leafProfileCache[call] ?? null;
  }
  // Prefetch leaf-profile metadata for every editable part so the ✎ button
  // appears without a click. Runs whenever the recognized parts change.
  $effect(() => {
    if (!canEdit) return;
    for (const inst of parts as any[]) void fetchLeafProfile(inst.call);
  });

  // Split an arg-list string into its top-level argument substrings, ignoring
  // commas nested inside (), [], {}, or quotes. Returns each segment's TEXT
  // plus its [start, end) offset WITHIN argsText so we can splice precisely.
  function splitTopLevelArgs(argsText: string): Array<{ text: string; start: number; end: number }> {
    const out: Array<{ text: string; start: number; end: number }> = [];
    let depth = 0, segStart = 0, quote = '';
    for (let i = 0; i < argsText.length; i++) {
      const c = argsText[i];
      if (quote) { if (c === quote && argsText[i - 1] !== '\\') quote = ''; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === ',' && depth === 0) { out.push({ text: argsText.slice(segStart, i), start: segStart, end: i }); segStart = i + 1; }
    }
    out.push({ text: argsText.slice(segStart), start: segStart, end: argsText.length });
    return out;
  }

  // ── Profile popup state ──────────────────────────────────────────────────
  // The profile arg of an instance (Parts tab) can be one of two editable
  // shapes under the Svelte-component (meta.profiles) model:
  //   - 'profile' — `meta.profiles.<name>.value` (the encapsulated default,
  //     already extracted). The popup edits THAT value literal in the buffer.
  //   - 'literal' — an inline `[[x,y],…]` array. The popup edits it in place
  //     AND offers "Promote to profile" (extract the literal into a named
  //     meta.profiles entry + replace the inline arg with meta.profiles.<n>.value).
  // Anything else (other expression) → refuse.
  let profileEdit = $state<{
    instName: string;
    call: string;
    info: LeafProfile;
    mode: 'literal' | 'profile';
    /** Absolute offsets in editedSource of the value to splice on Apply:
     *  the inline array literal ('literal') or the meta.profiles value ('profile'). */
    profStart: number;
    profEnd: number;
    /** 'profile' mode only — the profile name being edited. */
    profileName: string | null;
    /** True when this 'literal' arg can be promoted to a meta.profiles entry. */
    canPromote: boolean;
    px: number;
    py: number;
  } | null>(null);
  let profilePts = $state<[number, number][]>([]);
  let profileBaseline = ''; // JSON of pts at open → dirty detection
  let promoteBusy = $state(false);

  // Match `meta.profiles.<name>.value` (or a `P.<name>` merge ref) → the
  // profile name. Returns null when the segment isn't a profile reference.
  function profileRefName(segText: string): string | null {
    let m = /^meta\s*\.\s*profiles\s*\.\s*([a-z_$][a-z0-9_$]*)\s*\.\s*value$/i.exec(segText);
    if (m) return m[1];
    m = /^[A-Za-z_$][\w$]*\s*\.\s*([a-z_$][a-z0-9_$]*)$/i.exec(segText); // P.body
    if (m && (recognized?.profiles ?? []).some((p: any) => p.name === m![1])) return m[1];
    return null;
  }

  // Open the popup for a recognized instance. We re-locate the profile arg
  // against the LIVE editedSource (offsets shift as the user edits) by reading
  // the recognized argsStart/argsEnd then sub-splitting the arg list.
  function openProfilePopup(inst: any, info: LeafProfile, ev: MouseEvent) {
    if (inst.argsStart < 0 || inst.argsEnd < 0) return;
    const argsText = editedSource.slice(inst.argsStart, inst.argsEnd);
    const segs = splitTopLevelArgs(argsText);
    const seg = segs[info.argIndex];
    if (!seg) return;
    const segText = seg.text.trim();
    const lead = seg.text.length - seg.text.trimStart().length;
    const segStart = inst.argsStart + seg.start + lead;
    const segEnd = inst.argsStart + seg.end - (seg.text.length - seg.text.trimEnd().length);
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const px = Math.max(8, Math.min(rect.left - 380, window.innerWidth - 480));
    const py = Math.max(8, Math.min(rect.top, window.innerHeight - 360));

    // Case 1 — a meta.profiles reference → edit that profile's value literal.
    const refName = profileRefName(segText);
    if (refName) {
      const rp = (recognized?.profiles ?? []).find((p: any) => p.name === refName);
      if (rp && rp.valueStart >= 0) {
        let pts: [number, number][] | null = null;
        try {
          const parsed = JSON.parse(editedSource.slice(rp.valueStart, rp.valueEnd).trim());
          if (Array.isArray(parsed) && parsed.every((p) => Array.isArray(p) && p.length === 2)) pts = parsed as [number, number][];
        } catch { /* value isn't a literal array */ }
        if (pts) {
          profilePts = pts.map((p) => [p[0], p[1]] as [number, number]);
          profileBaseline = JSON.stringify(profilePts);
          profileEdit = { instName: inst.name, call: inst.call, info, mode: 'profile', profStart: rp.valueStart, profEnd: rp.valueEnd, profileName: refName, canPromote: false, px, py };
          return;
        }
      }
      recogError = `Can't edit ${inst.name}'s profile — "${segText}" references a profile with no literal value. (Edit it in the Profiles tab.)`;
      return;
    }

    // Case 2 — inline literal array → edit in place + offer Promote.
    let pts: [number, number][] | null = null;
    try {
      const parsed = JSON.parse(segText);
      if (Array.isArray(parsed) && parsed.every((p) => Array.isArray(p) && p.length === 2)) pts = parsed as [number, number][];
    } catch { /* not a literal array (expression) → can't edit visually */ }
    if (!pts) {
      // Case 3 — a resolveProfile({kind,params}) FUNCTION profile (function-first
      // parts). You don't drag vertices on a function — its params ARE the part's
      // params (edit them in the Parameters panel). Matches both the inline call
      // AND a local var (`const profile = resolveProfile({kind:'X'})`) since the
      // scaffold names it. Show the kind + a resolved preview instead of erroring.
      const KIND_RE = /resolveProfile\s*\(\s*\{[^{}]*\bkind\s*:\s*['"]([a-z_$][\w$]*)['"]/i;
      let fnKind: string | null = null;
      const inlineM = KIND_RE.exec(segText);
      if (inlineM) fnKind = inlineM[1];
      else if (/^[A-Za-z_$][\w$]*$/.test(segText)) {
        const declM = new RegExp(`\\b(?:const|let|var)\\s+${segText}\\s*=\\s*` + KIND_RE.source, 'i').exec(editedSource);
        if (declM) fnKind = declM[1];
      }
      if (fnKind) {
        // Function profile → open the unified editor directly (selector in its
        // title repoints the part); no intermediate picker popup.
        void openInstanceFnEditor(inst, info, fnKind);
        return;
      }
      recogError = `Can't edit ${inst.name}'s profile visually — arg ${info.argIndex} isn't a literal [[x,y],…] array or a meta.profiles reference.`; return;
    }
    profilePts = pts.map((p) => [p[0], p[1]] as [number, number]);
    profileBaseline = JSON.stringify(profilePts);
    const canPromote = !!recognized?.editable && (recognized.profilesInsertPos >= 0 || recognized.metaInsertPos >= 0);
    profileEdit = { instName: inst.name, call: inst.call, info, mode: 'literal', profStart: segStart, profEnd: segEnd, profileName: null, canPromote, px, py };
  }
  let profileDirty = $derived(profileEdit !== null && JSON.stringify(profilePts) !== profileBaseline);
  function closeProfilePopup() { profileEdit = null; }
  // Apply: serialize the edited polygon and splice it over the target (inline
  // literal or meta.profiles value) in editedSource. → Source dirty; canvases
  // re-bake off editedSource; the recognition $effect re-scans.
  function applyProfile() {
    if (!profileEdit) return;
    const json = JSON.stringify(profilePts);
    spliceSource(profileEdit.profStart, profileEdit.profEnd, json);
    profileBaseline = json;
    closeProfilePopup();
  }
  // Composite popup: the inline profile is a raw point literal (not a {kind}
  // descriptor), so the searchable dropdown loads the chosen shape's polygon
  // into the editor (like the old preset chips, but searchable + thumbnailed).
  // Apply then splices these points back into the call.
  function pickProfileShape(id: string, origin: 'builtin' | 'volume') {
    let pts: [number, number][] | null = null;
    const def = PROFILE_REGISTRY[id];
    if (origin === 'builtin' && def) {
      try { pts = def.build(defaultsFor(def)) as [number, number][]; } catch { /* ignore */ }
    } else {
      const v = volProfiles.find((x) => x.id === id);
      if (v) {
        try { pts = resolveProfile(Array.isArray(v.points) ? v.points : { kind: v.kind!, params: v.params ?? {} }) as [number, number][]; } catch { /* ignore */ }
      }
    }
    if (pts && pts.length) profilePts = pts.map((p) => [p[0], p[1]] as [number, number]);
  }

  // ── Profile shape extraction (for the shape-icon previews) ───────────────
  // Pull the polygon points for a recognized part instance WITHOUT opening the
  // popup — mirrors openProfilePopup's locate logic (meta.profiles ref OR inline
  // literal). Returns null when the arg isn't a literal/profile we can draw.
  function profilePtsPreview(inst: any): [number, number][] | null {
    const info = profileInfoFor(inst.call);
    if (!info || inst.argsStart < 0 || inst.argsEnd < 0) return null;
    try {
      const argsText = editedSource.slice(inst.argsStart, inst.argsEnd);
      const seg = splitTopLevelArgs(argsText)[info.argIndex];
      if (!seg) return null;
      const segText = seg.text.trim();
      const refName = profileRefName(segText);
      if (refName) {
        const rp = (recognized?.profiles ?? []).find((p: any) => p.name === refName);
        if (rp && rp.valueStart >= 0) {
          const parsed = JSON.parse(editedSource.slice(rp.valueStart, rp.valueEnd).trim());
          if (Array.isArray(parsed) && parsed.every((p) => Array.isArray(p) && p.length === 2)) return parsed as [number, number][];
        }
        return null;
      }
      const parsed = JSON.parse(segText);
      if (Array.isArray(parsed) && parsed.every((p) => Array.isArray(p) && p.length === 2)) return parsed as [number, number][];
    } catch { /* not a literal we can draw */ }
    return null;
  }

  // Build an SVG path `d` from polygon points, fitted into a `size`×`size` box
  // (with `pad` margin). Y is flipped so the drawing matches screen-up. Closed
  // path. Returns '' for empty/degenerate input.
  function pathFor(pts: [number, number][] | null | undefined, size: number, pad = 1.5): string {
    if (!pts || pts.length < 2) return '';
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of pts) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const w = maxX - minX || 1, h = maxY - minY || 1;
    const span = size - pad * 2;
    const s = Math.min(span / w, span / h);
    // Center the (possibly non-square) shape within the box.
    const ox = pad + (span - w * s) / 2, oy = pad + (span - h * s) / 2;
    const tx = (x: number) => ox + (x - minX) * s;
    const ty = (y: number) => oy + (maxY - y) * s; // flip Y (screen-up)
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${tx(p[0]).toFixed(2)},${ty(p[1]).toFixed(2)}`).join(' ') + ' Z';
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
  function openLeafProfile(pname: string, ev: MouseEvent) {
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
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
    target: 'leaf' | 'instance'; pname: string | null;
    set: 'revolve' | 'cartesian'; seed: any;
    /** When editing a PART's function profile: the binding used by the title
     *  selector to repoint the part (swap which profile drives it). */
    bind?: { instName: string; kind: string; revolve: boolean } | null;
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
  function openFnEditor(target: 'leaf' | 'instance', pname: string | null, set: 'revolve' | 'cartesian', ev: MouseEvent) {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    fnEditor = { target, pname, set, seed: null, ...fnEditorPos(r.left, r.bottom) };
  }
  // EDIT-EXISTING (K.22 D): fetch a saved function profile's source + params and
  // open the editor seeded from it. Save then UPDATES it (same id overwrites).
  function bodyOf(source: string): string {
    const i = source.indexOf('{'), j = source.lastIndexOf('}');
    return i >= 0 && j > i ? source.slice(i + 1, j).replace(/^\n/, '').replace(/\n\s*$/, '') : source;
  }
  async function editFnProfile(target: 'leaf' | 'instance', pname: string | null, id: string) {
    try {
      const r = await fetch(`/api/primitives/profiles/source?id=${encodeURIComponent(id)}`);
      if (!r.ok) return;
      const p = await r.json();
      if (!p.source) return; // configured/drawn profile — no build() to edit
      fnEditor = {
        target, pname, set: p.set ?? 'revolve',
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
  // Open the editor bound to an instance's function profile (`resolveProfile({kind})`).
  async function openInstanceFnEditor(inst: any, info: LeafProfile, kind: string) {
    const set: 'revolve' | 'cartesian' = info.revolve ? 'revolve' : 'cartesian';
    const pos = editorOpenPos();
    const bind = { instName: inst.name, kind, revolve: !!info.revolve };
    const seed = await seedForKind(kind);
    fnEditor = { target: 'instance', pname: null, set, seed, bind, ...pos };
  }
  // Title selector → swap WHICH profile drives the part: repoint the part's
  // source (kind string, regex-relocated so it survives offset shifts) then
  // reseed the editor from the picked profile. Volume kinds resolve via the P6
  // bake path, so both curated + volume swaps work.
  async function swapEditorProfile(id: string, _origin: 'builtin' | 'volume') {
    const b = fnEditor?.bind;
    if (!b || id === b.kind) return;
    const esc = b.kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`(\\bkind\\s*:\\s*['"])${esc}(['"])`).exec(editedSource);
    if (m) { const kStart = m.index + m[1].length; spliceSource(kStart, kStart + b.kind.length, id); }
    const pos = { px: fnEditor!.px, py: fnEditor!.py };
    const nb = { ...b, kind: id };
    const seed = await seedForKind(id);
    fnEditor = { target: 'instance', pname: null, set: fnEditor!.set, seed, bind: nb, ...pos };
  }
  async function onFnSaved(id: string) {
    const ed = fnEditor;
    await loadVolProfiles(true);
    // Repoint the bound part's function profile to the saved id (so editing a
    // profile OR saving it as a new custom one actually drives the part).
    if (ed?.bind && id !== ed.bind.kind) {
      const esc = ed.bind.kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = new RegExp(`(\\bkind\\s*:\\s*['"])${esc}(['"])`).exec(editedSource);
      if (m) { const kStart = m.index + m[1].length; spliceSource(kStart, kStart + ed.bind.kind.length, id); }
    } else if (ed?.target === 'leaf' && ed.pname) {
      pickPaletteProfile(ed.pname, id, 'volume');
    }
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

  // ── Function-profile params shown INSIDE the part row ─────────────────────
  // A revolve part driven by a function profile (`resolveProfile({kind})`,
  // inline or via a named local) has the profile's params LIFTED into the
  // part's meta.params. Surface those params right inside the part's accordion
  // (not only the top Parameters panel) so they're encapsulated with the part
  // that uses them — editable there, sharing the same pending/applied state.
  const PROFILE_KIND_RE = /resolveProfile\s*\(\s*\{[^{}]*\bkind\s*:\s*['"]([a-z_$][\w$]*)['"]/i;
  // The function-profile kind a part instance is driven by (null if none).
  function partProfileKind(inst: any): string | null {
    const info = profileInfoFor(inst.call);
    if (!info || inst.argsStart < 0) return null;
    const seg = splitTopLevelArgs(inst.argsText)[info.argIndex];
    if (!seg) return null;
    const segText = seg.text.trim();
    const inlineM = PROFILE_KIND_RE.exec(segText);
    if (inlineM) return inlineM[1];
    // a named local: `const profile = resolveProfile({kind:'X'})`
    if (/^[A-Za-z_$][\w$]*$/.test(segText)) {
      const declM = new RegExp(`\\b(?:const|let|var)\\s+${segText}\\s*=\\s*` + PROFILE_KIND_RE.source, 'i').exec(editedSource);
      if (declM) return declM[1];
    }
    return null;
  }
  // The profile's param SCHEMA (curated registry, else a volume ƒ profile).
  function profileSchemaForKind(kind: string): Record<string, any> | null {
    const def = PROFILE_REGISTRY[kind];
    if (def) return def.params as any;
    const v = volProfiles.find((p) => p.id === kind) as any;
    return v && v.params && typeof v.params === 'object' ? v.params : null;
  }
  // Profile param names that are ALSO part params (lifted) — those we can show
  // + edit inside the part row. Order follows the profile schema.
  function partProfileParamNames(inst: any): string[] {
    const kind = partProfileKind(inst);
    if (!kind) return [];
    const schema = profileSchemaForKind(kind);
    if (!schema) return [];
    return Object.keys(schema).filter((n) => n in effectiveSchema && effectiveSchema[n]?.type !== 'polygon');
  }
  // A filtered schema (just the named params) to feed ParamGrid in the part row.
  function pickSchema(names: string[]): Record<string, any> {
    const out: Record<string, any> = {};
    for (const n of names) if (effectiveSchema[n]) out[n] = effectiveSchema[n];
    return out;
  }
  function leafKindOptions(yd: boolean) {
    const set = yd ? 'revolve' : 'cartesian';
    return Object.values(PROFILE_REGISTRY).filter((def) => def.set === set);
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

  // Promote an inline profile literal → an encapsulated meta.profiles entry
  // (the Svelte-component model). Two edits, high→low offset:
  //   1. replace the inline literal in the body with `meta.profiles.<name>.value`
  //   2. add a `<name>: { …flags, value: <literal> }` entry to meta.profiles
  //      (creating the `profiles: {…}` block if the meta has none)
  // The flags mirror the leaf's polygon flags so the Profiles-tab ProfileEditor
  // renders it the same way as the leaf.
  function suggestProfileName(instName: string): string {
    const taken = new Set<string>((recognized?.profiles ?? []).map((p: any) => p.name));
    let base = instName || 'profile';
    if (!taken.has(base)) return base;
    let i = 2; while (taken.has(`${base}${i}`)) i++; return `${base}${i}`;
  }
  function promoteProfile() {
    if (!profileEdit || profileEdit.mode !== 'literal' || !profileEdit.canPromote || promoteBusy) return;
    const r = recognized;
    if (!r) return;
    promoteBusy = true;
    try {
      const pname = suggestProfileName(profileEdit.instName);
      const info = profileEdit.info;
      const literal = JSON.stringify(profilePts);
      const flags: string[] = [`label: '${profileEdit.instName} section'`, `type: 'polygon'`];
      if (info.yDown) flags.push(`yDown: true`, `hLabel: '${info.hLabel}'`, `vLabel: '${info.vLabel}'`);
      flags.push(`value: ${literal}`);
      const entryBody = `${pname}: { ${flags.join(', ')} }`;
      const edits: Array<{ s: number; e: number; text: string }> = [
        { s: profileEdit.profStart, e: profileEdit.profEnd, text: `meta.profiles.${pname}.value` },
      ];
      if (r.profilesInsertPos >= 0) {
        // meta.profiles already exists → append an entry.
        edits.push({ s: r.profilesInsertPos, e: r.profilesInsertPos, text: `${r.profilesHasElems ? ', ' : ''}${entryBody}` });
      } else {
        // No profiles block → synthesise one at the end of meta.
        edits.push({ s: r.metaInsertPos, e: r.metaInsertPos, text: `, profiles: { ${entryBody} }` });
      }
      edits.sort((a, b) => b.s - a.s);
      let out = editedSource;
      for (const ed of edits) out = out.slice(0, ed.s) + ed.text + out.slice(ed.e);
      editedSource = out; // → Source dirty; the recognition $effect re-scans
      closeProfilePopup();
    } finally {
      promoteBusy = false;
    }
  }

  // ── Load primitive → scaffold an instance ────────────────────────────────
  // Pick a primitive; we fetch its params (the catalog list is id-only/lazy),
  // scaffold `const <inst> = <call>(<default args>)` before the return, wire
  // it into the composition (`.add(<inst>)`) + meta.uses, and write it into
  // the source. The inlined defaults are then editable via the rows above.
  let loadPick = $state('');
  let dragOverCanvas = $state(false);  // sidebar→canvas drag-to-add highlight
  let loadBusy = $state(false);
  // Dedupe by id — the merged catalog can legitimately contain the same id
  // twice (e.g. a primitive present at both the flat location and a category
  // sub-folder on the volume). A duplicate KEY in the {#each (e.id)} below
  // throws `each_key_duplicate`, which crashes the whole inspector render
  // (parts stuck on "recognizing…"). Dedupe so a volume inconsistency can
  // never break the UI.
  let loadable = $derived.by(() => {
    const seen = new Set<string>();
    const out: Array<{ id: string }> = [];
    for (const e of catalog ?? []) {
      if (e.id === id || seen.has(e.id)) continue;
      seen.add(e.id); out.push(e);
    }
    return out;
  });
  function defaultArgFor(ps: any): string {
    const d = ps?.default;
    return Array.isArray(d) ? JSON.stringify(d) : String(d ?? 0);
  }
  function uniqueInstName(childId: string): string {
    // FORBID names that would shadow an injected function param: the instance
    // name must never equal the primitive it calls (`const X = X()` hits the
    // temporal-dead-zone → "Cannot access X before initialization"), nor any
    // OTHER instance's call id, nor a sandbox helper. Strip a leading r_/t_
    // type prefix so e.g. t_goblet_bored → goblet_bored (≠ the call).
    const callIds = [...parts, ...locals].map((i: any) => i.call);
    const taken = new Set<string>([
      ...[...parts, ...locals].map((i: any) => i.name),
      ...callIds, childId,
      'cyl', 'tube', 'mv', 'rot', 'revolve', 'profile_extrude', 'helix_band', 'empty',
      'gridPatch', 'capFan', 'weldAndBuild', 'revolveProfile', 'resolveProfile', 'M', 'G', 'Math',
    ]);
    const base = childId.replace(/^[rt]_/, '') || 'part';
    if (!taken.has(base)) return base;
    let i = 2; while (taken.has(base + i)) i++; return base + i;
  }

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
  function submitAddParam() {
    const r = recognized;
    const n = apName.trim();
    if (!n || addParamError || !r || r.paramsInsertPos < 0 || r.sigInsertPos < 0) return;
    const def = Number(apDefault) || 0, mn = Number(apMin) || 0, mx = Number(apMax) || 10, st = Number(apStep) || 0.1;
    const entry = `${r.paramsHasElems ? ', ' : ''}${n}: { label: '${n}', min: ${mn}, max: ${mx}, step: ${st}, default: ${def} }`;
    const sigParam = `${r.sigHasParams ? ', ' : ''}${n}`;
    // Two splices, applied high→low so the earlier offset stays valid.
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
  function deleteParam(name: string) {
    const r = recognized;
    if (!canEdit || !r) return;
    const rp = (r.params ?? []).find((p: any) => p.name === name);
    if (!rp || rp.entryStart < 0) { recogError = `Can't delete "${name}" — not found in the source meta.`; return; }
    // Guard: refuse if the name is referenced anywhere OUTSIDE its own meta
    // entry + signature token (i.e. used by the geom body) — deleting it would
    // leave a dangling reference and break the bake.
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![.\\w$])${esc}(?![\\w$])`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(editedSource))) {
      const i = m.index;
      const inEntry = i >= rp.entryStart && i < rp.entryEnd;
      const inSig = rp.sigStart >= 0 && i >= rp.sigStart && i < rp.sigEnd;
      if (!inEntry && !inSig) {
        recogError = `Can't delete "${name}" — it's still used in the function body. Remove those references first.`;
        return;
      }
    }
    const edits = [spanWithComma(rp.entryStart, rp.entryEnd)];
    if (rp.sigStart >= 0) edits.push(spanWithComma(rp.sigStart, rp.sigEnd));
    edits.sort((a, b) => b.s - a.s); // high→low so earlier offsets stay valid
    let out = editedSource;
    for (const ed of edits) out = out.slice(0, ed.s) + out.slice(ed.e);
    editedSource = out; // → Source dirty; recognition $effect re-scans + re-bake
    const drop = <T extends Record<string, any>>(o: T) => { const { [name]: _x, ...rest } = o; return rest as T; };
    addedParams = drop(addedParams);
    pending = drop(pending);
    applied = drop(applied);
    removedParams = new Set([...removedParams, name]); // hide from the grid now
  }

  // ── Delete a part (✕) ───────────────────────────────────────────────────
  // Remove the instance's `const X = …;` declaration + splice it out of the
  // composition (mid-chain `.op(X)` removed; base operand → next promoted).
  // Leaves an unused meta.uses dep (harmless). Edits the buffer only —
  // Revert/reload undoes; Save source persists.
  function deletePart(inst: any) {
    const r = recognized;
    if (!canEdit || !r || inst.declStart < 0) return;
    // Block if another instance references this one (cross-instance arg/transform).
    const refRe = new RegExp(`(?<![.\\w$])${inst.name}(?![\\w$])`);
    for (const o of parts as any[]) {
      if (o.name === inst.name) continue;
      if (refRe.test(o.argsText ?? '') || (o.transforms ?? []).some((t: any) => refRe.test(t.argsText ?? ''))) {
        recogError = `Can't delete ${inst.name} — referenced by ${o.name}. Remove that reference first.`;
        return;
      }
    }
    const ops = (r.operands ?? []) as any[];
    const idx = ops.findIndex((o) => o.name === inst.name);
    const edits: Array<{ s: number; e: number; text: string }> = [];
    // 1. remove the declaration + trailing whitespace/newline.
    let dEnd = inst.declEnd;
    while (dEnd < editedSource.length && /\s/.test(editedSource[dEnd])) dEnd++;
    edits.push({ s: inst.declStart, e: dEnd, text: '' });
    // 2. remove from the composition.
    if (idx >= 0) {
      const op = ops[idx];
      if (!op.isBase) {
        edits.push({ s: op.segStart, e: op.segEnd, text: '' });
      } else if (ops.length >= 2) {
        const next = ops[1];
        edits.push({ s: op.segStart, e: next.segEnd, text: editedSource.slice(next.argStart, next.argEnd) });
      } else {
        recogError = `Can't delete ${inst.name} — it's the only part (the composite must return something).`;
        return;
      }
    }
    edits.sort((a, b) => b.s - a.s);
    let out = editedSource;
    for (const ed of edits) out = out.slice(0, ed.s) + ed.text + out.slice(ed.e);
    editedSource = out;
    pinnedParts = new Set([...pinnedParts].filter((n) => n !== inst.name));
  }

  // ── ƒ function / expression picker for a part arg ───────────────────────
  // Edit an instance arg as an expression: bare param names + Math.* + arithmetic.
  // Param refs resolve at build (params are in the composite's function scope).
  // Cross-instance <INST>.<arg> refs are a later phase (need expandInstancePropRefs).
  let fxEdit = $state<{ inst: any; a: any; raw: string; px: number; py: number } | null>(null);
  let fxParams = $derived(paramOrder.filter((k) => effectiveSchema[k]?.type !== 'polygon'));
  function openFx(inst: any, a: any, ev: MouseEvent) {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    fxEdit = { inst, a, raw: a.text.trim(), px: Math.max(8, Math.min(r.left - 210, window.innerWidth - 320)), py: Math.min(r.bottom + 6, window.innerHeight - 220) };
  }
  function closeFx() { fxEdit = null; }
  function fxAppend(tok: string) { if (fxEdit) fxEdit = { ...fxEdit, raw: fxEdit.raw + tok }; }
  function applyFx() { if (!fxEdit) return; spliceArg(fxEdit.inst, fxEdit.a, fxEdit.raw); closeFx(); }

  // ── Warp at end (construction-tree Slice 0) ─────────────────────────────
  // Wrap the WHOLE composition in warpSpline(comp, path, {refine}) — bends the
  // assembled solid along an (x,z) spline as the final transform. The
  // recognizer exposes warpInnerStart/End (the inner comp) + warpPathStart/End
  // (the path arg) so the toggle round-trips and delete-part still sees the
  // inner chain. Edits the buffer only; Save source persists.
  // A ~quarter-arc (radius ≈ 2.5) so a typical part bends visibly over its own
  // length WITHOUT stretching (warpSpline maps z→arc-length 1:1 by default).
  const DEFAULT_WARP_PATH: number[][] = [[0, 0], [0.34, 1.25], [1.25, 2.17], [2.5, 2.5]];
  let isWarped = $derived((recognized?.warpInnerStart ?? -1) >= 0);
  let showTree = $state(false);
  let warpPathEdit = $state<{ pts: number[][] } | null>(null);
  function toggleWarpEnd() {
    const r = recognized;
    if (!canEdit || !r || r.compStart < 0 || r.compEnd < 0) return;
    if ((r.warpInnerStart ?? -1) >= 0) {
      const inner = editedSource.slice(r.warpInnerStart, r.warpInnerEnd);
      editedSource = editedSource.slice(0, r.compStart) + inner + editedSource.slice(r.compEnd);
    } else {
      const comp = editedSource.slice(r.compStart, r.compEnd);
      editedSource = editedSource.slice(0, r.compStart)
        + `warpSpline(${comp}, ${JSON.stringify(DEFAULT_WARP_PATH)}, { refine: 4 })`
        + editedSource.slice(r.compEnd);
    }
  }
  function openWarpPath() {
    const r = recognized;
    if (!r || (r.warpPathStart ?? -1) < 0) return;
    let pts: number[][];
    try { pts = JSON.parse(editedSource.slice(r.warpPathStart, r.warpPathEnd)); } catch { pts = DEFAULT_WARP_PATH; }
    if (!Array.isArray(pts) || pts.length < 2) pts = DEFAULT_WARP_PATH;
    warpPathEdit = { pts };
  }
  function closeWarpPath() { warpPathEdit = null; }
  function applyWarpPath() {
    const r = recognized;
    if (!warpPathEdit || !r || (r.warpPathStart ?? -1) < 0) return;
    const txt = JSON.stringify(warpPathEdit.pts.map((p) => [p[0], p[1]]));
    editedSource = editedSource.slice(0, r.warpPathStart) + txt + editedSource.slice(r.warpPathEnd);
    warpPathEdit = null;
  }
  async function loadPrimitive(childId?: string) {
    const r = recognized;
    const child = childId ?? loadPick;
    if (!child || !r || r.returnStart < 0 || r.compStart < 0) return;
    loadBusy = true;
    recogError = null;
    try {
      // Fetch the chosen primitive's params (defaults) — the list is lazy.
      const res = await fetch(`/api/primitives/source?name=${encodeURIComponent(child)}`);
      if (!res.ok) { recogError = `Load failed: ${await res.text()}`; return; }
      const data = await res.json();
      const childParams = data.params ?? {};
      const inst = uniqueInstName(child);
      const argList = Object.values(childParams).map(defaultArgFor).join(', ');
      const src = editedSource;
      // Three edits, applied high→low offset so earlier offsets stay valid.
      const edits = [
        { s: r.compStart, e: r.compEnd, text: src.slice(r.compStart, r.compEnd) + `.add(${inst})` },
        { s: r.returnStart, e: r.returnStart, text: `const ${inst} = ${child}(${argList});\n  ` },
      ];
      if (r.usesInsertPos >= 0) {
        edits.push({ s: r.usesInsertPos, e: r.usesInsertPos, text: (r.usesHasElems ? ', ' : '') + `'${child}'` });
      }
      edits.sort((a, b) => b.s - a.s);
      let out = src;
      for (const ed of edits) out = out.slice(0, ed.s) + ed.text + out.slice(ed.e);
      editedSource = out;       // → Source dirty; the recognition $effect re-scans
      loadPick = '';
    } catch (e: any) {
      recogError = `Load error: ${e?.message ?? e}`;
    } finally {
      loadBusy = false;
    }
  }

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
    try { await onSaveSource(editedSource); } finally { saving = false; }
  }
  async function saveDefaults() {
    if (!onSaveDefaults) return;
    saving = true;
    try { await onSaveDefaults(applied); } finally { saving = false; }
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
     wrapping button (opens the ✎ popup). -->
{#snippet shapeIcon(pts: [number, number][] | null | undefined)}
  <span class="pv-shape-ic" aria-hidden="true">
    {#if pts && pts.length >= 2}
      <svg viewBox="0 0 18 18" width="18" height="18">
        <path d={pathFor(pts, 18)} fill="rgba(34,102,204,0.18)" stroke="#2266cc" stroke-width="1" stroke-linejoin="round" />
      </svg>
    {:else}
      <svg viewBox="0 0 18 18" width="18" height="18"><path d="M3 14 L9 4 L15 14 Z" fill="none" stroke="#2266cc" stroke-width="1" stroke-linejoin="round" /></svg>
    {/if}
    <span class="pv-shape-tip" role="tooltip">
      <span class="pv-shape-tip-label">profile</span>
      {#if pts && pts.length >= 2}
        <svg class="pv-shape-tip-svg" viewBox="0 0 72 72" width="72" height="72">
          <path d={pathFor(pts, 72, 6)} fill="rgba(34,102,204,0.15)" stroke="#2266cc" stroke-width="1.4" stroke-linejoin="round" />
        </svg>
      {/if}
    </span>
  </span>
{/snippet}

<div class="pv-root">
  <div class="pv-split" style="--side-width: {sideWidth}px;">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="pv-canvas-pane"
      class:pv-drop-ok={dragOverCanvas}
      role="application"
      ondragover={(ev) => { if (canEdit && recognized && recognized.returnStart >= 0 && ev.dataTransfer?.types.includes('application/x-primitive-id')) { ev.preventDefault(); dragOverCanvas = true; } }}
      ondragleave={() => { dragOverCanvas = false; }}
      ondrop={(ev) => { dragOverCanvas = false; const dropped = ev.dataTransfer?.getData('application/x-primitive-id'); if (dropped && canEdit && recognized && recognized.returnStart >= 0) { ev.preventDefault(); loadPrimitive(dropped); } }}
    >
      <!-- Always pass `source` so the preview runs through the sandbox
           path (which has a first-export fallback when the function
           name differs from the directory id, e.g. dir
           `profile_extrude_v2` containing `export function profile_extrude`).
           The bundle fast-path can't handle that mismatch. -->
      <PrimitiveDualCanvas {id} {name} {description} args={appliedArgs} source={editedSource} />
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
      <div class="pv-tabs" role="tablist">
        <button class="pv-tab" class:active={tab === 'build'} onclick={() => (tab = 'build')} type="button" role="tab">
          <span class="pv-ic">⚙</span> Build
          {#if paramsDirty || sourceDirty}<span class="pv-dot"></span>{/if}
        </button>
        <button class="pv-tab" class:active={tab === 'source'} onclick={() => (tab = 'source')} type="button" role="tab">
          <span class="pv-ic">🛠</span> Source
          {#if sourceDirty}<span class="pv-dot"></span>{/if}
        </button>
        {#if editable}
          <button class="pv-tab pv-tab-ai" class:active={tab === 'ai'} onclick={() => (tab = 'ai')} type="button" role="tab">
            <span class="pv-ic">✦</span> AI
          </button>
        {/if}
      </div>

      {#if tab === 'build'}
        <!-- Merged Build tab — Parameters section (ParamGrid + leaf polygon
             ✎ popups) on top, then ONE collapsible accordion row per
             recognized part (args + transform chain + ✎ profile inside).
             Mirrors the /components inspector accordion (.pg-acc-* + .pr-card). -->
        <div class="pv-pane pv-build">
          <div class="pv-pane-head">
            <span class="pv-pill" class:dirty={paramsDirty || sourceDirty}>
              {paramsDirty ? 'params pending — Enter to apply' : sourceDirty ? 'source edited' : 'in sync'}
            </span>
            <div class="pv-spacer"></div>
            {#if onSaveDefaults}
              <button class="pv-btn" onclick={saveDefaults} type="button" disabled={!editable || saving} title="Rewrite the default: literals in source.ts">Save defaults</button>
            {/if}
            {#if canEdit && onSaveSource}
              <button class="pv-btn primary" type="button" onclick={saveSource} disabled={saving || !sourceDirty}>Save source</button>
            {/if}
          </div>

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
                {#if canEdit && recognized && recognized.paramsInsertPos >= 0 && recognized.sigInsertPos >= 0}
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
                    onDelete={canEdit ? deleteParam : undefined}
                  />
                  <!-- Polygon leaf params — ParamGrid skips these; each gets a
                       ✎ card that opens the ProfileEditor in a popup (editing
                       pending; Apply commits → re-bake). -->
                  {#each polygonParamNames as pname (pname)}
                    {@const cardPts = resolveProfile((pending[pname] ?? effectiveSchema[pname].default) as any)}
                    {@const cardKind = leafKindOf(pname)}
                    <div class="pr-card pv-poly-card" class:dirty={JSON.stringify(pending[pname] ?? []) !== JSON.stringify(applied[pname] ?? [])}>
                      <span class="pr-keyname" title={paramSchema[pname].label ?? pname}>{paramSchema[pname].label ?? pname}</span>
                      <span class="pv-poly-verts">{cardKind ? cardKind : `${cardPts.length} verts`}</span>
                      <div class="pv-spacer"></div>
                      <button class="pv-part-profile" type="button" title="Edit this profile in a popup" onclick={(e) => openLeafProfile(pname, e)}>{@render shapeIcon(cardPts)}<span class="pv-part-profile-lbl">profile</span></button>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>

            <!-- Parts — recognized instances. Add/Load + Re-scan controls. -->
            <div class="pv-parts-tools">
              {#if canEdit && recognized && recognized.returnStart >= 0}
                <select class="pv-load-pick" bind:value={loadPick} title="Load a primitive as a new instance">
                  <option value="">＋ Load…</option>
                  {#each loadable as e (e.id)}<option value={e.id}>{e.id}</option>{/each}
                </select>
                <button class="pv-mini-btn" type="button" disabled={!loadPick || loadBusy} onclick={() => loadPrimitive()}>{loadBusy ? '…' : 'Add'}</button>
              {/if}
              <div class="pv-spacer"></div>
              <span class="pv-parts-count">{parts.length} part{parts.length === 1 ? '' : 's'}</span>
              <button class="pv-mini-btn" type="button" onclick={loadRecognition}>Re-scan</button>
            </div>

            {#if recogStatus === 'loading'}
              <div class="pv-parts-empty">recognizing…</div>
            {:else if recogError}
              <div class="pv-parts-err">{recogError}</div>
            {:else if parts.length === 0}
              <div class="pv-parts-empty">No parts recognized — this is a leaf (no <code>meta.uses</code> instances). Parts appear for composites that call other primitives.</div>
            {:else}
              {#each resolvedParts as inst (inst.name)}
                {@const open = isOpen(inst.name)}
                <div class="pg-acc-wrap instance">
                  <div class="pg-acc-head instance" class:collapsed={!open}
                    role="button" tabindex="0"
                    aria-expanded={open}
                    onclick={() => togglePart(inst.name)}
                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePart(inst.name); } }}>
                    <button class="pv-pin" class:pinned={pinnedParts.has(inst.name)} type="button" title={pinnedParts.has(inst.name) ? 'Unpin (allow collapse)' : 'Pin open (stays open while other rows open)'} onclick={(e) => { e.stopPropagation(); togglePin(inst.name); }}>📌</button>
                    <span class="pg-acc-title">{inst.name}</span>
                    <span class="pg-acc-sig">:{inst.call}</span>
                    <div class="pv-spacer"></div>
                    {#if canEdit && inst.argsStart >= 0 && profileInfoFor(inst.call)}
                      <button
                        class="pv-part-profile"
                        type="button"
                        title="Edit this instance's profile in a popup"
                        onclick={(e) => { e.stopPropagation(); openPart(inst.name); openProfilePopup(inst, profileInfoFor(inst.call)!, e); }}
                      >{@render shapeIcon(profilePtsPreview(inst))}<span class="pv-part-profile-lbl">profile</span></button>
                    {/if}
                    {#if canEdit && inst.declStart >= 0}
                      <button class="pv-part-txdel" type="button" title="Delete this part — removes it from the composition" onclick={(e) => { e.stopPropagation(); deletePart(inst); }}>✕</button>
                    {/if}
                  </div>
                  {#if open}
                    <div class="pg-acc-body pv-part-body">
                      {#if canEdit && inst.argsStart >= 0}
                        {@const argSpans = splitTopLevelArgs(inst.argsText)}
                        {@const pnames = leafMetaCache[inst.call] ?? []}
                        {@const polyIdx = profileInfoFor(inst.call)?.argIndex ?? -1}
                        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:4px 8px;">
                          {#each argSpans as a, i (i)}
                            {#if i === polyIdx}
                              <div style="display:flex; align-items:center; gap:6px;">
                                <span style="min-width:0; flex:0 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:600 11px Arial; color:#555;" title={pnames[i] ?? `arg${i}`}>{pnames[i] ?? `arg${i}`}</span>
                                <span style="flex:1; font:10px Arial; color:#2266cc;">↑ edit via the profile button</span>
                              </div>
                            {:else}
                              {@const isLit = /^\s*-?\d*\.?\d+\s*$/.test(a.text)}
                              <div style="display:flex; align-items:center; gap:6px;">
                                <span style="min-width:0; flex:0 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:600 11px Arial; color:#555;" title={pnames[i] ?? `arg${i}`}>{pnames[i] ?? `arg${i}`}</span>
                                <input
                                  value={a.text.trim()}
                                  spellcheck="false"
                                  title={isLit ? 'number — Enter to commit' : 'expression (param names · Math.*) — Enter to commit'}
                                  onkeydown={(e) => { if (e.key === 'Enter') spliceArg(inst, a, (e.currentTarget as HTMLInputElement).value); }}
                                  style="flex:1; min-width:0; font:11px ui-monospace, monospace; padding:2px 5px; border:1px solid {isLit ? '#d8d8e0' : '#d4e1f5'}; border-radius:4px; background:{isLit ? '#fff' : '#eef3fb'};"
                                />
                                <button type="button" title="Edit as a function / expression (param names · Math.*)" onclick={(e) => openFx(inst, a, e)} style="border:none; background:transparent; cursor:pointer; font:600 13px Arial; color:{isLit ? '#bbb' : '#2266cc'}; padding:0 2px; line-height:1;">ƒ</button>
                              </div>
                            {/if}
                          {/each}
                        </div>
                      {:else}
                        <div class="pv-part-args">{inst.argsText}</div>
                      {/if}
                      <!-- Function-profile params lifted into the part — shown
                           HERE (encapsulated with the part that uses them), not
                           only in the top Parameters panel. Shares pending/
                           applied, so edits live-rebake + mirror the top grid. -->
                      {#if partProfileParamNames(inst).length}
                        {@const ppNames = partProfileParamNames(inst)}
                        <div class="pv-profile-params">
                          <div class="pv-pp-head">profile params · <code>{partProfileKind(inst)}</code></div>
                          <ParamGrid schema={pickSchema(ppNames)} {pending} {applied} onPending={setPending} onCommit={commitOne} variant="fn" />
                        </div>
                      {/if}
                      {#each inst.txs as t}
                        <div class="pv-part-tx">
                          ↳ {t.op}(
                          {#if canEdit && t.argsStart >= 0}
                            <input
                              class="pv-part-edit pv-part-edit-tx"
                              value={t.argsText}
                              spellcheck="false"
                              onkeydown={(e) => { if (e.key === 'Enter') spliceSource(t.argsStart, t.argsEnd, (e.currentTarget as HTMLInputElement).value); }}
                            />
                          {:else}{t.argsText}{/if}
                          )
                          {#if canEdit && t.callStart >= 0}<button class="pv-part-txdel" type="button" title="Delete this transform" onclick={() => deleteTransform(t)}>✕</button>{/if}
                        </div>
                      {/each}
                      {#if canEdit && inst.initStart >= 0}
                        <button
                          class="pv-part-addtx"
                          type="button"
                          title="Add a transform (translate / rotate) — appended below, applied in sequence"
                          onclick={(e) => openTxAdd(inst, e)}
                        >＋ transform</button>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/each}
              {#if recognized?.composition}
                <div class="pv-part-compose"><span class="pv-part-name">return</span> <code>{recognized.composition}</code></div>
              {/if}
              {#if canEdit && recognized && recognized.returnStart >= 0 && recognized.compStart >= 0}
                <div class="pv-warp-row">
                  <button class="pv-mini-btn" class:on={isWarped} type="button"
                    title="Wrap the whole composition in warpSpline(...) — bends the assembled solid along an (x,z) spline as the final transform. Toggle off to un-warp."
                    onclick={toggleWarpEnd}>⟿ warp at end{isWarped ? ' ✓' : ''}</button>
                  {#if isWarped && recognized.warpPathStart >= 0}
                    <button class="pv-mini-btn" type="button" title="Edit the spline path the solid bends along" onclick={openWarpPath}>✎ path</button>
                  {/if}
                  {#if (recognized?.operands?.length ?? 0) >= 1}
                    <button class="pv-mini-btn" class:on={showTree} type="button" title="Show the construction tree + BODMAS evaluation order for this composition" onclick={() => (showTree = !showTree)}>🌳 tree</button>
                  {/if}
                </div>
                {#if showTree}
                  <ConstructionTree {recognized} parts={resolvedParts} onPick={(name) => openPart(name)} />
                {/if}
              {/if}
              {#if locals.length}<div class="pv-parts-note">+ {locals.length} local{locals.length === 1 ? '' : 's'} (non-part calls)</div>{/if}
              {#if recognized?.unrecognized}<div class="pv-parts-note">+ {recognized.unrecognized} statement{recognized.unrecognized === 1 ? '' : 's'} not decomposed (opaque code)</div>{/if}
              {#if editable && recognized && !recognized.editable}<div class="pv-parts-note">read-only — remove TS type annotations from the params to edit args inline.</div>{/if}
            {/if}
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
          <div class="pv-pane-head">
            <span class="pv-pill" class:dirty={sourceDirty}>{sourceDirty ? 'modified' : 'in sync'}</span>
            <div class="pv-spacer"></div>
            {#if onReloadSource}<button class="pv-btn" onclick={onReloadSource} type="button">Reload</button>{/if}
            {#if onSaveAs}
              <button class="pv-btn" onclick={openSaveAs} type="button" title="Save the current edits as a NEW primitive (the original is untouched)">Save As…</button>
            {/if}
            {#if onSaveSource}
              <button class="pv-btn primary" onclick={saveSource} type="button" disabled={!editable || saving || !sourceDirty}>Save source</button>
            {/if}
          </div>
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
    </aside>
  </div>

  {#if profileEdit}
    <FloatingPanel
      title={`Profile · ${profileEdit.instName} (${profileEdit.call})`}
      visible={true}
      x={profileEdit.px}
      y={profileEdit.py}
      width="min(360px, 92vw)"
      maxHeight="70vh"
      onClose={closeProfilePopup}
    >
      <div class="pv-profile-pop">
        <!-- One bar: searchable shape dropdown + actions (no separate head). -->
        <div class="pv-prof-bar">
          <div class="pv-prof-combo">
            <ProfilePalette layout="dropdown" set={profileEdit.info.revolve ? 'revolve' : 'cartesian'} volume={volProfiles} onPick={(id, origin) => pickProfileShape(id, origin)} onEdit={(id) => editFnProfile('instance', null, id)} />
          </div>
          {#if profileEdit.mode === 'literal' && profileEdit.canPromote}
            <button class="pv-iconbtn" type="button" disabled={promoteBusy} title="Promote to meta.profiles (clean composition)" onclick={promoteProfile}>{promoteBusy ? '…' : '↥'}</button>
          {/if}
          <button class="pv-iconbtn" type="button" title="Author a function profile (params + build())" onclick={(e) => openFnEditor('instance', null, profileEdit!.info.revolve ? 'revolve' : 'cartesian', e)}>ƒ+</button>
          <button class="pv-iconbtn" type="button" disabled={!profileDirty} title="Revert" onclick={() => { profilePts = JSON.parse(profileBaseline); }}>↺</button>
          <button class="pv-btn primary" type="button" disabled={!profileDirty} onclick={applyProfile}>Apply</button>
        </div>
        <div class="pv-prof-split">
          <ProfileEditor
            value={profilePts}
            width={232}
            height={200}
            yDown={profileEdit.info.yDown}
            hLabel={profileEdit.info.hLabel}
            vLabel={profileEdit.info.vLabel}
            presetSet={profileEdit.info.revolve ? 'revolve' : 'cartesian'}
            showAxis={profileEdit.info.revolve}
            showPresets={false}
            onChange={(next) => { profilePts = next; }}
          />
          <div class="pv-coords-col">
            <div class="pv-coords-head"><span>#</span><span>{profileEdit.info.revolve ? 'r' : 'x'}</span><span>{profileEdit.info.revolve ? 'z' : 'y'}</span></div>
            <ol class="pv-coords-list pv-coords-tbl">
              {#each profilePts as pt, i (i)}
                <li><span class="pv-coords-i">{i}</span><span class="pv-coords-n">{fmt2(pt[0])}</span><span class="pv-coords-n">{fmt2(pt[1])}</span></li>
              {/each}
            </ol>
          </div>
        </div>
      </div>
    </FloatingPanel>
  {/if}

  {#if warpPathEdit}
    <FloatingPanel
      title="Warp path · (x, z) spline"
      visible={true}
      x={Math.max(8, window.innerWidth - 470)}
      y={120}
      width="min(440px, 90vw)"
      maxHeight="70vh"
      onClose={closeWarpPath}
    >
      <div class="pv-profile-pop">
        <div class="pv-profile-pop-head">
          <span class="pv-pill">{warpPathEdit.pts.length} pts</span>
          <div class="pv-spacer"></div>
          <button class="pv-btn primary" type="button" onclick={applyWarpPath}>Apply → source</button>
        </div>
        <ProfileEditor
          value={warpPathEdit.pts}
          width={400}
          height={300}
          yDown={true}
          hLabel="x"
          vLabel="z"
          presetSet="revolve"
          showAxis={true}
          onChange={(next) => { if (warpPathEdit) warpPathEdit = { pts: next }; }}
        />
        <p class="pv-profile-pop-note">
          The assembled solid's z-extent is mapped onto this spline (z → arc-length);
          x becomes the in-plane radial offset. Edits <code>warpSpline(…)</code>'s path arg on Apply. Save source to persist.
        </p>
      </div>
    </FloatingPanel>
  {/if}

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
            <ProfilePalette layout="dropdown" set={yd ? 'revolve' : 'cartesian'} current={lkind} volume={volProfiles} onPick={(id, origin) => pickPaletteProfile(leafEdit!.pname, id, origin)} onEdit={(id) => editFnProfile('leaf', leafEdit!.pname, id)} />
          </div>
          <button class="pv-iconbtn" type="button" title="Save this profile to the volume" onclick={(e) => openSaveProfile(leafEdit!.pname, e)}>＋</button>
          <button class="pv-iconbtn" type="button" title="Author a function profile (params + build())" onclick={(e) => openFnEditor('leaf', leafEdit!.pname, yd ? 'revolve' : 'cartesian', e)}>ƒ+</button>
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

  {#if fnEditor}
    <!-- key on the fnEditor object so the editor REMOUNTS each open — its state
         seeds from `seed` only on mount, so reusing the instance kept the first
         seed (the rect default) even after picking a different profile. -->
    {#key fnEditor}
      <FloatingPanel
        title=""
        subtitle={fnEditor.bind ? (fnMeta.description || fnAutoDesc) : `${fnMeta.label || fnMeta.id || 'New profile'} · ${fnMeta.description || fnAutoDesc}`}
        visible={true} x={fnEditor.px} y={fnEditor.py} width="auto" maxHeight="86vh" onClose={closeFnEditor}>
        {#snippet titleAction()}
          {#if fnEditor.bind}
            <!-- selector: swap WHICH profile drives the part, in the title itself -->
            <div class="pv-fn-sel" role="presentation" onmousedown={(e) => e.stopPropagation()}>
              <ProfilePalette layout="dropdown" set={fnEditor.set} current={fnMeta.id} volume={volProfiles} onPick={(id, origin) => swapEditorProfile(id, origin)} />
            </div>
          {/if}
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

  {#if fxEdit}
    <FloatingPanel title="ƒ function / expression" visible={true} x={fxEdit.px} y={fxEdit.py} width="300px" onClose={closeFx}>
      <div style="display:flex; flex-direction:column; gap:6px; padding:4px;">
        <input bind:value={fxEdit.raw} spellcheck="false" placeholder="e.g. boreR * 2"
          onkeydown={(e) => { if (e.key === 'Enter') applyFx(); }}
          style="font:11px ui-monospace, monospace; padding:4px 6px; border:1px solid #d4e1f5; border-radius:4px;" />
        {#if fxParams.length}
          <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;"><span style="font:10px Arial; color:#888;">params:</span>
            {#each fxParams as p (p)}<button type="button" onclick={() => fxAppend(p)} style="font:10px ui-monospace,monospace; padding:1px 6px; border:1px solid #d4e1f5; border-radius:3px; background:#eef3fb; cursor:pointer;">{p}</button>{/each}
          </div>
        {:else}
          <div style="font:10px Arial; color:#888;">No params yet — add one with <strong>＋ param</strong> to reference it here.</div>
        {/if}
        <div style="display:flex; flex-wrap:wrap; gap:4px;">
          {#each ['+', '-', '*', '/', '(', ')', 'Math.PI'] as t (t)}<button type="button" onclick={() => fxAppend(t)} style="font:10px ui-monospace,monospace; padding:1px 6px; border:1px solid #ddd; border-radius:3px; background:#fafafa; cursor:pointer;">{t}</button>{/each}
        </div>
        <div style="display:flex; justify-content:flex-end; gap:6px;">
          <button class="pv-btn" type="button" onclick={closeFx}>Cancel</button>
          <button class="pv-btn primary" type="button" onclick={applyFx}>Apply</button>
        </div>
        <p style="font:10px Arial; color:#888; margin:2px 0 0;">Param names + <code>Math.*</code> resolve at build. <strong>Save source</strong> to persist.</p>
      </div>
    </FloatingPanel>
  {/if}

  {#if txAdd}
    <FloatingPanel
      title={`Add transform · ${txAdd.instName}`}
      visible={true}
      x={txAdd.px}
      y={txAdd.py}
      width="min(240px, 90vw)"
      maxHeight="60vh"
      onClose={closeTxAdd}
    >
      <div class="pv-txadd-pop">
        {#each TRANSFORMS as t (t.id)}
          <button class="pv-txadd-item" type="button" title={t.hint} onclick={() => addTransform(t)}>
            <span class="pv-txadd-glyph">{t.glyph}</span>
            <span class="pv-txadd-label">{t.label}</span>
            <span class="pv-txadd-op">{t.op}(…)</span>
          </button>
        {/each}
        <p class="pv-txadd-note">Wraps <code>{txAdd.instName}</code>'s call. Edit the values on the new <code>↳</code> row; Save source to persist.</p>
      </div>
    </FloatingPanel>
  {/if}

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

  .pv-canvas-pane { background: #1a1a1a; min-height: 0; overflow: hidden; border-radius: 4px; padding: 0; }
  .pv-canvas-pane.pv-drop-ok { outline: 2px dashed #2266cc; outline-offset: -2px; }

  .pv-resizer { background: transparent; cursor: col-resize; position: relative; }
  .pv-resizer::before { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; transform: translateX(-50%); background: #eee; transition: background 0.15s; }
  .pv-resizer:hover::before, .pv-resizer.dragging::before { background: #cc2222; }

  .pv-side { display: flex; flex-direction: column; min-height: 0; min-width: 0; border: 1px solid #eee; border-radius: 4px; background: #fff; overflow: hidden; }
  .pv-tabs { display: flex; border-bottom: 1px solid #eee; background: #fafafa; }
  .pv-tab { background: transparent; border: 0; padding: 8px 14px; font: 600 12px Arial; color: #666; cursor: pointer; display: flex; align-items: center; gap: 6px; border-bottom: 2px solid transparent; }
  .pv-tab:hover { color: #cc2222; }
  .pv-tab.active { color: #cc2222; border-bottom-color: #cc2222; background: #fff; }
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
  .pv-build-body { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 10px 12px; display: flex; flex-direction: column; gap: 4px; }

  /* Accordion shell — adopted from the /components inspector (.pg-acc-*). */
  .pg-acc-wrap { border: 3px solid #d4d4dc; border-radius: 4px; background: #fff; padding: 0 3px 1px; margin: 0; }
  .pg-acc-wrap:first-of-type { margin-top: 0; }
  /* Instance (part) wraps get the thinner red-tinted outline + colour stripe. */
  .pg-acc-wrap.instance { border-width: 2px; border-color: #f0c8c8; background: #fff8f8; border-left-width: 4px; border-left-color: var(--inst-color, #f0c8c8); }
  .pg-acc-head {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 4px; margin: 0;
    background: transparent; border: 0;
    cursor: pointer;
    border-radius: 3px;
  }
  .pg-acc-head:hover { background: #ececf2; color: #cc2222; }
  .pg-acc-head.collapsed { background: #fafafa; }
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
  .pv-parts-empty { font: 12px Arial; color: #999; padding: 14px 4px; line-height: 1.4; }
  .pv-parts-empty code { background: #eee; padding: 0 4px; border-radius: 3px; }
  .pv-parts-err { font: 11px ui-monospace, monospace; color: #c4392f; padding: 10px 4px; white-space: pre-wrap; }
  .pv-load-pick { font: 11px monospace; padding: 3px 4px; border: 1px solid #ccc; border-radius: 4px; background: #fff; max-width: 150px; cursor: pointer; }
  .pv-load-pick:hover { border-color: #cc2222; }
  /* profile trigger on a part row — shape-icon + "profile" label; opens the
     ProfileEditor popup on click. */
  .pv-part-profile { display: inline-flex; align-items: center; gap: 4px; font: 600 10px Arial; color: #2266cc; background: #eef3fb; border: 1px solid #d4e1f5; border-radius: 4px; padding: 2px 6px; cursor: pointer; white-space: nowrap; }
  .pv-part-profile:hover { background: #2266cc; color: #fff; border-color: #2266cc; }
  .pv-part-profile:hover :global(.pv-shape-ic path) { stroke: #fff; }
  .pv-part-profile-lbl { line-height: 1; }
  /* Function-profile params surfaced inside a part row (the "body" instance). */
  .pv-profile-params { margin: 5px 0 2px; padding: 5px 7px; border: 1px dashed #d4e1f5; border-radius: 5px; background: #f7faff; }
  .pv-pp-head { font: 700 8px Arial; text-transform: uppercase; letter-spacing: .05em; color: #2266cc; margin-bottom: 5px; }
  .pv-pp-head code { font-family: 'SF Mono', Menlo, monospace; text-transform: none; letter-spacing: 0; color: #1a4fa0; }

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
