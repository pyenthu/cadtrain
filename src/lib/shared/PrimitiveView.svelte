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
  import PrimitiveCanvas from './PrimitiveCanvas.svelte';
  import PrimitiveGlbCanvas from './PrimitiveGlbCanvas.svelte';
  import CodeEditor from './CodeEditor.svelte';
  import ProfileEditor from './ProfileEditor.svelte';
  import FloatingPanel from './FloatingPanel.svelte';
  import ParamGrid from './ParamGrid.svelte';
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

  let {
    id,
    name = id,
    description = '',
    paramSchema,
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

  let paramOrder = $derived(Object.keys(paramSchema));

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

  // First polygon-typed param (if any). The Profile tab edits this
  // one; the Params tab edits ALL of them (composites that promoted
  // inline profiles to named params can carry several).
  let polygonParamName = $derived(paramOrder.find((k) => paramSchema[k].type === 'polygon') ?? null);
  let hasProfile = $derived(polygonParamName !== null);
  // Every polygon-typed param, in meta order — the Params tab renders one
  // ProfileEditor per entry below the scalar grid.
  let polygonParamNames = $derived(paramOrder.filter((k) => paramSchema[k].type === 'polygon'));

  let tab = $state<'params' | 'parts' | 'profile' | 'source' | 'ai'>('params');

  // ── Parts tab ──────────────────────────────────────────────────────────
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
  // Re-recognize whenever the Parts tab is open and the source changes.
  $effect(() => { if (tab === 'parts') { void editedSource; loadRecognition(); } });
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

  async function fetchLeafProfile(call: string): Promise<LeafProfile | null> {
    if (call in leafProfileCache) return leafProfileCache[call];
    let result: LeafProfile | null = null;
    try {
      const res = await fetch(`/api/primitives/source?name=${encodeURIComponent(call)}`);
      if (res.ok) {
        const data = await res.json();
        const params = data?.params ?? {};
        const keys = Object.keys(params);
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
  // The profile arg of an instance can be one of two editable shapes:
  //   - 'literal' — an inline `[[x,y],…]` array. The popup edits it in place
  //     (splice over the literal) AND offers "Promote to param" (extract the
  //     literal into a named meta.params polygon param + a positional fn arg).
  //   - 'param'   — a bare identifier that resolves to a meta.params polygon
  //     param (already promoted). The popup edits THAT param's `default` value.
  // Anything else (expression, non-polygon param) → refuse.
  let profileEdit = $state<{
    instName: string;
    call: string;
    info: LeafProfile;
    mode: 'literal' | 'param';
    /** Absolute offsets in editedSource of the value to splice on Apply:
     *  the inline array literal ('literal') or the param's `default:` value
     *  expression ('param'). */
    profStart: number;
    profEnd: number;
    /** 'param' mode only — the param name being edited. */
    paramName: string | null;
    /** True when this 'literal' arg can be promoted to a named param (we have
     *  the meta.params + signature insert points + the leaf's flags). */
    canPromote: boolean;
    /** Pixel anchor for the FloatingPanel (near the ✎ trigger). */
    px: number;
    py: number;
  } | null>(null);
  let profilePts = $state<[number, number][]>([]);
  let profileBaseline = ''; // JSON of pts at open → dirty detection
  let promoteBusy = $state(false);

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

    // Case 1 — bare identifier matching a polygon meta.param → edit its default.
    if (/^[a-z_$][a-z0-9_$]*$/i.test(segText)) {
      const rp = (recognized?.params ?? []).find((p: any) => p.name === segText && p.polygon);
      if (rp && rp.defaultStart >= 0) {
        let pts: [number, number][] | null = null;
        try {
          const parsed = JSON.parse(editedSource.slice(rp.defaultStart, rp.defaultEnd).trim());
          if (Array.isArray(parsed) && parsed.every((p) => Array.isArray(p) && p.length === 2)) pts = parsed as [number, number][];
        } catch { /* default isn't a literal array */ }
        if (pts) {
          profilePts = pts.map((p) => [p[0], p[1]] as [number, number]);
          profileBaseline = JSON.stringify(profilePts);
          profileEdit = { instName: inst.name, call: inst.call, info, mode: 'param', profStart: rp.defaultStart, profEnd: rp.defaultEnd, paramName: rp.name, canPromote: false, px, py };
          return;
        }
      }
      recogError = `Can't edit ${inst.name}'s profile — "${segText}" isn't a polygon param with a literal default.`;
      return;
    }

    // Case 2 — inline literal array → edit in place + offer Promote.
    let pts: [number, number][] | null = null;
    try {
      const parsed = JSON.parse(segText);
      if (Array.isArray(parsed) && parsed.every((p) => Array.isArray(p) && p.length === 2)) pts = parsed as [number, number][];
    } catch { /* not a literal array (expression) → can't edit visually */ }
    if (!pts) { recogError = `Can't edit ${inst.name}'s profile visually — arg ${info.argIndex} isn't a literal [[x,y],…] array or a polygon param.`; return; }
    profilePts = pts.map((p) => [p[0], p[1]] as [number, number]);
    profileBaseline = JSON.stringify(profilePts);
    const canPromote = !!recognized?.editable && recognized.paramsInsertPos >= 0 && recognized.sigInsertPos >= 0;
    profileEdit = { instName: inst.name, call: inst.call, info, mode: 'literal', profStart: segStart, profEnd: segEnd, paramName: null, canPromote, px, py };
  }
  let profileDirty = $derived(profileEdit !== null && JSON.stringify(profilePts) !== profileBaseline);
  function closeProfilePopup() { profileEdit = null; }
  // Apply: serialize the edited polygon and splice it over the target (inline
  // literal or promoted param's default) in editedSource. → Source dirty;
  // canvases re-bake off editedSource; the recognition $effect re-scans.
  function applyProfile() {
    if (!profileEdit) return;
    const json = JSON.stringify(profilePts);
    spliceSource(profileEdit.profStart, profileEdit.profEnd, json);
    profileBaseline = json;
    closeProfilePopup();
  }

  // Promote an inline profile literal → a named polygon param. Three edits,
  // applied high→low offset so earlier offsets stay valid:
  //   1. replace the inline literal in the body with the new param NAME
  //   2. add the param to the function signature (positional, after the last)
  //   3. add a polygon entry to meta.params (mirroring the leaf's flags so the
  //      Params-tab ProfileEditor renders it the same way as the leaf)
  // meta.params append is last in source order (top of file) → lowest offset.
  function suggestParamName(instName: string): string {
    const taken = new Set<string>((recognized?.params ?? []).map((p: any) => p.name));
    let base = `${instName}_profile`;
    if (!taken.has(base)) return base;
    let i = 2; while (taken.has(`${base}${i}`)) i++; return `${base}${i}`;
  }
  function promoteProfile() {
    if (!profileEdit || profileEdit.mode !== 'literal' || !profileEdit.canPromote || promoteBusy) return;
    const r = recognized;
    if (!r) return;
    promoteBusy = true;
    try {
      const pname = suggestParamName(profileEdit.instName);
      const info = profileEdit.info;
      // The literal to extract — use the current (possibly-edited) pts so an
      // in-popup edit is captured by the promotion.
      const literal = JSON.stringify(profilePts);
      // Build the meta.params entry, mirroring the leaf's polygon flags.
      const flags: string[] = [`label: '${profileEdit.instName} profile'`, `type: 'polygon'`];
      if (info.yDown) {
        flags.push(`yDown: true`, `hLabel: '${info.hLabel}'`, `vLabel: '${info.vLabel}'`);
      }
      flags.push(`default: ${literal}`);
      const paramEntry = `${r.paramsHasElems ? ', ' : ''}${pname}: { ${flags.join(', ')} }`;
      // Signature param name (positional). meta.params order must match arg
      // order — we append both at the END so the new param is the LAST arg.
      const sigEntry = `${r.sigHasParams ? ', ' : ''}${pname}`;
      const edits = [
        { s: profileEdit.profStart, e: profileEdit.profEnd, text: pname },
        { s: r.sigInsertPos, e: r.sigInsertPos, text: sigEntry },
        { s: r.paramsInsertPos, e: r.paramsInsertPos, text: paramEntry },
      ];
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
  let loadBusy = $state(false);
  let loadable = $derived((catalog ?? []).filter((e) => e.id !== id));
  function defaultArgFor(ps: any): string {
    const d = ps?.default;
    return Array.isArray(d) ? JSON.stringify(d) : String(d ?? 0);
  }
  function uniqueInstName(childId: string): string {
    const taken = new Set<string>([...parts, ...locals].map((i: any) => i.name));
    const base = childId.replace(/^r_/, '') || 'part';
    if (!taken.has(base)) return base;
    let i = 2; while (taken.has(base + i)) i++; return base + i;
  }
  async function loadPrimitive() {
    const r = recognized;
    if (!loadPick || !r || r.returnStart < 0 || r.compStart < 0) return;
    loadBusy = true;
    recogError = null;
    try {
      // Fetch the chosen primitive's params (defaults) — the list is lazy.
      const res = await fetch(`/api/primitives/source?name=${encodeURIComponent(loadPick)}`);
      if (!res.ok) { recogError = `Load failed: ${await res.text()}`; return; }
      const data = await res.json();
      const childParams = data.params ?? {};
      const child = loadPick;
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

  // GLB cutaway toggle — defaults off so users see the full bake first.
  // The Mesh pane is ALWAYS cutaway (baked into manifoldToCutVC), so
  // this toggle gives the GLB pane visual parity on demand. Reacts to
  // the same appliedArgs signal as the canvas, so it re-bakes only on
  // Apply, not on every slider drag.
  let glbCut = $state(false);

  // Polygon params travel to the server as JSON strings; scalars as
  // numbers. Order follows the meta param-order.
  let appliedArgs = $derived(paramOrder.map((k) => {
    const v = applied[k] ?? paramSchema[k].default;
    if (paramSchema[k].type === 'polygon') return JSON.stringify(v);
    return v as number;
  }));

  // Dirty if any scalar mismatches OR any polygon's JSON serialization
  // differs (cheap structural compare via stringify).
  let paramsDirty = $derived(
    paramOrder.some((k) => {
      const p = pending[k] ?? paramSchema[k].default;
      const a = applied[k] ?? paramSchema[k].default;
      if (paramSchema[k].type === 'polygon') return JSON.stringify(p) !== JSON.stringify(a);
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

<div class="pv-root">
  <header class="pv-head">
    <div class="pv-title">
      <h1>{name}</h1>
      {#if description}<p class="pv-desc">{description}</p>{/if}
    </div>
  </header>

  <div class="pv-split" style="--side-width: {sideWidth}px;">
    <div class="pv-canvas-pane">
      <!-- Always pass `source` so the preview runs through the sandbox
           path (which has a first-export fallback when the function
           name differs from the directory id, e.g. dir
           `profile_extrude_v2` containing `export function profile_extrude`).
           The bundle fast-path can't handle that mismatch. -->
      <div class="pv-canvas-stack">
        <div class="pv-canvas-half">
          <div class="pv-canvas-label">Mesh (live)</div>
          <PrimitiveCanvas {id} {name} args={appliedArgs} source={editedSource} />
        </div>
        <div class="pv-canvas-half">
          <div class="pv-canvas-label">GLB (bake preview)</div>
          <label class="pv-canvas-toggle" title="Show the half-sectioned bake (same cut plane as the Mesh pane).">
            <input type="checkbox" bind:checked={glbCut} />
            <span>Cutaway</span>
          </label>
          <PrimitiveGlbCanvas {id} {name} args={appliedArgs} source={editedSource} cut={glbCut} />
        </div>
      </div>
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
        <button class="pv-tab" class:active={tab === 'params'} onclick={() => (tab = 'params')} type="button" role="tab">
          <span class="pv-ic">⚙</span> Params
          {#if paramsDirty}<span class="pv-dot"></span>{/if}
        </button>
        <button class="pv-tab" class:active={tab === 'parts'} onclick={() => (tab = 'parts')} type="button" role="tab">
          <span class="pv-ic">▦</span> Parts
        </button>
        {#if hasProfile}
          <button class="pv-tab" class:active={tab === 'profile'} onclick={() => (tab = 'profile')} type="button" role="tab">
            <span class="pv-ic">◧</span> Profile
          </button>
        {/if}
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

      {#if tab === 'params'}
        <div class="pv-pane pv-params">
          <div class="pv-pane-head">
            <span class="pv-pill" class:dirty={paramsDirty}>{paramsDirty ? 'pending — press Enter to apply' : 'applied'}</span>
            <div class="pv-spacer"></div>
            <button class="pv-btn" onclick={apply} type="button" disabled={!paramsDirty}>Apply</button>
            <button class="pv-btn" onclick={revert} type="button" disabled={!paramsDirty}>Revert</button>
            {#if onSaveDefaults}
              <button class="pv-btn primary" onclick={saveDefaults} type="button" disabled={!editable || saving}>Save defaults</button>
            {/if}
          </div>
          <div class="pv-params-grid">
            <ParamGrid
              schema={paramSchema}
              {pending}
              {applied}
              onPending={setPending}
              onCommit={commitOne}
            />
            <!-- Polygon params (ParamGrid skips these) render as inline
                 ProfileEditors — the SAME component the leaf's Profile tab +
                 the Parts-tab popup use. Editing seeds `pending` (orange-bar
                 state); Apply/Enter commits → re-bake. Flags mirror the leaf
                 so a promoted revolve profile gets the (r,z) Z-down editor and
                 an extrude profile gets the centred Cartesian one. -->
            {#each polygonParamNames as pname (pname)}
              <div class="pv-poly-param">
                <div class="pv-poly-head">
                  <span class="pv-pname">{paramSchema[pname].label ?? pname}</span>
                  <span class="pv-poly-verts">{(pending[pname] as [number, number][])?.length ?? 0} verts</span>
                </div>
                <ProfileEditor
                  value={(pending[pname] as [number, number][]) ?? (paramSchema[pname].default as [number, number][])}
                  width={360}
                  height={240}
                  yDown={paramSchema[pname].yDown ?? false}
                  hLabel={paramSchema[pname].hLabel ?? (paramSchema[pname].yDown ? 'r →' : 'x →')}
                  vLabel={paramSchema[pname].vLabel ?? (paramSchema[pname].yDown ? 'z ↓' : 'y ↑')}
                  presetSet={paramSchema[pname].yDown ? 'revolve' : 'cartesian'}
                  showAxis={paramSchema[pname].yDown ?? false}
                  onChange={(next) => { pending = { ...pending, [pname]: next }; }}
                  onApply={apply}
                />
              </div>
            {/each}
          </div>
        </div>
      {:else if tab === 'parts'}
        <div class="pv-pane pv-parts">
          <div class="pv-pane-head">
            <span class="pv-pill" class:dirty={sourceDirty}>{parts.length} part{parts.length === 1 ? '' : 's'}{sourceDirty ? ' · edited' : ''}</span>
            <div class="pv-spacer"></div>
            {#if canEdit && recognized && recognized.returnStart >= 0}
              <select class="pv-load-pick" bind:value={loadPick} title="Load a primitive as a new instance">
                <option value="">＋ Load…</option>
                {#each loadable as e (e.id)}<option value={e.id}>{e.id}</option>{/each}
              </select>
              <button class="pv-btn" type="button" disabled={!loadPick || loadBusy} onclick={loadPrimitive}>{loadBusy ? '…' : 'Add'}</button>
            {/if}
            <button class="pv-btn" type="button" onclick={loadRecognition}>Re-scan</button>
            {#if canEdit && onSaveSource}
              <button class="pv-btn primary" type="button" onclick={saveSource} disabled={saving || !sourceDirty}>Save source</button>
            {/if}
          </div>
          <div class="pv-parts-body">
            {#if recogStatus === 'loading'}
              <div class="pv-parts-empty">recognizing…</div>
            {:else if recogError}
              <div class="pv-parts-err">{recogError}</div>
            {:else if parts.length === 0}
              <div class="pv-parts-empty">No parts recognized — this is a leaf (no <code>meta.uses</code> instances). Parts appear for composites that call other primitives.</div>
            {:else}
              {#each resolvedParts as inst (inst.name)}
                <div class="pv-part">
                  <div class="pv-part-head">
                    <span class="pv-part-name">{inst.name}</span>
                    <span class="pv-part-call">{inst.call}</span>
                    {#if canEdit && inst.argsStart >= 0 && profileInfoFor(inst.call)}
                      <div class="pv-spacer"></div>
                      <button
                        class="pv-part-profile"
                        type="button"
                        title="Edit this instance's profile in a popup"
                        onclick={(e) => openProfilePopup(inst, profileInfoFor(inst.call)!, e)}
                      >✎ profile</button>
                    {/if}
                  </div>
                  {#if canEdit && inst.argsStart >= 0}
                    <input
                      class="pv-part-edit"
                      value={inst.argsText}
                      spellcheck="false"
                      title="Edit args · Enter to write into the source"
                      onkeydown={(e) => { if (e.key === 'Enter') spliceSource(inst.argsStart, inst.argsEnd, (e.currentTarget as HTMLInputElement).value); }}
                    />
                  {:else}
                    <div class="pv-part-args">{inst.argsText}</div>
                  {/if}
                  {#if inst.resolvedArgs}<div class="pv-part-live">→ {inst.resolvedArgs}</div>{/if}
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
                      ){#if t.resolved}<span class="pv-part-live"> → {t.op}({t.resolved})</span>{/if}
                    </div>
                  {/each}
                </div>
              {/each}
              {#if recognized?.composition}
                <div class="pv-part-compose"><span class="pv-part-name">return</span> <code>{recognized.composition}</code></div>
              {/if}
              {#if locals.length}<div class="pv-parts-note">+ {locals.length} local{locals.length === 1 ? '' : 's'} (non-part calls)</div>{/if}
              {#if recognized?.unrecognized}<div class="pv-parts-note">+ {recognized.unrecognized} statement{recognized.unrecognized === 1 ? '' : 's'} not decomposed (opaque code)</div>{/if}
              {#if editable && recognized && !recognized.editable}<div class="pv-parts-note">read-only — remove TS type annotations from the params to edit args inline.</div>{/if}
            {/if}
          </div>
        </div>
      {:else if tab === 'profile' && polygonParamName}
        {@const pname = polygonParamName}
        <div class="pv-pane pv-profile">
          <div class="pv-pane-head">
            <span class="pv-pname">{paramSchema[pname].label ?? pname}</span>
            <span class="pv-pill" class:dirty={paramsDirty}>{(pending[pname] as [number, number][])?.length ?? 0} verts</span>
            <div class="pv-spacer"></div>
            <button class="pv-btn" onclick={apply} type="button" disabled={!paramsDirty}>Apply</button>
            <button class="pv-btn" onclick={revert} type="button" disabled={!paramsDirty}>Revert</button>
          </div>
          <ProfileEditor
            value={pending[pname] as [number, number][]}
            yDown={paramSchema[pname].yDown ?? false}
            hLabel={paramSchema[pname].hLabel ?? (paramSchema[pname].yDown ? 'r →' : 'x →')}
            vLabel={paramSchema[pname].vLabel ?? (paramSchema[pname].yDown ? 'z ↓' : 'y ↑')}
            presetSet={paramSchema[pname].yDown ? 'revolve' : 'cartesian'}
            showAxis={paramSchema[pname].yDown ?? false}
            onChange={(next) => { pending = { ...pending, [pname]: next }; }}
            onApply={apply}
          />
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
      width="min(440px, 90vw)"
      maxHeight="70vh"
      onClose={closeProfilePopup}
    >
      <div class="pv-profile-pop">
        <div class="pv-profile-pop-head">
          <span class="pv-pill" class:dirty={profileDirty}>{profilePts.length} verts{profileDirty ? ' · edited' : ''}</span>
          {#if profileEdit.mode === 'param'}
            <span class="pv-profile-pop-tag">param <code>{profileEdit.paramName}</code></span>
          {/if}
          <div class="pv-spacer"></div>
          {#if profileEdit.mode === 'literal' && profileEdit.canPromote}
            <button class="pv-btn" type="button" disabled={promoteBusy} title="Extract this inline profile into a named polygon param + a positional fn arg" onclick={promoteProfile}>{promoteBusy ? '…' : '↥ Promote to param'}</button>
          {/if}
          <button class="pv-btn" type="button" disabled={!profileDirty} onclick={() => { profilePts = JSON.parse(profileBaseline); }}>Revert</button>
          <button class="pv-btn primary" type="button" disabled={!profileDirty} onclick={applyProfile}>Apply → source</button>
        </div>
        <ProfileEditor
          value={profilePts}
          width={400}
          height={300}
          yDown={profileEdit.info.yDown}
          hLabel={profileEdit.info.hLabel}
          vLabel={profileEdit.info.vLabel}
          presetSet={profileEdit.info.revolve ? 'revolve' : 'cartesian'}
          showAxis={profileEdit.info.revolve}
          onChange={(next) => { profilePts = next; }}
        />
        <p class="pv-profile-pop-note">
          {#if profileEdit.mode === 'param'}
            Edits the <code>{profileEdit.paramName}</code> param's default in source.ts on Apply; also editable in the Params tab. Save source to persist.
          {:else}
            Edits write into <code>{profileEdit.instName}</code>'s call in source.ts on Apply. <strong>Promote to param</strong> makes it an editable named param. Save source to persist.
          {/if}
        </p>
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
  .pv-root { display: grid; grid-template-rows: auto 1fr; height: 100%; min-height: 0; font: 13px Arial; color: #222; padding: 0 6px 6px; gap: 4px; box-sizing: border-box; }

  .pv-head { padding: 0 6px 4px; border-bottom: 1px solid #eee; }
  .pv-title h1 { margin: 0; font: 700 14px monospace; color: #cc2222; line-height: 1.2; }
  .pv-desc { margin: 2px 0 0; color: #555; font-size: 11px; max-width: 720px; line-height: 1.3; }

  .pv-split { display: grid; grid-template-columns: 1fr 6px var(--side-width, 420px); min-height: 0; height: 100%; gap: 0; }

  .pv-canvas-pane { background: #1a1a1a; min-height: 0; overflow: hidden; border-radius: 4px; padding: 6px; }
  .pv-canvas-stack { display: grid; grid-template-rows: 1fr 1fr; gap: 6px; height: 100%; min-height: 0; }
  .pv-canvas-half { position: relative; min-height: 0; border-radius: 4px; overflow: hidden; }
  .pv-canvas-label { position: absolute; top: 6px; left: 8px; z-index: 5; font: 600 10px Arial; color: #fff; background: rgba(0,0,0,0.6); padding: 2px 8px; border-radius: 3px; pointer-events: none; }
  .pv-canvas-toggle { position: absolute; top: 6px; right: 8px; z-index: 5; display: flex; align-items: center; gap: 4px; font: 600 10px Arial; color: #fff; background: rgba(0,0,0,0.6); padding: 2px 8px; border-radius: 3px; cursor: pointer; user-select: none; }
  .pv-canvas-toggle input { width: 12px; height: 12px; margin: 0; cursor: pointer; accent-color: #cc2222; }
  .pv-canvas-toggle:hover { background: rgba(204,34,34,0.6); }

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

  .pv-params { padding: 0; }
  /* Param controls now render via the shared <ParamGrid> (the same
     .pr-card grid the /components inspector uses). This wrapper just
     handles padding + scroll. */
  .pv-params-grid { padding: 8px 12px 12px; overflow-y: auto; }
  /* Still used by the Profile tab's pane head. */
  .pv-pname { font: 12px monospace; color: #333; }

  /* Inline polygon-param editors in the Params tab. */
  .pv-poly-param { margin-top: 10px; border: 1px solid #eaeaef; border-radius: 4px; padding: 6px 8px 4px; background: #fafafa; }
  .pv-poly-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
  .pv-poly-verts { font: 10px Arial; color: #888; }

  /* Parts tab — read-only recognized instances. */
  .pv-parts { padding: 0; }
  .pv-parts-body { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  .pv-part { border: 1px solid #eee; border-radius: 5px; padding: 7px 9px; background: #fafafa; }
  .pv-part-head { display: flex; align-items: center; gap: 8px; }
  .pv-part-name { font: 700 13px monospace; color: #cc2222; }
  .pv-part-call { font: 11px monospace; color: #2266cc; background: #eef3fb; padding: 1px 6px; border-radius: 8px; }
  .pv-part-args { margin-top: 4px; font: 11px ui-monospace, monospace; color: #555; white-space: pre-wrap; word-break: break-word; }
  .pv-part-tx { margin-top: 3px; font: 11px ui-monospace, monospace; color: #888; }
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
  /* ✎ profile trigger on a part row — opens the ProfileEditor in a popup. */
  .pv-part-profile { font: 600 10px Arial; color: #2266cc; background: #eef3fb; border: 1px solid #d4e1f5; border-radius: 4px; padding: 2px 7px; cursor: pointer; white-space: nowrap; }
  .pv-part-profile:hover { background: #2266cc; color: #fff; border-color: #2266cc; }

  /* Profile-editor popup body (FloatingPanel). */
  .pv-profile-pop { display: flex; flex-direction: column; min-height: 0; gap: 4px; padding: 2px; }
  /* Give the embedded ProfileEditor (flex:1, no intrinsic height) a fixed
     drawing area so the SVG renders inside the auto-sized FloatingPanel. */
  .pv-profile-pop :global(.pe-root) { flex: 0 0 auto; }
  .pv-profile-pop :global(.pe-svg-wrap) { height: 280px; flex: 0 0 auto; }
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
