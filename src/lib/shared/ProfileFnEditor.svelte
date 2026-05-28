<script lang="ts">
  /**
   * ProfileFnEditor — author a VOLUME *function* profile in-GUI (K.22 P3b,
   * docs/plans/profiles-directory.md). You define a params SCHEMA + a `build(p)`
   * body that returns an (r,z) half-section; a live preview round-trips the body
   * through /api/primitives/profiles/resolve (the points-only server sandbox —
   * `build` can't run client-side), then Save writes profile.json + source.ts to
   * the volume so it joins the palette with a `ƒ` badge.
   *
   * Identity (id / name / description / tags) is OWNED BY THE PARENT and edited
   * via the title-bar ⚙ popover — this editor only reads those props (for save +
   * the slug). The body is two columns: a scrollable LEFT (params · expressions ·
   * path) and a fixed RIGHT (actions + preview).
   */
  import type { Pt } from './profile-presets';
  import { dragNumber } from './dragNumber';
  import { tipHost } from './floating-tip';

  interface ParamRow { key: string; label: string; def: number; min: number; max: number; step: number; unit: string; }
  interface Seed { id?: string; label?: string; description?: string; tags?: string[]; params?: Record<string, any>; body?: string; }
  interface Props {
    set: 'revolve' | 'cartesian';
    seed?: Seed | null;
    /** Parent-owned identity (edited via the title-bar ⚙). Read here for save. */
    id?: string;
    label?: string;
    description?: string;
    tags?: string; // comma-separated
    onSaved: (id: string) => void;
    onClose: () => void;
    /** Page mode: the editor fills its container (full width/height) with a
     *  large preview, instead of the fixed-size popup geometry. */
    fill?: boolean;
  }
  let { set, seed = null, id = '', label = '', description = '', tags = '', onSaved, onClose, fill = false }: Props = $props();

  // Seed an editable cylinder so a fresh editor previews immediately.
  // Trace the profile with the pen (mv/line) — readable + editable (insert/
  // delete a move). `pen` is injected into the profile sandbox.
  // r, len come from the params (auto-destructured in build) — no aliasing.
  // Default scaffold per mode — function-first parametric in both cases, so a
  // freshly-created profile builds cleanly out of the gate. Revolve = an L-shaped
  // (r,z) half-section anchored on the axis (Z-down). Cartesian = a centered
  // (x,y) rectangle, ready to be edited into a richer cross-section.
  const DEFAULT_BODY = set === 'cartesian'
    ? `const t = pen();\nt.mv(-w/2, -h/2); // bottom-left\nt.line( w/2, -h/2); // → right\nt.line( w/2,  h/2); // ↑ up\nt.line(-w/2,  h/2); // ← left\nreturn t.pts();`
    : `const t = pen();\nt.mv(0, 0);    // axis, top\nt.line(r, 0);  // → out to radius\nt.line(r, len);// ↓ down the side\nt.line(0, len);// → back to axis\nreturn t.pts();`;
  function seedRows(s: Seed | null): ParamRow[] {
    if (s?.params && typeof s.params === 'object' && Object.keys(s.params).length) {
      return Object.entries<any>(s.params).map(([key, d]) => ({
        key, label: d?.label ?? key, def: +(d?.default ?? 0), min: +(d?.min ?? 0), max: +(d?.max ?? 100), step: +(d?.step ?? 1), unit: d?.unit ?? '',
      }));
    }
    return set === 'cartesian'
      ? [
          { key: 'w', label: 'Width',  def: 1.5, min: 0.05, max: 20, step: 0.05, unit: '' },
          { key: 'h', label: 'Height', def: 1.0, min: 0.05, max: 20, step: 0.05, unit: '' },
        ]
      : [
          { key: 'r',   label: 'Radius', def: 40,  min: 1, max: 300, step: 0.5, unit: 'mm' },
          { key: 'len', label: 'Length', def: 120, min: 1, max: 600, step: 1,   unit: 'mm' },
        ];
  }

  // ── Build = calculated EXPRESSIONS + a visual MOVE list (the pen path) ──────
  // Move kinds:
  //   mv / line      — absolute (x, y).
  //   lineR / lineZ  — relative (radial / axial delta).
  //   repeat         — Array.from({length: a}, (_, i) => [b, c]) emitting a
  //                    SEQUENCE of points. a = count expression, b = x(i),
  //                    c = y(i). The visual loop primitive — D3 join in code.
  interface Move { cmd: 'mv' | 'line' | 'lineR' | 'lineZ' | 'repeat'; a: string; b: string; c?: string; }
  // Split call args on top-level commas (so `Math.max(a, b), z` → two args).
  function splitArgs(s: string): string[] {
    const out: string[] = []; let depth = 0, cur = '';
    for (const ch of s) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  // Parse a build body into { expr (calculated values), moves (the pen path) }.
  // Two body shapes are recognized:
  //   1. pen() chain — `pen().mv(a,b).line(c,d)…` or `t.mv()/t.line()` calls.
  //   2. return-array literal — `return [[a,b], [c,d], …]` or `=> [[…]]`.
  //      Every curated profile uses this shape (rect/l/t/plus/cylinder/tube/
  //      cone/barrel/drill_pipe_pin) — extract each [a,b] pair as a move so the
  //      structured editor can decompose them. p.<name> is stripped so the
  //      destructured bare param names (added by composeSource) match.
  // Algorithmic bodies (for/Array.from + push) won't match either pattern and
  // get preserved verbatim by composeSource's no-moves branch.
  function parseBody(b: string): { expr: string; moves: Move[] } {
    const moves: Move[] = [];
    // (1) pen-chain moves.
    const re = /\.(mv|line|lineR|lineZ)\s*\(((?:[^()]|\([^()]*\))*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(b))) {
      const a = splitArgs(m[2]);
      moves.push({ cmd: m[1] as Move['cmd'], a: a[0] ?? '0', b: a[1] ?? '0' });
    }
    // (2) Array.from repeat pattern — recognized BEFORE the literal-array form
    // so wrapped uses (`return [...Array.from(...)]`) decompose to a single
    // repeat row instead of being over-eagerly parsed as a one-point literal.
    // Two callback forms:
    //   inline   : (_, i) => [<x>, <y>]
    //   block    : (_, i) => { const <name> = <expr>; return [<x>, <y>]; }
    // Local calcs in the block form are INLINED to fixpoint so the row's
    // expressions are pure functions of params + i.
    if (!moves.length) {
      // count uses [\s\S]+? (non-greedy ANY char) so expressions with commas
      // inside parens — Math.max(0, Math.round(n)) — match cleanly; the
      // surrounding `\s*\}\s*,\s*\(\s*_\s*,\s*i\s*\)` terminates the capture.
      const afMatch = b.match(/Array\.from\s*\(\s*\{\s*length\s*:\s*([\s\S]+?)\s*\}\s*,\s*\(\s*_\s*,\s*i\s*\)\s*=>\s*(\[[^\[\]]*\]|\{[\s\S]*?\}(?=\s*\)))/);
      if (afMatch) {
        const count = afMatch[1].trim();
        const cbody = afMatch[2].trim();
        let x = '', y = '';
        if (cbody.startsWith('[')) {
          const close = cbody.lastIndexOf(']');
          if (close > 0) {
            const parts = splitArgs(cbody.slice(1, close));
            if (parts.length === 2) { x = parts[0]; y = parts[1]; }
          }
        } else if (cbody.startsWith('{')) {
          const close = cbody.lastIndexOf('}');
          const inner = close > 0 ? cbody.slice(1, close) : cbody;
          const localCalcs: Record<string, string> = {};
          for (const stmt of inner.split(';')) {
            const sm = stmt.match(/^\s*const\s+([a-zA-Z_$][\w$]*)\s*=\s*([\s\S]+?)\s*$/);
            if (sm) localCalcs[sm[1]] = sm[2].trim();
          }
          const ret = inner.match(/return\s*\[([\s\S]+?)\]\s*;?/);
          if (ret) {
            const parts = splitArgs(ret[1]);
            if (parts.length === 2) {
              const subst = (e: string) => {
                for (let pass = 0; pass < 8; pass++) {
                  let changed = false;
                  for (const [k, v] of Object.entries(localCalcs)) {
                    const re = new RegExp('\\b' + k + '\\b', 'g');
                    const next = e.replace(re, '(' + v + ')');
                    if (next !== e) { e = next; changed = true; }
                  }
                  if (!changed) break;
                }
                return e;
              };
              x = subst(parts[0]);
              y = subst(parts[1]);
            }
          }
        }
        if (x && y) {
          const strip = (s: string) => s.replace(/\bp\./g, '').trim();
          moves.push({ cmd: 'repeat', a: strip(count), b: strip(x), c: strip(y) });
        }
      }
    }
    // (3) return-array literal — only when (1) and (2) found nothing. Match the
    // LAST top-level `return [...]` or `=> [...]` containing 2-element subarrays.
    if (!moves.length) {
      const arrMatch = b.match(/(?:return|=>)\s*(\[(?:[^\[\]]|\[[^\[\]]*\])*\])\s*;?\s*$/);
      if (arrMatch) {
        const outer = arrMatch[1];
        const elemRe = /\[\s*([^\[\]]+?)\s*\]/g;
        let em: RegExpExecArray | null;
        while ((em = elemRe.exec(outer))) {
          const parts = splitArgs(em[1]);
          if (parts.length !== 2) continue;
          const a = parts[0].replace(/\bp\./g, '').trim();
          const c = parts[1].replace(/\bp\./g, '').trim();
          moves.push({ cmd: moves.length ? 'line' : 'mv', a, b: c });
        }
      }
    }
    // calc = everything before the pen path begins (`const t = pen()` /
    // `return pen()`); a raw `return [...]` profile (no pen) → whole body is calc.
    const penIdx = b.search(/\bpen\s*\(/);
    const expr = (penIdx >= 0 ? b.slice(0, penIdx) : b)
      .replace(/[,;]?\s*(?:\b(?:const|let|var)\s+)?[A-Za-z_$][\w$]*\s*=\s*$/, '')
      .replace(/\breturn\s+$/, '')
      .replace(/\n{2,}/g, '\n')
      .trim();
    return { expr, moves };
  }
  interface Calc { name: string; expr: string; }
  // Split the calc block (`const a = X, b = Y; const c = Z;`) into structured
  // { name, expr } entries for the visual 3-column editor.
  //
  // Walks the body char by char tracking BRACE DEPTH so that `;` terminators
  // INSIDE a callback (e.g. Array.from((_, i) => { const a = …; return […]; }))
  // don't get misread as top-level calcs. Without this, a nested `const r = …`
  // referencing local `theta` would surface in the calc panel, get re-emitted
  // by composeSource at the top, and explode at build time with `theta is not
  // defined`. Top level only, single-declarator form only (skips destructure).
  function parseCalc(body: string): Calc[] {
    const out: Calc[] = [];
    const stripped = (body || '').replace(/\/\/[^\n]*/g, '');
    let depth = 0, start = 0;
    const emit = (stmt: string) => {
      const decl = stmt.replace(/^\s*(?:const|let|var)\s+/, '');
      const m = decl.match(/^\s*([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/);
      if (m && m[2].trim()) out.push({ name: m[1], expr: m[2].trim() });
    };
    for (let i = 0; i <= stripped.length; i++) {
      const ch = stripped[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if ((ch === ';' || i === stripped.length) && depth === 0) {
        emit(stripped.slice(start, i));
        start = i + 1;
      }
    }
    return out;
  }

  const _parsed = parseBody(seed?.body ?? DEFAULT_BODY);
  let rows = $state<ParamRow[]>(seedRows(seed));
  let calc = $state<Calc[]>(parseCalc(_parsed.expr));
  let moves = $state<Move[]>(_parsed.moves);
  // Recomposed calc source (one declaration per line) — for the Source tab.
  const exprSource = $derived(calc.map((c) => `const ${c.name} = ${c.expr};`).join('\n'));
  let exprOpen = $state(true);
  let movesOpen = $state(true);
  let previewPts = $state<Pt[]>([]);
  let err = $state<string | null>(null);
  let busy = $state(false);
  let saveErr = $state<string | null>(null);
  let paramsOpen = $state(true);
  let tab = $state<'builder' | 'source'>('builder');
  let pathView = $state<'flow' | 'rows'>('flow'); // PATH section: node flow-chart vs row table
  let flowOpen = $state<number | null>(null);      // which flow node is expanded for editing
  const f2 = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '·');
  // Chunk the moves into rows of n for the snake (boustrophedon) flow layout.
  function chunkMoves(n: number): { mv: Move; i: number }[][] {
    const out: { mv: Move; i: number }[][] = [];
    moves.forEach((mv, i) => { (out[Math.floor(i / n)] ??= []).push({ mv, i }); });
    return out;
  }
  // Per-param range/label callout — a Flowbite-style popover anchored to the
  // row's ⚙. Holds the metadata you rarely touch (label / min / max / step) so
  // the param row itself stays compact (key · default · unit).
  let paramPop = $state<{ i: number; x: number; y: number } | null>(null);
  // ƒ callout for editing an expression too long for the inline input — a path
  // move's x/y ('move') or a calculated value ('calc').
  let fxEdit = $state<{ kind: 'move' | 'calc'; i: number; field?: 'a' | 'b' | 'c'; x: number; y: number } | null>(null);
  function fxPos(ev: MouseEvent): { x: number; y: number } {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const popH = 110; // flip above if opening below would clip the viewport bottom
    let y = r.bottom + 8;
    if (y + popH > window.innerHeight - 8) y = Math.max(8, r.top - popH - 8);
    return { x: Math.max(8, Math.min(r.left - 110, window.innerWidth - 266)), y };
  }
  function openFx(i: number, field: 'a' | 'b' | 'c', ev: MouseEvent) { fxEdit = { kind: 'move', i, field, ...fxPos(ev) }; }
  function openFxCalc(i: number, ev: MouseEvent) { fxEdit = { kind: 'calc', i, ...fxPos(ev) }; }
  function openParamPop(i: number, ev: MouseEvent) {
    if (paramPop?.i === i) { paramPop = null; return; }
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const popH = 128; // flip above if it'd clip the bottom of the viewport
    let y = r.bottom + 9;
    if (y + popH > window.innerHeight - 8) y = Math.max(8, r.top - popH - 9);
    paramPop = { i, x: Math.max(8, Math.min(r.right - 172, window.innerWidth - 196)), y };
  }

  // Auto description (shown / persisted when the parent hasn't typed one).
  const autoDesc = $derived(set === 'revolve' ? 'revolve half-section (r, z)' : 'cross-section profile');
  const slug = $derived(id.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, ''));
  // Reassemble the build: expressions, then the pen path from the move list.
  function composeSource(): string {
    // Expose params as bare names (const { bore, wall, … } = p) so the path AND
    // calc can use them directly — no `const ri = p.bore` aliasing needed. Skip
    // any name the calc block already declares (avoids double-declaration).
    const keys = rows.map((r) => r.key.trim()).filter((k) => /^[a-zA-Z_]\w*$/.test(k));
    const usable = keys.filter((k) => !calc.some((c) => c.name === k));
    const destr = usable.length ? `  const { ${usable.join(', ')} } = p;\n` : '';
    const ex = calc.length ? calc.map((c) => `  const ${c.name} = ${c.expr};`).join('\n') + '\n' : '';
    if (!moves.length) {
      // No pen moves recognized. Two cases:
      //  (a) Procedural body (for/while/Array.from + pts.push) like the curated
      //      ellipse/ngon/star — parseBody returns 0 moves because there's no
      //      pen chain to extract. Preserve the original body verbatim so it
      //      still builds. Calc/destr is NOT prepended here (the body already
      //      contains its own declarations + return; duplicating would double-
      //      declare). Adding a row to "path" switches to the pen-chain branch
      //      below, which replaces the body entirely.
      //  (b) Truly empty (a fresh profile that had its moves deleted) — emit a
      //      visible empty array so the error surfaces clearly.
      const body = (seed?.body || '').trim();
      if (body) return `export function build(p) {\n  ${body.replace(/\n/g, '\n  ')}\n}`;
      return `export function build(p) {\n${destr}${ex}  return [];\n}`;
    }
    // When ANY repeat row is present, emit a RAW point-array body that mixes
    // static (mv/line) literals with Array.from() expansions for each repeat.
    // pen()'s relative ops (lineR/lineZ) can't compose cleanly with spread, so
    // they're flagged as a comment when mixed with repeat — the user can switch
    // them back to absolute line/mv once they're aware. For pure mv/line/lineR/
    // lineZ rows (no repeat), keep the pen() chain — that's what loaded sources
    // round-trip to and what the snake/flow view expects.
    const hasRepeat = moves.some((m) => m.cmd === 'repeat');
    if (hasRepeat) {
      const els = moves.map((m) => {
        if (m.cmd === 'repeat') return `    ...Array.from({ length: Math.max(0, Math.round(${m.a || '0'})) }, (_, i) => [${m.b || '0'}, ${m.c ?? '0'}])`;
        if (m.cmd === 'lineR' || m.cmd === 'lineZ') return `    /* ${m.cmd}(${m.a}) — relative ops not supported when a repeat row is present; convert to mv/line */`;
        return `    [${m.a || '0'}, ${m.b || '0'}]`;
      }).join(',\n');
      return `export function build(p) {\n${destr}${ex}  return [\n${els},\n  ];\n}`;
    }
    // Chained pen path: pen().mv(…).line(…)….pts()
    const chain = moves.map((mv) =>
      mv.cmd === 'lineR' || mv.cmd === 'lineZ' ? `    .${mv.cmd}(${mv.a})` : `    .${mv.cmd}(${mv.a}, ${mv.b})`,
    ).join('\n');
    return `export function build(p) {\n${destr}${ex}  return pen()\n${chain}\n    .pts();\n}`;
  }
  // Dirty = the saved payload (build SOURCE + param schema, incl. defaults)
  // differs from what we loaded. Baseline captured once per mount
  // ({#key seedKey} in the parent remounts on profile switch) + reset on a
  // successful save → drives the red "needs save" Save button.
  const saveSig = $derived(composeSource() + '' + JSON.stringify(schema()));
  let baseline = $state<string | null>(null);
  $effect(() => { const s = saveSig; if (baseline === null) baseline = s; });
  const dirty = $derived(baseline !== null && saveSig !== baseline);
  // Full profile source.ts (meta block + build) — the unified P6 form, shown in
  // the Source tab the same way a part's source reads: meta (params + calc) on
  // top, the build/composer below.
  function metaSource(): string {
    const meta: Record<string, any> = { id: slug || 'profile', label: label.trim() || slug || 'profile' };
    if (description.trim() || autoDesc) meta.description = description.trim() || autoDesc;
    meta.set = set;
    meta.tags = tags.split(',').map((t) => t.trim()).filter(Boolean);
    meta.params = schema();
    return `export const meta = ${JSON.stringify(meta, null, 2)};`;
  }
  // Parse the pen-path code (t.mv/line(...) lines) back into the move list, so
  // the Source tab's path editor round-trips to the builder + preview.
  function parsePathLines(text: string): Move[] {
    const out: Move[] = [];
    const re = /\.(mv|line|lineR|lineZ)\s*\(((?:[^()]|\([^()]*\))*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) { const a = splitArgs(m[2]); out.push({ cmd: m[1] as Move['cmd'], a: a[0] ?? '0', b: a[1] ?? '0' }); }
    return out;
  }
  function schema(): Record<string, any> {
    const out: Record<string, any> = {};
    for (const r of rows) {
      const k = r.key.trim();
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) continue;
      out[k] = { label: r.label || k, min: +r.min, max: +r.max, step: +r.step, default: +r.def, ...(r.unit ? { unit: r.unit } : {}) };
    }
    return out;
  }
  function previewParams(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of rows) { const k = r.key.trim(); if (k) out[k] = +r.def; }
    return out;
  }

  function addRow() { rows = [...rows, { key: '', label: '', def: 0, min: 0, max: 100, step: 1, unit: '' }]; }
  function delRow(i: number) { rows = rows.filter((_, j) => j !== i); }
  function addMove() { moves = [...moves, { cmd: 'line', a: '0', b: '0' }]; }
  function addRepeat() {
    // Seed a hexagon ring at radius 1. The user edits count + the cos/sin
    // expressions to taste; reference any param + Math; `i` is the iteration index.
    moves = [...moves, { cmd: 'repeat', a: '6', b: 'Math.cos(i * 2 * Math.PI / 6)', c: 'Math.sin(i * 2 * Math.PI / 6)' }];
  }
  function delMove(i: number) { moves = moves.filter((_, j) => j !== i); }

  // Live preview: debounce → resolve build(defaults) on the server sandbox.
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const src = composeSource(); const pp = previewParams(); // track body + rows
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const r = await fetch('/api/primitives/profiles/resolve', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source: src, params: pp }),
        });
        if (r.ok) { previewPts = (await r.json()).points ?? []; err = null; }
        else { err = (await r.text()).slice(0, 160); }
      } catch (e: any) { err = e?.message ?? String(e); }
    }, 250);
    return () => clearTimeout(timer);
  });

  // Preview matches the app's half-section convention: a revolve shows the r≥0
  // HALF only (NOT mirrored) with the rotation axis at r=0 and z increasing
  // downward (Z-down). Cartesian shows the centered cross-section (y up, no axis).
  // Resolution-independent: the viewBox follows the polygon's OWN bounds (+pad);
  // the <svg> fills its CSS box and preserveAspectRatio centers/scales. No pixel
  // measuring → no ResizeObserver, so the box can't feed back and grow.
  const view = $derived.by(() => {
    const poly = previewPts;
    if (!poly.length) return { d: '', axis: null as number | null, vb: '0 0 100 100', y0: 0, y1: 100 };
    const revolve = set === 'revolve';
    // svg y grows downward → revolve z (Z-down) maps as-is; cartesian y-up flips.
    const pts = poly.map((p) => [p[0], revolve ? p[1] : -p[1]] as [number, number]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const minX = revolve ? Math.min(0, ...xs) : Math.min(...xs);
    const maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = (maxX - minX) || 1, h = (maxY - minY) || 1;
    const pad = 0.04 * Math.max(w, h); // small margin → shape fills more of the box
    const vbX = minX - pad, vbY = minY - pad, vbW = w + 2 * pad, vbH = h + 2 * pad;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(3)} ${p[1].toFixed(3)}`).join(' ') + ' Z';
    return { d, axis: revolve ? 0 : null, vb: `${vbX} ${vbY} ${vbW} ${vbH}`, y0: vbY, y1: vbY + vbH };
  });

  // The id this editor opened on (when editing/forking an existing profile).
  const seedId = seed?.id ?? '';
  // Save under `slug` (Save), or fork to a new id (Save as new — appends _copy
  // when the id still matches the one we opened, so the original is never clobbered).
  // "Save as" → a small popover to name a NEW custom profile (id + name).
  let saveAs = $state<{ id: string; label: string; x: number; y: number } | null>(null);
  function openSaveAs(ev: MouseEvent) {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const popH = 150;
    let y = r.bottom + 8;
    if (y + popH > window.innerHeight - 8) y = Math.max(8, r.top - popH - 8);
    const base = slug || 'profile';
    saveAs = { id: `${base}_copy`, label: `${(label.trim() || base)} copy`, x: Math.max(8, Math.min(r.left - 70, window.innerWidth - 248)), y };
  }
  async function save(asNew = false, customId?: string, customLabel?: string) {
    saveErr = null;
    const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    let targetId = customId != null ? norm(customId) : slug;
    if (asNew && customId == null && seedId && targetId === seedId) targetId = `${targetId}_copy`;
    if (!targetId) { saveErr = 'id required'; return; }
    if (Object.keys(schema()).length === 0) { saveErr = 'add at least one param'; return; }
    busy = true;
    try {
      const r = await fetch('/api/primitives/profiles/save', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: targetId, label: (customLabel ?? label).trim() || targetId, description: description.trim() || autoDesc, set,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
          params: schema(), source: composeSource(),
        }),
      });
      if (r.ok) { saveAs = null; baseline = saveSig; onSaved(targetId); }
      else saveErr = `save failed: ${(await r.text()).slice(0, 200)}`;
    } catch (e: any) { saveErr = `error: ${e?.message ?? e}`; }
    finally { busy = false; }
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && paramPop) paramPop = null; }} />

<div class="fn-ed" class:fill use:tipHost>
  <!-- slim vertical tabs: Builder (GUI) | Source -->
  <div class="fn-tabs" role="tablist">
    <button class="fn-tab" class:active={tab === 'builder'} onclick={() => (tab = 'builder')} type="button" role="tab" title="Builder — params, expressions, path">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
      <span class="fn-tab-lbl">Builder</span>
    </button>
    <button class="fn-tab" class:active={tab === 'source'} onclick={() => (tab = 'source')} type="button" role="tab" title="Source — the full source.ts (meta + build)">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
      <span class="fn-tab-lbl">Source</span>
    </button>
  </div>
  <!-- LEFT (scrolls): Builder = params·expressions·path; Source = the source.ts -->
  <div class="fn-left">
    {#if tab === 'builder'}
    <div class="fn-acc">
      <button type="button" class="fn-acc-tog" onclick={() => (paramsOpen = !paramsOpen)}>
        <span class="fn-acc-caret">{paramsOpen ? '▾' : '▸'}</span> params <span class="fn-acc-n">{rows.length}</span>
      </button>
      <button type="button" class="fn-acc-add" onclick={() => { paramsOpen = true; addRow(); }} title="Add a parameter">+ param</button>
    </div>
    {#if paramsOpen}
      <div class="fn-params">
        {#each rows as row, i (i)}
          <div class="fn-prow">
            <input class="k" bind:value={row.key} placeholder="r" spellcheck="false" title={row.label || 'param name'} />
            <input class="num" type="text" inputmode="decimal" value={row.def} oninput={(e) => (row.def = +(e.currentTarget as HTMLInputElement).value)} use:dragNumber={{ step: row.step || 1, get: () => row.def, set: (v) => (row.def = v) }} title="default — drag or type" />
            <input class="u" bind:value={row.unit} placeholder="mm" title="unit" />
            <button type="button" class="fn-gear" class:on={paramPop?.i === i} onclick={(e) => openParamPop(i, e)} title="Range & label — min / max / step" aria-label="Edit param range">
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <g stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none"><path d="M2.5 4h5.5M11.5 4h2M2.5 8h2M7 8h6.5M2.5 12h7M12.5 12h1"/></g>
                <g fill="currentColor"><circle cx="9.5" cy="4" r="1.7"/><circle cx="5.5" cy="8" r="1.7"/><circle cx="11" cy="12" r="1.7"/></g>
              </svg>
            </button>
            <button type="button" class="fn-del" onclick={() => delRow(i)} title="Remove param" aria-label="Remove param">
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M6 2h4l.5 1H13v1.4H3V3h2.5L6 2zm-1.6 3.4h7.2l-.6 8.1a1.1 1.1 0 0 1-1.1 1H6.1a1.1 1.1 0 0 1-1.1-1l-.6-8.1zM7 7v5h1V7H7zm2 0v5h1V7H9z"/></svg>
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <!-- calculated expressions — visual 3-column grid of {name = expr} boxes -->
    <div class="fn-acc">
      <button type="button" class="fn-acc-tog" onclick={() => (exprOpen = !exprOpen)}>
        <span class="fn-acc-caret">{exprOpen ? '▾' : '▸'}</span> calculated expressions <span class="fn-acc-n">{calc.length}</span>
      </button>
      <button type="button" class="fn-acc-add" onclick={() => { exprOpen = true; calc = [...calc, { name: '', expr: '0' }]; }} title="Add a calculated value">+ expr</button>
    </div>
    {#if exprOpen}
      <div class="fn-calc">
        {#each calc as c, i (i)}
          <div class="fn-cbox">
            <input class="fn-cname" bind:value={c.name} spellcheck="false" placeholder="name" />
            <span class="fn-ceq">=</span>
            <input class="fn-cexpr" bind:value={c.expr} spellcheck="false" placeholder="expr" />
            {#if (c.expr?.length ?? 0) > 9}<button type="button" class="fn-fx" onclick={(e) => openFxCalc(i, e)} aria-label="Edit expression">ƒ</button>{/if}
            <button type="button" class="fn-cdel" onclick={() => (calc = calc.filter((_, j) => j !== i))} aria-label="Remove" title="Remove">✕</button>
          </div>
        {/each}
      </div>
    {/if}

    <!-- path: visual list of pen moves (mv / line) — r,z are expressions -->
    <div class="fn-acc">
      <button type="button" class="fn-acc-tog" onclick={() => (movesOpen = !movesOpen)}>
        <span class="fn-acc-caret">{movesOpen ? '▾' : '▸'}</span> path
        <span class="fn-acc-n">{moves.length}</span>
        <span class="fn-acc-hint">({set === 'revolve' ? 'r ≥ 0 half-section, Z-down' : 'centered'})</span>
      </button>
      <button type="button" class="fn-acc-add" title="Toggle flow / rows view" onclick={() => (pathView = pathView === 'flow' ? 'rows' : 'flow')}>{pathView === 'flow' ? 'rows' : 'flow'}</button>
      <button type="button" class="fn-acc-add" onclick={() => { movesOpen = true; addMove(); }} title="Add a move">+ move</button>
      <button type="button" class="fn-acc-add" onclick={() => { movesOpen = true; addRepeat(); }} title="Add a repeat row — emits N points via i = 0..N-1 (the visual loop)">+ repeat</button>
    </div>
    {#if movesOpen}
      {#if pathView === 'flow'}
        <!-- node flow-chart: a circle per move (hollow = start), the resolved
             (r,z) beside it, the Δ vector to the next node, then a closure line. -->
        <!-- snake grid: fixed left/right margins for the U-turn lines; boxes line
             up in columns, flow L→R then R→L, turns drawn in the margins. -->
        <div class="fn-snake">
          {#each moves as mv, i (i)}
            {@const row = Math.floor(i / 3)}
            {@const col = row % 2 === 0 ? i % 3 : 2 - (i % 3)}
            <div class="fn-box" class:start={i === 0} class:repeat={mv.cmd === 'repeat'} style="grid-column:{col + 2};grid-row:{row + 1}">
              <span class="fn-box-i">{mv.cmd === 'repeat' ? `${i} ⟳` : i}</span>
              {#if mv.cmd === 'repeat'}
                <div class="fn-box-rows">
                  <label class="fn-box-row">
                    <span class="fn-box-k">×N</span>
                    <input class="fn-box-v" bind:value={moves[i].a} spellcheck="false" placeholder="6" title="count" />
                    {#if (moves[i].a?.length ?? 0) > 8}<button type="button" class="fn-fx" onclick={(e) => openFx(i, 'a', e)} aria-label="Edit expression">ƒ</button>{/if}
                  </label>
                  <label class="fn-box-row">
                    <span class="fn-box-k">x(i)</span>
                    <input class="fn-box-v" bind:value={moves[i].b} spellcheck="false" placeholder="r * Math.cos(i*2*Math.PI/N)" title="x as a function of i" />
                    {#if (moves[i].b?.length ?? 0) > 8}<button type="button" class="fn-fx" onclick={(e) => openFx(i, 'b', e)} aria-label="Edit expression">ƒ</button>{/if}
                  </label>
                  <label class="fn-box-row">
                    <span class="fn-box-k">y(i)</span>
                    <input class="fn-box-v" bind:value={moves[i].c} spellcheck="false" placeholder="r * Math.sin(i*2*Math.PI/N)" title="y as a function of i" />
                    {#if ((moves[i].c?.length ?? 0)) > 8}<button type="button" class="fn-fx" onclick={(e) => openFx(i, 'c', e)} aria-label="Edit expression">ƒ</button>{/if}
                  </label>
                </div>
              {:else}
                <div class="fn-box-rows">
                  <label class="fn-box-row">
                    <span class="fn-box-k">x</span>
                    <input class="fn-box-v" bind:value={moves[i].a} spellcheck="false" />
                    {#if (moves[i].a?.length ?? 0) > 8}<button type="button" class="fn-fx" onclick={(e) => openFx(i, 'a', e)} aria-label="Edit expression">ƒ</button>{/if}
                  </label>
                  {#if mv.cmd === 'mv' || mv.cmd === 'line'}
                    <label class="fn-box-row">
                      <span class="fn-box-k">y</span>
                      <input class="fn-box-v" bind:value={moves[i].b} spellcheck="false" />
                      {#if (moves[i].b?.length ?? 0) > 8}<button type="button" class="fn-fx" onclick={(e) => openFx(i, 'b', e)} aria-label="Edit expression">ƒ</button>{/if}
                    </label>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
          {#each Array.from({ length: Math.ceil(moves.length / 3) }) as _, r (r)}
            {@const count = Math.min(3, moves.length - r * 3)}
            {#if count > 1}<span class="fn-rail" style="grid-row:{r + 1};grid-column:{r % 2 === 0 ? 2 : 5 - count}/{r % 2 === 0 ? count + 2 : 5}"></span>{/if}
          {/each}
          {#each Array.from({ length: Math.max(0, Math.ceil(moves.length / 3) - 1) }) as _, r (r)}
            <span class="fn-turn" class:left={r % 2 === 1} style="grid-row:{r + 1}/{r + 3};grid-column:{r % 2 === 0 ? 5 : 1}"></span>
          {/each}
        </div>
        <div class="fn-snake-close">↺ closes back to start</div>
      {:else}
        <div class="fn-moves">
          <div class="fn-mrow fn-mrow-h"><span></span><span>cmd</span><span>r</span><span>z</span><span></span></div>
          {#each moves as mv, i (i)}
            <div class="fn-mrow" class:fn-mrow-rep={mv.cmd === 'repeat'}>
              <span class="fn-mnum">{i}</span>
              <select class="fn-mcmd" bind:value={mv.cmd}>
                <option value="mv">mv</option><option value="line">line</option>
                <option value="lineR">lineR</option><option value="lineZ">lineZ</option>
                <option value="repeat">repeat</option>
              </select>
              {#if mv.cmd === 'repeat'}
                <input class="fn-marg" bind:value={mv.a} placeholder="N" spellcheck="false" title="count expression — number or param ref (uses `i` is auto-bound 0..N-1)" />
                <input class="fn-marg" bind:value={mv.b} placeholder="x(i)" spellcheck="false" title="x expression — can reference any param and `i`" />
                <input class="fn-marg" bind:value={mv.c} placeholder="y(i)" spellcheck="false" title="y expression — can reference any param and `i`" />
              {:else}
                <input class="fn-marg" bind:value={mv.a} placeholder={mv.cmd === 'lineZ' ? 'z' : 'r'} spellcheck="false" title="r / expression" />
                {#if mv.cmd === 'mv' || mv.cmd === 'line'}
                  <input class="fn-marg" bind:value={mv.b} placeholder="z" spellcheck="false" title="z / expression" />
                {:else}<span class="fn-marg fn-marg-na">—</span>{/if}
              {/if}
              <button type="button" class="fn-del" onclick={() => delMove(i)} title="Remove move" aria-label="Remove move">
                <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M6 2h4l.5 1H13v1.4H3V3h2.5L6 2zm-1.6 3.4h7.2l-.6 8.1a1.1 1.1 0 0 1-1.1 1H6.1a1.1 1.1 0 0 1-1.1-1l-.6-8.1zM7 7v5h1V7H7zm2 0v5h1V7H9z"/></svg>
              </button>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
    {:else}
      <!-- Source: same collapsible sections as the builder, shown as code -->
      {@const metaCode = metaSource()}
      {@const pathLines = 'pen()\n' + moves.map((mv) => mv.cmd === 'lineR' || mv.cmd === 'lineZ' ? `  .${mv.cmd}(${mv.a})` : `  .${mv.cmd}(${mv.a}, ${mv.b})`).join('\n') + '\n  .pts();'}
      <div class="fn-acc"><button type="button" class="fn-acc-tog" onclick={() => (paramsOpen = !paramsOpen)}><span class="fn-acc-caret">{paramsOpen ? '▾' : '▸'}</span> meta</button></div>
      {#if paramsOpen}<textarea class="fn-expr" readonly spellcheck="false" rows="9" value={metaCode}></textarea>{/if}
      <div class="fn-acc"><button type="button" class="fn-acc-tog" onclick={() => (exprOpen = !exprOpen)}><span class="fn-acc-caret">{exprOpen ? '▾' : '▸'}</span> calculated expressions</button></div>
      {#if exprOpen}<textarea class="fn-expr" value={exprSource} onchange={(e) => (calc = parseCalc((e.currentTarget as HTMLTextAreaElement).value))} spellcheck="false" rows="4" placeholder="const ri = p.bore / 2;"></textarea>{/if}
      <div class="fn-acc"><button type="button" class="fn-acc-tog" onclick={() => (movesOpen = !movesOpen)}><span class="fn-acc-caret">{movesOpen ? '▾' : '▸'}</span> path <span class="fn-acc-hint">(composer)</span></button></div>
      {#if movesOpen}<textarea class="fn-expr" spellcheck="false" rows="7" value={pathLines} onchange={(e) => (moves = parsePathLines((e.currentTarget as HTMLTextAreaElement).value))}></textarea>{/if}
    {/if}
  </div>

  <!-- RIGHT (fixed): actions on top, then the capped preview -->
  <div class="fn-right">
    <div class="fn-actions">
      <button type="button" class="fn-save" class:dirty disabled={busy || !!err || !slug} onclick={() => save(false)} title={dirty ? 'Unsaved changes — save to the volume' : 'Save to the volume'}>{busy ? '…' : 'Save'}</button>
      {#if seedId}
        <button type="button" class="fn-saveas" disabled={busy || !!err} onclick={(e) => openSaveAs(e)} title="Save as a new custom profile">Save as</button>
      {/if}
      <button type="button" class="fn-cancel" onclick={onClose}>Cancel</button>
    </div>
    {#if saveErr}<div class="fn-saveerr" title={saveErr}>{saveErr}</div>{/if}
    <div class="fn-prev">
      <svg viewBox={view.vb} preserveAspectRatio={fill ? 'xMidYMid meet' : 'xMinYMid meet'} class="fn-svg" class:bad={!!err}>
        {#if view.axis !== null}<line x1={view.axis} y1={view.y0} x2={view.axis} y2={view.y1} class="fn-axis" vector-effect="non-scaling-stroke" />{/if}
        {#if view.d}<path d={view.d} class="fn-path" vector-effect="non-scaling-stroke" />{/if}
      </svg>
      {#if err}<div class="fn-err" title={err}>{err}</div>{/if}
    </div>
  </div>
</div>

{#if paramPop}
  {@const prow = rows[paramPop.i]}
  {#if prow}
    <div class="fn-pop-back" role="presentation" onclick={() => (paramPop = null)}></div>
    <div class="fn-pop" style={`left:${paramPop.x}px; top:${paramPop.y}px`}>
      <div class="fn-pop-ttl"><code>{prow.key || 'param'}</code> · range &amp; label</div>
      <label class="fn-pp-row"><span>label</span><input value={prow.label} oninput={(e) => (prow.label = (e.currentTarget as HTMLInputElement).value)} placeholder="Bore ID" /></label>
      <label class="fn-pp-row"><span>min</span><input class="num" type="text" inputmode="decimal" value={prow.min} oninput={(e) => (prow.min = +(e.currentTarget as HTMLInputElement).value)} use:dragNumber={{ step: prow.step || 1, get: () => prow.min, set: (v) => (prow.min = v) }} /></label>
      <label class="fn-pp-row"><span>max</span><input class="num" type="text" inputmode="decimal" value={prow.max} oninput={(e) => (prow.max = +(e.currentTarget as HTMLInputElement).value)} use:dragNumber={{ step: prow.step || 1, get: () => prow.max, set: (v) => (prow.max = v) }} /></label>
      <label class="fn-pp-row"><span>step</span><input class="num" type="text" inputmode="decimal" value={prow.step} oninput={(e) => (prow.step = +(e.currentTarget as HTMLInputElement).value)} use:dragNumber={{ step: 0.1, get: () => prow.step, set: (v) => (prow.step = v) }} /></label>
    </div>
  {/if}
{/if}

{#if saveAs}
  <div class="fn-pop-back" role="presentation" onclick={() => (saveAs = null)}></div>
  <div class="fn-pop fn-saveas-pop" style={`left:${saveAs.x}px; top:${saveAs.y}px`}>
    <div class="fn-pop-ttl">save as a new custom profile</div>
    <label class="fn-fx-row"><span>id</span><input bind:value={saveAs.id} spellcheck="false" placeholder="my_profile" /></label>
    <label class="fn-fx-row"><span>name</span><input bind:value={saveAs.label} placeholder="My profile" /></label>
    <button type="button" class="fn-save fn-saveas-go" disabled={busy || !saveAs.id.trim()} onclick={() => save(true, saveAs!.id, saveAs!.label)}>{busy ? '…' : 'Save copy'}</button>
  </div>
{/if}

{#if fxEdit && fxEdit.kind === 'move'}
  {@const fm = moves[fxEdit.i]}
  {#if fm}
    <div class="fn-pop-back" role="presentation" onclick={() => (fxEdit = null)}></div>
    <div class="fn-pop fn-fx-pop" style={`left:${fxEdit.x}px; top:${fxEdit.y}px`}>
      <div class="fn-pop-ttl">{fm.cmd === 'repeat' ? 'repeat' : 'point'} <code>{fxEdit.i}</code> · {fm.cmd === 'repeat' ? (fxEdit.field === 'a' ? 'count (N)' : fxEdit.field === 'b' ? 'x(i)' : 'y(i)') : (fxEdit.field === 'a' ? 'x (r)' : 'y (z)')} expression</div>
      <textarea class="fn-fx-ta" spellcheck="false" rows="3"
        value={fxEdit.field === 'a' ? fm.a : fxEdit.field === 'b' ? fm.b : (fm.c ?? '')}
        oninput={(e) => { const v = (e.currentTarget as HTMLTextAreaElement).value; if (fxEdit!.field === 'a') fm.a = v; else if (fxEdit!.field === 'b') fm.b = v; else fm.c = v; }}></textarea>
    </div>
  {/if}
{:else if fxEdit && fxEdit.kind === 'calc'}
  {@const c = calc[fxEdit.i]}
  {#if c}
    <div class="fn-pop-back" role="presentation" onclick={() => (fxEdit = null)}></div>
    <div class="fn-pop fn-fx-pop" style={`left:${fxEdit.x}px; top:${fxEdit.y}px`}>
      <div class="fn-pop-ttl"><code>{c.name || 'calc'}</code> = … expression</div>
      <label class="fn-fx-row"><span>name</span><input bind:value={c.name} spellcheck="false" placeholder="ri" /></label>
      <textarea class="fn-fx-ta" bind:value={c.expr} spellcheck="false" rows="3" placeholder="p.bore / 2"></textarea>
    </div>
  {/if}
{/if}

<style>
  /* two columns; LEFT scrolls, RIGHT is fixed. height:100% lets the popup's
     own max-height cap the panel and confine scrolling to the left column. */
  /* FIXED height — the popup doesn't resize with content; only the left column scrolls. */
  .fn-ed { width: 600px; max-width: 94vw; height: 72vh; min-height: 0; overflow: hidden; display: grid; grid-template-columns: 24px 1fr 130px; gap: 9px; align-items: stretch; font: 11px Arial; color: #222; }
  /* Page (fill) mode: occupy the host container with a big preview column. */
  .fn-ed.fill { width: 100%; max-width: none; height: 100%; grid-template-columns: 26px minmax(0, 1fr) minmax(300px, 40%); gap: 14px; }
  .fn-ed.fill .fn-svg { max-height: none; }
  /* slim vertical tab rail (Builder | Source) — Excel-style trapezoid tabs with
     vertical labels, so the rail stays narrow and reads top-to-bottom. */
  .fn-tabs { display: flex; flex-direction: column; gap: 5px; align-items: stretch; padding-top: 4px; }
  .fn-tab { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; border: 0; background: #f1e7e5; cursor: pointer; color: #8a8a8a; padding: 14px 0; clip-path: polygon(0 12%, 100% 0, 100% 100%, 0 88%); }
  .fn-tab:hover { background: #f7ddd9; color: #b23329; }
  .fn-tab.active { background: #c4392f; color: #fff; }
  .fn-tab svg { display: block; transform: rotate(90deg); width: 13px; height: 13px; }
  .fn-tab-lbl { writing-mode: vertical-rl; transform: rotate(180deg); font: 700 8px Arial; text-transform: uppercase; letter-spacing: .09em; }
  .fn-left { min-width: 0; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; padding-right: 5px; }
  .fn-right { min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: 7px; }
  /* actions — Cancel + Save-as-new share a row; Save takes its own full-width row */
  /* three buttons in a single row — Cancel · Save as · Save */
  .fn-actions { display: flex; gap: 12px; align-items: stretch; }
  .fn-cancel { flex: 1 1 0; min-width: 0; border: 1px solid #d4d4dc; background: #fff; border-radius: 5px; padding: 4px 6px; cursor: pointer; font: 11px Arial; }
  .fn-cancel:hover { background: #f6f6f8; }
  .fn-saveas { flex: 1 1 0; min-width: 0; white-space: nowrap; border: 1px solid #e8c6c1; background: #fff; color: #c4392f; border-radius: 5px; padding: 4px 6px; cursor: pointer; font: 11px Arial; }
  .fn-saveas:hover:not(:disabled) { background: #fceeec; }
  .fn-saveas:disabled { opacity: .5; cursor: not-allowed; }
  /* Save: calm/neutral when clean; RED with a WHITE OUTLINE when dirty so an
     unsaved profile clearly needs saving. */
  .fn-save { flex: 1 1 0; min-width: 0; border: 1px solid #ccc; background: #efefef; color: #555; border-radius: 5px; padding: 4px 6px; cursor: pointer; font: 11px Arial; }
  .fn-save:hover:not(:disabled) { background: #e4e4e4; }
  .fn-save.dirty { background: #c4392f; color: #fff; border-color: #c4392f; box-shadow: 0 0 0 2px #fff, 0 0 0 4px #c4392f; font-weight: 700; }
  .fn-save.dirty:hover:not(:disabled) { background: #b23329; }
  .fn-save:disabled { opacity: .5; cursor: not-allowed; }
  .fn-saveerr { font-size: 10px; color: #cc2222; line-height: 1.3; }
  /* collapsible section header — distinct bordered chip (toggle | + add),
     slightly rounded, tight. The + action lives inside the title chip. */
  .fn-acc { display: flex; align-items: stretch; border: 1px solid #e3c4bf; background: #fbf4f3; border-radius: 4px; margin-top: 2px; overflow: hidden; }
  .fn-acc:hover { border-color: #e0b4ad; }
  .fn-acc-tog { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; text-align: left; border: 0; background: transparent; cursor: pointer; font: 700 9px/1.3 Arial; text-transform: uppercase; letter-spacing: .055em; color: #1f1f1f; padding: 4px 8px; }
  .fn-acc-tog:hover { background: #fceeec; color: #b23329; }
  .fn-acc-add { flex: 0 0 auto; border: 0; border-left: 1px solid #efd3ce; background: transparent; cursor: pointer; color: #c4392f; font: 700 9px Arial; text-transform: uppercase; letter-spacing: .04em; padding: 0 9px; }
  .fn-acc-add:hover { background: #fceeec; }
  .fn-acc-caret { color: #cf9b94; font-size: 8px; width: 9px; }
  .fn-acc-n { background: #f6ddd9; color: #c4392f; border-radius: 8px; padding: 1px 7px; font-size: 8px; font-weight: 700; }
  .fn-acc-hint { margin-left: auto; font-size: 8px; color: #aaa; text-transform: none; letter-spacing: 0; font-weight: 400; }
  /* params — two-column compact grid (one param per cell) */
  .fn-params { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 10px; padding: 3px 2px 0; }
  .fn-prow { display: grid; grid-template-columns: minmax(0,1.2fr) minmax(0,0.75fr) minmax(0,0.45fr) 22px 18px; gap: 3px; align-items: center; }
  .fn-prow input { font: 10px Arial; padding: 3px 4px; border: 1px solid #dcdce4; border-radius: 4px; min-width: 0; width: 100%; box-sizing: border-box; }
  .fn-prow input:focus { outline: none; border-color: #c4392f; }
  .fn-prow input.k { font-family: 'SF Mono', Menlo, monospace; }
  .fn-prow input.num { font-family: 'SF Mono', Menlo, monospace; text-align: right; cursor: ew-resize; background: #fdf8f7; }
  .fn-gear { display: inline-flex; align-items: center; justify-content: center; height: 22px; border: 1px solid transparent; background: transparent; cursor: pointer; color: #c79a95; padding: 0; border-radius: 4px; }
  .fn-gear:hover { color: #c4392f; background: #fceeec; }
  .fn-gear.on { color: #c4392f; background: #f6ddd9; border-color: #e8c6c1; }
  .fn-del { display: inline-flex; align-items: center; justify-content: center; border: 0; background: transparent; cursor: pointer; color: #c4c4d0; padding: 0; }
  .fn-del:hover { color: #cc2222; }
  .fn-expr { font: 11px 'SF Mono', Menlo, monospace; padding: 6px; border: 1px solid #d4d4dc; border-radius: 5px; resize: vertical; line-height: 1.4; width: 100%; box-sizing: border-box; }
  .fn-expr:focus { outline: none; border-color: #c4392f; }
  /* visual move list */
  .fn-moves { display: flex; flex-direction: column; gap: 2px; padding: 2px 2px 0; }
  .fn-mrow { display: grid; grid-template-columns: 16px 64px 1fr 1fr 20px; gap: 4px; align-items: center; }
  /* Repeat rows STACK — N on the top line with cmd selector + delete; x(i) and
     y(i) each get a full-width row underneath so long polar expressions like
     `r * Math.cos(i * 2 * Math.PI / n)` are readable. Monospace + bumped font
     so the math is legible at a glance. Capped at the panel width (max-width
     comes from the parent layout); N stays compact via max-width: 50%. */
  .fn-mrow-rep {
    grid-template-columns: 16px 64px 1fr 20px;
    grid-template-rows: auto auto auto;
    row-gap: 3px;
    align-items: center;
    background: #f7f3ec;
    border-radius: 4px;
    padding: 3px 2px;
    margin: 1px 0;
  }
  .fn-mrow-rep > .fn-mnum     { grid-column: 1; grid-row: 1; }
  .fn-mrow-rep > select.fn-mcmd { grid-column: 2; grid-row: 1; }
  .fn-mrow-rep > input.fn-marg:nth-of-type(1) { grid-column: 3; grid-row: 1; max-width: 50%; }
  .fn-mrow-rep > input.fn-marg:nth-of-type(2),
  .fn-mrow-rep > input.fn-marg:nth-of-type(3) {
    grid-column: 2 / 4;
    font: 13px ui-monospace, SFMono-Regular, Menlo, monospace;
    padding: 4px 6px;
    background: #fff;
    border: 1px solid #e0d4c8;
    border-radius: 3px;
  }
  .fn-mrow-rep > input.fn-marg:nth-of-type(2) { grid-row: 2; }
  .fn-mrow-rep > input.fn-marg:nth-of-type(3) { grid-row: 3; }
  .fn-mrow-rep > .fn-del      { grid-column: 4; grid-row: 1; }
  .fn-mrow-h { font-size: 8px; color: #bbb; }
  .fn-mrow-h span { padding-left: 3px; }
  .fn-mnum { font: 9px 'SF Mono', Menlo, monospace; color: #bbb; text-align: right; }
  .fn-mcmd { font: 10px 'SF Mono', Menlo, monospace; padding: 2px 3px; border: 1px solid #dcdce4; border-radius: 4px; background: #fdf8f7; color: #c4392f; }
  .fn-marg { font: 10px 'SF Mono', Menlo, monospace; padding: 3px 5px; border: 1px solid #dcdce4; border-radius: 4px; min-width: 0; width: 100%; box-sizing: border-box; }
  .fn-marg:focus { outline: none; border-color: #c4392f; }
  .fn-marg-na { color: #ccc; text-align: center; }
  /* path snake (CSS grid): 3 box columns centred between fixed left/right margins
     that hold the rounded U-turn lines; boxes line up in columns and flow L→R
     then R→L. Inputs look like labels (transparent border) → no reflow on edit. */
  .fn-snake { display: grid; grid-template-columns: 20px repeat(3, 1fr) 20px; gap: 8px 8px; padding: 8px 2px 2px; align-items: center; overflow-x: hidden; }
  .fn-box { position: relative; z-index: 1; display: inline-flex; align-items: flex-start; gap: 4px; border: 1px solid #e3c4bf; border-radius: 6px; padding: 3px 6px; background: #fff; justify-self: center; }
  .fn-box.start { border-color: #c4392f; background: #fceeec; }
  /* Repeat box (flow view) reads as "loop body" — amber accent + wider min so
     the x(i)/y(i) inputs can show long polar expressions. The inputs themselves
     go monospace and a touch bigger for math legibility. Capped at 50% of the
     left-panel width so it doesn't dominate when the snake has many boxes. */
  .fn-box.repeat { border-color: #d9a441; background: #fdf6e3; min-width: 240px; max-width: 50%; }
  .fn-box.repeat .fn-box-i { color: #b07a16; font-weight: 700; }
  .fn-box.repeat .fn-box-v { font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; }
  .fn-box.repeat .fn-box-k { color: #8a6a16; font-weight: 700; }
  /* continuous rail behind a row's boxes → connects them (boxes cover it; the
     line shows through the gaps so adjacent boxes read as joined) */
  .fn-rail { align-self: center; justify-self: stretch; height: 2px; background: #e0cfcb; z-index: 0; }
  .fn-box-i { font: 8px 'SF Mono', Menlo, monospace; color: #b3b3b3; padding-top: 1px; }
  .fn-box-rows { display: flex; flex-direction: column; gap: 2px; }
  .fn-box-row { display: flex; align-items: center; gap: 4px; }
  .fn-box-k { font: 700 11px 'SF Mono', Menlo, monospace; color: #1a1a1a; width: 10px; }
  .fn-box-v { width: 46px; border: 1px solid transparent; background: transparent; font: 10px 'SF Mono', Menlo, monospace; color: #222; padding: 1px 3px; border-radius: 3px; box-sizing: border-box; }
  .fn-box-v:focus { outline: none; border-color: #c4392f; background: #fdf4f3; }
  /* ƒ — opens a callout to edit an expression too long for the inline input */
  .fn-fx { border: 0; background: transparent; color: #c4392f; cursor: pointer; font: italic 700 12px Georgia, 'Times New Roman', serif; padding: 0 1px; flex-shrink: 0; line-height: 1; }
  .fn-fx:hover { color: #a8302a; }
  .fn-fx-pop { width: 248px; }
  .fn-fx-ta { width: 100%; box-sizing: border-box; font: 11px 'SF Mono', Menlo, monospace; padding: 6px; border: 1px solid #dcdce4; border-radius: 5px; resize: vertical; color: #222; }
  .fn-fx-ta:focus { outline: none; border-color: #c4392f; }
  .fn-fx-row { display: grid; grid-template-columns: 38px 1fr; align-items: center; gap: 6px; margin-bottom: 5px; }
  .fn-fx-row span { font-size: 9px; color: #888; }
  .fn-fx-row input { font: 11px 'SF Mono', Menlo, monospace; padding: 4px 6px; border: 1px solid #dcdce4; border-radius: 4px; width: 100%; box-sizing: border-box; }
  .fn-fx-row input:focus { outline: none; border-color: #c4392f; }
  .fn-saveas-pop { width: 232px; }
  .fn-saveas-go { width: 100%; margin-top: 4px; flex: none; }
  /* calculated expressions — 3-column grid of {name = expr} boxes (no units) */
  .fn-calc { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; padding: 3px 2px 0; }
  .fn-cbox { display: inline-flex; align-items: center; gap: 2px; border: 1px solid #e3c4bf; border-radius: 6px; padding: 2px 4px; background: #fff; min-width: 0; }
  .fn-cname { width: 48px; flex-shrink: 0; border: 1px solid transparent; background: transparent; font: 700 10px 'SF Mono', Menlo, monospace; color: #1a1a1a; padding: 1px 2px; border-radius: 3px; box-sizing: border-box; }
  .fn-cname:focus { outline: none; border-color: #c4392f; background: #fdf4f3; }
  .fn-ceq { color: #c9bcba; font: 10px 'SF Mono', Menlo, monospace; flex-shrink: 0; }
  .fn-cexpr { flex: 1; min-width: 0; border: 1px solid transparent; background: transparent; font: 10px 'SF Mono', Menlo, monospace; color: #444; padding: 1px 2px; border-radius: 3px; box-sizing: border-box; }
  .fn-cexpr:focus { outline: none; border-color: #c4392f; background: #fdf4f3; }
  .fn-cdel { border: 0; background: transparent; color: #c4c4d0; cursor: pointer; font-size: 11px; padding: 0 1px; flex-shrink: 0; line-height: 1; }
  .fn-cdel:hover { color: #cc2222; }
  /* rounded U-turn drawn in the side margin, from one box's vertical centre to
     the next row's (inset ~half a box so it meets the box centres). */
  .fn-turn { align-self: stretch; justify-self: stretch; border: 2px solid #e0cfcb; border-left: 0; border-radius: 0 14px 14px 0; margin: 15px 0; }
  .fn-turn.left { border-left: 2px solid #e0cfcb; border-right: 0; border-radius: 14px 0 0 14px; }
  .fn-snake-close { font: 9px Arial; color: #b06b63; padding: 4px 0 0 4px; }
  /* the left column scrolls; its sections keep their height (no squeezing) */
  .fn-left > * { flex-shrink: 0; }
  /* black floating tooltip (body-portaled by the tipHost action) */
  :global(.floating-tip) { position: fixed; z-index: 2000; background: #000; color: #fff; padding: 4px 8px; border-radius: 3px; font: 500 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; max-width: 320px; width: max-content; white-space: pre-line; box-shadow: 0 2px 6px rgba(0,0,0,0.35); pointer-events: none; }
  /* preview — fills the right column (capped to popup viewport); shape ~90% */
  .fn-prev { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 4px; }
  .fn-svg { flex: 1; width: 100%; min-height: 120px; max-height: 320px; min-width: 0; border: 1px solid #ececf2; border-radius: 6px; background: #fffdfc; }
  .fn-svg.bad { background: #fff6f6; border-color: #f0caca; }
  .fn-path { fill: rgba(196,57,47,0.13); stroke: #c4392f; stroke-width: 1.4; stroke-linejoin: round; }
  .fn-axis { stroke: #d08b84; stroke-width: 1.4; stroke-dasharray: 6 4; opacity: .9; }
  .fn-err { font-size: 9px; color: #cc2222; max-height: 48px; overflow: hidden; line-height: 1.3; }
  /* Flowbite-style range/label callout (body-portaled, never clipped) */
  .fn-pop-back { position: fixed; inset: 0; z-index: 1190; background: transparent; }
  .fn-pop { position: fixed; z-index: 1200; width: 176px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 4px 18px rgba(17,24,39,.14); padding: 9px 10px; font: 11px Arial; color: #222; display: flex; flex-direction: column; gap: 5px; }
  .fn-pop::before { content: ''; position: absolute; top: -6px; right: 18px; width: 10px; height: 10px; background: #fff; border-left: 1px solid #e5e7eb; border-top: 1px solid #e5e7eb; transform: rotate(45deg); }
  .fn-pop-ttl { font: 8px Arial; text-transform: uppercase; letter-spacing: .05em; color: #9a9aa8; margin-bottom: 1px; }
  .fn-pop-ttl code { font-family: 'SF Mono', Menlo, monospace; color: #c4392f; text-transform: none; letter-spacing: 0; }
  .fn-pp-row { display: grid; grid-template-columns: 38px 1fr; align-items: center; gap: 6px; }
  .fn-pp-row span { font-size: 9px; color: #888; }
  .fn-pp-row input { font: 10px Arial; padding: 3px 6px; border: 1px solid #dcdce4; border-radius: 4px; width: 100%; min-width: 0; box-sizing: border-box; }
  .fn-pp-row input:focus { outline: none; border-color: #c4392f; }
  .fn-pp-row input.num { font-family: 'SF Mono', Menlo, monospace; text-align: right; cursor: ew-resize; background: #fdf8f7; }
</style>
