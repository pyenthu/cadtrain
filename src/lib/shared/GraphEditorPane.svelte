<!--
  /graph-editor — Slices 1+4+5 of the visual composition editor.

  Three-pane layout:
    LEFT (40%)  — SVG graph canvas with Call/Method/Mv/Rot nodes, picker, wires
    MIDDLE(35%) — live 3D Threlte bake
    RIGHT (25%) — live .asm.ts source

  Slices delivered:
    1 (foundation)  — drop one Call, see canvas + bake + source
    4 (CSG)         — drop ⊖ ⊕ ⊗ method nodes; drag-wire from a node's
                       output socket to a method's obj/arg input
    5 (transforms)  — drop mv/rot wrapper nodes; drag-wire to set child;
                       3 xyz inputs on each transform card

  Save: writes <exemplar>.asm.ts to the volume via /api/primitives/save.

  Per docs/plans/composition-architecture.md.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import {
    newGraph,
    addCall,
    addMethodPlaceholder,
    addMvPlaceholder,
    addRotPlaceholder,
    setMethodInput,
    setTransformChild,
    setTransformAxis,
    setTransformAxisValue,
    setViewport,
    addStackPlaceholder,
    addRepeatPlaceholder,
    setRepeatChild,
    setRepeatCount,
    setRepeatOp,
    appendContainerChild,
    removeContainerChildAt,
    setCallArg,
    removeNode,
    setLayout,
    asLiteral,
    asExpr,
    asParam,
    addParam,
    removeParam,
    setParamSchema,
    wrapInTransform,
    unwrapTransform,
    inlineTransformOf,
    hydrateGraph,
    type Graph,
    type NodeId,
    type CsgOp,
    type MvNode,
    type RotNode,
  } from '$lib/cad/composition-graph';
  import { emitGraph } from '$lib/cad/composition-emit';
  import { emitProfileGraph } from '$lib/cad/composition-emit-profile';
  import { bakeGraphPreview } from '$lib/cad/composition-bake';
  import { autoLayoutGraph, forceSeparate } from '$lib/cad/composition-layout';
  import { dragNumber } from '$lib/shared/dragNumber';
  import { PROFILE_REGISTRY, defaultsFor, type ProfileDef } from '$lib/shared/profile-presets';

  /** Props (component contract — same surface mounted by /graph-editor for
   *  full-page work and by /primitives for the tabbed multi-instance view).
   *
   *    id     — the primitive to load on mount. When null/undefined the
   *             component opens a fresh default graph (`test_graph_a`).
   *    embed  — when true the global SvelteKit nav is hidden via the head
   *             style injection below + the inner chrome layout collapses
   *             so the editor fits inside another page's tab/iframe.
   *    kind   — 'part' (default) edits a part assembly (.asm.ts / .prim.ts);
   *             'profile' edits a 2D profile (.prvl.ts / .prex.ts) — same
   *             canvas + auto-layout + push-apart, but the source/save
   *             endpoints route to /api/primitives/profiles/* and the
   *             right-pane swaps the 3D bake canvas for an inline SVG of
   *             the resolved polygon. Profile-specific node types
   *             (mv/line/repeat) come in a follow-up commit. */
  interface Props { id?: string | null; embed?: boolean; kind?: 'part' | 'profile'; }
  const props: Props = $props();
  const editKind = $derived(props.kind ?? 'part');
  /** Endpoint paths swap based on `kind`. Profile endpoints take `?id=…`
   *  rather than `?name=…` so the helpers also normalize the query
   *  param. Kept as derived strings (not constants) so a parent flipping
   *  `kind` mid-mount re-routes cleanly. */
  const SOURCE_URL = $derived(editKind === 'profile' ? '/api/primitives/profiles/source' : '/api/primitives/source');
  const SAVE_URL   = $derived(editKind === 'profile' ? '/api/primitives/profiles/save'   : '/api/primitives/save');
  const SOURCE_QS  = $derived(editKind === 'profile' ? 'id' : 'name');
  // exemplarId is the WRITABLE working id — Save / Save-as / typing in the
  // id input mutate it locally. The `id` prop only seeds it; once mounted
  // we stop reading the prop so the user's typed value isn't reverted.
  let graph = $state<Graph>(newGraph());
  let exemplarId = $state<string>(props.id ?? 'test_graph_a');
  let saveStatus = $state<string | null>(null);
  /** Embed mode — when the editor is mounted inside another surface (the
   *  /primitives tab strip, the /vocab Editor tab), hide the global layout
   *  nav so the chrome doesn't double-up. The page's own .ge-bar stays
   *  since it hosts Save / + Drop / id input — the in-context controls. */
  let embed = $state<boolean>(!!props.embed);
  /** Drift detection (Phase 11). Per src-name → its meta.params keys
   *  as last seen on the volume. Compared to each Call's args keys; a
   *  mismatch marks the Call as drifted. Refresh syncs the Call's args
   *  back to the expected shape (preserves existing values for shared
   *  keys, fills new keys with the primitive's defaults). */
  let expectedParams = $state<Record<string, string[]>>({});
  let expectedDefaults = $state<Record<string, Record<string, number>>>({});
  /** Profile-typed arg keys per src. `expectedProfileKeys['r_revolve'] = {profile}`.
   *  Populated alongside expectedParams from the primitive's meta.params
   *  scan; lookup at Call-card render time decides whether to show the
   *  profile chip + picker (#119) instead of a generic expression input. */
  let expectedProfileKeys = $state<Record<string, Set<string>>>({});
  /** Which "set" the primitive's profile uses — drives the kind filter in
   *  the profile picker popover. r_revolve → 'revolve' (r,z half-section);
   *  r_extrude / r_weld_extrude → 'cartesian' (x,y polygon). */
  let expectedProfileSet = $state<Record<string, 'revolve' | 'cartesian'>>({});

  let emitted = $derived(emitGraph(graph, { id: exemplarId, drawingMd }));
  // The SOURCE the LIVE SOURCE tab + the bake canvas see — it's the
  // GHOST-emit when any 👁 is active (so the canvas re-posts the same
  // source the auto-bake just baked, gets the same response, and
  // renders the cutters alongside the result). When no ghosts active
  // it falls back to the plain emit. MD is included so the SRC tab's
  // text matches what Save writes to disk.
  let emittedForRender = $derived(emitGraph(graph, { id: exemplarId, ghosts: ghostIds, drawingMd }));
  let sourceText = $derived(emittedForRender.source);

  let bake = $state<{ ok: boolean; source?: string; bake?: any; message?: string } | 'loading' | null>(null);
  let bakeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Profile-mode preview state — populated by /api/primitives/profiles/resolve
   *  with the polygon points the build() returns at default params. Driven
   *  by a separate effect that fires on profile load + on bakeNonce changes
   *  (the Bake button reuses the same nonce so the user gets a re-resolve
   *  after editing). `profileSet` ('revolve' | 'cartesian') changes how the
   *  SVG renders the axis + Y orientation. */
  let profilePts = $state<[number, number][]>([]);
  let profileSet = $state<'revolve' | 'cartesian'>('revolve');
  let profileResolveErr = $state<string | null>(null);
  let profileSource = $state<string>('');
  /** Profile's meta.params (loaded from the file's meta block) — used as
   *  the default param dict when calling /resolve. We can't just read
   *  graph.params because profiles loaded in legacy mode (no meta.graph
   *  block) have an empty graph + empty params, but the build() needs
   *  the file's declared param defaults to produce points. */
  let profileMetaParams = $state<Record<string, { default?: number }>>({});
  /** Derived viewBox + path for the 2D SVG preview (revolve: axis at r=0,
   *  Z-down; cartesian: Y-flip so positive points up). Mirrors the SVG
   *  logic in the deleted ProfilePane. */
  const profileView = $derived.by(() => {
    const pts = profilePts;
    if (pts.length === 0) return null;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const w = Math.max(0.001, xMax - xMin), h = Math.max(0.001, yMax - yMin);
    const pad = Math.max(w, h) * 0.08;
    return {
      vb: `${xMin - pad} ${yMin - pad} ${w + 2 * pad} ${h + 2 * pad}`,
      d: pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z',
      // Closure: dashed segment from last point back to first.
      dClose: pts.length > 1
        ? `M ${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]} L ${pts[0][0]} ${pts[0][1]}`
        : '',
      yFlip: profileSet === 'cartesian',
      axis: profileSet === 'revolve',
      xMin, yMin, w, h, pad,
    };
  });
  /** Profile-mode resolve — calls /api/primitives/profiles/resolve with
   *  `profileSource` (loaded from the file) and current default params,
   *  populating `profilePts` for the right-pane 2D SVG. Re-fires on
   *  source change and on bakeNonce bumps (the 🔨 button triggers a
   *  manual re-resolve). The graph itself doesn't yet feed back into
   *  profileSource — that's the Step-2 profile emit pipeline.
   *  PROFILE_TODO Phase 2.2: emit graph → build() body each change. */
  /** Profile-mode resolve. Two source paths:
   *   * GRAPH path — the canvas has pen_* nodes wired. The graph is
   *     emitted via composition-emit-profile.ts into a build() body;
   *     we POST that to /resolve. This is what gives the user a LIVE
   *     2D preview as they drop / edit pen nodes.
   *   * ON-DISK path — empty/legacy graph (no pen nodes). We fall back
   *     to the original profileSource loaded from the file so the
   *     preview still shows SOMETHING.
   *
   *  Params come from the graph's own meta.params (PARAMS card sliders)
   *  when present, otherwise the file's meta.params defaults. Debounced
   *  120 ms so a slider drag doesn't flood /resolve. */
  let profileResolveTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (editKind !== 'profile') return;
    void bakeNonce; // re-run on manual bake

    // Pick the source: emit the graph if it has pen nodes; else the
    // on-disk source.
    const hasPenNodes = Object.values(graph.nodes).some(
      (n) => (n as any).type === 'call' && String((n as any).src ?? '').startsWith('pen_'),
    );
    const src = hasPenNodes ? emitProfileGraph(graph).source : profileSource;
    if (!src) return;

    // Param dict — prefer graph.params (the editor-controlled sliders)
    // when populated; fall back to the file's meta.params.
    const params: Record<string, number> = {};
    const graphParams = graph.params ?? {};
    if (Object.keys(graphParams).length > 0) {
      for (const [k, v] of Object.entries(graphParams)) {
        params[k] = Number((v as any)?.default ?? 0);
      }
    } else {
      for (const [k, v] of Object.entries(profileMetaParams)) {
        params[k] = Number((v as any)?.default ?? 0);
      }
    }

    clearTimeout(profileResolveTimer);
    profileResolveTimer = setTimeout(async () => {
      try {
        const r = await fetch('/api/primitives/profiles/resolve', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source: src, params }),
        });
        if (!r.ok) { profileResolveErr = `Resolve ${r.status}: ${(await r.text()).slice(0, 160)}`; return; }
        const d = await r.json();
        profilePts = Array.isArray(d.points) ? d.points : [];
        profileResolveErr = null;
      } catch (e: any) { profileResolveErr = e?.message ?? String(e); }
    }, 120);
  });

  /** Re-bake nonce — increment to trigger a fresh /api/primitives/preview
   *  call. Used by the 🔨 Bake button (manual rebake), the 🔄 Rebuild
   *  button (cache wipe + rebake), and the initial-load auto-bake. */
  let bakeNonce = $state(0);
  /** Tracks whether the source the user is LOOKING AT has changed since
   *  the bake panel last rendered geometry. Shown as a small "stale" badge
   *  next to the Bake button so the user knows there's a pending change. */
  let bakeStale = $derived(
    typeof bake === 'object' && bake && bake.source !== undefined && bake.source !== emittedForRender.source,
  );
  /** Auto-bake mode — defaults ON with a long debounce so slider scrubs
   *  don't fire intermediate bakes. Press Enter in any input to force-
   *  bake immediately (skips the debounce). The 🔨 Bake button always
   *  bakes regardless of the toggle. Persisted to localStorage. */
  let autoBake = $state(true);
  /** Suppress the first-render bake until the URL hydrate has settled,
   *  so we don't bake the empty default graph before redirecting state. */
  let firstBakeDone = false;
  onMount(() => {
    try {
      // Default to ON unless the user explicitly disabled it.
      const v = localStorage.getItem('ge-auto-bake');
      autoBake = v === null ? true : v === '1';
    } catch { /* localStorage blocked */ }
  });
  function setAutoBake(v: boolean) {
    autoBake = v;
    try { localStorage.setItem('ge-auto-bake', v ? '1' : '0'); } catch { /* ignore */ }
    if (v) {
      bakeNonce++; // re-bake when flipping ON
    } else {
      // Cancel any pending debounced auto-bake so toggling OFF actually
      // STOPS the next bake from firing — the $effect below early-bailed
      // on `!autoBake` without clearing the timer, so a bake set 600 ms
      // before the toggle would still land 100 ms after. (#115)
      clearTimeout(autoBakeTimer);
    }
  }
  /** Per-card ghost set — Call cards (and any node) flagged with the eye
   *  icon get their emitted Manifold APPENDED to the return list, so the
   *  bake renders them alongside the normal result. Useful for eyeballing
   *  the volume that a subtract is removing (toggle the cutter card on,
   *  see its body sitting inside the void it carved). Lives in editor
   *  state only; saved files are never affected. */
  let ghostSet = $state<Record<string, boolean>>({});
  let ghostIds = $derived(Object.keys(ghostSet).filter((id) => ghostSet[id]));
  function toggleNodeGhost(id: string) {
    ghostSet = { ...ghostSet, [id]: !ghostSet[id] };
    bakeNonce++;
  }
  function clearAllGhosts() {
    ghostSet = {};
    bakeNonce++;
  }
  /** Canvas-settings popover (anchored to the ⚙ button on the vertical
   *  rail). Holds layout tools (auto-layout, push apart) that don't need
   *  to be one-click from the rail — and future view/nav controls. */
  let canvasMenuOpen = $state(false);
  /** Ref to the ⚙ button so we can position the popover next to ITS
   *  bounding rect instead of a hardcoded `top: 220px` (which drifted
   *  as buttons came and went above it — ghost-clear, undo, etc.). */
  let settingsBtnEl = $state<HTMLButtonElement | null>(null);
  let canvasMenuPos = $state<{ left: number; top: number }>({ left: 56, top: 220 });
  function openCanvasMenu() {
    if (settingsBtnEl) {
      const r = settingsBtnEl.getBoundingClientRect();
      // Anchor to the right of the rail button; align top of menu with
      // top of button. `position: fixed` so it lives in viewport space
      // and we don't have to chase a positioned ancestor.
      canvasMenuPos = { left: r.right + 6, top: r.top };
    }
    canvasMenuOpen = true;
  }
  /** Canvas-edge boundary toggles (#116). Each edge cycles
   *    off → repellant → confiner → off
   *  Repellant = a thin tall virtual obstacle just outside the canvas edge,
   *  fed into forceSeparate.obstacles → pushes nodes AWAY from that edge.
   *  Confiner = forceSeparate.confinerBounds → clamps nodes INSIDE the
   *  visible region on each iteration. Persisted to localStorage so the
   *  user's choice survives across reloads. */
  /** Simplified to boolean: 'off' | 'repellant'. The tri-state cycle
   *  (off → repellant → confiner → off) was reachable only via the
   *  small circular edge buttons (🔒 / 🔺 / ⏹) pinned to the canvas
   *  edges; those buttons were removed (redundant with the ⚙ menu
   *  checkboxes). Legacy 'confiner' values in localStorage are
   *  treated as 'off' on read so users with an old persisted state
   *  don't get a stuck confiner with no UI to clear it. */
  type BoundState = 'off' | 'repellant';
  let boundLeft = $state<BoundState>('off');
  let boundRight = $state<BoundState>('off');
  onMount(() => {
    try {
      const l = localStorage.getItem('ge-bound-left');
      if (l === 'repellant') boundLeft = 'repellant';
      const r = localStorage.getItem('ge-bound-right');
      if (r === 'repellant') boundRight = 'repellant';
    } catch { /* localStorage blocked — fine */ }
  });
  /** Run a bake now. Called by the 🔨 Bake button + initial-load + nonce
   *  bumps. Reads the current emitted source so manual bakes always
   *  reflect the latest graph state. */
  function runBake() {
    bakeNonce++;
  }
  /** Window-level Enter handler — when the user presses Enter while
   *  focused on any input/textarea inside the editor, trigger a bake.
   *  Lets the user scrub a value, hit Enter, see the new render — no
   *  click required. Skipped for IME composition + modifier keys (those
   *  are reserved for shortcuts elsewhere). */
  function onWindowKeydown(ev: KeyboardEvent) {
    if (ev.key !== 'Enter') return;
    if (ev.isComposing) return;
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    const tag = target.tagName;
    // Only fire on text-like editing surfaces — buttons / canvas / etc.
    // shouldn't capture Enter for re-bake.
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return;
    ev.preventDefault();
    if (target.tagName === 'INPUT') (target as HTMLInputElement).blur();
    runBake();
  }
  onMount(() => {
    window.addEventListener('keydown', onWindowKeydown);
    return () => window.removeEventListener('keydown', onWindowKeydown);
  });
  // ─── Global dark tooltip ────────────────────────────────────────────────
  // Replaces the native browser tooltip (slow + unstyled) with a single
  // floating black-bg-white-text bubble that follows the cursor. Picks up:
  //   * any element with a `data-tip="..."` attribute (preferred)
  //   * any element with a native `title` attribute (the `title` is hoisted
  //     to `data-tip` on first hover so the browser doesn't show its own
  //     yellow bubble alongside ours)
  // Both work with the new resize grip + every existing tooltip in the
  // editor without per-element changes.
  onMount(() => {
    if (typeof document === 'undefined') return;
    let tipEl: HTMLDivElement | null = null;
    let activeTarget: HTMLElement | null = null;
    function ensureTip() {
      if (tipEl) return tipEl;
      tipEl = document.createElement('div');
      tipEl.className = 'ge-floating-tip';
      tipEl.style.cssText = [
        'position: fixed',
        'background: #111827',
        'color: #f9fafb',
        'font: 11px Arial',
        'padding: 4px 8px',
        'border-radius: 4px',
        'pointer-events: none',
        'z-index: 9999',
        'max-width: 280px',
        'white-space: pre-line',
        'box-shadow: 0 2px 6px rgba(0,0,0,0.25)',
        'opacity: 0',
        'transition: opacity 90ms',
      ].join(';');
      document.body.appendChild(tipEl);
      return tipEl;
    }
    function show(target: HTMLElement, text: string) {
      activeTarget = target;
      const tip = ensureTip();
      tip.textContent = text;
      tip.style.opacity = '1';
    }
    function hide() {
      activeTarget = null;
      if (tipEl) tipEl.style.opacity = '0';
    }
    function onOver(ev: MouseEvent) {
      let el = ev.target as HTMLElement | null;
      while (el && el !== document.body) {
        const dt = el.getAttribute?.('data-tip');
        const t  = !dt && el.getAttribute?.('title');
        if (dt || t) {
          if (t) {
            // Hoist native title to data-tip so the browser stops
            // rendering its own yellow rectangle.
            el.setAttribute('data-tip', t);
            el.removeAttribute('title');
          }
          show(el, dt ?? t ?? '');
          return;
        }
        el = el.parentElement;
      }
      hide();
    }
    function onMove(ev: MouseEvent) {
      if (!activeTarget || !tipEl) return;
      // Track the cursor at a small offset; the tip clamps to the viewport.
      const offsetX = 14;
      const offsetY = 18;
      const x = Math.min(window.innerWidth - tipEl.offsetWidth - 8, ev.clientX + offsetX);
      const y = Math.min(window.innerHeight - tipEl.offsetHeight - 8, ev.clientY + offsetY);
      tipEl.style.left = `${x}px`;
      tipEl.style.top  = `${y}px`;
    }
    function onOut(ev: MouseEvent) {
      // Only hide when leaving the active target completely.
      const rel = (ev as any).relatedTarget as HTMLElement | null;
      if (!activeTarget) return;
      if (rel && activeTarget.contains(rel)) return;
      hide();
    }
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseout', onOut);
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseout', onOut);
      tipEl?.remove();
      tipEl = null;
    };
  });
  $effect(() => {
    // Track bakeNonce + the FIRST-load condition (any visible node + no
    // prior bake). Subsequent graph changes don't fire here — they go
    // through the debounced auto-bake effect below.
    bakeNonce;
    // Profile mode skips the part-bake pipeline entirely — the right-pane
    // 2D preview renders from `profilePts` (resolved via the profile-
    // specific /resolve endpoint, refreshed in a separate effect below).
    if (editKind === 'profile') { bake = null; firstBakeDone = true; return; }
    const hasNode = Object.values(graph.nodes).some((n) => n.type !== 'list' || n.children.length > 0);
    if (!hasNode) { bake = null; firstBakeDone = false; return; }
    // Initial-load case: graph hydrated, no bake yet → fire one bake.
    // Otherwise wait for bakeNonce changes (manual Bake / Enter / Rebuild).
    if (firstBakeDone && bakeNonce === 0) return;
    bake = 'loading';
    clearTimeout(bakeTimer);
    bakeTimer = setTimeout(async () => {
      const r = await bakeGraphPreview(graph, { id: exemplarId, bust: bakeNonce > 1, ghosts: ghostIds });
      // Hand the canvas the EXACT same source the bake just ran on (the
      // ghost-flag aware emit) so its own /preview re-fetch returns the
      // same mesh — otherwise the cuboids get baked once + immediately
      // thrown away by the canvas's no-ghost re-bake.
      bake = { ok: r.ok, source: emittedForRender.source, bake: r, message: r.message as string | undefined };
      firstBakeDone = true;
    }, 250);
  });
  /** Trigger a single initial bake once the graph has nodes — kicks off
   *  from the URL-load path so loading dt_stand renders without waiting
   *  for the user to click Bake. */
  $effect(() => {
    const hasNode = Object.values(graph.nodes).some((n) => n.type !== 'list' || n.children.length > 0);
    if (hasNode && !firstBakeDone && bake !== 'loading') {
      bakeNonce++;
    }
  });
  // Auto-bake with a LONG debounce when source changes. The window is
  // 700 ms — long enough that slider scrubs don't fire intermediate
  // bakes, short enough that you don't feel sluggish after stopping.
  // Enter in any input force-fires immediately (see onWindowKeydown).
  let autoBakeTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    emittedForRender.source; // track — also catches ghostIds changes
    if (!autoBake) {
      // Don't just skip — actively cancel anything that was scheduled
      // while we were on. Without this, flipping the toggle off lets
      // the last pending bake leak through 700 ms later.
      clearTimeout(autoBakeTimer);
      return;
    }
    if (!firstBakeDone) return;
    clearTimeout(autoBakeTimer);
    autoBakeTimer = setTimeout(() => { bakeNonce++; }, 700);
  });

  // ─── Lazy cutaway load ──────────────────────────────────────────────────
  // When the bake auto-skips the cutaway (big Repeat × N, > 15k tris), the
  // bake panel surfaces "cutaway off (perf)" with a "Load" button. Click
  // re-bakes with cutaway:true (forced) and merges the new cutVC into the
  // bake state so the scene's cutaway toggle starts showing actual geometry.
  // This is the "first load, then cut" pattern.
  let cutawayBusy = $state(false);
  let cutawayStatus = $state<string | null>(null);
  async function loadCutaway() {
    if (cutawayBusy) return;
    if (typeof bake !== 'object' || !bake || !bake.source) return;
    cutawayBusy = true;
    cutawayStatus = '🔄 baking cutaway…';
    try {
      const params = Object.values(graph.params).map((p) => p.default);
      const r = await fetch('/api/primitives/preview?bust=1', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: bake.source,
          name: exemplarId,
          params,
          cutaway: true,
        }),
      });
      if (!r.ok) {
        cutawayStatus = `✗ ${r.status}: ${(await r.text()).slice(0, 140)}`;
        cutawayBusy = false;
        return;
      }
      const data = await r.json();
      // Merge cutVC + clear the skip flag in-place so the badge disappears.
      const cur = (bake as any).bake ?? {};
      cur.cutVC = data.cutVC;
      cur.cutawaySkipped = false;
      cur.cached = data.cached;
      cur.cacheHash = data.cacheHash;
      bake = { ...(bake as any) };
      cutawayStatus = `✓ cutaway baked (${Object.keys(data._t ?? {}).length ? Math.round(Object.values(data._t).reduce((a: number, b: any) => a + (Number(b) || 0), 0)) : '?'} ms)`;
      setTimeout(() => { cutawayStatus = null; cutawayBusy = false; }, 2000);
    } catch (e: any) {
      cutawayStatus = `✗ ${e?.message ?? String(e)}`;
      cutawayBusy = false;
    }
  }

  // 🔄 Rebuild this part's cache + re-bake (Phase 1.5 of bake-cache.md).
  // Wipes cache/<exemplarId>/ then bumps the bake nonce to force a fresh
  // /api/primitives/preview that repopulates the cache on the cold path.
  let rebuildBusy = $state(false);
  let rebuildStatus = $state<string | null>(null);
  async function rebuildCache() {
    if (rebuildBusy) return;
    rebuildBusy = true;
    rebuildStatus = '🔄 clearing cache…';
    try {
      const r = await fetch(`/api/cache/clear?id=${encodeURIComponent(exemplarId)}`, { method: 'POST' });
      const d = await r.json();
      if (d.ok) rebuildStatus = `✓ cleared ${d.cleared} · re-baking…`;
      else      rebuildStatus = `⚠ ${d.error ?? 'clear failed'}`;
      bakeNonce++;
      setTimeout(() => { rebuildStatus = null; rebuildBusy = false; }, 2000);
    } catch (e: any) {
      rebuildStatus = `✗ ${e?.message ?? String(e)}`;
      rebuildBusy = false;
    }
  }

  let PrimitiveDualCanvas = $state<any>(null);
  /** Set when a URL `?id=<name>` is given but the loaded source has no
   *  meta.graph (legacy text-format assembly OR a leaf primitive). The
   *  canvas stays empty + a banner surfaces above the source pane explaining
   *  why. The user can still Save a NEW graph alongside the legacy file —
   *  but we don't fight the user with auto-translation. */
  let legacyLoad = $state<{ id: string; reason: 'no-graph' | 'fetch-failed' } | null>(null);
  onMount(async () => {
    try {
      const mod = await import('$lib/shared/PrimitiveDualCanvas.svelte');
      PrimitiveDualCanvas = mod.default;
    } catch { /* canvas unavailable */ }

    // Id load: when the `id` prop is set, fetch the part's source from the
    // volume + hydrate meta.graph into the canvas. If the source is missing
    // or has no meta.graph, we surface a banner instead of fabricating state.
    //
    // graph extraction: we look at `data.graph` (preferred — the server
    // extracts it via extractMetaFromSource) BUT fall back to a client-side
    // brace-walking parser on `data.source` so the load path works against
    // a prod endpoint that hasn't been redeployed with the graph field yet.
    try {
      const id = props.id ?? null;
      if (id && /^[a-z_][a-z0-9_]*$/i.test(id)) {
        const r = await fetch(`${SOURCE_URL}?${SOURCE_QS}=${encodeURIComponent(id)}`);
        if (!r.ok) { legacyLoad = { id, reason: 'fetch-failed' }; exemplarId = id; return; }
        const d = await r.json();
        // Profile mode: capture set + source so the resolve effect can run.
        if (editKind === 'profile') {
          profileSet = (d.set === 'cartesian' ? 'cartesian' : 'revolve');
          profileMetaParams = d.params ?? {};
          profileSource = String(d.source ?? '');
          exemplarId = id;
          // Trigger an initial resolve — the effect below picks up on
          // profileSource changes.
        }
        // Pull the drawing-descriptor markdown out of the saved meta if
        // present. Falls back to extracting from the source string for
        // older endpoints that don't surface every meta field.
        const md = d.drawingMd ?? d.draw_md ?? extractDrawingMdFromSource(d.source ?? '');
        if (typeof md === 'string') drawingMd = md;
        const graphJson = d.graph ?? extractGraphFromSource(d.source ?? '');
        if (graphJson && typeof graphJson === 'object') {
          graph = hydrateGraph(graphJson);
          // A — auto-layout on first load. When a freshly-translated part
          // (e.g. dt_stand, dt_joint) lands without saved layout entries
          // for its node cards, the visible nodes pile at the default-grid
          // position. Run autoLayoutGraph once so the user arrives at an
          // arranged canvas. Skip when the file HAS saved positions
          // (= the user already arranged + saved; respect their layout).
          const visibleIds = Object.values(graph.nodes)
            .filter((n) => !isInlineWrapper(n.id) && n.id !== graph.root)
            .map((n) => n.id);
          const savedCount = visibleIds.filter((id) => !!graphJson.layout?.[id]).length;
          if (visibleIds.length > 0 && savedCount === 0) {
            graph = autoLayoutGraph(graph);
          }
          // Restore canvas viewport — pan + zoom were captured at save time.
          if (graph.viewport) {
            pan = { ...graph.viewport.pan };
            zoom = graph.viewport.zoom;
          }
          exemplarId = id;
        } else {
          legacyLoad = { id, reason: 'no-graph' };
          exemplarId = id;
          // Banner lives in the source tab — auto-switch so the explanation
          // is visible by default rather than hidden behind the bake tab.
          rightTab = 'source';
        }
      }
    } catch { /* URL parse / network failures are non-fatal */ }
  });

  /** Client-side graph-block extractor — walks balanced braces to isolate
   *  the `graph: {...}` literal inside the meta block, then evals as plain
   *  data via `new Function`. Pure object/array literals → safe.
   *  Returns undefined when the source has no graph block (legacy part). */
  function extractGraphFromSource(src: string): any | undefined {
    if (!src) return undefined;
    const m = /(^|[\s,{])graph\s*:\s*\{/m.exec(src);
    if (!m) return undefined;
    const startBrace = src.indexOf('{', m.index + m[0].length - 1);
    if (startBrace < 0) return undefined;
    let depth = 0;
    let end = -1;
    for (let i = startBrace; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) return undefined;
    const block = src.slice(startBrace, end + 1);
    try { return new Function(`return (${block});`)(); } catch { return undefined; }
  }
  /** Pull `drawingMd: '...'` (single-quoted, newlines escaped) out of a
   *  saved meta block. Companion to extractGraphFromSource for endpoints
   *  that don't return the parsed meta field. Returns '' when absent. */
  function extractDrawingMdFromSource(src: string): string {
    if (!src) return '';
    const m = /(^|[\s,{])drawingMd\s*:\s*'((?:\\'|[^'])*)'/m.exec(src);
    if (!m) return '';
    return (m[2] ?? '').replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }

  // ─── canvas state — pan + zoom ─────────────────────────────────────────
  let pan = $state({ x: 0, y: 0 });
  let zoom = $state(1);
  let canvasEl: SVGSVGElement | undefined = $state();
  /** Pan the canvas so a given node id is centered in the viewport — used
   *  by the broken-reference banner chips to scroll a deleted-ref node into
   *  view. No-op when the node has no layout entry (legacy graphs). */
  function panToNode(id: NodeId) {
    const pos = graph.layout[id];
    if (!pos || !canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    pan = {
      x: rect.width / 2 - pos.x * zoom,
      y: rect.height / 2 - pos.y * zoom,
    };
  }
  let panning = false; let panStart = { x: 0, y: 0 }; let panOrig = { x: 0, y: 0 };
  function onCanvasPointerDown(ev: PointerEvent) {
    // Middle button + Shift ALWAYS pan, even over content (power-user handle).
    // Plain left-click pans ONLY when the target is the canvas background —
    // the SVG itself or the grid rect. Any other target (a button, an input,
    // a node body) gets its own handler — pointerdown bubbles up to the
    // canvas but we DON'T capture/pan when the click was meant for a child.
    const isShortcut = ev.button === 1 || ev.shiftKey;
    const target = ev.target as Element;
    const isBackground =
      target === canvasEl ||
      (target.tagName.toLowerCase() === 'rect' && (target.getAttribute('fill') ?? '').includes('grid'));
    if (isShortcut || (ev.button === 0 && isBackground)) {
      panning = true; panStart = { x: ev.clientX, y: ev.clientY }; panOrig = { ...pan };
      canvasEl?.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    }
  }
  function onCanvasPointerMove(ev: PointerEvent) {
    if (panning) {
      pan = { x: panOrig.x + (ev.clientX - panStart.x), y: panOrig.y + (ev.clientY - panStart.y) };
    }
    if (wireFrom) {
      const pt = clientToGraph(ev.clientX, ev.clientY);
      wireMouse = pt;
    }
  }
  function onCanvasPointerUp(ev: PointerEvent) {
    if (panning) { panning = false; canvasEl?.releasePointerCapture(ev.pointerId); }
    // If a wire-drag was in flight and we're releasing over empty canvas, cancel.
    if (wireFrom) { wireFrom = null; wireMouse = null; }
  }
  function onCanvasWheel(ev: WheelEvent) {
    ev.preventDefault();
    const k = Math.exp(-ev.deltaY * 0.001);
    zoom = Math.max(0.2, Math.min(3, zoom * k));
  }

  // ─── drag-to-move node cards ────────────────────────────────────────────
  let dragging: string | null = null;
  let dragOrig = { x: 0, y: 0 }; let dragStart = { x: 0, y: 0 };
  /** Z-order ordering of node ids — last one wins (renders ON TOP). When the
   *  user clicks a node, we move its id to the END of this array so it pops
   *  to the front. Nodes not in this list render BEFORE the listed ones,
   *  in their natural Object.values order (= insertion order). */
  let zOrder = $state<string[]>([]);
  function bringToFront(id: string) {
    // Filter out the id (idempotent if not in list), then append.
    zOrder = [...zOrder.filter((x) => x !== id), id];
  }
  function onNodePointerDown(ev: PointerEvent, id: string) {
    if (ev.button !== 0) return;
    bringToFront(id);
    dragging = id;
    dragStart = { x: ev.clientX, y: ev.clientY };
    dragOrig = graph.layout[id] ?? { x: 0, y: 0 };
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    ev.stopPropagation();
  }
  function onNodePointerMove(ev: PointerEvent) {
    if (!dragging) return;
    const dx = (ev.clientX - dragStart.x) / zoom;
    const dy = (ev.clientY - dragStart.y) / zoom;
    // Preserve `w` so a position drag doesn't wipe out a previous resize.
    graph = setLayout(graph, dragging, { x: dragOrig.x + dx, y: dragOrig.y + dy, w: dragOrig.w });
  }
  function onNodePointerUp(ev: PointerEvent) {
    if (dragging) {
      (ev.currentTarget as Element).releasePointerCapture(ev.pointerId);
      dragging = null;
    }
  }

  // ─── Card resize (right-edge grip) ─────────────────────────────────────
  let resizing = $state<string | null>(null);
  let resizeStartX = 0;
  let resizeOrigW = 0;
  function onResizePointerDown(ev: PointerEvent, id: string) {
    if (ev.button !== 0) return;
    resizing = id;
    resizeStartX = ev.clientX;
    const node = graph.nodes[id];
    if (!node) return;
    resizeOrigW = nodeSize(node).w;
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    ev.stopPropagation();
    ev.preventDefault();
  }
  function onResizePointerMove(ev: PointerEvent) {
    if (!resizing) return;
    const dx = (ev.clientX - resizeStartX) / zoom;
    setCardWidth(resizing, resizeOrigW + dx);
  }
  function onResizePointerUp(ev: PointerEvent) {
    if (!resizing) return;
    (ev.currentTarget as Element).releasePointerCapture(ev.pointerId);
    resizing = null;
  }

  // ─── param chip positioning ─────────────────────────────────────────────
  // Chips are TACKED to the viewport top-left by default (📌). They render
  // OUTSIDE the pan/zoom transform — so when the user pans the canvas, the
  // chips stay where they are. This avoids the "ugly default-grid" problem
  // when you reload and your chips were arranged carefully on the canvas.
  // Position is purely derived from the chip's index in paramEntries.
  // Params card geometry. Outer card sits at (CARD_X0, CARD_Y0). The title
  // bar takes CARD_TITLE_H; chips fill the body below it. Each chip is
  // PARAM_W × PARAM_H, with PARAM_GAP between rows. The whole card is wide
  // enough to wrap the chip + padding; the socket sits OUTSIDE the card's
  // right edge so it can be drag-wired from.
  const CARD_X0 = 8, CARD_Y0 = 8, CARD_PAD = 8, CARD_TITLE_H = 26;
  // PARAM_W is DYNAMIC — derived from the longest label so chips like
  // p.totalLen don't clip. Constants below are the FIXED footprint of the
  // pin + input + trash; the label slot expands to fit the longest name.
  const PARAM_W_MIN = 124, PARAM_H = 28, PARAM_GAP = 3;
  const PARAM_PIN_W = 14;        // 📌 column (icon only)
  const PARAM_INPUT_W = 48;      // numeric input column
  const PARAM_TRASH_W = 18;      // 🗑 column
  const PARAM_GAPS = 4 * 6;      // 4× 6 px gap between pin/name/val/trash
  const PARAM_CHIP_PAD = 12;     // 6 px L + R chip padding
  /** Approx char width for 11 px monospace — used to widen the chip to fit
   *  the longest `p.<name>` label without clipping. Caller passes the
   *  longest label CHAR COUNT (including the `p.` prefix). The 7.5 px
   *  bias gives a little extra slack so labels don't sit RIGHT against
   *  the ellipsis threshold. */
  function chipWidthFor(longestLabelChars: number): number {
    const labelPx = Math.max(40, Math.ceil(longestLabelChars * 7.5));
    const w = PARAM_CHIP_PAD + PARAM_PIN_W + PARAM_GAPS + labelPx + PARAM_INPUT_W + PARAM_TRASH_W;
    return Math.max(PARAM_W_MIN, w);
  }
  // Live longest-label-len → live chip width. Updates as params are added
  // / renamed / deleted; the wire endpoints + socket positions all read
  // PARAM_W so they track the chip's growing/shrinking right edge.
  let PARAM_W = $derived.by(() => {
    const names = Object.keys(graph.params ?? {});
    if (names.length === 0) return PARAM_W_MIN;
    const longest = Math.max(...names.map((n) => ('p.' + n).length));
    return chipWidthFor(longest);
  });
  /** Position of the i-th chip's top-left INSIDE the params card. */
  function paramPos(_name: string, i: number): { x: number; y: number } {
    return {
      x: CARD_X0 + CARD_PAD,
      y: CARD_Y0 + CARD_TITLE_H + CARD_PAD + i * (PARAM_H + PARAM_GAP),
    };
  }
  /** Card outer rect dimensions — derived from chip count + chip width. */
  function paramCardSize(n: number, chipW: number): { w: number; h: number } {
    return {
      w: CARD_PAD * 2 + chipW,
      h: CARD_TITLE_H + CARD_PAD * 2 + Math.max(1, n) * PARAM_H + Math.max(0, n - 1) * PARAM_GAP,
    };
  }
  let pcs = $derived(paramCardSize(Object.entries(graph.params ?? {}).length, PARAM_W));
  /** Where a param chip's OUTPUT socket sits — in GRAPH space (the wires
   *  render inside the pan/zoom group, so we convert from the chip's fixed
   *  viewport position back into graph coords). The conversion ensures the
   *  wire's endpoint always lands on the visual chip socket regardless of
   *  pan/zoom. The chip's group is translated to paramPos, and the socket
   *  inside that group sits at (PARAM_W + CARD_PAD + 4, PARAM_H / 2).  */
  /** Pull every `p.<ident>` reference out of an expression string. Returns
   *  unique names in first-occurrence order. Used to render wires from the
   *  referenced param chips into the arg slot when arg.kind === 'expr'. */
  function extractParamRefs(expr: string): string[] {
    if (!expr) return [];
    const re = /\bp\.([a-zA-Z_]\w*)\b/g;
    const seen = new Set<string>();
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(expr)) !== null) {
      const name = m[1]!;
      if (!seen.has(name)) { seen.add(name); out.push(name); }
    }
    return out;
  }
  function paramSocketPos(name: string, i: number): { x: number; y: number } {
    const p = paramPos(name, i);
    const vx = p.x + PARAM_W + CARD_PAD + 4;
    const vy = p.y + PARAM_H / 2;
    // viewport → graph: invert outer transform `translate(pan) ∘ scale(zoom)`.
    return { x: (vx - pan.x) / zoom, y: (vy - pan.y) / zoom };
  }

  // ─── drag-to-wire ───────────────────────────────────────────────────────
  // wireFrom is either a node's output socket OR a param's output chip. On
  // release over an input socket, the connection is committed.
  type WireSource =
    | { kind: 'out'; nodeId: NodeId }
    | { kind: 'param-out'; paramName: string };
  let wireFrom = $state<WireSource | null>(null);
  let wireMouse = $state<{ x: number; y: number } | null>(null);
  function clientToGraph(cx: number, cy: number) {
    if (!canvasEl) return { x: cx, y: cy };
    const r = canvasEl.getBoundingClientRect();
    return { x: ((cx - r.left) - pan.x) / zoom, y: ((cy - r.top) - pan.y) / zoom };
  }
  function startWire(ev: PointerEvent, nodeId: NodeId) {
    ev.stopPropagation();
    wireFrom = { kind: 'out', nodeId };
    wireMouse = clientToGraph(ev.clientX, ev.clientY);
  }
  function startParamWire(ev: PointerEvent, paramName: string) {
    ev.stopPropagation();
    wireFrom = { kind: 'param-out', paramName };
    wireMouse = clientToGraph(ev.clientX, ev.clientY);
  }
  function endWireOnInput(ev: PointerEvent, targetId: NodeId, slot: 'obj' | 'arg' | 'child') {
    ev.stopPropagation();
    if (!wireFrom) return;
    // Only node-output wires fit method/transform sockets (those carry shapes).
    if (wireFrom.kind !== 'out' || wireFrom.nodeId === targetId) { wireFrom = null; wireMouse = null; return; }
    if (slot === 'obj' || slot === 'arg') {
      graph = setMethodInput(graph, targetId, slot, wireFrom.nodeId);
    } else {
      graph = setTransformChild(graph, targetId, wireFrom.nodeId);
    }
    wireFrom = null; wireMouse = null;
  }
  function endWireOnCallArg(ev: PointerEvent, callId: NodeId, key: string) {
    ev.stopPropagation();
    if (!wireFrom) return;
    if (wireFrom.kind === 'param-out') {
      graph = setCallArg(graph, callId, key, asParam(wireFrom.paramName));
    }
    wireFrom = null; wireMouse = null;
  }
  /** Wire a param's output onto one of a mv/rot's three xyz slots. */
  function endWireOnTransformAxis(ev: PointerEvent, transformId: NodeId, axis: 0 | 1 | 2) {
    ev.stopPropagation();
    if (!wireFrom) return;
    if (wireFrom.kind === 'param-out') {
      graph = setTransformAxisValue(graph, transformId, axis, asParam(wireFrom.paramName));
    }
    wireFrom = null; wireMouse = null;
  }
  /** Replace a param-wired transform axis with a literal default. */
  function unwireTransformAxis(transformId: NodeId, axis: 0 | 1 | 2, fallback = 0) {
    const node = graph.nodes[transformId];
    if (!node || (node.type !== 'mv' && node.type !== 'rot')) return;
    const field = node.type === 'mv' ? (node as MvNode).offset : (node as RotNode).rot;
    const cur = field[axis];
    const literal = cur?.kind === 'literal' ? cur.value : (cur?.kind === 'param' ? (graph.params[cur.param]?.default ?? fallback) : fallback);
    graph = setTransformAxis(graph, transformId, axis, typeof literal === 'number' ? literal : fallback);
  }
  /** Card bounding boxes in graph space — used by `bezier()` to route
   *  wires AROUND non-endpoint cards instead of straight through them.
   *  Inline mv/rot wrappers (rendered as decorations on the parent Call,
   *  not as standalone cards) are filtered out. */
  let cardObstacles = $derived.by(() => {
    const out: { id: string; x: number; y: number; w: number; h: number }[] = [];
    for (const id of Object.keys(graph.nodes)) {
      const node = graph.nodes[id];
      if (!node) continue;
      if (isInlineWrapper(id)) continue;
      const pos = graph.layout[id];
      if (!pos) continue;
      const sz = nodeSize(node);
      out.push({ id, x: pos.x, y: pos.y, w: sz.w, h: sz.h });
    }
    return out;
  });

  /** Bezier from (x1,y1) to (x2,y2) — orthogonally routed AROUND any card
   *  whose body the default S-curve would cut through. The source + target
   *  endpoint cards are auto-detected (point sits within EDGE_TOLERANCE
   *  of a card's bounding box → that card is excluded from the obstacle
   *  set). If any non-endpoint obstacle intrudes, the curve's control
   *  points lift to the closer clear Y level (above or below all
   *  blockers), giving the wire a clean arch instead of a straight line
   *  through the offending card body. */
  function bezier(x1: number, y1: number, x2: number, y2: number): string {
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.4);
    const cx1 = x1 + dx, cy1 = y1;
    const cx2 = x2 - dx, cy2 = y2;
    const defaultPath = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
    // Tiny wires (e.g. a self-edge or the in-flight stub) don't need routing.
    const span = Math.hypot(x2 - x1, y2 - y1);
    if (span < 60 || cardObstacles.length === 0) return defaultPath;

    const EDGE_TOLERANCE = 10;
    const CLEAR_BUF = 28; // px above/below blocking cards (was 18 — bump
                          // so the arch reads clearly outside the body)
    const onEdge = (px: number, py: number, o: { x: number; y: number; w: number; h: number }) =>
      px >= o.x - EDGE_TOLERANCE && px <= o.x + o.w + EDGE_TOLERANCE &&
      py >= o.y - EDGE_TOLERANCE && py <= o.y + o.h + EDGE_TOLERANCE;

    // Endpoint cards — wires START and END on socket points that sit on
    // card edges; those cards are NOT obstacles for this wire.
    const endpointCards = new Set<string>();
    for (const o of cardObstacles) {
      if (onEdge(x1, y1, o) || onEdge(x2, y2, o)) endpointCards.add(o.id);
    }

    // Sample a cubic bezier given its control points; returns the worst
    // intrusion (top + bottom clearance of every offending card). The
    // router runs this on the default path AND on each lifted iteration
    // to catch wires whose arch itself crosses another card.
    function intrudeBounds(ax: number, ay: number, bx: number, by: number, cAx: number, cAy: number, cBx: number, cBy: number) {
      const samples = 14;
      let topClear = Infinity, botClear = -Infinity;
      let hits = 0;
      for (let i = 1; i < samples; i++) {
        const t = i / samples;
        const t1 = 1 - t;
        const sx = t1*t1*t1*ax + 3*t1*t1*t*cAx + 3*t1*t*t*cBx + t*t*t*bx;
        const sy = t1*t1*t1*ay + 3*t1*t1*t*cAy + 3*t1*t*t*cBy + t*t*t*by;
        for (const o of cardObstacles) {
          if (endpointCards.has(o.id)) continue;
          if (sx >= o.x && sx <= o.x + o.w && sy >= o.y && sy <= o.y + o.h) {
            hits++;
            if (o.y < topClear) topClear = o.y - CLEAR_BUF;
            if (o.y + o.h > botClear) botClear = o.y + o.h + CLEAR_BUF;
          }
        }
      }
      return { hits, topClear, botClear };
    }

    // First pass — default bezier. Picks an arch side + a Y level.
    const first = intrudeBounds(x1, y1, x2, y2, cx1, cy1, cx2, cy2);
    if (first.hits === 0) return defaultPath;
    const midY = (y1 + y2) / 2;
    let goUp = (midY - first.topClear) <= (first.botClear - midY);
    let arcY = goUp ? first.topClear : first.botClear;

    // Iterative refinement — lift the arch until it ALSO clears any card
    // its bend would otherwise cross. Caps at 4 passes (rarely needed for
    // typical graphs) and at the canvas bounds so we don't fly off.
    for (let pass = 0; pass < 4; pass++) {
      const re = intrudeBounds(x1, y1, x2, y2, cx1, arcY, cx2, arcY);
      if (re.hits === 0) break;
      // The arch itself is hitting a new card. Bump arcY further in the
      // same direction by the worst clearance we just collected.
      if (goUp)  arcY = Math.min(arcY, re.topClear);
      else       arcY = Math.max(arcY, re.botClear);
    }
    return `M ${x1} ${y1} C ${cx1} ${arcY}, ${cx2} ${arcY}, ${x2} ${y2}`;
  }

  // Socket position helpers — match the node card geometries below.
  // Call card: 200×<auto>; output socket on right edge mid-card.
  // Method card: 180×100; sockets on left (obj at y+30, arg at y+70) + right (output y+50).
  // Mv/Rot card: 200×120; left (child y+40) + right (output y+60).
  // ─── Per-card user resize overrides ───────────────────────────────────
  /** Sets the user-override width on a card, clamped to the card's
   *  MINIMUM-content width (key column + input + actions + padding).
   *  Width round-trips through graph.layout[id].w so resize persists
   *  across Save → reload (T #111). */
  function setCardWidth(id: string, w: number) {
    const node = graph.nodes[id];
    if (!node) return;
    const min = cardMinWidth(node);
    const clamped = Math.max(min, Math.round(w));
    const cur = graph.layout[id] ?? { x: 0, y: 0 };
    graph = setLayout(graph, id, { ...cur, w: clamped });
  }
  /** Minimum width the card can shrink to — derived from the row content.
   *  For Call cards: key column (70 px for "label") + value cell (input +
   *  actions = ~76 px) + horizontal padding ~16 px. Everything else uses
   *  its native fixed default — the user resizes those rarely. */
  function cardMinWidth(node: any): number {
    if (node.type === 'call')   return 168; // 70 key + 76 value + 22 chrome
    if (node.type === 'method') return 96;  // ⊖ + label + × (sockets sit on edges)
    if (node.type === 'mv' || node.type === 'rot') return 116;
    if (node.type === 'repeat') return 170;
    if (node.type === 'list' || node.type === 'stack' || node.type === 'group') return 110;
    return 130;
  }
  /** Auto-fit width based on the card's content — title length + longest
   *  arg key character count + value cell footprint. The result is the
   *  DEFAULT width when no user override is set; the user can always
   *  drag the grip to override. */
  function cardAutoWidth(node: any): number {
    if (node.type === 'call') {
      const argKeys = Object.keys(node.args ?? {});
      const titleChars = (node.alias?.length ?? 0) + 3 + (node.src?.length ?? 0); // "A · dt_tube"
      const longestKey = argKeys.length ? Math.max(...argKeys.map((k) => k.length)) : 4;
      // 70 key column was a constant; widen if the longest key needs more
      // (still letting the input cell breathe).
      const keyW = Math.max(70, longestKey * 8 + 8);
      const valueW = 124; // input + ƒ + × comfortably
      const padding = 22;
      const fromArgs = keyW + valueW + padding;
      const fromTitle = titleChars * 7 + 50; // ⇄ ↻ × glyphs + side padding
      return Math.max(220, fromArgs, fromTitle);
    }
    if (node.type === 'method') return 110;
    if (node.type === 'mv' || node.type === 'rot') return 136;
    if (node.type === 'repeat') return 230;
    if (node.type === 'list' || node.type === 'stack' || node.type === 'group') {
      // Auto-width based on the LONGEST child-slot label. Each slot prints
      // either the child's "alias · src" (call), "op(…)" (method/transform),
      // or a fallback. Width = padding + socket + longest_label + chrome.
      const labels: string[] = [];
      for (const cid of (node as any).children ?? []) {
        const child = graph.nodes[cid];
        if (!child) continue;
        labels.push(
          child.type === 'call'   ? `${(child as any).alias} · ${(child as any).src}` :
          child.type === 'method' ? `${(child as any).op}(…)` :
          child.type === 'mv'     ? 'mv(…)' :
          child.type === 'rot'    ? 'rot(…)' :
          child.type === 'stack'  ? 'stack(…)' :
          child.type === 'repeat' ? `repeat × ${(child as any).count?.kind === 'literal' ? (child as any).count.value : '…'}` :
          '(missing)',
        );
      }
      const longest = labels.length ? Math.max(...labels.map((s) => s.length)) : 12;
      // ~7 px per char monospace + 18 px socket + 14 px × button + 16 px
      // padding. Title row has the ▶ chevron + name + ⚙ gear so the
      // header itself needs room; account for the minimum.
      const titleW = 90; // ▶ Output + gear with padding
      const rowW = longest * 7 + 18 + 14 + 16;
      // 120 px floor matches the Call card's min and reads as a real
      // container, not a half-collapsed sliver.
      return Math.max(120, Math.max(rowW, titleW));
    }
    return 180;
  }
  function nodeSize(node: any): { w: number; h: number } {
    // Width source of truth: graph.layout[id].w (persisted) → cardAutoWidth
    // fallback. The min clamp protects rows from collapsing below the
    // input+actions footprint even when a stale saved width is too small.
    const savedW = graph.layout[node.id]?.w;
    const baseW = typeof savedW === 'number' ? savedW : cardAutoWidth(node);
    const w = Math.max(cardMinWidth(node), baseW);
    if (node.type === 'call') {
      const argCount = Object.keys(node.args ?? {}).length;
      return { w, h: Math.max(80, 50 + argCount * 22) };
    }
    if (node.type === 'method') return { w, h: 64 };
    if (node.type === 'mv' || node.type === 'rot') return { w, h: 110 };
    if (node.type === 'repeat') return { w, h: 110 };
    if (node.type === 'list' || node.type === 'stack' || node.type === 'group') {
      const slots = (node.children?.length ?? 0) + 1;
      return { w, h: Math.max(60, 40 + slots * 22) };
    }
    return { w, h: 80 };
  }
  /** Input socket Y for the i-th child slot of a container (list/stack/group). */
  function containerSlotY(i: number): number { return 40 + i * 22; }
  /** Drag-wire target — when a wire ends on a container's slot, append the
   *  source node as a child of that container. Idempotent (won't double-add). */
  function endWireOnContainerSlot(ev: PointerEvent, containerId: NodeId) {
    if (!wireFrom) return;
    ev.stopPropagation();
    graph = appendContainerChild(graph, containerId, wireFrom.nodeId);
    wireFrom = null; wireMouse = null;
  }
  function nodePos(id: NodeId): { x: number; y: number } {
    return graph.layout[id] ?? { x: 0, y: 0 };
  }
  function outputSocketAt(id: NodeId): { x: number; y: number } {
    const node = graph.nodes[id];
    if (!node) return { x: 0, y: 0 };
    const { w, h } = nodeSize(node);
    const p = nodePos(id);
    // mv / rot put their OUTPUT socket on the title row's right edge
    // (y=16) — same vertical line as the child input on the left. Other
    // node types keep the middle-right edge default.
    if (node.type === 'mv' || node.type === 'rot') return { x: p.x + w, y: p.y + 16 };
    if (node.type === 'method') return { x: p.x + w, y: p.y + 14 };
    return { x: p.x + w, y: p.y + h / 2 };
  }
  function inputSocketAt(id: NodeId, slot: 'obj' | 'arg' | 'child'): { x: number; y: number } {
    const p = nodePos(id);
    const node = graph.nodes[id];
    if (!node) return p;
    if (slot === 'obj')  return { x: p.x, y: p.y + 42 };
    if (slot === 'arg')  return { x: p.x, y: p.y + 56 };
    // mv / rot put their child socket on the LEFT EDGE, vertically aligned
    // with the title row (y=16). Axis sockets line the rest of the left
    // edge underneath. Repeat keeps the legacy bottom-edge position via
    // its own renderer.
    if (slot === 'child' && (node.type === 'mv' || node.type === 'rot')) {
      return { x: p.x, y: p.y + 16 };
    }
    /* child (legacy left-edge for method/repeat) */
    return { x: p.x, y: p.y + 50 };
  }
  /** Container slot input socket position — the i-th child slot of a
   *  list/stack/group container's card. Used to draw the visible "piped
   *  into output" wires from each child node's output socket to its slot
   *  in the Output (root list) card. */
  function containerSlotInputAt(containerId: NodeId, i: number): { x: number; y: number } {
    const p = nodePos(containerId);
    return { x: p.x, y: p.y + containerSlotY(i) };
  }

  // ─── picker — drops Calls, CSG ops, transforms ──────────────────────────
  let pickerOpen = $state(false);
  let pickerSrcs = $state<string[]>([]);
  let pickerFilter = $state('');
  /** Anchor for the picker dropdown — same pattern as the ⚙ canvas-
   *  settings menu. We bind:this on the + rail button and read its
   *  getBoundingClientRect when opening so the picker sits flush
   *  next to it (not pinned at a hardcoded `top: 60px`). */
  let dropBtnEl = $state<HTMLButtonElement | null>(null);
  let pickerPos = $state<{ left: number; top: number }>({ left: 56, top: 60 });
  async function openPicker() {
    if (dropBtnEl) {
      const r = dropBtnEl.getBoundingClientRect();
      pickerPos = { left: r.right + 6, top: r.top };
    }
    pickerOpen = true;
    if (pickerSrcs.length === 0) {
      try {
        const r = await fetch('/api/primitives/list');
        const d = await r.json() as any;
        // completions is an OBJECT keyed by family ({drill_pipe: [...], packers: [...]}) —
        // flatten its values; basic + stdlib/stdstale + completions are arrays of {id, source, …}.
        // stdstale carries r_revolve/r_extrude/r_weld_extrude (the engines being phased
        // out of stdlib but still callable); INCLUDE them so r_revolve + r_extrude
        // are reachable as Calls in the picker (#105 surface step).
        const basicItems = Array.isArray(d.basic) ? d.basic : [];
        const stdlibItems = Array.isArray(d.stdlib) ? d.stdlib : [];
        const stdstaleItems = Array.isArray(d.stdstale) ? d.stdstale : [];
        const completionItems: any[] = d.completions && typeof d.completions === 'object'
          ? (Object.values(d.completions) as any[][]).flat()
          : [];
        const all = [...basicItems, ...stdlibItems, ...stdstaleItems, ...completionItems];
        // Stash {id, source} so the sort dropdown can group by source.
        const seen = new Set<string>();
        pickerSrcs = [];
        pickerSrcMeta = {};
        for (const p of all) {
          if (!p?.id || seen.has(p.id)) continue;
          seen.add(p.id);
          pickerSrcs.push(p.id);
          pickerSrcMeta[p.id] = { source: p.source ?? 'volume' };
        }
        // Stdlib glob-cache patch — Vite's `import.meta.glob('/stdlib/*.ts')`
        // caches the matched set at first module load; adding a NEW file to
        // src/lib/cad/stdlib/ doesn't refresh it without a server restart
        // (the source + bake endpoints still resolve it because they read
        // fs directly). Probe the source endpoint for a known stdlib id
        // here so a freshly-added primitive becomes pickable WITHOUT a
        // restart. Remove this once the glob's HMR story is solid.
        for (const id of ['r_cuboid']) {
          if (seen.has(id)) continue;
          try {
            const sr = await fetch(`/api/primitives/source?name=${encodeURIComponent(id)}`);
            if (sr.ok) {
              const sd = await sr.json() as any;
              if (sd?.source) {
                pickerSrcs.push(id);
                pickerSrcMeta[id] = { source: 'stdlib' };
                seen.add(id);
              }
            }
          } catch { /* skip — not resolvable */ }
        }
        pickerSrcs.sort();
      } catch { /* fall through */ }
    }
  }
  /** Per-id metadata (source: 'basic'|'stdlib'|'stdstale'|'volume') used
   *  by the picker's sort dropdown. Populated alongside pickerSrcs. */
  let pickerSrcMeta = $state<Record<string, { source: string }>>({});
  /** Sort mode for the +Drop picker primitive list. Persisted to
   *  localStorage so the user's pick survives across sessions.
   *    'name'   — A→Z (default)
   *    'recent' — recently used first (per localStorage 'ge-picker-recent')
   *    'source' — group by source: stdlib → basic → stdstale → completions */
  let pickerSort = $state<'name' | 'recent' | 'source'>('name');
  let pickerRecent = $state<string[]>([]);
  onMount(() => {
    try {
      const m = localStorage.getItem('ge-picker-sort');
      if (m === 'name' || m === 'recent' || m === 'source') pickerSort = m;
      const r = localStorage.getItem('ge-picker-recent');
      if (r) pickerRecent = JSON.parse(r) as string[];
    } catch { /* storage blocked */ }
  });
  function setPickerSort(m: 'name' | 'recent' | 'source') {
    pickerSort = m;
    try { localStorage.setItem('ge-picker-sort', m); } catch { /* ignore */ }
  }
  /** Track usage when a primitive is dropped — feeds the 'recent' sort. */
  function bumpRecent(id: string) {
    pickerRecent = [id, ...pickerRecent.filter((x) => x !== id)].slice(0, 30);
    try { localStorage.setItem('ge-picker-recent', JSON.stringify(pickerRecent)); } catch { /* ignore */ }
  }
  function closePicker() { pickerOpen = false; pickerFilter = ''; }
  async function dropCall(src: string) {
    closePicker();
    bumpRecent(src);
    let args: Record<string, any> = {};
    let paramKeys: string[] = [];
    let defaults: Record<string, number> = {};
    try {
      const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(src)}`);
      const d = await r.json() as any;
      const profileKeys = new Set<string>();
      for (const [k, p] of Object.entries((d.params ?? {}) as Record<string, any>)) {
        // Profile-typed args (r_revolve / r_extrude) carry a {kind, params}
        // DESCRIPTOR as their default — not a number. Encode as an `expr`
        // ArgValue: emit injects the literal object syntax, the body's
        // resolveProfile(...) call inside the primitive collapses it to
        // points. The profile-picker chip in the Call card (#119) reads
        // the descriptor + offers a kind swap; absent the picker the user
        // can still hand-edit the JSON in the ƒ popup.
        if (p && typeof p === 'object' && p.type === 'profile' && p.default && typeof p.default === 'object') {
          args[k] = asExpr(JSON.stringify(p.default));
          profileKeys.add(k);
        } else {
          args[k] = asLiteral(p?.default ?? 0);
        }
        paramKeys.push(k);
        defaults[k] = Number(p?.default ?? 0);
      }
      // Infer the profile "set" (revolve vs cartesian) from the primitive
      // name. r_revolve → revolve (r,z); r_extrude / r_weld_extrude →
      // cartesian (x,y). Drives the kind filter in the picker.
      if (profileKeys.size > 0) {
        expectedProfileKeys = { ...expectedProfileKeys, [src]: profileKeys };
        expectedProfileSet = {
          ...expectedProfileSet,
          [src]: src === 'r_revolve' ? 'revolve' : 'cartesian',
        };
      }
    } catch { /* leave args empty */ }
    const result = addCall(graph, src, args);
    graph = result.graph;
    // Cache the expected params for drift detection — same fetch we just did.
    if (paramKeys.length > 0) {
      expectedParams = { ...expectedParams, [src]: paramKeys };
      expectedDefaults = { ...expectedDefaults, [src]: defaults };
    }
  }

  /** Lazy-load expected params for any Call whose src we haven't fetched
   *  yet (URL hydrate, paste-in from clipboard, etc.). Idempotent — only
   *  fetches each src once per session. */
  async function loadExpectedParamsFor(src: string) {
    if (expectedParams[src]) return;
    try {
      const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(src)}`);
      if (!r.ok) return;
      const d = await r.json() as any;
      const keys = Object.keys(d.params ?? {});
      const defaults: Record<string, number> = {};
      const profileKeys = new Set<string>();
      for (const [k, p] of Object.entries((d.params ?? {}) as Record<string, any>)) {
        defaults[k] = Number(p.default ?? 0);
        if (p && typeof p === 'object' && p.type === 'profile') profileKeys.add(k);
      }
      expectedParams = { ...expectedParams, [src]: keys };
      expectedDefaults = { ...expectedDefaults, [src]: defaults };
      if (profileKeys.size > 0) {
        expectedProfileKeys = { ...expectedProfileKeys, [src]: profileKeys };
        expectedProfileSet = {
          ...expectedProfileSet,
          [src]: src === 'r_revolve' ? 'revolve' : 'cartesian',
        };
      }
    } catch { /* skip */ }
  }

  // Whenever the graph changes, fetch expected params for any new src.
  $effect(() => {
    const srcs = new Set<string>();
    for (const n of Object.values(graph.nodes)) {
      if (n.type === 'call') srcs.add(n.src);
    }
    for (const src of srcs) loadExpectedParamsFor(src);
  });

  /** A Call is "drifted" when its args keys differ from the underlying
   *  primitive's CURRENT meta.params keys. Returns false when expected
   *  params haven't been fetched yet (don't false-positive). */
  function isCallDrifted(callId: NodeId): boolean {
    const node = graph.nodes[callId];
    if (!node || node.type !== 'call') return false;
    const expected = expectedParams[node.src];
    if (!expected) return false;
    const have = Object.keys(node.args ?? {}).sort();
    const want = [...expected].sort();
    if (have.length !== want.length) return true;
    return have.some((k, i) => k !== want[i]);
  }

  /** Sync a drifted Call's args back to the primitive's CURRENT params:
   *    • keep existing arg values for keys that survive
   *    • add new keys with the primitive's default values
   *    • drop orphan keys
   *  Wholesale args replacement instead of incremental setCallArg so
   *  the graph diff is one transaction. */
  function refreshCallArgs(callId: NodeId) {
    const node = graph.nodes[callId];
    if (!node || node.type !== 'call') return;
    const expected = expectedParams[node.src];
    const defaults = expectedDefaults[node.src] ?? {};
    if (!expected) return;
    const newArgs: Record<string, any> = {};
    for (const k of expected) {
      const existing = (node.args as any)?.[k];
      newArgs[k] = existing ?? asLiteral(defaults[k] ?? 0);
    }
    // Mutate via setCallArg one key at a time — preserves edge index rebuild.
    let g = graph;
    // First strip orphan keys via a node replacement.
    const updated = { ...node, args: { ...newArgs } } as any;
    g = { ...g, nodes: { ...g.nodes, [callId]: updated } };
    graph = g;
  }
  // ─── Resizable 2-pane divider ──────────────────────────────────────────
  // The editor's main area is split canvas | (bake/source tabs). Default
  // ratio is canvas 70 % / right 30 %, giving the graph 7/10 of the width.
  // Persisted as client state (localStorage) so the user's preferred split
  // survives reloads without bloating meta.graph.
  let splitA = $state(70);          // canvas pane %
  let gridEl: HTMLElement | undefined = $state();
  let splitDragging = false;
  /** Right-pane tab: 3D bake or live source. */
  let rightTab = $state<'bake' | 'source' | 'md'>('bake');
  onMount(() => {
    try {
      const a = Number(localStorage.getItem('ge-splitA-v2'));
      if (a >= 30 && a <= 85) splitA = a;
      const t = localStorage.getItem('ge-right-tab');
      if (t === 'bake' || t === 'source' || t === 'md') rightTab = t;
    } catch { /* localStorage blocked — fine */ }
  });
  function startSplitDrag(ev: PointerEvent) {
    if (ev.button !== 0) return;
    splitDragging = true;
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    ev.preventDefault();
  }
  function onSplitMove(ev: PointerEvent) {
    if (!splitDragging || !gridEl) return;
    const r = gridEl.getBoundingClientRect();
    const pct = ((ev.clientX - r.left) / r.width) * 100;
    splitA = Math.max(30, Math.min(85, pct));
  }
  function endSplitDrag(ev: PointerEvent) {
    if (!splitDragging) return;
    (ev.currentTarget as Element).releasePointerCapture(ev.pointerId);
    splitDragging = false;
    try { localStorage.setItem('ge-splitA-v2', String(splitA)); } catch { /* ignore */ }
  }
  function setRightTab(t: 'bake' | 'source' | 'md') {
    rightTab = t;
    try { localStorage.setItem('ge-right-tab', t); } catch { /* ignore */ }
  }

  /** Drawing descriptor markdown — hand-authored "how to draw this part"
   *  reference. Stored alongside the graph as `meta.drawingMd` so it
   *  round-trips through save → reload. Hydrated from any saved file in
   *  the URL-load block below; empty for fresh graphs. */
  let drawingMd = $state<string>('');
  /** ✨ AI-generate spinner. The actual /api/primitives/describe endpoint
   *  is a follow-up; today this surfaces a "not yet wired" notice in the
   *  MD pane so the icon is testable without breaking the flow. */
  let mdAiBusy = $state(false);
  async function generateMdWithAi() {
    if (mdAiBusy) return;
    mdAiBusy = true;
    try {
      // TODO (#117): POST { source, bakeStats, graph } to
      // /api/primitives/describe (Claude vision). For now stub a friendly
      // notice prepended to the existing MD so the user can see the icon
      // fires + the spot the AI will land its draft into.
      const stub = `<!-- ✨ AI describe is not wired yet — coming in #117. -->\n<!-- For ${exemplarId}: include purpose, function, composition, parameter table, drawing notes, see-also links. -->\n\n`;
      if (!drawingMd.trim()) drawingMd = stub;
      else if (!drawingMd.startsWith('<!--')) drawingMd = stub + drawingMd;
    } finally {
      mdAiBusy = false;
    }
  }

  function dropCsg(op: CsgOp) { closePicker(); graph = addMethodPlaceholder(graph, op).graph; }
  function dropMv()  { closePicker(); graph = addMvPlaceholder(graph).graph; }
  function dropRot() { closePicker(); graph = addRotPlaceholder(graph).graph; }
  function dropStack(){ closePicker(); graph = addStackPlaceholder(graph).graph; }

  /** Profile-mode "pen" nodes — turtle-graphics-style polygon authoring.
   *  Each pen node lands as a Call with a synthetic src tag (`pen_mv`,
   *  `pen_line`, …) and default literal args. The Phase 2b profile-
   *  emit pipeline interprets these src tags into build() body output.
   *
   *  Why CALL nodes (not a new node type): keeps the graph data model
   *  unchanged, so wire / layout / autoLayout / push-apart all work
   *  uniformly. The src string is a sentinel — the emitter and the
   *  picker both pattern-match against `pen_*` to decide their behavior.
   *
   *  Defaults are Z-down friendly (revolve set): mv puts the pen at
   *  origin; line pulls outward by 1 in r; lineR pushes down 1 in z;
   *  lineZ same. The user adjusts the literal args from there or
   *  wires them to assembly params (od, len, …) via the ƒ-popup. */
  function dropPen(op: 'mv' | 'line' | 'lineR' | 'lineZ') {
    closePicker();
    const args: Record<string, { kind: 'literal'; value: number }> = (() => {
      if (op === 'mv')    return { r: asLiteral(0), z: asLiteral(0) };
      if (op === 'line')  return { r: asLiteral(1), z: asLiteral(0) };
      if (op === 'lineR') return { dr: asLiteral(0), dz: asLiteral(1) };
      return { dz: asLiteral(1) }; // lineZ
    })();
    graph = addCall(graph, `pen_${op}`, args).graph;
  }

  // ─── stack/list reorder popover ─────────────────────────────────────────
  // ⚙ button on container cards (stack / list / group / root output) opens
  // a popover showing each child as a row with ▲ / ▼ to reorder. Mutates
  // container.children directly; the visible slots + wires re-derive.
  let containerPop = $state<{ containerId: NodeId; x: number; y: number } | null>(null);
  function openContainerPop(ev: MouseEvent, containerId: NodeId) {
    ev.stopPropagation();
    containerPop = { containerId, x: ev.clientX, y: ev.clientY };
  }
  function closeContainerPop() { containerPop = null; }
  function moveChild(containerId: NodeId, index: number, delta: -1 | 1) {
    const node = graph.nodes[containerId] as any;
    if (!node || !Array.isArray(node.children)) return;
    const newIndex = index + delta;
    if (newIndex < 0 || newIndex >= node.children.length) return;
    const newChildren = [...node.children];
    [newChildren[index], newChildren[newIndex]] = [newChildren[newIndex]!, newChildren[index]!];
    graph = { ...graph, nodes: { ...graph.nodes, [containerId]: { ...node, children: newChildren } } };
  }

  // ─── dev-server restart from the bake error ─────────────────────────────
  // POSTs to /api/__dev_restart which spawns a detached restart of `bun run
  // dev`. The current dev server dies; the browser keeps polling and reloads
  // bake state once the new server comes up. ~2-3 seconds in practice.
  let restartBusy = $state(false);
  let restartStatus = $state<string | null>(null);
  async function restartDevServer() {
    if (restartBusy) return;
    restartBusy = true;
    restartStatus = 'killing dev server…';
    try {
      const r = await fetch('/api/__dev_restart', { method: 'POST' });
      if (!r.ok) {
        const txt = await r.text();
        restartStatus = `✗ ${r.status}: ${txt.slice(0, 120)}`;
        restartBusy = false;
        return;
      }
      restartStatus = '🔄 waiting for new server…';
      // Poll the cache-stats endpoint until it answers — that means a fresh
      // bun run dev came up.
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 500));
        try {
          const ping = await fetch('/api/cache/stats', { cache: 'no-store' });
          if (ping.ok) {
            restartStatus = '✓ dev server ready — re-baking…';
            // Trigger a bake re-run by tweaking the graph state slightly.
            graph = { ...graph };
            setTimeout(() => { restartStatus = null; restartBusy = false; }, 1500);
            return;
          }
        } catch { /* still down */ }
      }
      restartStatus = '⚠ timeout waiting for restart — check /tmp/cadtrain-dev.log';
      restartBusy = false;
    } catch (e: any) {
      restartStatus = `✗ ${e?.message ?? String(e)}`;
      restartBusy = false;
    }
  }
  /** Drop a Repeat + a Stack adjacent + pre-wire Repeat output → Stack
   *  first slot. The canonical pattern (Repeat → Stack → Output) becomes
   *  one click. User can ⚙ open the Stack popover or × the Stack if they
   *  want raw list output instead. */
  function dropRepeat() {
    closePicker();
    const r = addRepeatPlaceholder(graph);
    const s = addStackPlaceholder(r.graph);
    let g2 = appendContainerChild(s.graph, s.id, r.id);
    // Offset the Stack to the right of the Repeat so the wire reads
    // left-to-right immediately, without needing 📐 Auto-layout.
    const rPos = g2.layout[r.id] ?? { x: 80, y: 80 };
    g2 = setLayout(g2, s.id, { x: rPos.x + 260, y: rPos.y });
    graph = g2;
  }
  /** Drag-wire ending on a Repeat node's count socket — sets the count
   *  to a param (when wireFrom is a param chip). Same pattern as the
   *  Call arg wire targets. */
  function endWireOnRepeatCount(ev: PointerEvent, repeatId: NodeId) {
    if (!wireFrom) return;
    ev.stopPropagation();
    if (wireFrom.kind === 'param-out') {
      graph = setRepeatCount(graph, repeatId, asParam(wireFrom.paramName));
    }
    wireFrom = null; wireMouse = null;
  }
  /** Drag-wire ending on a Repeat node's child slot — set the wire source
   *  as the new child. Idempotent and works for any node type that has an
   *  output socket. */
  function endWireOnRepeatChild(ev: PointerEvent, repeatId: NodeId) {
    if (!wireFrom) return;
    ev.stopPropagation();
    graph = setRepeatChild(graph, repeatId, wireFrom.nodeId);
    wireFrom = null; wireMouse = null;
  }

  function deleteNode(id: string) { graph = removeNode(graph, id); }
  function onArgEdit(id: string, key: string, value: number) {
    graph = setCallArg(graph, id, key, asLiteral(value));
  }
  /** Convert an arg between literal and expression modes (ƒ toggle).
   *  literal → expr seeded with the literal value as text (e.g. 1.5 → "1.5")
   *  expr → literal parsed via parseFloat, falling back to 0 if unparseable
   *  param  → expr seeded as "p.<paramName>" (no-op for the user — they could
   *           click × to fully unwire, but starting from the live binding is
   *           a natural way to compose `p.od / 2`). */
  function toggleArgExprMode(id: string, key: string) {
    const node = graph.nodes[id];
    if (!node || node.type !== 'call') return;
    const cur = (node as any).args[key];
    if (cur?.kind === 'expr') {
      const n = parseFloat(String(cur.expr));
      graph = setCallArg(graph, id, key, asLiteral(isNaN(n) ? 0 : n));
    } else if (cur?.kind === 'param') {
      graph = setCallArg(graph, id, key, asExpr(`p.${cur.param}`));
    } else {
      const seed = cur?.kind === 'literal' ? String(cur.value) : '0';
      graph = setCallArg(graph, id, key, asExpr(seed));
    }
  }
  function onArgExprEdit(id: string, key: string, expr: string) {
    graph = setCallArg(graph, id, key, asExpr(expr));
  }

  // ─── multi-source ƒ-expression popup editor ─────────────────────────────
  // When an arg's kind === 'expr' AND the expression references 2+ distinct
  // params, the inline text input is too cramped to author cleanly. The
  // collapsed chip — "ƒ(p.od, p.wall)" — opens this popup with a bigger
  // text area + click-to-insert chips for every declared param. Applied
  // value commits back to the arg via setCallArg(asExpr(...)).
  let argExprPop = $state<{ callId: NodeId; key: string; draft: string; x: number; y: number } | null>(null);
  function openArgExprPop(ev: MouseEvent, callId: NodeId, key: string, currentExpr: string) {
    ev.stopPropagation();
    argExprPop = { callId, key, draft: currentExpr, x: ev.clientX, y: ev.clientY };
  }
  function closeArgExprPop() { argExprPop = null; }
  function applyArgExprPop() {
    if (!argExprPop) return;
    graph = setCallArg(graph, argExprPop.callId, argExprPop.key, asExpr(argExprPop.draft));
    argExprPop = null;
  }
  // ─── Profile picker popover (#119) ─────────────────────────────────────
  /** Open when the user clicks a profile chip on a Call card. Lists every
   *  curated kind from PROFILE_REGISTRY filtered by the primitive's `set`
   *  (revolve vs cartesian). Selecting a kind rewrites the arg's expr to
   *  a fresh `{kind, params}` JSON descriptor seeded with defaults. */
  let profilePop = $state<{ callId: NodeId; key: string; src: string; set: 'revolve' | 'cartesian'; currentKind: string; x: number; y: number } | null>(null);
  function openProfilePop(ev: MouseEvent, callId: NodeId, key: string, src: string, currentKind: string) {
    ev.stopPropagation();
    const set = expectedProfileSet[src] ?? (src === 'r_revolve' ? 'revolve' : 'cartesian');
    profilePop = { callId, key, src, set, currentKind, x: ev.clientX, y: ev.clientY };
  }
  function closeProfilePop() { profilePop = null; }
  function selectProfileKind(kindId: string) {
    if (!profilePop) return;
    const def: ProfileDef | undefined = PROFILE_REGISTRY[kindId];
    if (!def) return;
    const desc = { kind: kindId, params: defaultsFor(def) };
    graph = setCallArg(graph, profilePop.callId, profilePop.key, asExpr(JSON.stringify(desc)));
    profilePop = null;
  }
  /** Parse the current expr ArgValue into a `{kind, params}` descriptor.
   *  Returns null when the expr isn't a parseable JSON object (e.g. the
   *  user wrote a custom math expression). The chip renderer falls back
   *  to "expr ƒ" in that case. */
  function parseProfileExpr(expr: string): { kind?: string; params?: Record<string, number> } | null {
    if (!expr || !expr.trim().startsWith('{')) return null;
    try { return JSON.parse(expr); } catch { return null; }
  }
  /** Curated kinds available for a given set, sorted by label. */
  function kindsForSet(set: 'revolve' | 'cartesian'): ProfileDef[] {
    return Object.values(PROFILE_REGISTRY)
      .filter((d) => d.set === set)
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function insertParamIntoDraft(name: string) {
    if (!argExprPop) return;
    const ref = `p.${name}`;
    const draft = argExprPop.draft;
    // Append with a space if there's existing text + the last char isn't whitespace.
    const sep = draft.length > 0 && !/\s$/.test(draft) ? ' ' : '';
    argExprPop = { ...argExprPop, draft: draft + sep + ref };
  }
  function onTransformAxis(id: string, axis: 0 | 1 | 2, value: number) {
    graph = setTransformAxis(graph, id, axis, value);
  }
  /** ƒ button on an mv/rot axis — toggle the axis between literal /
   *  expression mode. Mirrors toggleArgExprMode on Call args. Going IN to
   *  expr mode seeds the draft with `p.<name>` (when wired) or the current
   *  literal value, so the input stays meaningful after the toggle. */
  function toggleTransformAxisExprMode(id: string, axis: 0 | 1 | 2) {
    const node = graph.nodes[id] as (MvNode | RotNode) | undefined;
    if (!node) return;
    const field = node.type === 'mv' ? (node as MvNode).offset : (node as RotNode).rot;
    const cur = field[axis];
    if (cur.kind === 'expr') {
      // Try to recover a literal from the expression — if the expression
      // is just a number string we keep the value; otherwise reset to 0.
      const n = Number(cur.expr);
      graph = setTransformAxisValue(graph, id, axis, asLiteral(Number.isFinite(n) ? n : 0));
      return;
    }
    let seed = '';
    if (cur.kind === 'param') seed = `p.${cur.param}`;
    else if (cur.kind === 'literal') seed = String(cur.value);
    graph = setTransformAxisValue(graph, id, axis, asExpr(seed));
  }
  /** Edit the expression value on an mv/rot axis. */
  function onTransformAxisExprEdit(id: string, axis: 0 | 1 | 2, expr: string) {
    graph = setTransformAxisValue(graph, id, axis, asExpr(expr));
  }
  function resetGraph() { graph = newGraph(); }

  // ─── auto-layout (Phase 20) ────────────────────────────────────────────
  // 📐 Auto-layout runs the heuristic layered algorithm in
  // src/lib/cad/composition-layout.ts → rearranges every node by depth
  // column with a barycenter tiebreaker (cheap, deterministic, ~120 LOC,
  // zero deps). One-step undo restores the prior layout.
  //
  // Phase 21 (deferred) will swap in dagre when graphs grow past ~15 nodes.
  let undoLayout = $state<Record<string, { x: number; y: number }> | null>(null);
  function autoLayout() {
    undoLayout = { ...graph.layout };
    graph = autoLayoutGraph(graph);
  }
  function undoAutoLayout() {
    if (!undoLayout) return;
    graph = { ...graph, layout: { ...undoLayout } };
    undoLayout = null;
  }
  // Phase 22 — 🧲 Push apart. Resolves overlapping cards via pairwise
  // bounding-box separation. Includes the tacked params card as a
  // viewport-fixed obstacle so nodes get pushed clear of it too.
  // The same undoLayout snapshot is reused so the user can ↶ undo this
  // just like an auto-layout.
  function pushApart() {
    undoLayout = { ...graph.layout };
    // Convert the params card's viewport rect to graph space so it
    // participates in the force iteration. As the user pans, the card's
    // graph-space position shifts inversely; we recompute on each click.
    const pcardSize = paramCardSize(paramEntries.length, PARAM_W);
    const obstacles: { id: string; x: number; y: number; w: number; h: number }[] = [{
      id: '__obs_params_card',
      x: (CARD_X0 - pan.x) / zoom,
      y: (CARD_Y0 - pan.y) / zoom,
      // socket spills past the card's right edge by ~12 px — pad accordingly
      w: (pcardSize.w + 14) / zoom,
      h: pcardSize.h / zoom,
    }];
    // Boundary walls (#116). The visible canvas region in graph space is
    // ([0, rect.width]/zoom shifted by -pan.x, etc.). Repellant walls
    // ride the obstacles channel — a tall thin rect JUST OUTSIDE the edge
    // that pushes any node touching the edge away. Confiner walls clamp
    // to the visible interior via confinerBounds. If both edges are off,
    // we skip the rect lookup entirely.
    let confinerBounds: { minX?: number; maxX?: number } | undefined;
    if (canvasEl && (boundLeft !== 'off' || boundRight !== 'off')) {
      const rect = canvasEl.getBoundingClientRect();
      // Viewport edges in graph space — the wall IS the current section
      // boundary. Cards past the edge (off-screen) get pulled back inside;
      // cards inside don't get touched. To catch cards that are already
      // far off-screen, each wall extends as a FULL HALF-PLANE in the
      // off-screen direction — viewport-end → ±FAR — so a card anywhere
      // outside the visible region overlaps it and gets pushed back in.
      const FAR = 10000;
      const gxLeft = (0 - pan.x) / zoom;
      const gxRight = (rect.width - pan.x) / zoom;
      const gyTop = (0 - pan.y) / zoom;
      const gyBottom = (rect.height - pan.y) / zoom;
      const wallY = gyTop - FAR;
      const wallH = (gyBottom - gyTop) + 2 * FAR;
      // Repellant mode ALSO sets a confinerBounds clamp on that side —
      // gives a hard "stay inside the viewport" guarantee on top of the
      // half-plane obstacle, so pairwise pushes that ricochet a card past
      // the boundary in one iteration get yanked back at the end of that
      // same iteration. Without this, a chain of 5+ cards can cascade and
      // send the last 1-2 off-screen as the resolver moves things around.
      if (boundLeft === 'repellant') {
        obstacles.push({
          id: '__obs_wall_left',
          x: gxLeft - FAR, y: wallY, w: FAR, h: wallH,
        });
        confinerBounds = { ...(confinerBounds ?? {}), minX: gxLeft };
      }
      if (boundRight === 'repellant') {
        obstacles.push({
          id: '__obs_wall_right',
          x: gxRight, y: wallY, w: FAR, h: wallH,
        });
        confinerBounds = { ...(confinerBounds ?? {}), maxX: gxRight };
      }
    }
    // Collect the visible wires so push-apart can route cards AROUND them
    // (Phase 22b — wire repulsion). Same socket helpers as the SVG render
    // path, so the obstacles match what the user sees.
    const wires = collectWires();
    graph = forceSeparate(graph, {
      nodeSize: (id) => nodeSize(graph.nodes[id]),
      padding: 24,
      obstacles,
      wires,
      wirePadding: 16,
      confinerBounds,
    });
  }

  /** Enumerate every visible wire in the graph as a line segment in
   *  GRAPH space. Used by pushApart so wires push non-endpoint cards
   *  perpendicular to the segment when a card sits on top of one.
   *  Mirrors the SVG render path's wire enumeration (method obj/arg,
   *  mv/rot/repeat child, container child → output). */
  function collectWires(): { fromId?: NodeId; toId?: NodeId; ax: number; ay: number; bx: number; by: number }[] {
    const out: { fromId?: NodeId; toId?: NodeId; ax: number; ay: number; bx: number; by: number }[] = [];
    for (const [id, node] of Object.entries(graph.nodes)) {
      if (!node) continue;
      const addInputWire = (srcId: NodeId, slot: 'obj' | 'arg' | 'child') => {
        if (!graph.nodes[srcId]) return;
        const a = outputSocketAt(srcId);
        const b = inputSocketAt(id, slot);
        out.push({ fromId: srcId, toId: id, ax: a.x, ay: a.y, bx: b.x, by: b.y });
      };
      if (node.type === 'method') {
        if (node.obj) addInputWire(node.obj, 'obj');
        if (node.arg) addInputWire(node.arg, 'arg');
      } else if (node.type === 'mv' || node.type === 'rot' || node.type === 'repeat') {
        if (node.child) addInputWire(node.child, 'child');
      } else if (node.type === 'stack' || node.type === 'group') {
        node.children.forEach((c, i) => {
          if (!graph.nodes[c]) return;
          const a = outputSocketAt(c);
          const b = containerSlotInputAt(id, i);
          out.push({ fromId: c, toId: id, ax: a.x, ay: a.y, bx: b.x, by: b.y });
        });
      } else if (node.type === 'list' && id === graph.root) {
        // Root-list children draw a wire to the Output card's slots.
        node.children.forEach((c, i) => {
          if (!graph.nodes[c]) return;
          const a = outputSocketAt(c);
          const b = containerSlotInputAt(id, i);
          out.push({ fromId: c, toId: id, ax: a.x, ay: a.y, bx: b.x, by: b.y });
        });
      }
    }
    return out;
  }

  // ─── inline transforms on Call cards ────────────────────────────────────
  function toggleInlineTransform(callId: NodeId, kind: 'mv' | 'rot') {
    const existing = inlineTransformOf(graph, callId, kind);
    if (existing) {
      graph = unwrapTransform(graph, existing);
    } else {
      graph = wrapInTransform(graph, callId, kind).graph;
    }
  }
  /** Inline wrappers should NOT render on the main canvas — their xyz inputs
   *  surface inside their child's Call card instead. */
  function isInlineWrapper(nodeId: NodeId): boolean {
    const n = graph.nodes[nodeId];
    if (!n || (n.type !== 'mv' && n.type !== 'rot')) return false;
    const childId = (n as MvNode | RotNode).child;
    if (!childId) return false;
    const child = graph.nodes[childId];
    return child?.type === 'call' && inlineTransformOf(graph, childId, n.type) === nodeId;
  }

  // ─── assembly-level params (Slice 3 first cut) ──────────────────────────
  let newParamName = $state('');
  let newParamDefault = $state(0);
  let addParamPop = $state<{ x: number; y: number } | null>(null);
  function openAddParamPop(ev: PointerEvent) { addParamPop = { x: ev.clientX, y: ev.clientY }; }
  function closeAddParamPop() { addParamPop = null; }
  function onAddParam() {
    const name = newParamName.trim();
    if (!name) return;
    graph = addParam(graph, name, { default: newParamDefault, step: 0.05 });
    newParamName = ''; newParamDefault = 0;
    addParamPop = null;
  }
  function onParamDefault(name: string, value: number) {
    const cur = graph.params[name];
    if (!cur) return;
    graph = setParamSchema(graph, name, { ...cur, default: value });
  }
  function onRemoveParam(name: string) {
    const r = removeParam(graph, name);
    if (r.orphans.length > 0) {
      // Surface to the user — the editor refuses, expects them to unwire first.
      alert(`Can't remove ${name}: ${r.orphans.length} call arg${r.orphans.length === 1 ? '' : 's'} still wired to it. Unwire first.`);
      return;
    }
    graph = r.graph;
  }
  /** Wire popover state — when the user clicks an arg's wire icon, this opens
   *  a small menu with param choices. */
  let wirePop = $state<{ callId: NodeId; key: string; x: number; y: number } | null>(null);
  function openWirePop(ev: MouseEvent, callId: NodeId, key: string) {
    ev.stopPropagation();
    wirePop = { callId, key, x: ev.clientX, y: ev.clientY };
  }
  function closeWirePop() { wirePop = null; }
  function wireArgToParam(callId: NodeId, key: string, paramName: string) {
    graph = setCallArg(graph, callId, key, asParam(paramName));
    wirePop = null;
  }
  function unwireArgToLiteral(callId: NodeId, key: string) {
    const node = graph.nodes[callId];
    if (!node || node.type !== 'call') return;
    const cur = (node as any).args[key];
    const literal = cur?.kind === 'literal' ? cur.value : (graph.params[cur?.param]?.default ?? 0);
    graph = setCallArg(graph, callId, key, asLiteral(typeof literal === 'number' ? literal : 0));
    wirePop = null;
  }

  // ─── Save ─────────────────────────────────────────────────────────────
  let saveBusy = $state(false);
  async function saveGraph() {
    if (saveBusy) return;
    saveBusy = true;
    saveStatus = `saving ${exemplarId}…`;
    // Capture current viewport into the graph BEFORE serialising so the
    // emitted meta.graph carries the canvas state we want to restore on
    // reload. `emitted.source` is reactive — assigning graph re-runs the
    // emit chain to include the new viewport.
    graph = setViewport(graph, pan, zoom);
    try {
      // Profile save expects a richer body (label / description / set /
      // params / source); parts get the lean assembly body. The endpoint
      // contract differs even though the canvas is the same.
      const body = editKind === 'profile'
        ? {
            id: exemplarId,
            label: exemplarId,
            description: '',
            set: 'revolve',
            tags: [],
            params: graph.params ?? {},
            source: emitted.source,
          }
        : {
            id: exemplarId,
            source: emitted.source,
            kind: 'asm',
            dir: 'basic',
          };
      const r = await fetch(SAVE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        saveStatus = `✓ ${exemplarId} saved to basic/`;
      } else {
        saveStatus = `✗ save ${r.status}: ${(await r.text()).slice(0, 160)}`;
      }
    } catch (e: any) {
      saveStatus = `✗ ${e?.message ?? e}`;
    } finally {
      saveBusy = false;
    }
  }

  // Derived view-helpers.
  // Visible nodes on the canvas: every node EXCEPT inline mv/rot wrappers
  // (those render inline inside their Call's card). The ROOT list IS visible
  // now — it shows up as the ▶ Output card so the user can see + curate what
  // the function returns. Non-root lists/stacks/groups also render as cards.
  let allNodes = $derived.by(() => {
    const all = Object.values(graph.nodes).filter((n) => !isInlineWrapper(n.id));
    // Z-order sort: nodes in `zOrder` render AFTER the rest, in the order they
    // were brought to front. SVG paints later elements ON TOP — that's how
    // we get click-to-front. Unlisted nodes keep their natural insertion order.
    if (zOrder.length === 0) return all;
    const zMap = new Map<string, number>();
    zOrder.forEach((id, i) => zMap.set(id, i));
    return [...all].sort((a, b) => {
      const aZ = zMap.get(a.id);
      const bZ = zMap.get(b.id);
      if (aZ === undefined && bZ === undefined) return 0;
      if (aZ === undefined) return -1;
      if (bZ === undefined) return 1;
      return aZ - bZ;
    });
  });
  /** Excludes the root list — that's the always-present ▶ Output card,
   *  not a user-dropped node. Used by the status bar + empty-canvas hint. */
  let visibleNodeCount = $derived(allNodes.filter((n) => n.id !== graph.root).length);

  /** Set of node ids that are CONSUMED by another node — i.e. referenced as
   *  the input slot of a method.obj/arg, mv/rot/repeat.child, or as a child
   *  of stack/group. Mirrors composition-emit.ts computeConsumedSet so the
   *  editor and the emit agree on what's "intermediate" vs "output".
   *
   *  Used by the ▶ Output card slot rendering — consumed children stay in
   *  root.children for data integrity but aren't shown as Output slots
   *  (they aren't in the function's return either). */
  let consumedSet = $derived.by(() => {
    const set = new Set<string>();
    for (const n of Object.values(graph.nodes)) {
      if (n.type === 'method') {
        if ((n as any).obj) set.add((n as any).obj);
        if ((n as any).arg) set.add((n as any).arg);
      } else if (n.type === 'mv' || n.type === 'rot' || n.type === 'repeat') {
        if ((n as any).child) set.add((n as any).child);
      } else if (n.type === 'stack' || n.type === 'group') {
        for (const c of (n as any).children) set.add(c);
      } else if (n.type === 'list' && n.id !== graph.root) {
        for (const c of (n as any).children) set.add(c);
      }
    }
    return set;
  });
  let paramEntries = $derived(Object.entries(graph.params));
  let filteredSrcs = $derived.by(() => {
    const q = pickerFilter.trim().toLowerCase();
    const base = q ? pickerSrcs.filter((s) => s.toLowerCase().includes(q)) : pickerSrcs.slice();
    // Sort mode applied AFTER filter so the user sees the relevant set in
    // the chosen order. 'name' = lexicographic A→Z, 'recent' = LRU-first
    // from `pickerRecent`, then alpha for the tail, 'source' = group by
    // origin (stdlib first → basic → completions → stdstale).
    if (pickerSort === 'recent' && pickerRecent.length > 0) {
      const rec = new Set(pickerRecent);
      const recentSet = base.filter((s) => rec.has(s)).sort((a, b) => pickerRecent.indexOf(a) - pickerRecent.indexOf(b));
      const rest = base.filter((s) => !rec.has(s)).sort();
      return [...recentSet, ...rest];
    }
    if (pickerSort === 'source') {
      const order = { stdlib: 0, basic: 1, volume: 1, completions: 2, stdstale: 3 } as Record<string, number>;
      return base.sort((a, b) => {
        const sa = order[pickerSrcMeta[a]?.source ?? 'volume'] ?? 9;
        const sb = order[pickerSrcMeta[b]?.source ?? 'volume'] ?? 9;
        return sa !== sb ? sa - sb : a.localeCompare(b);
      });
    }
    return base.sort();
  });
</script>

<svelte:head>
  <title>Graph editor · CAD Train</title>
  {#if embed}
    <!-- Hide the outer SvelteKit layout chrome when iframed. Injected as
         raw CSS in <head> so it can reach across scoped boundaries. -->
    {@html `<style>
      #nav-menu-wrapper { display: none !important; }
      .layout { padding: 0 !important; height: 100% !important; }
      .layout .content { padding: 0 !important; height: 100% !important; }
      html, body { height: 100%; margin: 0; overflow: hidden; }
    </style>`}
  {/if}
</svelte:head>

<div class="ge-root" class:embed>
  <!-- Title + id input removed (2026-06-09 — redundant with the /primitives
       tab strip showing the part id; the rename / save-as flow surfaces a
       prompt on demand instead of the always-on input). The graph editor
       header row is gone; the canvas + left vertical rail now sit flush
       with the page chrome above. -->

  {#if emitted.validationErrors.length > 0}
    <!-- Broken-reference banner. Surfaces deleted-node / deleted-param refs
         BEFORE the bake explodes as a cryptic WASM out-of-bounds. Each row
         is precise enough to find + fix in the editor: node id + slot + the
         missing ref. Clicking selects the offending node. -->
    <div class="ge-valerr" role="status" aria-live="polite">
      <strong>⚠ {emitted.validationErrors.length} broken reference{emitted.validationErrors.length === 1 ? '' : 's'}</strong>
      <span class="ge-valerr-hint">— bake will fail until fixed:</span>
      <ul>
        {#each emitted.validationErrors as e (e.nodeId + e.slot)}
          <li>
            <button class="ge-valerr-chip" type="button" title="Pan to {e.nodeId}"
              onclick={() => panToNode(e.nodeId)}>{e.nodeId}</button>
            <span class="ge-valerr-slot">{e.slot}</span>
            →
            <span class="ge-valerr-bad" title={e.kind}>{e.kind === 'missing-param' ? 'param' : 'node'} "{e.badRef}" not found</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <!-- Vertical toolbar — primary actions stacked left of the canvas. Each
       button is icon-only with a data-tip; the dark tooltip layer (mounted
       in onMount) renders the labels on hover. Auto-layout + Push apart
       moved to a canvas-settings popover. -->
  <aside class="ge-vrail">
    <button class="ge-vrail-btn" type="button"
      bind:this={dropBtnEl} onclick={openPicker}
      data-tip="+ Drop a node (Call, CSG, transform, container)">＋</button>
    <button class="ge-vrail-btn save" type="button" disabled={saveBusy} onclick={saveGraph}
      data-tip={saveBusy ? 'Saving…' : `Save ${exemplarId} to the volume`}>💾</button>
    <button class="ge-vrail-btn bake" type="button" onclick={runBake}
      class:stale={bakeStale}
      data-tip={bakeStale ? 'Source changed — click or press Enter to re-bake' : 'Bake now (Enter in any input also bakes)'}>
      {bakeStale ? '🔨●' : '🔨'}
    </button>
    <button class="ge-vrail-btn auto" type="button"
      class:on={autoBake}
      onclick={() => setAutoBake(!autoBake)}
      data-tip={autoBake ? 'Auto-bake ON — toggle off to bake only on demand' : 'Auto-bake OFF — toggle on to bake on every change (700 ms debounce)'}>
      ⚡
    </button>
    {#if ghostIds.length > 0}
      <button class="ge-vrail-btn ghost-clear" type="button"
        onclick={clearAllGhosts}
        data-tip={`Clear ${ghostIds.length} ghost overlay${ghostIds.length === 1 ? '' : 's'} and bake the final result`}>
        👁✕<span class="ge-vrail-badge">{ghostIds.length}</span>
      </button>
    {/if}
    {#if undoLayout}
      <button class="ge-vrail-btn" type="button" onclick={undoAutoLayout}
        data-tip="Restore the prior layout (undo auto-layout / push apart)">↶</button>
    {/if}
    <div class="ge-vrail-sep"></div>
    <button class="ge-vrail-btn settings" type="button"
      bind:this={settingsBtnEl}
      onclick={() => canvasMenuOpen ? (canvasMenuOpen = false) : openCanvasMenu()}
      class:on={canvasMenuOpen}
      data-tip="Layout tools — auto-layout, push apart, edge bounds">⚙</button>
    <div class="ge-vrail-spacer"></div>
    <button class="ge-vrail-btn reset" type="button" onclick={resetGraph}
      data-tip="Reset the graph to an empty canvas">⟲</button>
  </aside>

  {#if canvasMenuOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-canvas-menu-shade" onclick={() => canvasMenuOpen = false}></div>
    <!-- Compact Flowbite-style dropdown anchored to the ⚙ button's
         bounding rect (see openCanvasMenu). Two action rows + a separator
         + two checkbox rows for the left/right canvas-edge boundaries.
         The checkbox toggle is BOOLEAN repellant on/off; the small edge
         buttons on the canvas still expose the tri-state (off →
         repellant → confiner) cycle for the rare confiner case. -->
    <div class="ge-canvas-menu"
      style="left: {canvasMenuPos.left}px; top: {canvasMenuPos.top}px">
      <button class="ge-cm-row action" type="button"
        onclick={() => { autoLayout(); canvasMenuOpen = false; }}
        title="Rearrange nodes left-to-right by depth">
        <span class="ge-cm-icon">📐</span>
        <span class="ge-cm-label">Auto-layout</span>
      </button>
      <button class="ge-cm-row action" type="button"
        onclick={() => { pushApart(); canvasMenuOpen = false; }}
        title="Resolve overlapping cards via pairwise separation">
        <span class="ge-cm-icon">🧲</span>
        <span class="ge-cm-label">Push apart</span>
      </button>
      <div class="ge-cm-sep"></div>
      <label class="ge-cm-row check"
        title="Push nodes away from the LEFT canvas edge during push-apart">
        <input type="checkbox"
          checked={boundLeft === 'repellant'}
          onchange={(ev) => {
            const on = (ev.currentTarget as HTMLInputElement).checked;
            boundLeft = on ? 'repellant' : 'off';
            try { localStorage.setItem('ge-bound-left', boundLeft); } catch { /* ignore */ }
          }} />
        <span class="ge-cm-label">Left boundary</span>
      </label>
      <label class="ge-cm-row check"
        title="Push nodes away from the RIGHT canvas edge during push-apart">
        <input type="checkbox"
          checked={boundRight === 'repellant'}
          onchange={(ev) => {
            const on = (ev.currentTarget as HTMLInputElement).checked;
            boundRight = on ? 'repellant' : 'off';
            try { localStorage.setItem('ge-bound-right', boundRight); } catch { /* ignore */ }
          }} />
        <span class="ge-cm-label">Right boundary</span>
      </label>
    </div>
  {/if}

  <main class="ge-grid" bind:this={gridEl}
    style="grid-template-columns: {splitA}% 6px 1fr">
    <!-- LEFT — graph canvas -->
    <section class="ge-canvas-pane">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <svg
        bind:this={canvasEl}
        class="ge-canvas"
        class:dragging={!!dragging || !!wireFrom}
        xmlns="http://www.w3.org/2000/svg"
        role="application"
        aria-label="Graph canvas"
        onpointerdown={onCanvasPointerDown}
        onpointermove={onCanvasPointerMove}
        onpointerup={onCanvasPointerUp}
        onwheel={onCanvasWheel}
      >
        <g transform="translate({pan.x},{pan.y}) scale({zoom})">
          <defs>
            <pattern id="ge-grid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0 L0 0 0 40" fill="none" stroke="#e5e7eb" stroke-width="0.5"/>
            </pattern>
          </defs>
          <rect x="-2000" y="-2000" width="4000" height="4000" fill="url(#ge-grid)"/>

          <!-- PARAM CHIPS render OUTSIDE the pan/zoom group (below) so they
               stay tacked to the viewport top-left even when the canvas
               is panned. -->
          {#if paramEntries.length === 0}
            <text x="120" y="35" class="ge-canvas-hint">← drop an outer dial here; drag its socket onto an arg.</text>
          {/if}

          <!-- PARAM WIRES — for every {Call.args[k] OR mv.offset[i] OR rot.rot[i]}
               with kind 'param', draw a bezier from the param chip's output
               socket to the consumer's input socket. -->
          {#each allNodes as n (n.id)}
            {#if n.type === 'call'}
              {#each Object.entries((n as any).args ?? {}) as [k, v], argIdx (k)}
                {#if (v as any).kind === 'param'}
                  {@const pIdx = paramEntries.findIndex(([nm]) => nm === (v as any).param)}
                  {#if pIdx >= 0}
                    {@const ps = paramSocketPos((v as any).param, pIdx)}
                    {@const pos = nodePos(n.id)}
                    {@const argY = pos.y + 36 + 14 + argIdx * 22}
                    <path class="ge-wire param" d={bezier(ps.x, ps.y, pos.x, argY)}/>
                  {/if}
                {:else if (v as any).kind === 'expr'}
                  <!-- Expression arg — draw a wire from EACH referenced
                       p.<name> chip to this slot. Multi-source = visually
                       obvious; styled .expr to distinguish from direct
                       param wires (amber dashed vs orange dashed). -->
                  {#each extractParamRefs((v as any).expr) as refName (refName)}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                    {#if pIdx >= 0}
                      {@const ps = paramSocketPos(refName, pIdx)}
                      {@const pos = nodePos(n.id)}
                      {@const argY = pos.y + 36 + 14 + argIdx * 22}
                      <path class="ge-wire param expr" d={bezier(ps.x, ps.y, pos.x, argY)}/>
                    {/if}
                  {/each}
                {/if}
              {/each}
              <!-- Inline transform axis wires (mv/rot wrapping this Call) -->
              {@const cSize = nodeSize(n)}
              {@const inlMv  = inlineTransformOf(graph, n.id, 'mv')}
              {@const inlRot = inlineTransformOf(graph, n.id, 'rot')}
              {#if inlMv}
                {@const mvN = graph.nodes[inlMv] as MvNode}
                {#each [0,1,2] as i (i)}
                  {#if (mvN.offset[i] as any).kind === 'param'}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === (mvN.offset[i] as any).param)}
                    {#if pIdx >= 0}
                      {@const ps = paramSocketPos((mvN.offset[i] as any).param, pIdx)}
                      {@const pos = nodePos(n.id)}
                      {@const axisY = pos.y + cSize.h + 4 + 18 + i * 18}
                      <path class="ge-wire param" d={bezier(ps.x, ps.y, pos.x, axisY)}/>
                    {/if}
                  {:else if (mvN.offset[i] as any).kind === 'expr'}
                    {#each extractParamRefs((mvN.offset[i] as any).expr) as refName (refName)}
                      {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                      {#if pIdx >= 0}
                        {@const ps = paramSocketPos(refName, pIdx)}
                        {@const pos = nodePos(n.id)}
                        {@const axisY = pos.y + cSize.h + 4 + 18 + i * 18}
                        <path class="ge-wire param expr" d={bezier(ps.x, ps.y, pos.x, axisY)}/>
                      {/if}
                    {/each}
                  {/if}
                {/each}
              {/if}
              {#if inlRot}
                {@const rotN = graph.nodes[inlRot] as RotNode}
                {#each [0,1,2] as i (i)}
                  {#if (rotN.rot[i] as any).kind === 'param'}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === (rotN.rot[i] as any).param)}
                    {#if pIdx >= 0}
                      {@const ps = paramSocketPos((rotN.rot[i] as any).param, pIdx)}
                      {@const pos = nodePos(n.id)}
                      {@const rotY = pos.y + cSize.h + 4 + (inlMv ? 80 : 0) + 18 + i * 18}
                      <path class="ge-wire param" d={bezier(ps.x, ps.y, pos.x, rotY)}/>
                    {/if}
                  {:else if (rotN.rot[i] as any).kind === 'expr'}
                    {#each extractParamRefs((rotN.rot[i] as any).expr) as refName (refName)}
                      {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                      {#if pIdx >= 0}
                        {@const ps = paramSocketPos(refName, pIdx)}
                        {@const pos = nodePos(n.id)}
                        {@const rotY = pos.y + cSize.h + 4 + (inlMv ? 80 : 0) + 18 + i * 18}
                        <path class="ge-wire param expr" d={bezier(ps.x, ps.y, pos.x, rotY)}/>
                      {/if}
                    {/each}
                  {/if}
                {/each}
              {/if}
            {:else if n.type === 'repeat'}
              <!-- Repeat count param-wire — chip → top-left count socket -->
              {#if (n as any).count?.kind === 'param'}
                {@const pIdx = paramEntries.findIndex(([nm]) => nm === (n as any).count.param)}
                {#if pIdx >= 0}
                  {@const ps = paramSocketPos((n as any).count.param, pIdx)}
                  {@const pos = nodePos(n.id)}
                  <path class="ge-wire param" d={bezier(ps.x, ps.y, pos.x, pos.y + 17)}/>
                {/if}
              {:else if (n as any).count?.kind === 'expr'}
                {#each extractParamRefs((n as any).count.expr) as refName (refName)}
                  {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                  {#if pIdx >= 0}
                    {@const ps = paramSocketPos(refName, pIdx)}
                    {@const pos = nodePos(n.id)}
                    <path class="ge-wire param expr" d={bezier(ps.x, ps.y, pos.x, pos.y + 17)}/>
                  {/if}
                {/each}
              {/if}
            {/if}
          {/each}

          <!-- WIRES: render method.obj/arg + transform.child as bezier paths. -->
          {#each allNodes as n (n.id)}
            {#if n.type === 'method'}
              {#if (n as any).obj && graph.nodes[(n as any).obj]}
                {@const src = outputSocketAt((n as any).obj)}
                {@const tgt = inputSocketAt(n.id, 'obj')}
                <path class="ge-wire obj" d={bezier(src.x, src.y, tgt.x, tgt.y)} fill="none"/>
              {/if}
              {#if (n as any).arg && graph.nodes[(n as any).arg]}
                {@const src = outputSocketAt((n as any).arg)}
                {@const tgt = inputSocketAt(n.id, 'arg')}
                <path class="ge-wire arg" d={bezier(src.x, src.y, tgt.x, tgt.y)} fill="none"/>
              {/if}
            {:else if n.type === 'mv' || n.type === 'rot'}
              {#if (n as any).child && graph.nodes[(n as any).child]}
                {@const src = outputSocketAt((n as any).child)}
                {@const tgt = inputSocketAt(n.id, 'child')}
                <path class="ge-wire child" d={bezier(src.x, src.y, tgt.x, tgt.y)} fill="none"/>
              {/if}
            {:else if n.type === 'repeat'}
              <!-- Repeat node's child wire — bottom-left input socket -->
              {#if (n as any).child && graph.nodes[(n as any).child]}
                {@const src = outputSocketAt((n as any).child)}
                {@const pos = nodePos(n.id)}
                {@const size = nodeSize(n)}
                <path class="ge-wire child" d={bezier(src.x, src.y, pos.x, pos.y + size.h - 18)} fill="none"/>
              {/if}
            {:else if n.type === 'list' || n.type === 'stack' || n.type === 'group'}
              <!-- Container wires: each visible child of a container shows as
                   a bezier from the child's output socket → the container's
                   slot input socket. For the ROOT (▶ Output), consumed
                   children are filtered out so we don't draw wires into
                   non-existent slots — matches the slot-render filter. -->
              {@const visKids = (n.id === graph.root
                ? (n as any).children.filter((cid: string) => !consumedSet.has(cid))
                : (n as any).children) as string[]}
              {#each visKids as childId, i (childId)}
                {#if graph.nodes[childId]}
                  {@const src = outputSocketAt(childId)}
                  {@const tgt = containerSlotInputAt(n.id, i)}
                  <path class="ge-wire output" class:root={n.id === graph.root}
                    d={bezier(src.x, src.y, tgt.x, tgt.y)} fill="none"/>
                {/if}
              {/each}
            {/if}
          {/each}

          <!-- In-flight wire being dragged -->
          {#if wireFrom && wireMouse}
            {@const src = outputSocketAt(wireFrom.nodeId)}
            <path class="ge-wire in-flight" d={bezier(src.x, src.y, wireMouse.x, wireMouse.y)} fill="none"/>
          {/if}

          <!-- NODE CARDS -->
          {#each allNodes as n (n.id)}
            {@const pos = nodePos(n.id)}
            {@const size = nodeSize(n)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <g transform="translate({pos.x},{pos.y})" class="ge-node"
              role="group"
              onpointerdown={() => bringToFront(n.id)}>
              {#if n.type === 'call'}
                {@const call = n as any}
                {@const inlineMv  = inlineTransformOf(graph, n.id, 'mv')}
                {@const inlineRot = inlineTransformOf(graph, n.id, 'rot')}
                {@const mvNode    = inlineMv  ? (graph.nodes[inlineMv]  as MvNode)  : null}
                {@const rotNode   = inlineRot ? (graph.nodes[inlineRot] as RotNode) : null}
                {@const cardH     = size.h + (inlineMv ? 80 : 0) + (inlineRot ? 80 : 0)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg call" width={size.w} height={cardH} rx="6"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}
                />
                <text x="10" y="22" class="ge-node-title">{call.alias} · {call.src}</text>
                <!-- Drift badge (Phase 11) — when the underlying primitive's params
                     differ from this Call's args keys, surface ⚠ + a Refresh
                     pointerdown handler that brings the Call back into sync. -->
                {#if isCallDrifted(n.id)}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <text role="button" tabindex="-1" x={size.w - 96} y="22"
                    class="ge-drift-btn"
                    onpointerdown={(ev) => { ev.stopPropagation(); refreshCallArgs(n.id); }}>⚠</text>
                {/if}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 56} y="22" class="ge-xform-btn" class:on={!!inlineMv}
                  onpointerdown={(ev) => { ev.stopPropagation(); toggleInlineTransform(n.id, 'mv'); }}>⇄</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 38} y="22" class="ge-xform-btn" class:on={!!inlineRot}
                  onpointerdown={(ev) => { ev.stopPropagation(); toggleInlineTransform(n.id, 'rot'); }}>↻</text>
                <!-- 👁 ghost toggle — when on, this Call's emitted Manifold is
                     ALSO returned alongside the normal result. Lets the user
                     see a cutter (or any intermediate part) overlaid on the
                     final bake to eyeball its volume. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 56} y="22"
                  class="ge-node-ghost" class:on={!!ghostSet[n.id]}
                  data-tip={ghostSet[n.id] ? `Hide ${call.alias} from the bake overlay` : `Show ${call.alias} alongside the bake (ghost overlay)`}
                  onpointerdown={(ev) => { ev.stopPropagation(); toggleNodeGhost(n.id); }}>👁</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 14} y="22" class="ge-node-x"
                  onpointerdown={(ev) => { ev.stopPropagation(); deleteNode(n.id); }}>×</text>
                <line x1="0" y1="32" x2={size.w} y2="32" class="ge-node-divider"/>
                <foreignObject x="6" y="36" width={size.w - 12} height={size.h - 40} class="ge-fo">
                  <div class="ge-args" xmlns="http://www.w3.org/1999/xhtml">
                    {#each Object.entries(call.args ?? {}) as [k, v] (k)}
                      <!-- Unified row: [key_label][value_body][trailing_actions]
                           The value_body shows the literal input, the wired
                           param chip body (label-only), or the expression input.
                           The trailing_actions cell always pins ƒ + × to the
                           right edge so every row's controls land at the
                           same spot. -->
                      <div class="ge-arg-row">
                        <button class="ge-arg-key wire-btn" type="button" title="Wire to outer param"
                          onclick={(ev) => openWirePop(ev, n.id, k)}>{k}</button>
                        {#if (v as any).kind === 'literal'}
                          <span class="ge-arg-cell">
                            <input class="ge-arg-input" type="number" step="0.05"
                              value={(v as any).value}
                              use:dragNumber={{
                                step: 0.05,
                                get: () => Number((v as any).value) || 0,
                                set: (val) => onArgEdit(n.id, k, val),
                              }}
                              oninput={(e) => onArgEdit(n.id, k, Number((e.target as HTMLInputElement).value))}
                            />
                            <span class="ge-arg-actions">
                              <button class="ge-arg-action fx" type="button" title="Switch to expression (ƒ)"
                                onclick={() => toggleArgExprMode(n.id, k)}>ƒ</button>
                            </span>
                          </span>
                        {:else if (v as any).kind === 'param'}
                          <!-- Wired param: chip body shows the label only; ƒ + ×
                               live in the trailing actions cell, vertically
                               aligned with the literal-case ƒ button so the
                               right edge stays consistent across rows. -->
                          <span class="ge-arg-cell wired">
                            <span class="ge-arg-pchip" title="Wired to param">p.{(v as any).param}</span>
                            <span class="ge-arg-actions">
                              <button class="ge-arg-action fx" type="button"
                                title="Make this an expression (e.g. p.wall / 2)"
                                onclick={() => toggleArgExprMode(n.id, k)}>ƒ</button>
                              <button class="ge-arg-action x" type="button"
                                title="Unwire — back to literal"
                                onclick={() => unwireArgToLiteral(n.id, k)}>×</button>
                            </span>
                          </span>
                        {:else}
                          {@const expr = (v as any).expr ?? ''}
                          {@const refs = extractParamRefs(expr)}
                          {@const isProfileSlot = !!expectedProfileKeys[call.src]?.has(k)}
                          {@const profileDesc = isProfileSlot ? parseProfileExpr(expr) : null}
                          {#if isProfileSlot && profileDesc && profileDesc.kind}
                            <!-- Profile chip (#119) — replaces the raw JSON expr
                                 for r_revolve / r_extrude / r_weld_extrude args
                                 typed as `profile`. Click opens the kind picker
                                 popover with curated kinds filtered by set. -->
                            {@const kindDef = PROFILE_REGISTRY[profileDesc.kind]}
                            <span class="ge-arg-cell">
                              <!-- svelte-ignore a11y_click_events_have_key_events -->
                              <span class="ge-arg-profilechip" role="button" tabindex="-1"
                                title={`Click to swap profile kind · current: ${profileDesc.kind}`}
                                onclick={(ev) => openProfilePop(ev, n.id, k, call.src, profileDesc.kind ?? '')}>
                                <span class="ge-arg-profilechip-kind">▾ {kindDef?.label ?? profileDesc.kind}</span>
                              </span>
                              <span class="ge-arg-actions">
                                <button class="ge-arg-action edit" type="button" title="Edit raw JSON descriptor"
                                  onclick={(ev) => openArgExprPop(ev, n.id, k, expr)}>✎</button>
                              </span>
                            </span>
                          {:else if refs.length >= 2}
                            <!-- Multi-source ƒ chip — too dense for inline editing; click to open popup. -->
                            <span class="ge-arg-cell">
                              <!-- svelte-ignore a11y_click_events_have_key_events -->
                              <span class="ge-arg-fnchip" role="button" tabindex="-1"
                                title={`Click to edit · expression: ${expr}`}
                                onclick={(ev) => openArgExprPop(ev, n.id, k, expr)}>
                                ƒ(<span class="ge-arg-fnchip-refs">{refs.map((r) => 'p.' + r).join(', ')}</span>) ✎
                              </span>
                              <span class="ge-arg-actions">
                                <button class="ge-arg-action fx on" type="button" title="Back to literal"
                                  onclick={() => toggleArgExprMode(n.id, k)}>ƒ</button>
                              </span>
                            </span>
                          {:else}
                            <span class="ge-arg-cell">
                              <input class="ge-arg-input expr" type="text"
                                placeholder="e.g. p.od / 2"
                                value={expr}
                                oninput={(e) => onArgExprEdit(n.id, k, (e.target as HTMLInputElement).value)}
                              />
                              <span class="ge-arg-actions">
                                <button class="ge-arg-action edit" type="button" title="Open expression editor"
                                  onclick={(ev) => openArgExprPop(ev, n.id, k, expr)}>✎</button>
                                <button class="ge-arg-action fx on" type="button" title="Back to literal"
                                  onclick={() => toggleArgExprMode(n.id, k)}>ƒ</button>
                              </span>
                            </span>
                          {/if}
                        {/if}
                      </div>
                    {/each}
                  </div>
                </foreignObject>
                {#if mvNode}
                  <foreignObject x="6" y={size.h + 4} width={size.w - 12} height="72">
                    <div class="ge-inline-xform mv" xmlns="http://www.w3.org/1999/xhtml">
                      <div class="ge-inline-label">⇄ mv</div>
                      {#each ['x','y','z'] as axis, i (axis)}
                        {@const av = mvNode.offset[i] as any}
                        <div class="ge-arg-row tight">
                          <span class="ge-arg-key">{axis}</span>
                          {#if av.kind === 'param'}
                            <span class="ge-arg-pchip" title="Wired to param">
                              p.{av.param}
                              <button class="ge-arg-pchip-x" type="button"
                                onclick={() => unwireTransformAxis(inlineMv!, i as 0|1|2)}>×</button>
                            </span>
                          {:else}
                            <input class="ge-arg-input" type="number" step="0.5"
                              value={av.kind === 'literal' ? av.value : 0}
                              use:dragNumber={{
                                step: 0.5,
                                get: () => Number(av.value ?? 0),
                                set: (val) => onTransformAxis(inlineMv!, i as 0|1|2, val),
                              }}
                              oninput={(e) => onTransformAxis(inlineMv!, i as 0|1|2, Number((e.target as HTMLInputElement).value))}
                            />
                          {/if}
                        </div>
                      {/each}
                    </div>
                  </foreignObject>
                  <!-- Per-axis input sockets on the LEFT edge — drag a param chip
                       output socket onto one to wire that axis. -->
                  {#each [0,1,2] as i (i)}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <circle role="button" tabindex="-1" class="ge-sock in param tiny"
                      cx="0" cy={size.h + 4 + 18 + i * 18} r="4"
                      onpointerup={(ev) => endWireOnTransformAxis(ev, inlineMv!, i as 0|1|2)}/>
                  {/each}
                {/if}
                {#if rotNode}
                  {@const rotY = size.h + 4 + (inlineMv ? 80 : 0)}
                  <foreignObject x="6" y={rotY} width={size.w - 12} height="72">
                    <div class="ge-inline-xform rot" xmlns="http://www.w3.org/1999/xhtml">
                      <div class="ge-inline-label">↻ rot</div>
                      {#each ['rx','ry','rz'] as axis, i (axis)}
                        {@const av = rotNode.rot[i] as any}
                        <div class="ge-arg-row tight">
                          <span class="ge-arg-key">{axis}</span>
                          {#if av.kind === 'param'}
                            <span class="ge-arg-pchip" title="Wired to param">
                              p.{av.param}
                              <button class="ge-arg-pchip-x" type="button"
                                onclick={() => unwireTransformAxis(inlineRot!, i as 0|1|2)}>×</button>
                            </span>
                          {:else}
                            <input class="ge-arg-input" type="number" step="1"
                              value={av.kind === 'literal' ? av.value : 0}
                              use:dragNumber={{
                                step: 1,
                                get: () => Number(av.value ?? 0),
                                set: (val) => onTransformAxis(inlineRot!, i as 0|1|2, val),
                              }}
                              oninput={(e) => onTransformAxis(inlineRot!, i as 0|1|2, Number((e.target as HTMLInputElement).value))}
                            />
                          {/if}
                        </div>
                      {/each}
                    </div>
                  </foreignObject>
                  {#each [0,1,2] as i (i)}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <circle role="button" tabindex="-1" class="ge-sock in param tiny"
                      cx="0" cy={rotY + 18 + i * 18} r="4"
                      onpointerup={(ev) => endWireOnTransformAxis(ev, inlineRot!, i as 0|1|2)}/>
                  {/each}
                {/if}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <!-- Output: if a Call has an inline mv/rot wrapper, the visible
                     output is the WRAPPER's output (the transformed result), so
                     wires from this socket originate from the wrapper id. Without
                     this, downstream methods would bypass the inline transform —
                     emit would be `A.subtract(B)` instead of `mv(A,...).subtract(B)`. -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={cardH / 2} r="6"
                  onpointerdown={(ev) => startWire(ev, inlineRot ?? inlineMv ?? n.id)}/>
                <!-- Per-arg input sockets on the left edge of the Call card.
                     Drag a param chip's output socket onto one to wire. -->
                {#each Object.keys(call.args ?? {}) as ak, ai (ak)}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class="ge-sock in param"
                    cx="0" cy={36 + 14 + ai * 22} r="5"
                    onpointerup={(ev) => endWireOnCallArg(ev, n.id, ak)}/>
                {/each}

              {:else if n.type === 'method'}
                {@const m = n as any}
                <!-- Compact title-row layout (matches mv/rot): op glyph +
                     name in the title at top, obj/arg sockets on the left
                     below, output on the title-row right edge. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg method" width={size.w} height={size.h} rx="6"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}
                />
                <text x="14" y="20" class="ge-node-title">
                  {m.op === 'subtract' ? '⊖' : m.op === 'add' ? '⊕' : '⊗'} {m.op}
                </text>
                <line x1="0" y1="28" x2={size.w} y2="28" class="ge-node-divider"/>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 22} y="20" class="ge-node-x"
                  onpointerdown={(ev) => { ev.stopPropagation(); deleteNode(n.id); }}>×</text>
                <!-- Input sockets, stacked under the divider -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in obj" cx="0" cy="42" r="6"
                  onpointerup={(ev) => endWireOnInput(ev, n.id, 'obj')}/>
                <text x="10" y="45" class="ge-sock-label">obj</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in arg" cx="0" cy="56" r="6"
                  onpointerup={(ev) => endWireOnInput(ev, n.id, 'arg')}/>
                <text x="10" y="59" class="ge-sock-label">arg</text>
                <!-- OUTPUT socket on the title-row right edge -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy="14" r="6"
                  onpointerdown={(ev) => startWire(ev, n.id)}/>

              {:else if n.type === 'mv' || n.type === 'rot'}
                {@const t = n as any}
                {@const fieldName = n.type === 'mv' ? 'offset' : 'rot'}
                {@const axisRowH = 24}
                {@const axisStartY = 40}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg transform" class:rot={n.type === 'rot'}
                  width={size.w} height={size.h} rx="6"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}
                />
                <text x="14" y="22" class="ge-node-title">
                  {n.type === 'mv' ? '⇄ mv' : '↻ rot'}
                </text>
                <line x1="0" y1="32" x2={size.w} y2="32" class="ge-node-divider"/>
                <!-- CHILD socket on the LEFT EDGE, vertically aligned with
                     the title row. Implicit — no label since the position
                     itself communicates "shape comes in here". Sits at the
                     top of the same left-edge column as the axis sockets.
                     inputSocketAt('child') reports this point so existing
                     wires draw correctly. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in child" cx="0" cy="16" r="6"
                  onpointerup={(ev) => endWireOnInput(ev, n.id, 'child')}/>
                <!-- Each axis row: edge socket + label + input + × — same
                     column model as the params card so wiring is obvious
                     + the right edge stays consistent. -->
                <foreignObject x="14" y={axisStartY - 4} width={size.w - 18} height={3 * axisRowH + 6}>
                  <div class="ge-xyz" xmlns="http://www.w3.org/1999/xhtml">
                    {#each ['x','y','z'] as axisLabel, i (axisLabel)}
                      {@const axis = (t as any)[fieldName][i]}
                      <div class="ge-arg-row">
                        <span class="ge-arg-key axis">{n.type === 'mv' ? '' : 'r'}{axisLabel}</span>
                        {#if axis.kind === 'param'}
                          <!-- Wired param. ƒ promotes the bare wire to an
                               expression seeded with `p.<name>`. × unwires
                               back to literal 0. -->
                          <span class="ge-arg-cell wired">
                            <span class="ge-arg-pchip" title="Wired to param">p.{axis.param}</span>
                            <span class="ge-arg-actions">
                              <button class="ge-arg-action fx" type="button"
                                title="Make this an expression (e.g. p.wall / 2)"
                                onclick={() => toggleTransformAxisExprMode(n.id, i as 0|1|2)}>ƒ</button>
                              <button class="ge-arg-action x" type="button" title="Unwire — back to literal"
                                onclick={() => onTransformAxis(n.id, i as 0|1|2, 0)}>×</button>
                            </span>
                          </span>
                        {:else if axis.kind === 'expr'}
                          <!-- Expression mode — free-form text input, click ƒ
                               to demote back to literal. -->
                          <span class="ge-arg-cell">
                            <input class="ge-arg-input expr" type="text"
                              placeholder="e.g. p.od / 2"
                              value={axis.expr}
                              oninput={(e) => onTransformAxisExprEdit(n.id, i as 0|1|2, (e.target as HTMLInputElement).value)}
                            />
                            <span class="ge-arg-actions">
                              <button class="ge-arg-action fx on" type="button"
                                title="Back to literal"
                                onclick={() => toggleTransformAxisExprMode(n.id, i as 0|1|2)}>ƒ</button>
                            </span>
                          </span>
                        {:else}
                          <span class="ge-arg-cell">
                            <input class="ge-arg-input" type="number" step={n.type === 'mv' ? 0.5 : 1}
                              value={axis.value}
                              use:dragNumber={{
                                step: n.type === 'mv' ? 0.5 : 1,
                                get: () => Number(axis.value ?? 0),
                                set: (val) => onTransformAxis(n.id, i as 0|1|2, val),
                              }}
                              oninput={(e) => onTransformAxis(n.id, i as 0|1|2, Number((e.target as HTMLInputElement).value))}
                            />
                            <span class="ge-arg-actions">
                              <button class="ge-arg-action fx" type="button"
                                title="Switch to expression (ƒ)"
                                onclick={() => toggleTransformAxisExprMode(n.id, i as 0|1|2)}>ƒ</button>
                            </span>
                          </span>
                        {/if}
                      </div>
                    {/each}
                  </div>
                </foreignObject>
                <!-- Per-axis input sockets — ON the left edge (cx=0). Drag a
                     param chip onto one and the axis becomes wired (via
                     endWireOnTransformAxis). -->
                {#each [0, 1, 2] as i}
                  {@const cy = axisStartY + i * axisRowH + axisRowH / 2 - 4}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class="ge-sock in param tiny" cx="0" cy={cy} r="4"
                    onpointerup={(ev) => endWireOnTransformAxis(ev, n.id, i as 0|1|2)}/>
                {/each}
                <!-- × delete — moved further from the right edge so it
                     doesn't crowd the title-row output socket. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 22} y="22" class="ge-node-x"
                  onpointerdown={(ev) => { ev.stopPropagation(); deleteNode(n.id); }}>×</text>
                <!-- OUTPUT socket on the title-row RIGHT EDGE (y=16) —
                     same vertical line as the child input on the left. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy="16" r="6"
                  onpointerdown={(ev) => startWire(ev, n.id)}/>

              {:else if n.type === 'repeat'}
                {@const rep = n as any}
                {@const countKind = rep.count?.kind ?? 'literal'}
                {@const countLiteral = countKind === 'literal' ? Number(rep.count.value) : 1}
                {@const countDisplay = countKind === 'param' ? `p.${rep.count.param}`
                  : countKind === 'expr' ? rep.count.expr
                  : String(countLiteral)}
                {@const repOp = (rep.op ?? 'stack') as 'stack' | 'list' | 'place'}
                {@const childNode = rep.child ? graph.nodes[rep.child] : null}
                {@const childLabel = !childNode ? '(drop a node into the child socket)'
                  : childNode.type === 'call' ? `${childNode.alias} · ${childNode.src}`
                  : childNode.type === 'method' ? `${childNode.op}(…)`
                  : childNode.type === 'repeat' ? `repeat × ${childNode.count?.kind === 'literal' ? childNode.count.value : '…'}`
                  : childNode.type}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg repeat"
                  width={size.w} height={size.h} rx="6"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}/>
                <!-- Title row: ↻ Repeat × N — N renders as a number input
                     when literal, OR a clickable chip when wired to a
                     param OR an expression. INPUT socket at the LEFT EDGE
                     of the count row lets the user drag-wire a param chip
                     onto it — same pattern as Call args. -->
                <text x="14" y="22" class="ge-node-title">↻ Repeat ×</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in param" cx="0" cy="17" r="5"
                  onpointerup={(ev) => endWireOnRepeatCount(ev, n.id)}/>
                {#if countKind === 'literal'}
                  <foreignObject x="92" y="6" width="56" height="22">
                    <input class="ge-repeat-count-inline" type="number" min="1" step="1"
                      xmlns="http://www.w3.org/1999/xhtml"
                      value={countLiteral}
                      use:dragNumber={{
                        step: 1,
                        get: () => countLiteral,
                        set: (val) => { graph = setRepeatCount(graph, n.id, asLiteral(Math.max(1, Math.round(val)))); },
                      }}
                      oninput={(e) => { graph = setRepeatCount(graph, n.id, asLiteral(Math.max(1, Math.round(Number((e.target as HTMLInputElement).value))))); }}/>
                  </foreignObject>
                {:else}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <text role="button" tabindex="-1" x="92" y="22"
                    class="ge-repeat-count-chip" class:param={countKind === 'param'} class:expr={countKind === 'expr'}
                    title={countKind === 'param' ? `Wired to param — click × on the chip to unwire` : `Expression — edit below`}
                    onpointerdown={(ev) => ev.stopPropagation()}>{countDisplay}</text>
                  {#if countKind === 'param'}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <text role="button" tabindex="-1" x="92" y="22" dx={countDisplay.length * 7 + 4}
                      class="ge-repeat-count-x"
                      onpointerdown={(ev) => { ev.stopPropagation(); graph = setRepeatCount(graph, n.id, asLiteral(graph.params[rep.count.param]?.default ?? 1)); }}>×</text>
                  {/if}
                {/if}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 14} y="22" class="ge-node-x"
                  onpointerdown={(ev) => { ev.stopPropagation(); deleteNode(n.id); }}>×</text>
                <line x1="0" y1="32" x2={size.w} y2="32" class="ge-node-divider"/>
                <!-- Repeat is a pure BUILDER — produces a list of N copies of
                     its child. To combine the list (mate, stack, overlap),
                     wire the output into a Stack / other consumer. Source
                     emit defaults to a bare Array.from(...). Legacy parts
                     without an `op` field still emit stack(Array.from(...))
                     for backward compat. -->
                <text x={size.w / 2} y="56" class="ge-repeat-sub" text-anchor="middle">
                  builds a list of {countDisplay} ×
                </text>
                <text x={size.w / 2} y="78" class="ge-repeat-child" text-anchor="middle">
                  {childLabel}
                </text>
                <!-- Child input socket — drop any node's output here to repeat it. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in child" cx="0" cy={size.h - 18} r="6"
                  onpointerup={(ev) => endWireOnRepeatChild(ev, n.id)}/>
                <text x="10" y={size.h - 14} class="ge-sock-label">child</text>
                <!-- Output -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={size.h / 2} r="6"
                  onpointerdown={(ev) => startWire(ev, n.id)}/>

              {:else if n.type === 'list' || n.type === 'stack' || n.type === 'group'}
                {@const isRoot = n.id === graph.root}
                {@const container = n as any}
                {@const title = isRoot ? '▶ Output' : n.type === 'stack' ? '↕ Stack' : n.type === 'group' ? '{} Group' : '[ ] List'}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <!-- ROOT CONTAINER WIDTH FIX: the container rect's SVG
                     `width` attribute is being IGNORED by the browser (the
                     rect renders at the full parent SVG width ~590 px).
                     Inline CSS `style="width: ..."` IS honoured. Setting
                     it explicitly here pins the actual visual size to
                     size.w even when the SVG attribute is overridden by
                     some unknown CSS cascade artifact (Tailwind v4 layer
                     interaction, suspected). Same trick for height for
                     consistency. -->
                <rect role="button" tabindex="-1"
                  class={`ge-node-bg container${isRoot ? ' root' : ''}${n.type === 'stack' ? ' stack' : ''}`}
                  width={size.w} height={size.h} rx="6"
                  style="width: {size.w}px; height: {size.h}px"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}
                />
                <text x="14" y="22" class="ge-node-title">{title}</text>
                <!-- ⚙ opens the reorder popover. Available on root too — the
                     Output card benefits from manual ordering just as much. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={isRoot ? size.w - 14 : size.w - 32} y="22"
                  class="ge-container-cog"
                  onpointerdown={(ev) => openContainerPop(ev, n.id)}>⚙</text>
                {#if !isRoot}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <text role="button" tabindex="-1" x={size.w - 14} y="22" class="ge-node-x"
                    onpointerdown={(ev) => { ev.stopPropagation(); deleteNode(n.id); }}>×</text>
                {/if}
                <line x1="0" y1="32" x2={size.w} y2="32" class="ge-node-divider"/>
                <!-- Children slots — for the ROOT (▶ Output) we hide children
                     that are CONSUMED by another node. Those children stay
                     in root.children for the graph's data integrity, but
                     the source emit's output filter strips them from the
                     return value, so showing them as Output slots was
                     misleading (the user saw "J is output" but actually
                     it's just the repeat's input). For non-root stack/group
                     we show all children — they ARE the container's value. -->
                {@const visibleChildren = isRoot
                  ? (container.children as string[])
                      .map((cid: string, origIdx: number) => ({ cid, origIdx }))
                      .filter(({ cid }) => !consumedSet.has(cid))
                  : (container.children as string[])
                      .map((cid: string, origIdx: number) => ({ cid, origIdx }))}
                {#each visibleChildren as { cid: childId, origIdx }, i (childId)}
                  {@const childNode = graph.nodes[childId]}
                  {@const childLabel = childNode?.type === 'call'
                    ? `${(childNode as any).alias} · ${(childNode as any).src}`
                    : childNode?.type === 'method' ? `${(childNode as any).op}(…)`
                    : childNode?.type === 'mv' ? 'mv(…)'
                    : childNode?.type === 'rot' ? 'rot(…)'
                    : childNode?.type === 'stack' ? 'stack(…)'
                    : childNode?.type === 'repeat' ? `× ${childNode.count?.kind === 'literal' ? childNode.count.value : '…'}`
                    : '(missing)'}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class="ge-sock in child" cx="0" cy={containerSlotY(i)} r="5"
                    onpointerup={(ev) => endWireOnContainerSlot(ev, n.id)}/>
                  <text x="10" y={containerSlotY(i) + 4} class="ge-sock-label">{childLabel}</text>
                  <!-- × removes this child from the container -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <text role="button" tabindex="-1" class="ge-container-slot-x"
                    x={size.w - 14} y={containerSlotY(i) + 4}
                    onpointerdown={(ev) => { ev.stopPropagation(); graph = removeContainerChildAt(graph, n.id, origIdx); }}>×</text>
                {/each}
                <!-- Trailing + drop slot — drag any output socket onto here to append. -->
                {@const trailY = containerSlotY(visibleChildren.length)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in child trail" cx="0" cy={trailY} r="5"
                  onpointerup={(ev) => endWireOnContainerSlot(ev, n.id)}/>
                <text x="10" y={trailY + 4} class="ge-sock-label trail">+ drop here</text>
                <!-- Non-root containers have an OUTPUT socket — their result
                     can feed upstream (e.g. into a method.obj). -->
                {#if !isRoot}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={size.h / 2} r="6"
                    onpointerdown={(ev) => startWire(ev, n.id)}/>
                {/if}
              {/if}
              <!-- ─── Right-edge resize grip ──────────────────────────────
                   Tiny vertical handle on the card's right edge — drag to
                   widen/shrink. Clamped to cardMinWidth(node) so the row
                   content (key column + input + actions) never gets
                   crushed. The Output card alone skips the grip (it's the
                   root container; resizing it doesn't help anything). -->
              {#if n.id !== graph.root}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect class="ge-resize-grip"
                  x={size.w - 3} y={Math.max(36, size.h * 0.2)}
                  width="6" height={Math.min(size.h * 0.6, 48)} rx="3"
                  data-tip="Drag to resize"
                  onpointerdown={(ev) => onResizePointerDown(ev, n.id)}
                  onpointermove={onResizePointerMove}
                  onpointerup={onResizePointerUp}/>
              {/if}
            </g>
          {/each}

          {#if allNodes.filter((n) => n.id !== graph.root).length === 0}
            <text x="80" y="100" class="ge-canvas-hint">Click <tspan font-weight="bold">+ Drop</tspan> to add a Call, CSG op, or transform.</text>
          {/if}
        </g>

        <!-- PARAMS CARD — tacked outside the pan/zoom group so it stays
             glued to the viewport top-left. Holds N param chips vertically,
             with a title bar that has a + rounded button to add a new param.
             Each chip is vertically symmetric, with: 📌 pin (left),
             p.name + input value, 🗑 trash (right), output socket OUTSIDE
             the card's right edge for drag-wiring. -->
        <g class="ge-params-card" transform="translate({CARD_X0},{CARD_Y0})">
          <rect class="ge-params-card-bg" width={pcs.w} height={pcs.h} rx="8"/>
          <text x="10" y={CARD_TITLE_H - 9} class="ge-params-card-title">Params</text>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <circle role="button" tabindex="-1" class="ge-params-add-btn"
            cx={pcs.w - 14} cy={CARD_TITLE_H - 13} r="9"
            onpointerdown={(ev) => { ev.stopPropagation(); openAddParamPop(ev); }}/>
          <text x={pcs.w - 14} y={CARD_TITLE_H - 9} class="ge-params-add-glyph" text-anchor="middle" pointer-events="none">+</text>
          <line x1="0" y1={CARD_TITLE_H} x2={pcs.w} y2={CARD_TITLE_H} class="ge-params-card-divider"/>
        </g>
        <!-- Chips render in viewport coords too. Output sockets stick out
             of the card's right edge so they can still be drag-targeted. -->
        {#each paramEntries as [name, p], i (name)}
          {@const pos = paramPos(name, i)}
          <g class="ge-param-card" transform="translate({pos.x},{pos.y})">
            <!-- Chip body — HTML/CSS flex layout inside a foreignObject so
                 pin / name / input / trash align cleanly without manual
                 SVG-coordinate math. Dynamic chip width (PARAM_W) tracks
                 the longest label so labels never clip; the label cell
                 itself flex-grows to absorb the slack. -->
            <foreignObject x="0" y="0" width={PARAM_W} height={PARAM_H}>
              <div class="ge-param-chip" xmlns="http://www.w3.org/1999/xhtml">
                <span class="pin">📌</span>
                <span class="name" title="p.{name}">p.{name}</span>
                <input class="val" type="number" step="0.05"
                  value={(p as any).default}
                  use:dragNumber={{
                    step: 0.05,
                    get: () => Number((p as any).default) || 0,
                    set: (val) => onParamDefault(name, val),
                  }}
                  oninput={(e) => onParamDefault(name, Number((e.target as HTMLInputElement).value))}/>
                <button class="trash" type="button" title="Remove p.{name}"
                  onpointerdown={(ev) => { ev.stopPropagation(); onRemoveParam(name); }}>🗑</button>
              </div>
            </foreignObject>
            <!-- Output socket — OUTSIDE the chip right edge so it's never clipped -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <circle role="button" tabindex="-1" class="ge-sock out param"
              cx={PARAM_W + CARD_PAD + 4} cy={PARAM_H / 2} r="5"
              onpointerdown={(ev) => startParamWire(ev, name)}/>
          </g>
        {/each}
      </svg>
      <!-- In-canvas status strip — bottom-left. Lifted out of the top
           toolbar so the canvas itself carries the local feedback
           (saveStatus + node count + zoom). Pointer-events:none on the
           wrap; the badges themselves are non-interactive so they don't
           steal canvas drags. -->
      <div class="ge-canvas-status">
        {#if saveStatus}
          <span class="ge-canvas-status-save">{saveStatus}</span>
        {/if}
        <span class="ge-canvas-status-stat">{visibleNodeCount} node{visibleNodeCount === 1 ? '' : 's'} · z {zoom.toFixed(2)}</span>
      </div>
      <!-- Boundary edge toggles (#116): the small circular buttons that
           used to sit on the canvas edges (🔒 confiner / 🔺 repellant /
           ⏹ off) were removed — the ⚙ canvas-settings menu now owns
           these as boolean checkbox rows. -->
    </section>

    <!-- Divider: canvas ↔ right pane -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="ge-divider" role="separator" tabindex="-1" aria-orientation="vertical"
      onpointerdown={startSplitDrag}
      onpointermove={onSplitMove}
      onpointerup={endSplitDrag}></div>

    <!-- RIGHT pane — tabbed: 3D bake / live source. One tab visible at a
         time; both keep their state mounted so switching is instant. -->
    <section class="ge-right-pane">
      <div class="ge-pane-tabs" role="tablist">
        <button class="ge-pane-tab" class:active={rightTab === 'bake'}
          type="button" role="tab" aria-selected={rightTab === 'bake'}
          data-tip={editKind === 'profile' ? '2D preview — resolved polygon (axis at r=0 for revolve, centered for cartesian)' : '3D bake — live mesh + GLB preview'}
          onclick={() => setRightTab('bake')}>{editKind === 'profile' ? '2D preview' : '3D bake'}</button>
        <button class="ge-pane-tab" class:active={rightTab === 'source'}
          type="button" role="tab" aria-selected={rightTab === 'source'}
          data-tip={`SRC — the emitted ${exemplarId}.asm.ts auto-generated from the graph`}
          onclick={() => setRightTab('source')}>SRC</button>
        <button class="ge-pane-tab" class:active={rightTab === 'md'}
          type="button" role="tab" aria-selected={rightTab === 'md'}
          data-tip="MD — hand-authored drawing-descriptor markdown. Saved as meta.drawingMd."
          onclick={() => setRightTab('md')}>MD{drawingMd ? ` · ${drawingMd.length}c` : ''}</button>
      </div>
      <div class="ge-pane-bodies">
        <div class="ge-bake-body" class:hidden={rightTab !== 'bake'}>
          {#if editKind === 'profile'}
            <!-- Profile mode: inline SVG of the resolved polygon. The
                 graph-driven re-emit is Phase 2.2 — for now this shows
                 the on-disk build()'s shape at default params. Closure
                 (last → first vertex) drawn as a dashed line so the
                 implicit polygon-close is visible. -->
            {#if profileView}
              {@const v = profileView}
              {@const sw = Math.max(v.w, v.h) * 0.008}
              {@const vsw = Math.max(v.w, v.h) * 0.005}
              {@const ph = Math.max(v.w, v.h) * 0.012}
              <div class="ge-profile-2d">
                <div class="ge-profile-2d-head">{exemplarId} · {profilePts.length} pts · {profileSet}</div>
                <svg viewBox={v.vb} preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
                  <g transform={v.yFlip ? `scale(1, -1) translate(0, ${-(2 * v.yMin + v.h)})` : ''}>
                    {#if v.axis}
                      <line x1="0" y1={v.yMin - v.pad} x2="0" y2={v.yMin + v.h + v.pad}
                        stroke="#94a3b8" stroke-width={vsw}
                        stroke-dasharray={`${Math.max(v.w, v.h) * 0.02} ${Math.max(v.w, v.h) * 0.02}`}/>
                    {/if}
                    <path d={v.d}
                      fill="rgba(204, 34, 34, 0.22)" stroke="#991b1b" stroke-width={sw}
                      stroke-linejoin="round"/>
                    <!-- Auto-closure dashed line — visual reminder that the
                         polygon implicitly closes the last vertex back to
                         the first. -->
                    <path d={v.dClose}
                      fill="none" stroke="#991b1b" stroke-width={sw * 0.7}
                      stroke-dasharray={`${sw * 2.5} ${sw * 2}`} stroke-linecap="round"/>
                    {#each profilePts as p, i}
                      <circle cx={p[0]} cy={p[1]} r={ph} fill="#991b1b">
                        <title>[{p[0].toFixed(3)}, {p[1].toFixed(3)}] · #{i}</title>
                      </circle>
                    {/each}
                  </g>
                </svg>
              </div>
            {:else if profileResolveErr}
              <div class="ge-err"><div>{profileResolveErr}</div></div>
            {:else}
              <div class="ge-empty">resolving polygon…</div>
            {/if}
          {:else if !bake}<div class="ge-empty">Drop nodes to bake.</div>
          {:else if bake === 'loading'}<div class="ge-empty">baking…</div>
          {:else if !bake.ok}
            <div class="ge-err">
              <div>{bake.message ?? 'bake failed'}</div>
              {#if /parameter 0 has unknown type|memory access out of bounds/.test(bake.message ?? '')}
                <!-- Stale-server-modules trap — Vite HMR doesn't reload server-side
                     modules (primitive-loader / composition-graph / emit). Surface
                     the symptom + the fix instead of letting the user wonder. -->
                <div class="ge-err-hint">
                  ⚠ Looks like a stale dev server (Vite HMR skips server modules after
                  edits to composition-graph / composition-emit / primitive-loader).
                  <div class="ge-err-hint-actions">
                    <button class="ge-err-restart-btn" type="button"
                      disabled={restartBusy} onclick={restartDevServer}>
                      {restartBusy ? '🔄 restarting…' : '🔄 Restart dev server'}
                    </button>
                    <span class="ge-err-hint-or">or manually:</span>
                    <code>pkill -f 'bun run dev' && bun run dev</code>
                  </div>
                  {#if restartStatus}<div class="ge-err-restart-stat">{restartStatus}</div>{/if}
                </div>
              {/if}
            </div>
          {:else if PrimitiveDualCanvas}
            <PrimitiveDualCanvas id={exemplarId} name={exemplarId} description=""
              args={Object.values(graph.params).map((p) => p.default)}
              source={bake.source}
              showControls={true} showLabels={false}/>
            <!-- Cache status row + Rebuild button (Phase 1.5) -->
            {@const bakeMeta = (bake as any).bake ?? {}}
            <div class="ge-bake-meta">
              {#if bakeMeta.cached}
                {@const cacheMs = Number(bakeMeta._t?.fetch_total) || 0}
                <span class="ge-cache-badge cached"
                  title={`hash: ${bakeMeta.cacheHash ?? '?'} · client round-trip ${cacheMs} ms (mesh decode + paint)`}>
                  ✓ cached{cacheMs > 0 ? ` · ${Math.round(cacheMs)} ms` : ''}
                </span>
              {:else if bakeMeta.cacheHash}
                {@const serverMs = Object.entries(bakeMeta._t ?? {}).reduce((a: number, [k, b]: [string, any]) => {
                  // fetch_total is the client-perspective round-trip we
                  // stash in composition-bake; don't double-count it
                  // against the server-side phase sum.
                  if (k === 'fetch_total') return a;
                  const n = Number(b);
                  return a + (Number.isFinite(n) ? n : 0);
                }, 0)}
                <span class="ge-cache-badge fresh" title={`hash: ${bakeMeta.cacheHash}`}>fresh · {Math.round(serverMs as number)} ms</span>
              {/if}
              {#if bakeMeta.cutawaySkipped}
                <span class="ge-cache-badge skipped" title="Cutaway CSG auto-skipped for big manifolds (> 15k tris). Click Load to compute it.">cutaway off (perf)</span>
                <button class="ge-cutaway-load-btn" type="button"
                  disabled={cutawayBusy} onclick={loadCutaway}
                  title="Bake cutaway on-demand for this part">
                  {cutawayBusy ? '🔄 …' : 'Load'}
                </button>
                {#if cutawayStatus}<span class="ge-rebuild-stat">{cutawayStatus}</span>{/if}
              {/if}
              <span class="ge-bake-meta-spacer"></span>
              <button class="ge-rebuild-btn" type="button"
                disabled={rebuildBusy} onclick={rebuildCache}
                title="Clear this part's cache then re-bake from scratch">
                {rebuildBusy ? '🔄 …' : '🔄 Rebuild'}
              </button>
              {#if rebuildStatus}<span class="ge-rebuild-stat">{rebuildStatus}</span>{/if}
            </div>
          {:else}<div class="ge-empty">3D canvas loading…</div>
          {/if}
        </div>
        <div class="ge-source-body" class:hidden={rightTab !== 'source'}>
          {#if legacyLoad}
            <div class="ge-legacy-banner">
              {#if legacyLoad.reason === 'no-graph'}
                <strong>{legacyLoad.id}</strong> opened in legacy mode — its source has
                no <code>meta.graph</code> block, so the canvas can't hydrate. Save
                here to overwrite with a graph-format part. The legacy PrimitiveView
                editor was removed 2026-06-09 — graph editor is the only editor now.
              {:else}
                Could not fetch <strong>{legacyLoad.id}</strong> from the volume.
                Check the id + your volume connection.
              {/if}
            </div>
          {/if}
          <!-- Filename header — the SAM info that used to live in the tab
               label. Moved into the body so the tab strip stays compact. -->
          <div class="ge-source-header">
            <code>{exemplarId}.asm.ts</code>
            <span class="ge-source-header-hint">auto-generated from the graph — edits here are discarded on next save</span>
          </div>
          <pre class="ge-source">{sourceText}</pre>
        </div>
        <div class="ge-md-body" class:hidden={rightTab !== 'md'}>
          <div class="ge-md-toolbar">
            <span class="ge-md-hint">Drawing-descriptor markdown — saved as <code>meta.drawingMd</code></span>
            <span class="ge-md-toolbar-actions">
              <!-- ✨ AI generate — kicks off a Claude-vision describe call
                   that drafts a markdown description from the current
                   bake + source + node graph. Endpoint TBD (#117 follow-up);
                   today this just toasts a stub message. -->
              <button class="ge-md-ai-btn" type="button"
                onclick={generateMdWithAi}
                disabled={mdAiBusy}
                data-tip="Generate description with AI (Claude vision — uses the current bake + graph as context)">
                {mdAiBusy ? '…' : '✨ AI'}
              </button>
              <span class="ge-md-count">{drawingMd.length} char{drawingMd.length === 1 ? '' : 's'}</span>
            </span>
          </div>
          <textarea class="ge-md-textarea"
            placeholder="# How to draw this part&#10;&#10;Notes, sketch references, parameter meanings, gotchas…"
            bind:value={drawingMd}></textarea>
        </div>
      </div>
    </section>
  </main>

  {#if addParamPop}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-wire-shade" onclick={closeAddParamPop}></div>
    <div class="ge-wire-pop" style="left: {addParamPop.x}px; top: {addParamPop.y}px; min-width: 220px">
      <div class="ge-wire-head">+ new param</div>
      <div class="ge-addparam-row">
        <input class="ge-addparam-input" type="text" placeholder="name (e.g. outerOD)" bind:value={newParamName}
          onkeydown={(e) => { if (e.key === 'Enter') onAddParam(); }}/>
      </div>
      <div class="ge-addparam-row">
        <input class="ge-addparam-input num" type="number" step="0.05" placeholder="default" bind:value={newParamDefault}
          onkeydown={(e) => { if (e.key === 'Enter') onAddParam(); }}/>
      </div>
      <div class="ge-addparam-row">
        <button class="ge-param-add" type="button" onclick={onAddParam}>add</button>
        <button class="ge-param-add ghost" type="button" onclick={closeAddParamPop}>cancel</button>
      </div>
    </div>
  {/if}
  {#if wirePop}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-wire-shade" onclick={closeWirePop}></div>
    <div class="ge-wire-pop" style="left: {wirePop.x}px; top: {wirePop.y}px">
      <div class="ge-wire-head">wire <code>{wirePop.key}</code> to:</div>
      {#if paramEntries.length === 0}
        <div class="ge-empty">no params yet — add one in the strip above</div>
      {/if}
      {#each paramEntries as [name, p] (name)}
        <button class="ge-wire-item" type="button"
          onclick={() => wireArgToParam(wirePop!.callId, wirePop!.key, name)}>p.{name} <span class="ge-wire-default">({(p as any).default})</span></button>
      {/each}
      <button class="ge-wire-item literal" type="button"
        onclick={() => unwireArgToLiteral(wirePop!.callId, wirePop!.key)}>← back to literal</button>
    </div>
  {/if}

  {#if profilePop}
    <!-- Profile-kind picker popover (#119). Lists curated kinds filtered
         by the primitive's `set` (revolve = r,z half-section; cartesian =
         x,y polygon). Click a kind → arg's expr is replaced with a fresh
         {kind, params} JSON descriptor seeded with defaults. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-wire-shade" onclick={closeProfilePop}></div>
    <div class="ge-profile-pop"
      style="left: {Math.min(profilePop.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 280)}px; top: {Math.min(profilePop.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 360)}px">
      <div class="ge-profile-pop-head">
        <span class="ge-profile-pop-title">Profile · {profilePop.set}</span>
        <span class="ge-profile-pop-hint">{profilePop.key} · {profilePop.src}</span>
      </div>
      <div class="ge-profile-pop-list">
        {#each kindsForSet(profilePop.set) as def (def.id)}
          <button class="ge-profile-pop-item"
            class:active={def.id === profilePop.currentKind}
            type="button"
            onclick={() => selectProfileKind(def.id)}>
            <span class="ge-profile-pop-item-name">{def.label}</span>
            <span class="ge-profile-pop-item-id">{def.id}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if argExprPop}
    <!-- ƒ-expression editor popup — wider input + click-to-insert chips for
         every declared param. Used when an arg references 2+ params (the
         inline text box becomes too cramped to read). -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-wire-shade" onclick={closeArgExprPop}></div>
    <div class="ge-wire-pop ge-expr-pop"
      style="left: {Math.min(argExprPop.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 460)}px; top: {argExprPop.y}px">
      <div class="ge-wire-head">ƒ <code>{argExprPop.key}</code> expression</div>
      <textarea class="ge-expr-textarea" rows="3"
        placeholder="e.g. p.od / 2 - p.wall"
        value={argExprPop.draft}
        oninput={(e) => { if (argExprPop) argExprPop = { ...argExprPop, draft: (e.target as HTMLTextAreaElement).value }; }}></textarea>
      <div class="ge-expr-pop-row">
        <span class="ge-expr-pop-label">insert:</span>
        {#each paramEntries as [name, p] (name)}
          <button class="ge-expr-pop-chip" type="button"
            onclick={() => insertParamIntoDraft(name)}
            title={`Append p.${name} to the expression (default ${(p as any).default})`}>p.{name}</button>
        {/each}
        {#if paramEntries.length === 0}
          <span class="ge-empty">no params declared</span>
        {/if}
      </div>
      <div class="ge-expr-pop-row right">
        <button class="ge-param-add ghost" type="button" onclick={closeArgExprPop}>cancel</button>
        <button class="ge-param-add" type="button" onclick={applyArgExprPop}>apply</button>
      </div>
    </div>
  {/if}

  {#if containerPop}
    {@const cnode = graph.nodes[containerPop.containerId] as any}
    {@const ctitle = cnode?.id === graph.root ? '▶ Output' : cnode?.type === 'stack' ? '↕ Stack' : cnode?.type === 'group' ? '{} Group' : '[ ] List'}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-wire-shade" onclick={closeContainerPop}></div>
    <div class="ge-wire-pop ge-container-pop"
      style="left: {Math.min(containerPop.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 380)}px; top: {containerPop.y}px">
      <div class="ge-wire-head">{ctitle} · order</div>
      {#if (cnode?.children ?? []).length === 0}
        <div class="ge-empty">no children yet — drag-wire something into this card</div>
      {:else}
        <table class="ge-container-table">
          <thead>
            <tr><th>#</th><th>node</th><th>kind</th><th>order</th><th></th></tr>
          </thead>
          <tbody>
            {#each cnode.children as childId, i (childId)}
              {@const cn = graph.nodes[childId]}
              {@const kind = cn?.type === 'repeat' && (cn as any).op === 'list' ? 'list (×N)' : cn?.type ?? '?'}
              {@const label = cn?.type === 'call' ? `${(cn as any).alias} · ${(cn as any).src}`
                : cn?.type === 'method' ? `${(cn as any).op}(…)`
                : cn?.type === 'mv' ? 'mv(…)'
                : cn?.type === 'rot' ? 'rot(…)'
                : cn?.type === 'stack' ? 'stack(…)'
                : cn?.type === 'repeat' ? `repeat × ${(cn as any).count?.kind === 'literal' ? (cn as any).count.value : '…'}`
                : '(missing)'}
              <tr>
                <td class="ge-cp-idx">{i + 1}</td>
                <td class="ge-cp-name">{label}</td>
                <td class="ge-cp-kind">{kind}</td>
                <td class="ge-cp-order">
                  <button type="button" class="ge-cp-arrow" title="Move up" disabled={i === 0}
                    onclick={() => moveChild(containerPop!.containerId, i, -1)}>▲</button>
                  <button type="button" class="ge-cp-arrow" title="Move down" disabled={i === cnode.children.length - 1}
                    onclick={() => moveChild(containerPop!.containerId, i, 1)}>▼</button>
                </td>
                <td class="ge-cp-del">
                  <button type="button" class="ge-cp-remove" title="Remove from container"
                    onclick={() => { graph = removeContainerChildAt(graph, containerPop!.containerId, i); }}>×</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      <div class="ge-expr-pop-row right">
        <button class="ge-param-add" type="button" onclick={closeContainerPop}>done</button>
      </div>
    </div>
  {/if}

  {#if pickerOpen}
    <!-- Compact Flowbite-style nav dropdown — anchored to the +Drop rail
         button. Single column, tight rows, subtle section dividers. (#118) -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-picker-shade" onclick={closePicker}></div>
    <div class="ge-picker"
      style="left: {pickerPos.left}px; top: {pickerPos.top}px">
      {#if editKind === 'profile'}
        <!-- Pen section — turtle-graphics polygon authoring nodes. Drops
             a Call card with src='pen_<op>'; the profile emitter walks
             these in graph order to build the [r, z] (revolve) or
             [x, y] (cartesian) point array. Repeat × N inside a list
             repeats a pen-op subsequence (also a Call/Container chain). -->
        <div class="ge-picker-section">
          <div class="ge-picker-label">Pen</div>
          <button class="ge-pick-item" type="button" onclick={() => dropPen('mv')}>
            <span class="ge-pick-icon">✎</span><span class="ge-pick-name">mv</span><span class="ge-pick-hint">→ (r, z)</span>
          </button>
          <button class="ge-pick-item" type="button" onclick={() => dropPen('line')}>
            <span class="ge-pick-icon">／</span><span class="ge-pick-name">line</span><span class="ge-pick-hint">→ (r, z)</span>
          </button>
          <button class="ge-pick-item" type="button" onclick={() => dropPen('lineR')}>
            <span class="ge-pick-icon">↗</span><span class="ge-pick-name">lineR</span><span class="ge-pick-hint">+(dr, dz)</span>
          </button>
          <button class="ge-pick-item" type="button" onclick={() => dropPen('lineZ')}>
            <span class="ge-pick-icon">↓</span><span class="ge-pick-name">lineZ</span><span class="ge-pick-hint">+dz</span>
          </button>
        </div>
      {:else}
        <!-- CSG ops — 3D booleans (parts only). -->
        <div class="ge-picker-section">
          <div class="ge-picker-label">CSG</div>
          <button class="ge-pick-item" type="button" onclick={() => dropCsg('subtract')}>
            <span class="ge-pick-icon">⊖</span><span class="ge-pick-name">subtract</span>
          </button>
          <button class="ge-pick-item" type="button" onclick={() => dropCsg('add')}>
            <span class="ge-pick-icon">⊕</span><span class="ge-pick-name">add</span>
          </button>
          <button class="ge-pick-item" type="button" onclick={() => dropCsg('intersect')}>
            <span class="ge-pick-icon">⊗</span><span class="ge-pick-name">intersect</span>
          </button>
        </div>
        <!-- Transform — 3D translate / rotate (parts only). -->
        <div class="ge-picker-section">
          <div class="ge-picker-label">Transform</div>
          <button class="ge-pick-item" type="button" onclick={dropMv}>
            <span class="ge-pick-icon">⇄</span><span class="ge-pick-name">mv</span><span class="ge-pick-hint">[x, y, z]</span>
          </button>
          <button class="ge-pick-item" type="button" onclick={dropRot}>
            <span class="ge-pick-icon">↻</span><span class="ge-pick-name">rot</span><span class="ge-pick-hint">[rx, ry, rz]</span>
          </button>
        </div>
      {/if}
      <!-- Container — works for both kinds (graph-shape, no geometry). -->
      <div class="ge-picker-section">
        <div class="ge-picker-label">Container</div>
        {#if editKind !== 'profile'}
          <button class="ge-pick-item" type="button" onclick={dropStack}>
            <span class="ge-pick-icon">↕</span><span class="ge-pick-name">stack</span><span class="ge-pick-hint">[…]</span>
          </button>
        {/if}
        <button class="ge-pick-item" type="button" onclick={dropRepeat}>
          <span class="ge-pick-icon">↻</span><span class="ge-pick-name">repeat</span><span class="ge-pick-hint">× N</span>
        </button>
      </div>
      {#if editKind !== 'profile'}
      <!-- Call (primitive) — filter + sort row + scrollable list -->
      <div class="ge-picker-section ge-picker-call-section">
        <div class="ge-picker-call-head">
          <div class="ge-picker-label">Call (primitive)</div>
          <div class="ge-picker-sort">
            <button class="ge-pick-sort" class:active={pickerSort === 'name'}
              type="button" onclick={() => setPickerSort('name')}>A–Z</button>
            <button class="ge-pick-sort" class:active={pickerSort === 'recent'}
              type="button" onclick={() => setPickerSort('recent')}
              title="Recently dropped first">Recent</button>
            <button class="ge-pick-sort" class:active={pickerSort === 'source'}
              type="button" onclick={() => setPickerSort('source')}
              title="Group by stdlib / basic / completions / stdstale">Source</button>
          </div>
        </div>
        <input class="ge-picker-search" type="text"
          placeholder="filter…" bind:value={pickerFilter}/>
        <div class="ge-picker-list">
          {#each filteredSrcs as src (src)}
            {@const meta = pickerSrcMeta[src]}
            <button class="ge-pick-item" type="button" onclick={() => dropCall(src)}>
              <span class="ge-pick-name code">{src}</span>
              {#if pickerSort === 'source' && meta?.source}<span class="ge-pick-src-tag src-{meta.source}">{meta.source}</span>{/if}
            </button>
          {/each}
          {#if pickerSrcs.length === 0}<div class="ge-empty">loading…</div>{/if}
        </div>
      </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* 48 px left rail + 1fr body. Rows: slim header + canvas grid. */
  .ge-root {
    display: grid;
    /* Title header removed (redundant with the /primitives tab strip).
       Single content row now; the validation-error banner inserts an
       auto row at the top only when shown. */
    grid-template-rows: 1fr;
    grid-template-columns: 48px 1fr;
    /* 100% fits inside the layout's content row. min-height: 0 lets the
       grid actually CLAMP at 100% — without it CSS grid sizes 1fr to
       max-content of the canvas + side pane, blowing the height out
       2-3× and overflowing the viewport. */
    height: 100%; min-height: 0; font-family: Arial; color: #1f2937;
    position: relative;
  }
  .ge-root > .ge-vrail   { grid-row: 1; grid-column: 1; min-height: 0; }
  .ge-root > .ge-grid    { grid-row: 1; grid-column: 2; min-height: 0; }
  .ge-root > .ge-valerr  { grid-column: 1 / -1; }
  /* ─── Vertical action rail ─────────────────────────────────────────── */
  .ge-vrail {
    display: flex; flex-direction: column;
    align-items: center; gap: 6px;
    padding: 10px 4px; background: #f8fafc;
    border-right: 1px solid #e5e7eb;
    overflow-y: auto;
  }
  .ge-vrail-btn {
    display: flex; align-items: center; justify-content: center;
    width: 36px; height: 36px;
    background: #fff; color: #44403c;
    border: 1px solid #e5e7eb; border-radius: 8px;
    font-size: 16px; line-height: 1; cursor: pointer;
    transition: background 120ms, border-color 120ms, color 120ms;
    position: relative;
  }
  .ge-vrail-btn:hover { background: #eff6ff; color: #0c4a6e; border-color: #93c5fd; }
  .ge-vrail-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .ge-vrail-btn.save    { color: #15803d; }
  .ge-vrail-btn.save:hover { background: #d1fae5; color: #14532d; border-color: #6ee7b7; }
  .ge-vrail-btn.bake    { color: #ea580c; }
  .ge-vrail-btn.bake:hover { background: #ffedd5; color: #9a3412; border-color: #fdba74; }
  .ge-vrail-btn.bake.stale {
    color: #ea580c; border-color: #f97316;
    animation: ge-bake-pulse 1.4s ease-in-out infinite;
  }
  .ge-vrail-btn.auto    { color: #78716c; }
  .ge-vrail-btn.auto.on { background: #fef3c7; color: #92400e; border-color: #fbbf24; }
  .ge-vrail-btn.ghost-clear { background: #c4b5fd; color: #4c1d95; border-color: #8b5cf6; }
  .ge-vrail-btn.ghost-clear:hover { background: #a78bfa; color: #2e1065; }
  .ge-vrail-btn.settings.on { background: #dbeafe; color: #1e40af; border-color: #60a5fa; }
  .ge-vrail-btn.reset:hover { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
  .ge-vrail-badge {
    position: absolute; top: -4px; right: -4px;
    background: #ea580c; color: #fff;
    font: 700 9px Arial; padding: 0 4px; border-radius: 9999px;
    min-width: 14px; height: 14px; line-height: 14px; text-align: center;
  }
  .ge-vrail-sep { width: 24px; height: 1px; background: #e5e7eb; margin: 4px 0; }
  .ge-vrail-spacer { flex: 1 1 auto; }

  /* ─── Canvas-settings popover (Flowbite-style compact dropdown) ─────── */
  /* Backdrop covers the viewport so an outside click closes the menu.
     `position: fixed` matches the menu's own fixed positioning so we don't
     need to chase a positioned ancestor — works the same whether mounted
     standalone (/graph-editor) or as a /primitives tab body. */
  .ge-canvas-menu-shade {
    position: fixed; inset: 0;
    z-index: 99;
  }
  .ge-canvas-menu {
    position: fixed;
    background: #fff; border: 1px solid #d6d3d1; border-radius: 6px;
    padding: 4px; width: 200px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.06);
    z-index: 100; display: flex; flex-direction: column;
  }
  /* Menu row — uniform height + horizontal layout (icon + label),
     matches the Flowbite DropdownItem visual rhythm. */
  .ge-cm-row {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 6px 10px; box-sizing: border-box;
    background: transparent; border: 0; border-radius: 4px; cursor: pointer;
    font: 500 12px Arial; color: #1f2937;
    text-align: left;
  }
  .ge-cm-row:hover { background: #f3f4f6; color: #0c4a6e; }
  .ge-cm-row.check { cursor: pointer; user-select: none; }
  .ge-cm-row.check input { margin: 0; cursor: pointer; accent-color: #cc2222; }
  .ge-cm-icon { width: 16px; text-align: center; font-size: 13px; line-height: 1; }
  .ge-cm-label { flex: 1 1 auto; }
  .ge-cm-sep { height: 1px; background: #f1f5f9; margin: 4px 6px; }
  /* ─── Profile-mode 2D preview ────────────────────────────────────── */
  .ge-profile-2d { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 12px; box-sizing: border-box; }
  .ge-profile-2d-head { font: 600 11px Arial; color: #57534e; margin-bottom: 8px; letter-spacing: 0.3px; }
  .ge-profile-2d svg { flex: 1 1 auto; min-height: 240px; width: 100%; background: #fafaf9; border: 1px solid #e5e7eb; border-radius: 4px; }
  /* Embed mode (`?embed=1`) — page is iframed inside /vocab (or similar).
     Override the 100vh so the iframe parent controls the height. */
  .ge-root.embed { height: 100%; }
  .ge-bar { display: flex; align-items: center; gap: 10px; padding: 6px 14px; border-bottom: 1px solid #e5e7eb; background: #f8fafc; }
  .ge-bar h1 { font: 700 15px Arial; margin: 0; color: #0c4a6e; }
  .ge-id { padding: 4px 10px; font: 12px ui-monospace, monospace; border: 1px solid #d6d3d1; border-radius: 4px; width: 180px; }
  .ge-btn { padding: 4px 12px; font: 600 12px Arial; background: #0369a1; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
  .ge-btn:hover { background: #0c4a6e; }
  .ge-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .ge-btn.save { background: #15803d; }
  .ge-btn.save:hover { background: #166534; }
  .ge-btn.bake { background: #ea580c; }
  .ge-btn.bake:hover { background: #c2410c; }
  .ge-btn.bake.stale { background: #f97316; animation: ge-bake-pulse 1.4s ease-in-out infinite; }
  @keyframes ge-bake-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.4); }
    50%      { box-shadow: 0 0 0 5px rgba(249, 115, 22, 0); }
  }
  .ge-auto-bake-toggle { display: inline-flex; align-items: center; gap: 4px; font: 11px Arial; color: #57534e; cursor: pointer; user-select: none; }
  .ge-auto-bake-toggle input { margin: 0; }
  /* Reset-ghosts button — appears when at least one card is ghosted.
     Violet to match the per-card 👁 toggle's active colour. */
  .ge-btn.ghost-clear {
    background: #c4b5fd; color: #4c1d95;
    padding: 3px 9px; font: 12px Arial; border: 1px solid #8b5cf6;
  }
  .ge-btn.ghost-clear:hover { background: #a78bfa; color: #2e1065; }
  /* Per-card 👁 eye toggle — a small SVG button on each Call card,
     left of the × delete. Activates ghost overlay for that card. */
  .ge-node-ghost { font: 12px Arial; cursor: pointer; user-select: none; opacity: 0.5; }
  .ge-node-ghost:hover { opacity: 1; }
  .ge-node-ghost.on { opacity: 1; fill: #6d28d9; }
  .ge-btn.ghost { background: #e5e7eb; color: #1f2937; }
  .ge-btn.ghost:hover { background: #d1d5db; }
  .ge-save-stat { font: 11px ui-monospace, monospace; color: #15803d; }
  /* In-canvas status strip — pinned bottom-left of the canvas pane.
     pointer-events:none so it doesn't intercept canvas drags; the badges
     themselves are non-interactive so click+drag pass straight through. */
  .ge-canvas-status {
    position: absolute; left: 12px; bottom: 10px;
    display: flex; align-items: center; gap: 10px;
    pointer-events: none;
    z-index: 4;
  }
  .ge-canvas-status-save {
    background: rgba(220, 252, 231, 0.92);
    color: #15803d; border: 1px solid #86efac;
    padding: 3px 9px; border-radius: 4px;
    font: 11px ui-monospace, monospace;
    box-shadow: 0 1px 2px rgba(0,0,0,0.06);
    animation: ge-canvas-status-fade-in 180ms ease-out;
  }
  .ge-canvas-status-stat {
    background: rgba(248, 250, 252, 0.85);
    color: #475569; border: 1px solid #e2e8f0;
    padding: 3px 9px; border-radius: 4px;
    font: 11px ui-monospace, monospace;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  }
  @keyframes ge-canvas-status-fade-in {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  /* Boundary edge toggles (#116) — the small circular ⏹/🔺/🔒 buttons
     pinned to the canvas edges were removed; the ⚙ canvas-settings menu
     now exposes Left / Right boundary as boolean checkbox rows. */
  /* Broken-reference banner — sits between the toolbar and the canvas so
     the user can't miss it. Amber theme matches the existing stale-server
     hint; click a node-id chip to select-and-pan to the offending node. */
  .ge-valerr {
    padding: 8px 14px; background: #fef3c7; border-bottom: 1px solid #fcd34d;
    color: #78350f; font: 12px Arial; line-height: 1.5;
  }
  .ge-valerr strong { color: #92400e; }
  .ge-valerr-hint { color: #a16207; }
  .ge-valerr ul { margin: 4px 0 0; padding: 0 0 0 18px; }
  .ge-valerr li { font-family: ui-monospace, monospace; font-size: 11px; }
  .ge-valerr-chip {
    background: #fde68a; color: #78350f; border: 1px solid #d97706; border-radius: 3px;
    padding: 0 6px; font: 11px ui-monospace, monospace; cursor: pointer;
  }
  .ge-valerr-chip:hover { background: #fcd34d; }
  .ge-valerr-slot { color: #a16207; }
  .ge-valerr-bad { color: #b91c1c; }
  .ge-stat { font: 11px ui-monospace, monospace; color: #6b7280; margin-left: auto; }
  /* grid-template-columns set inline (splitA% 6px splitB% 6px 1fr) — both
     dividers live between sections; the source pane gets the remainder. */
  .ge-grid { display: grid; overflow: hidden; }
  .ge-divider { background: #e5e7eb; cursor: col-resize; touch-action: none; transition: background 0.12s; }
  .ge-divider:hover, .ge-divider:active { background: #0369a1; }
  .ge-canvas-pane { overflow: hidden; position: relative; }
  /* + param button + delete × on canvas chip + add-param popover rows. */
  .ge-param-card-x { font: 13px Arial; fill: #b91c1c; cursor: pointer; user-select: none; }
  .ge-param-add-bg { fill: #fef3c7; stroke: #d97706; stroke-width: 2; stroke-dasharray: 4 3; cursor: pointer; }
  .ge-param-add-bg:hover { fill: #fde68a; }
  .ge-param-add-glyph { font: 600 10px Arial; fill: #92400e; text-transform: uppercase; letter-spacing: 0.5px; }
  .ge-addparam-row { padding: 6px 10px; display: flex; gap: 6px; }
  .ge-addparam-input { flex: 1; padding: 3px 8px; font: 11px ui-monospace, monospace; border: 1px solid #d6d3d1; border-radius: 3px; }
  .ge-addparam-input.num { max-width: 100px; }
  .ge-param-add { padding: 3px 12px; font: 600 11px Arial; background: #fbbf24; color: #78350f; border: 0; border-radius: 3px; cursor: pointer; }
  .ge-param-add:hover { background: #d97706; color: #fff; }
  .ge-param-add.ghost { background: #e5e7eb; color: #1f2937; }
  .ge-param-add.ghost:hover { background: #d1d5db; }

  .ge-canvas { width: 100%; height: 100%; background: #fafaf9; cursor: grab; touch-action: none; }
  .ge-canvas.dragging { cursor: grabbing; }

  .ge-node-bg { fill: #fff; stroke: #0369a1; stroke-width: 2; cursor: grab; }
  .ge-node-bg.method { fill: #fef3c7; stroke: #d97706; stroke-width: 2; }
  .ge-node-bg.transform { fill: #ede9fe; stroke: #6d28d9; stroke-width: 2; }
  .ge-node-bg.transform.rot { fill: #fce7f3; stroke: #be185d; }
  .ge-node-bg.container { fill: #ecfdf5; stroke: #047857; stroke-width: 2; }
  .ge-node-bg.container.root { fill: #f0fdf4; stroke: #15803d; stroke-width: 2.5; }
  .ge-node-bg.container.stack { fill: #ecfeff; stroke: #0e7490; }
  /* Repeat × N — distinct color so it reads as "iteration", not "container". */
  .ge-node-bg.repeat { fill: #fdf2f8; stroke: #be185d; stroke-width: 2; }
  /* Repeat count input — inline in the title row, big + editable. */
  .ge-repeat-count-inline { width: 100%; box-sizing: border-box; padding: 2px 6px; font: 700 14px ui-monospace, monospace; color: #be185d; background: #fff; border: 1px solid #fbcfe8; border-radius: 4px; text-align: center; cursor: ew-resize; }
  .ge-repeat-count-inline:focus { outline: 1px solid #be185d; cursor: text; }
  .ge-repeat-bound { font: 10px ui-monospace, monospace; fill: #be185d; pointer-events: none; }
  /* Count chip when wired to a param or expression — replaces the input */
  .ge-repeat-count-chip { font: 700 12px ui-monospace, monospace; fill: #831843; cursor: pointer; user-select: none; }
  .ge-repeat-count-chip.param { fill: #be185d; }
  .ge-repeat-count-chip.expr { fill: #b45309; font-style: italic; }
  .ge-repeat-count-x { font: 12px Arial; fill: #b91c1c; cursor: pointer; user-select: none; }
  .ge-repeat-count-x:hover { fill: #7f1d1d; }
  /* Body labels — "builds a list of N ×" + child name */
  .ge-repeat-sub { font: 11px Arial; fill: #831843; opacity: 0.85; }
  .ge-repeat-child { font: 600 12px ui-monospace, monospace; fill: #831843; }
  .ge-repeat-op-hint { font: 9px ui-monospace, monospace; fill: #9d174d; opacity: 0.6; }
  .ge-container-slot-x { font: 12px Arial; fill: #b91c1c; cursor: pointer; user-select: none; }
  .ge-container-slot-x:hover { fill: #7f1d1d; }
  .ge-container-cog { font: 13px Arial; fill: #047857; cursor: pointer; user-select: none; }
  .ge-container-cog:hover { fill: #065f46; }
  /* Reorder popover table */
  .ge-container-pop { min-width: 340px; max-width: 480px; padding: 8px 6px 4px; }
  .ge-container-table { width: 100%; border-collapse: collapse; font: 11px Arial; }
  .ge-container-table th { text-align: left; padding: 4px 6px; font: 600 10px Arial; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e5e7eb; }
  .ge-container-table td { padding: 4px 6px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
  .ge-cp-idx { width: 24px; color: #9ca3af; font: 600 11px ui-monospace, monospace; }
  .ge-cp-name { font: 600 11px ui-monospace, monospace; color: #0c4a6e; }
  .ge-cp-kind { font: 10px ui-monospace, monospace; color: #6b7280; }
  .ge-cp-order { width: 56px; white-space: nowrap; }
  .ge-cp-arrow { background: transparent; border: 1px solid #d1d5db; color: #6b7280; padding: 1px 5px; font: 10px Arial; cursor: pointer; border-radius: 3px; margin-right: 2px; }
  .ge-cp-arrow:hover:not(:disabled) { background: #f3f4f6; color: #111827; }
  .ge-cp-arrow:disabled { opacity: 0.3; cursor: default; }
  .ge-cp-del { width: 24px; text-align: right; }
  .ge-cp-remove { background: transparent; border: 0; font: 14px Arial; color: #b91c1c; cursor: pointer; padding: 0 4px; }
  .ge-cp-remove:hover { color: #7f1d1d; }
  .ge-sock-label.trail { fill: #9ca3af; font-style: italic; }
  .ge-sock.trail { fill: #fff; stroke: #9ca3af; stroke-dasharray: 2 2; }
  .ge-node-title { font: 600 12px Arial; fill: #0c4a6e; pointer-events: none; }
  .ge-node-divider { stroke: #e5e7eb; }
  .ge-node-x { font: 14px Arial; fill: #b91c1c; cursor: pointer; user-select: none; }
  .ge-method-op { font: 900 36px Arial; fill: #92400e; pointer-events: none; }
  .ge-method-name { font: 11px Arial; fill: #92400e; text-transform: uppercase; letter-spacing: 0.5px; pointer-events: none; }
  .ge-fo { overflow: visible; }
  .ge-args, .ge-xyz { font: 11px Arial; color: #1f2937; line-height: 1.5; }
  /* IMPORTANT: row height is 22 px to match the input-socket spacing
     math in the SVG (cy = 36 + 14 + i * 22). Don't change without
     updating ALL three sites: the cy expression on socket circles,
     argY computation for the param/expr wires, and inline mv/rot axis
     positions. Misalignment of even 3-4 px per row stacks visibly. */
  .ge-arg-row { display: grid; grid-template-columns: 70px 1fr; gap: 4px; align-items: center; padding: 0; height: 22px; box-sizing: border-box; }
  /* mv/rot axis rows live inside .ge-xyz — collapse the key column to
     14 px and drop the gap so the input box sits right next to the
     rx/ry/rz label, no wasted horizontal space. */
  .ge-xyz .ge-arg-row { grid-template-columns: 14px 1fr; gap: 2px; }
  .ge-arg-key { font: 11px ui-monospace, monospace; color: #6b7280; }
  /* Axis labels (x/y/z, rx/ry/rz) on the mv/rot single-column card. Slim
     fixed column, LEFT-justified so the rx/ry/rz labels read in a clean
     column header pattern instead of right-bumping against the input. */
  .ge-arg-key.axis {
    flex: 0 0 14px; text-align: left;
    font: 600 10px ui-monospace, monospace; color: #6b21a8;
    padding: 0;
  }
  .ge-arg-input { padding: 1px 4px; font: 11px ui-monospace, monospace; border: 1px solid #d6d3d1; border-radius: 2px; width: 100%; cursor: ew-resize; }
  .ge-arg-input:hover { background: #f0f9ff; }
  .ge-arg-input:focus { cursor: text; outline: 1px solid #0369a1; background: #fff; }
  .ge-arg-input.expr { cursor: text; background: #faf5ff; color: #5b21b6; border-color: #c4b5fd; }
  .ge-arg-input.expr:focus { background: #fff; outline-color: #6d28d9; }
  /* Two-element cell: [ input | ƒ ] — keeps the grid 70px-key + 1fr-value
     layout intact while giving each arg row a literal/expr mode toggle. */
  .ge-arg-cell { display: flex; align-items: stretch; gap: 4px; }
  .ge-arg-cell > input { flex: 1 1 auto; min-width: 0; }
  .ge-arg-cell.wired > .ge-arg-pchip { flex: 1 1 auto; min-width: 0; }
  /* Trailing actions — pinned to the right of the value cell. Same flex
     row in every arg state (literal / wired / expr) so ƒ and × always
     land at the right edge of the row, vertically aligned with the
     input's right border. */
  .ge-arg-actions {
    display: inline-flex; align-items: center; gap: 2px;
    flex: 0 0 auto;
  }
  .ge-arg-action {
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; padding: 0;
    background: transparent; border: 1px solid #e5e7eb; border-radius: 3px;
    color: #6b7280; cursor: pointer; line-height: 1;
    font: 700 11px serif;
  }
  .ge-arg-action.fx { font: 700 11px serif; }
  .ge-arg-action.edit { font: 11px Arial; color: #9ca3af; }
  .ge-arg-action.x { font: 12px Arial; color: #b91c1c; border-color: #fecaca; }
  .ge-arg-action:hover { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .ge-arg-action.fx.on { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .ge-arg-action.x:hover { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
  /* Legacy .ge-arg-fx class — kept so anything still using it gets the
     same look. Will be removed in a follow-up when no callers remain. */
  .ge-arg-fx { flex: 0 0 auto; padding: 0 5px; font: 700 11px serif; background: transparent; border: 1px solid #e5e7eb; border-radius: 2px; color: #6b7280; cursor: pointer; line-height: 1; }
  .ge-arg-fx:hover { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .ge-arg-fx.on { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .ge-param-card-input { cursor: ew-resize; }
  .ge-param-card-input:focus { cursor: text; }
  :global(body.dragnum-active) { cursor: ew-resize !important; }
  :global(body.dragnum-active *) { cursor: ew-resize !important; }
  /* Wired-param chip body — label-only (ƒ + × moved out to .ge-arg-actions).
     Pill-shaped so it visually reads as a "wire connection" not an input. */
  .ge-arg-pchip {
    display: inline-flex; align-items: center; min-width: 0;
    padding: 1px 8px; font: 600 10px ui-monospace, monospace;
    background: #fef3c7; color: #78350f; border: 1px solid #fbbf24;
    border-radius: 9999px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .ge-arg-pchip.ƒ { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .ge-arg-key.wire-btn { background: transparent; border: 0; padding: 1px 4px; font: 11px ui-monospace, monospace; color: #6b7280; cursor: pointer; text-align: left; border-radius: 2px; }
  .ge-arg-key.wire-btn:hover { background: #fef3c7; color: #78350f; }
  .ge-xform-btn { font: 13px Arial; fill: #6b7280; cursor: pointer; user-select: none; }
  .ge-xform-btn:hover { fill: #6d28d9; }
  .ge-xform-btn.on { fill: #6d28d9; font-weight: bold; }
  .ge-drift-btn { font: 700 14px Arial; fill: #d97706; cursor: pointer; user-select: none; }
  .ge-drift-btn:hover { fill: #92400e; }
  .ge-inline-xform { font: 11px Arial; color: #1f2937; line-height: 1.4; padding: 4px 0 0; border-top: 1px dashed #c4b5fd; }
  .ge-inline-xform.mv  { color: #5b21b6; }
  .ge-inline-xform.rot { color: #831843; border-top-color: #f9a8d4; }
  .ge-inline-label { font: 600 10px Arial; color: inherit; text-transform: uppercase; letter-spacing: 0.5px; padding: 0 0 2px; }
  .ge-arg-row.tight { padding: 0; }
  .ge-canvas-hint { font: 13px Arial; fill: #9ca3af; }

  .ge-sock { fill: #fff; stroke: #0c4a6e; stroke-width: 2; cursor: crosshair; }
  .ge-sock.out { stroke: #15803d; }
  .ge-sock.in.obj { stroke: #b91c1c; }
  .ge-sock.in.arg { stroke: #d97706; }
  .ge-sock.in.child { stroke: #6d28d9; }
  .ge-sock:hover { fill: #fef3c7; }
  .ge-sock-label { font: 10px ui-monospace, monospace; fill: #6b7280; pointer-events: none; }

  .ge-wire { stroke-width: 2; stroke-linecap: round; fill: none; }
  .ge-wire.obj { stroke: #b91c1c; }
  .ge-wire.arg { stroke: #d97706; }
  .ge-wire.child { stroke: #6d28d9; }
  .ge-wire.param { stroke: #d97706; stroke-dasharray: 2 2; opacity: 0.85; }
  /* Expression wires — multi-source. Same color as direct-param wires
     but a longer dash so it reads as "composed via expression" not
     "wired directly". Helps when both wire types meet at the same slot. */
  .ge-wire.param.expr { stroke: #b45309; stroke-dasharray: 5 3; opacity: 0.75; }
  .ge-wire.in-flight { stroke: #15803d; stroke-dasharray: 6 4; }
  /* output: piping a node into a container's slot. Green = "this is what the
     function returns / what gets stacked". root variant is slightly thicker
     to mark "this lands in the function's final return". */
  .ge-wire.output { stroke: #15803d; opacity: 0.7; }
  .ge-wire.output.root { stroke: #047857; stroke-width: 2.5; opacity: 0.85; }
  /* Param chips on canvas — small amber rounded rectangles at the top with
     output socket. The HTML strip above stays for adding/removing; these
     mirror the same data for visual wiring. */
  .ge-params-card-bg { fill: #fffbeb; stroke: #d97706; stroke-width: 1.5; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.06)); }
  .ge-params-card-title { font: 700 12px Arial; fill: #78350f; user-select: none; text-transform: uppercase; letter-spacing: 0.5px; }
  .ge-params-card-divider { stroke: #fde68a; stroke-width: 1; }
  .ge-params-add-btn { fill: #fcd34d; stroke: #d97706; stroke-width: 1.5; cursor: pointer; transition: fill 0.12s; }
  .ge-params-add-btn:hover { fill: #f59e0b; }
  .ge-params-add-glyph { font: 700 14px Arial; fill: #78350f; user-select: none; }
  /* Flex-row chip — pin | name (flex-grow) | input (fixed) | trash (fixed).
     Flowbite-style aesthetic: rounded body, soft amber, even spacing,
     items vertically centered. Width is controlled by the surrounding
     <foreignObject>, which itself reads the dynamic PARAM_W computed from
     the longest label so labels never clip. */
  .ge-param-chip {
    display: flex; align-items: center;
    height: 100%; box-sizing: border-box;
    padding: 0 6px;
    background: #fef3c7; border: 1px solid #d97706; border-radius: 6px;
    color: #78350f; font: 700 11px ui-monospace, monospace;
    gap: 6px;
  }
  .ge-param-chip .pin {
    flex: 0 0 auto;
    font: 11px 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', Arial;
    user-select: none; opacity: 0.85;
    width: 14px; text-align: center;
  }
  .ge-param-chip .name {
    flex: 1 1 auto; min-width: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    color: #78350f;
  }
  .ge-param-chip .val {
    flex: 0 0 48px;
    width: 48px; padding: 1px 4px;
    font: 11px ui-monospace, monospace; color: #92400e; text-align: center;
    background: rgba(255,255,255,0.9); border: 1px solid #fbbf24; border-radius: 3px;
    box-sizing: border-box;
    cursor: ew-resize;
  }
  .ge-param-chip .val:focus { outline: 1px solid #d97706; background: #fff; cursor: text; }
  .ge-param-chip .trash {
    flex: 0 0 auto;
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; padding: 0;
    font: 12px 'Apple Color Emoji', 'Segoe UI Emoji', Arial;
    background: transparent; border: 0; cursor: pointer;
    color: #b91c1c; opacity: 0.55; border-radius: 3px;
  }
  .ge-param-chip .trash:hover { opacity: 1; background: rgba(220, 38, 38, 0.12); }
  /* Hide native number-input spinners — drag-to-scrub via dragNumber +
     keyboard arrows are the input methods; the chevrons take horizontal
     space we can't afford in tight cells. */
  :global(.ge-param-chip .val::-webkit-outer-spin-button),
  :global(.ge-param-chip .val::-webkit-inner-spin-button),
  :global(.ge-arg-input::-webkit-outer-spin-button),
  :global(.ge-arg-input::-webkit-inner-spin-button) { -webkit-appearance: none; margin: 0; }
  :global(.ge-param-chip .val[type='number']),
  :global(.ge-arg-input[type='number']) { -moz-appearance: textfield; appearance: textfield; }
  .ge-sock.in.param { stroke: #d97706; }
  .ge-sock.out.param { stroke: #d97706; fill: #fef3c7; }
  .ge-sock.in.param:hover, .ge-sock.out.param:hover { fill: #fde68a; }
  .ge-sock.tiny { stroke-width: 1.5; }
  /* Right-edge resize grip — semi-transparent slate, lights up on hover.
     Cursor: ew-resize so the affordance is obvious. */
  .ge-resize-grip {
    fill: #cbd5e1; opacity: 0.55; cursor: ew-resize;
    transition: fill 120ms, opacity 120ms;
  }
  .ge-resize-grip:hover { fill: #6366f1; opacity: 0.95; }

  .ge-bake-pane, .ge-source-pane { display: grid; grid-template-rows: auto 1fr; overflow: hidden; }
  .ge-source-pane:has(.ge-legacy-banner) { grid-template-rows: auto auto 1fr; }
  /* Combined right pane (tabbed): bake + source in one column with a tab strip.
     30 % default width gives the canvas 70 % to show the graph. */
  .ge-right-pane { display: grid; grid-template-rows: auto 1fr; overflow: hidden; border-left: 1px solid #e5e7eb; }
  .ge-pane-tabs { display: flex; gap: 0; background: #f5f5f4; border-bottom: 1px solid #e7e5e4; }
  .ge-pane-tab { flex: 1 1 auto; padding: 6px 12px; font: 600 11px Arial; color: #78716c; background: transparent; border: 0; border-bottom: 2px solid transparent; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px; transition: background 0.12s, color 0.12s, border-color 0.12s; }
  .ge-pane-tab code { font: 11px ui-monospace, monospace; color: #57534e; text-transform: none; letter-spacing: 0; }
  .ge-pane-tab:hover { background: #fafaf9; color: #1c1917; }
  .ge-pane-tab.active { color: #0c4a6e; border-bottom-color: #0369a1; background: #fff; }
  .ge-pane-tab.active code { color: #0c4a6e; }
  .ge-pane-bodies { position: relative; display: grid; min-height: 0; overflow: hidden; }
  .ge-pane-bodies > .ge-bake-body,
  .ge-pane-bodies > .ge-source-body,
  .ge-pane-bodies > .ge-md-body { grid-area: 1 / 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
  /* SRC tab — filename header above the <pre>. Light row, monospace
     filename + a faded hint reminding the user the file is generated. */
  .ge-source-header {
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px; padding: 6px 10px;
    border-bottom: 1px solid #e5e7eb; background: #f8fafc;
  }
  .ge-source-header code { font: 12px ui-monospace, monospace; color: #0c4a6e; }
  .ge-source-header-hint { font: 10px Arial; color: #78716c; }
  /* MD tab — toolbar row + full-pane textarea. Stays mounted while hidden
     so the user can flip between SRC/MD without losing in-progress typing. */
  .ge-md-body { padding: 8px; gap: 6px; }
  .ge-md-toolbar {
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px; font: 10px Arial; color: #78716c;
  }
  .ge-md-toolbar code { font-family: ui-monospace, monospace; color: #44403c; }
  .ge-md-toolbar-actions { display: flex; align-items: center; gap: 8px; }
  .ge-md-count { flex: 0 0 auto; color: #a8a29e; }
  /* ✨ AI button — small violet pill, the established "smart / generated"
     colour in the editor (matches ƒ promote-to-expression chips). */
  .ge-md-ai-btn {
    background: #ede9fe; color: #5b21b6;
    border: 1px solid #c4b5fd; border-radius: 4px;
    padding: 2px 8px; font: 600 11px Arial; cursor: pointer;
    transition: background 100ms, color 100ms;
  }
  .ge-md-ai-btn:hover { background: #c4b5fd; color: #3b0764; }
  .ge-md-ai-btn:disabled { opacity: 0.6; cursor: wait; }
  .ge-md-textarea {
    flex: 1 1 auto; min-height: 0; resize: none;
    padding: 8px 10px;
    font: 12px ui-monospace, monospace; line-height: 1.5; color: #1f2937;
    background: #fafaf9; border: 1px solid #d6d3d1; border-radius: 4px;
    box-sizing: border-box;
  }
  .ge-md-textarea:focus { outline: 1px solid #0369a1; background: #fff; }
  .ge-pane-bodies > .hidden { display: none; }
  .ge-legacy-banner { padding: 8px 12px; font: 11px ui-monospace, monospace; line-height: 1.5; color: #78350f; background: #fef3c7; border-bottom: 1px solid #fbbf24; }
  .ge-legacy-banner strong { color: #92400e; }
  .ge-legacy-banner a { color: #0369a1; }
  .ge-pane-head { padding: 6px 12px; font: 600 11px Arial; color: #57534e; text-transform: uppercase; letter-spacing: 0.5px; background: #f5f5f4; border-bottom: 1px solid #e7e5e4; }
  .ge-pane-head code { font: 11px ui-monospace, monospace; color: #0c4a6e; text-transform: none; letter-spacing: 0; }
  .ge-bake-body { overflow: hidden; min-height: 0; }
  .ge-empty { padding: 20px; text-align: center; color: #9ca3af; font: 12px Arial; }
  .ge-err { padding: 20px; color: #b91c1c; font: 12px ui-monospace, monospace; display: flex; flex-direction: column; gap: 10px; }
  .ge-err-hint { padding: 10px 12px; background: #fef3c7; color: #78350f; border: 1px solid #fbbf24; border-radius: 4px; font: 11px Arial; line-height: 1.4; }
  .ge-err-hint code { font: 11px ui-monospace, monospace; background: rgba(0,0,0,0.06); padding: 1px 5px; border-radius: 2px; }
  .ge-err-hint-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  .ge-err-hint-or { font: 11px Arial; color: #92400e; }
  .ge-err-restart-btn { font: 600 11px Arial; color: #fff; background: #d97706; border: 1px solid #b45309; border-radius: 4px; padding: 4px 10px; cursor: pointer; transition: background 0.12s; }
  .ge-err-restart-btn:hover:not(:disabled) { background: #b45309; }
  .ge-err-restart-btn:disabled { opacity: 0.7; cursor: progress; }
  .ge-err-restart-stat { margin-top: 6px; font: 11px ui-monospace, monospace; color: #92400e; }
  /* Bake cache status row + Rebuild button */
  .ge-bake-meta { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: #fafaf9; border-top: 1px solid #e7e5e4; font: 11px Arial; }
  .ge-bake-meta-spacer { flex: 1 1 auto; }
  .ge-cache-badge { padding: 2px 8px; border-radius: 12px; font: 600 10px ui-monospace, monospace; }
  .ge-cache-badge.cached { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; }
  .ge-cache-badge.fresh { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
  .ge-cache-badge.skipped { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
  .ge-rebuild-btn { font: 600 11px Arial; color: #1c1917; background: #fff; border: 1px solid #d6d3d1; border-radius: 4px; padding: 3px 10px; cursor: pointer; transition: background 0.12s; }
  .ge-rebuild-btn:hover:not(:disabled) { background: #f5f5f4; }
  .ge-rebuild-btn:disabled { opacity: 0.7; cursor: progress; }
  .ge-rebuild-stat { font: 11px ui-monospace, monospace; color: #57534e; }
  /* Lazy cutaway load button — sits next to the "cutaway off (perf)" badge */
  .ge-cutaway-load-btn { font: 600 10px Arial; color: #fff; background: #b91c1c; border: 1px solid #991b1b; border-radius: 4px; padding: 2px 8px; cursor: pointer; transition: background 0.12s; }
  .ge-cutaway-load-btn:hover:not(:disabled) { background: #991b1b; }
  .ge-cutaway-load-btn:disabled { opacity: 0.7; cursor: progress; }
  .ge-source { margin: 0; padding: 10px 14px; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: #1f2937; background: #fafaf9; overflow: auto; white-space: pre; }
  .ge-source-pane { border-left: 1px solid #e5e7eb; }

  .ge-picker-shade { position: fixed; inset: 0; background: rgba(0,0,0,0.2); z-index: 100; }
  /* Multi-source ƒ-chip — shown on a Call's arg row when expr references 2+ params */
  .ge-arg-fnchip { display: inline-flex; align-items: center; gap: 2px; flex: 1 1 auto; padding: 1px 6px; font: 600 10px ui-monospace, monospace; background: #fef3c7; color: #78350f; border: 1px solid #f59e0b; border-radius: 9999px; cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: background 0.12s; }
  .ge-arg-fnchip:hover { background: #fde68a; }
  .ge-arg-fnchip-refs { color: #b45309; font-weight: 500; }
  /* Profile chip (#119) — appears on r_revolve / r_extrude / r_weld_extrude
     Call card rows where the underlying param is `type: 'profile'`. Shows
     the current kind label with a ▾ disclosure glyph; click opens the
     kind picker popover. */
  .ge-arg-profilechip {
    display: inline-flex; align-items: center; gap: 4px; flex: 1 1 auto;
    padding: 1px 8px; font: 600 10px ui-monospace, monospace;
    background: #ede9fe; color: #5b21b6;
    border: 1px solid #c4b5fd; border-radius: 9999px;
    cursor: pointer; max-width: 100%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    transition: background 120ms;
  }
  .ge-arg-profilechip:hover { background: #c4b5fd; color: #2e1065; }
  .ge-arg-profilechip-kind { font-weight: 700; }
  /* Profile picker popover */
  .ge-profile-pop {
    position: fixed; width: 280px; max-height: 360px;
    background: #fff; border: 1px solid #d6d3d1; border-radius: 8px;
    box-shadow: 0 6px 18px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06);
    z-index: 200; display: flex; flex-direction: column;
  }
  .ge-profile-pop-head {
    display: flex; flex-direction: column; gap: 1px;
    padding: 8px 12px; border-bottom: 1px solid #f1f5f9;
  }
  .ge-profile-pop-title { font: 600 11px Arial; color: #5b21b6; text-transform: uppercase; letter-spacing: 0.6px; }
  .ge-profile-pop-hint { font: 10px ui-monospace, monospace; color: #78716c; }
  .ge-profile-pop-list { flex: 1 1 auto; overflow-y: auto; padding: 4px 0; }
  .ge-profile-pop-item {
    display: flex; align-items: center; justify-content: space-between;
    width: 100%; padding: 6px 12px; box-sizing: border-box;
    background: transparent; border: 0; cursor: pointer;
    text-align: left; font: 12px Arial; color: #1f2937;
  }
  .ge-profile-pop-item:hover { background: #f3f4f6; color: #5b21b6; }
  .ge-profile-pop-item.active { background: #ede9fe; color: #4c1d95; font-weight: 600; }
  .ge-profile-pop-item-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ge-profile-pop-item-id { font: 10px ui-monospace, monospace; color: #a8a29e; }
  /* ƒ expression popup */
  .ge-expr-pop { min-width: 420px; max-width: 460px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .ge-expr-textarea { width: 100%; box-sizing: border-box; padding: 6px 8px; font: 12px ui-monospace, monospace; border: 1px solid #d6d3d1; border-radius: 4px; resize: vertical; background: #faf5ff; color: #5b21b6; }
  .ge-expr-textarea:focus { outline: 1px solid #6d28d9; background: #fff; }
  .ge-expr-pop-row { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 4px 6px; }
  .ge-expr-pop-row.right { justify-content: flex-end; gap: 8px; }
  .ge-expr-pop-label { font: 11px Arial; color: #6b7280; margin-right: 4px; }
  .ge-expr-pop-chip { font: 600 11px ui-monospace, monospace; color: #78350f; background: #fef3c7; border: 1px solid #fbbf24; border-radius: 4px; padding: 2px 7px; cursor: pointer; transition: background 0.1s; }
  .ge-expr-pop-chip:hover { background: #fde68a; }
  .ge-wire-shade { position: fixed; inset: 0; background: transparent; z-index: 99; }
  .ge-wire-pop { position: fixed; min-width: 200px; background: #fff; border: 1px solid #fbbf24; border-radius: 6px; box-shadow: 0 4px 14px rgba(0,0,0,0.18); padding: 4px 0; z-index: 100; }
  .ge-wire-head { padding: 6px 10px; font: 600 11px Arial; color: #78350f; border-bottom: 1px solid #fef3c7; }
  .ge-wire-head code { font: 11px ui-monospace, monospace; background: #fef3c7; padding: 1px 4px; border-radius: 2px; }
  .ge-wire-item { width: 100%; padding: 5px 12px; background: transparent; border: 0; text-align: left; font: 12px ui-monospace, monospace; color: #78350f; cursor: pointer; display: flex; gap: 8px; align-items: center; }
  .ge-wire-item:hover { background: #fef3c7; }
  .ge-wire-item.literal { color: #6b7280; border-top: 1px solid #f1f5f9; }
  .ge-wire-default { font: 10px ui-monospace, monospace; color: #92400e; }
  /* +Drop picker — Flowbite-style nav dropdown. Compact 260 px column,
     anchored next to the rail's +Drop button, soft shadow + 1 px border,
     row-based items (icon + name + optional hint) with hover highlight.
     Sections quietly separated by dividers; small uppercase labels
     instead of full coloured chips. #118. */
  .ge-picker {
    /* Position is set inline via the openPicker bounding rect — fall back
       to the rail-top defaults if the ref hasn't resolved yet. */
    position: fixed; top: 60px; left: 56px;
    width: 260px; height: 480px;
    background: #fff; border: 1px solid #d6d3d1; border-radius: 8px;
    box-shadow: 0 6px 18px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06);
    z-index: 101; overflow: hidden;
    /* Fixed outer height + overflow:hidden = the inner Call list owns the
       only scrollbar (vertical, on .ge-picker-list). The CSG/Transform/
       Container sections stay pinned at the top so the user can always
       reach them; only the long primitive list scrolls. */
    display: flex; flex-direction: column;
  }
  .ge-picker-section { padding: 4px 0; border-bottom: 1px solid #f1f5f9; }
  .ge-picker-section:last-child { border-bottom: 0; }
  .ge-picker-label {
    font: 600 9px Arial; color: #78716c;
    text-transform: uppercase; letter-spacing: 0.6px;
    padding: 4px 12px 2px;
  }
  /* Row item — Flowbite menu pattern: full-width button, icon column +
     name + optional muted hint. Hover gives a subtle bg, no per-type
     loud colours. */
  .ge-pick-item {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 6px 12px; box-sizing: border-box;
    background: transparent; border: 0; cursor: pointer;
    text-align: left; font: 12px Arial; color: #1f2937;
  }
  .ge-pick-item:hover { background: #f3f4f6; color: #0c4a6e; }
  .ge-pick-icon {
    flex: 0 0 14px; width: 14px;
    font-size: 13px; color: #64748b; text-align: center;
  }
  .ge-pick-item:hover .ge-pick-icon { color: #0c4a6e; }
  .ge-pick-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ge-pick-name.code { font-family: ui-monospace, monospace; }
  .ge-pick-hint { flex: 0 0 auto; font: 10px ui-monospace, monospace; color: #a8a29e; }
  /* Call (primitive) section — fixed-ish height with internal scroll so
     the sections above don't get pushed out when 50+ primitives load. */
  .ge-picker-call-section { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; }
  .ge-picker-call-head { display: flex; align-items: center; justify-content: space-between; padding-right: 8px; }
  .ge-picker-sort { display: flex; align-items: center; gap: 3px; }
  .ge-pick-sort {
    flex: 0 0 auto; padding: 1px 6px; font: 9px Arial;
    background: #fff; border: 1px solid #e5e7eb; border-radius: 3px;
    cursor: pointer; color: #57534e;
  }
  .ge-pick-sort:hover { background: #f3f4f6; }
  .ge-pick-sort.active { background: #1e40af; color: #fff; border-color: #1e40af; }
  .ge-picker-search {
    width: calc(100% - 24px); margin: 4px 12px 6px;
    padding: 4px 8px; font: 12px ui-monospace, monospace;
    border: 1px solid #e5e7eb; border-radius: 4px; background: #f9fafb;
  }
  .ge-picker-search:focus { outline: 1px solid #1e40af; background: #fff; border-color: #1e40af; }
  .ge-picker-list { min-height: 0; flex: 1 1 auto; overflow-y: auto; }
  .ge-pick-src-tag {
    flex: 0 0 auto;
    font: 9px ui-monospace, monospace; padding: 1px 5px; border-radius: 3px;
    margin-left: 6px; text-transform: lowercase;
  }
  .ge-pick-src-tag.src-stdlib { background: #dbeafe; color: #1e40af; }
  .ge-pick-src-tag.src-basic { background: #f5f5f4; color: #44403c; }
  .ge-pick-src-tag.src-volume { background: #f5f5f4; color: #44403c; }
  .ge-pick-src-tag.src-completions { background: #fef3c7; color: #92400e; }
  .ge-pick-src-tag.src-stdstale { background: #fee2e2; color: #991b1b; }
</style>
