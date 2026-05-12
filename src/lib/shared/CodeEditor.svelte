<script lang="ts">
  /**
   * Thin Svelte 5 wrapper around CodeMirror 6.
   *
   * Features wired here:
   *   - Line numbers + fold gutter (custom +/− pill markers).
   *   - JS/TS syntax highlighting via @codemirror/lang-javascript.
   *   - Token-coloured HighlightStyle per variant (svelte / script / default)
   *     so keyword / string / number / comment / function / type read as
   *     distinct on screen.
   *   - Undo/redo via @codemirror/commands history() + standardKeymap.
   *   - Autocomplete: identifier-from-doc plus a caller-supplied list
   *     (passed via `completions` prop — see primitives/+page.svelte for
   *     the cadtrain-specific list: manifold helpers, Manifold methods,
   *     current params/derived).
   *   - Optional Cmd/Ctrl-S keybinding that fires `onSave` with the
   *     current document. Parent decides what "save" means.
   *
   * Reactivity: when `value` or `lang` change, the editor's state is
   * rebuilt. That's cheap for the small snippets we display.
   */
  import { onMount, onDestroy } from 'svelte';
  import { EditorState, type Extension } from '@codemirror/state';
  import { EditorView, lineNumbers, highlightActiveLine, keymap } from '@codemirror/view';
  import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
  import {
    foldGutter, foldKeymap, codeFolding, indentOnInput, foldEffect,
    HighlightStyle, syntaxHighlighting,
  } from '@codemirror/language';
  import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
  import { autocompletion, completionKeymap, type CompletionContext, type Completion } from '@codemirror/autocomplete';
  import { tags as t } from '@lezer/highlight';

  let {
    value = '',
    lang = 'javascript',
    readonly = true,
    variant = 'default',
    onChange = undefined,
    onSave = undefined,
    completions = [],
    initialFold = undefined,
  }: {
    value: string;
    lang?: 'javascript' | 'typescript';
    readonly?: boolean;
    /** Visual skin. 'svelte' = light "design surface" (lavender + blue
     *  accent); 'script' = dark "machine output" (charcoal + amber);
     *  'default' = neutral. */
    variant?: 'default' | 'svelte' | 'script';
    /** Fires on every doc edit. Parent owns the latest text — pass it
     *  back through `value` if you want to round-trip, or just consume
     *  the latest value when you save. */
    onChange?: (next: string) => void;
    /** Fires when the user presses Cmd/Ctrl-S inside the editor. Gets
     *  the current full document. Parent does the actual save (and
     *  presumably runs format-on-save). When undefined, Cmd-S falls
     *  through to the browser's default (which is normally "Save Page
     *  As..." — annoying — so most callers should wire this). */
    onSave?: (current: string) => void;
    /** Caller-supplied autocompletion candidates. Merged with CM6's
     *  built-in JS keyword/snippet completion and the doc's existing
     *  identifiers. Use this for domain vocabulary: helper functions,
     *  Manifold methods, the current meta's params/derived keys, etc. */
    completions?: Completion[];
    /** Ranges to fold immediately after the editor mounts. Used by the
     *  Inspector to collapse the imports + meta blocks of a runes file. */
    initialFold?: Array<{ from: number; to: number }>;
  } = $props();

  let host: HTMLDivElement;
  let view: EditorView | null = null;

  function langExt(l: string): Extension {
    return javascript({ typescript: l === 'typescript', jsx: false });
  }

  /** Token colour palette. Keep keyword / string / number / comment /
   *  function-name / type / property visually distinct — that's the
   *  whole reason to install a HighlightStyle over CM6's defaults. */
  function highlightStyleFor(v: string): Extension {
    if (v === 'script') {
      // Dark palette tuned for the charcoal "script" background.
      return syntaxHighlighting(HighlightStyle.define([
        { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: '#ce9178' },
        { tag: [t.string, t.special(t.string)], color: '#6a9955' },
        { tag: [t.number, t.bool, t.null], color: '#b5cea8' },
        { tag: [t.lineComment, t.blockComment, t.docComment], color: '#608b4e', fontStyle: 'italic' },
        { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#dcdcaa' },
        { tag: [t.typeName, t.className], color: '#4ec9b0' },
        { tag: [t.propertyName], color: '#9cdcfe' },
        { tag: [t.variableName, t.definition(t.variableName)], color: '#d8d8d8' },
        { tag: [t.operator, t.punctuation, t.bracket], color: '#a8a8a8' },
        { tag: t.invalid, color: '#f08080', textDecoration: 'underline wavy' },
      ], { themeType: 'dark' }));
    }
    // Light palette — GitHub-ish. Used for both 'svelte' and 'default'.
    return syntaxHighlighting(HighlightStyle.define([
      { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: '#7c4dff', fontWeight: '600' },
      { tag: [t.string, t.special(t.string)], color: '#1b7c2c' },
      { tag: [t.number, t.bool, t.null], color: '#c2410c' },
      { tag: [t.lineComment, t.blockComment, t.docComment], color: '#6a737d', fontStyle: 'italic' },
      { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#1565c0', fontWeight: '500' },
      { tag: [t.typeName, t.className], color: '#ad1457' },
      { tag: [t.propertyName], color: '#00838f' },
      { tag: [t.variableName, t.definition(t.variableName)], color: '#22223b' },
      { tag: [t.operator, t.punctuation, t.bracket], color: '#525266' },
      { tag: t.invalid, color: '#cc2222', textDecoration: 'underline wavy' },
    ]));
  }

  function themeFor(v: string): Extension {
    if (v === 'svelte') {
      return EditorView.theme({
        '&': { height: '100%', fontSize: '12px', background: '#f5f3fb', color: '#22223b' },
        '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', caretColor: '#3b3b8a' },
        '.cm-gutters': { background: '#ebe7f5', borderRight: '1px solid #d8d4e8', color: '#8884a8' },
        '.cm-activeLine': { backgroundColor: 'rgba(80,90,200,0.08)' },
        '.cm-activeLineGutter': { backgroundColor: 'rgba(80,90,200,0.14)', color: '#3b3b8a' },
        '.cm-cursor': { borderLeftColor: '#3b3b8a' },
        '.cm-tooltip': { border: '1px solid #d8d4e8', background: '#fff', borderRadius: '4px', boxShadow: '0 4px 12px rgba(60,40,120,0.12)' },
        '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: '#7c4dff', color: '#fff' },
      });
    }
    if (v === 'script') {
      return EditorView.theme(
        {
          '&': { height: '100%', fontSize: '12px', background: '#1e1e22', color: '#d8d8d8' },
          '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', caretColor: '#f0a040' },
          '.cm-gutters': { background: '#26262c', borderRight: '1px solid #353540', color: '#666' },
          '.cm-activeLine': { backgroundColor: 'rgba(240,160,64,0.08)' },
          '.cm-activeLineGutter': { backgroundColor: 'rgba(240,160,64,0.18)', color: '#f0a040' },
          '.cm-cursor': { borderLeftColor: '#f0a040' },
          '.cm-lineNumbers .cm-gutterElement': { color: '#555' },
          '.cm-tooltip': { border: '1px solid #353540', background: '#26262c', color: '#d8d8d8', borderRadius: '4px' },
          '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: '#f0a040', color: '#1e1e22' },
        },
        { dark: true },
      );
    }
    return EditorView.theme({
      '&': { height: '100%', fontSize: '12px' },
      '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
      '.cm-gutters': { background: '#f3f3f7', borderRight: '1px solid #e2e2e8', color: '#888' },
      '.cm-activeLine': { backgroundColor: 'rgba(204,34,34,0.05)' },
      '.cm-activeLineGutter': { backgroundColor: 'rgba(204,34,34,0.08)', color: '#cc2222' },
    });
  }

  function foldMarker(open: boolean): HTMLElement {
    const el = document.createElement('span');
    el.className = `cm-fold-pill ${open ? 'open' : 'closed'}`;
    el.textContent = open ? '−' : '+';
    return el;
  }

  /** Live ref the completion source reads on every invocation. The
   *  parent passes a fresh `completions` array on each render (Svelte's
   *  reactivity creates a new array reference even when contents match);
   *  if we captured the array directly inside the closure we'd rebind
   *  it only when the editor state was recreated, defeating undo. By
   *  bouncing through a mutable ref, the closure stays stable and the
   *  $effect below just updates the ref's contents. */
  let liveCompletions: Completion[] = $state(completions);
  $effect(() => { liveCompletions = completions; });

  /** Custom completion source. Three context branches:
   *    1. `p.<partial>`        → param + derived keys (filter type=variable),
   *                              anchored after the dot so the completion
   *                              replaces only the partial word, not the
   *                              `p.` prefix.
   *    2. `<anything-else>.x`  → Manifold methods (filter type=method) so
   *                              chains like `bore.t<Tab>` autocomplete
   *                              to `.translate`.
   *    3. bare identifier      → everything (helpers, functions, params,
   *                              derived, methods).
   *  Reads liveCompletions lazily so prop changes don't require
   *  recreating the editor state. */
  function makeUserSource() {
    return (context: CompletionContext) => {
      if (liveCompletions.length === 0) return null;
      // 1. `p.<partial>` — params and derived
      const pDot = context.matchBefore(/\bp\.\w*/);
      if (pDot) {
        const afterDot = pDot.from + 2;
        const opts = liveCompletions.filter((c) => c.type === 'variable');
        if (opts.length === 0) return null;
        return { from: afterDot, options: opts, validFor: /^\w*$/ };
      }
      // 2. `<word>.<partial>` — Manifold chain methods
      const anyDot = context.matchBefore(/\b\w+\.\w*/);
      if (anyDot) {
        const dotIdx = anyDot.text.indexOf('.');
        const afterDot = anyDot.from + dotIdx + 1;
        const opts = liveCompletions.filter((c) => c.type === 'method');
        if (opts.length === 0) return null;
        return { from: afterDot, options: opts, validFor: /^\w*$/ };
      }
      // 3. bare identifier — full catalog
      const word = context.matchBefore(/[\w$]+/);
      if (!word || (word.from === word.to && !context.explicit)) return null;
      return { from: word.from, options: liveCompletions, validFor: /^\w*$/ };
    };
  }

  function buildExtensions(): Extension[] {
    const saveKey = onSave
      ? keymap.of([{
          key: 'Mod-s',
          preventDefault: true,
          run: (v) => { onSave?.(v.state.doc.toString()); return true; },
        }])
      : keymap.of([]);
    return [
      lineNumbers(),
      foldGutter({ markerDOM: foldMarker }),
      codeFolding(),
      history(),
      indentOnInput(),
      highlightActiveLine(),
      EditorView.lineWrapping,
      langExt(lang),
      javascriptLanguage.data.of({ autocomplete: makeUserSource() }),
      autocompletion({ activateOnTyping: true, defaultKeymap: true }),
      saveKey,
      keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap]),
      EditorState.readOnly.of(readonly),
      EditorView.editable.of(!readonly),
      EditorView.updateListener.of((u) => {
        if (!readonly && u.docChanged && onChange) {
          onChange(u.state.doc.toString());
        }
      }),
      highlightStyleFor(variant),
      themeFor(variant),
    ];
  }

  function applyInitialFold() {
    if (!view || !initialFold || initialFold.length === 0) return;
    const docLen = view.state.doc.length;
    const effects = initialFold
      .map((r) => ({ from: Math.max(0, Math.min(docLen, r.from)), to: Math.max(0, Math.min(docLen, r.to)) }))
      .filter((r) => r.to > r.from)
      .map((r) => foldEffect.of(r));
    if (effects.length > 0) view.dispatch({ effects });
  }

  onMount(() => {
    view = new EditorView({
      state: EditorState.create({ doc: value, extensions: buildExtensions() }),
      parent: host,
    });
    applyInitialFold();
  });

  onDestroy(() => {
    view?.destroy();
    view = null;
  });

  // Re-create the editor state ONLY when value / lang / readonly /
  // variant change. CRITICAL: must return early when the incoming
  // value already matches the editor's current doc — otherwise every
  // keystroke (which round-trips through the parent's sourceDraft and
  // back here as a "new" value prop) wipes the undo history.
  // `completions` is intentionally NOT tracked here; it's read live by
  // makeUserSource via liveCompletions.
  $effect(() => {
    const _v = value; const _l = lang; const _r = readonly; const _vr = variant;
    if (!view) return;
    if (view.state.doc.toString() === value) return;
    view.setState(EditorState.create({ doc: value, extensions: buildExtensions() }));
    applyInitialFold();
  });
</script>

<div class="cm-host" bind:this={host}></div>

<style>
  .cm-host {
    height: 100%;
    min-height: 200px;
    overflow: hidden;
    border: 1px solid #e2e2e8;
    border-radius: 4px;
    background: #fff;
  }
  :global(.cm-fold-pill) {
    display: inline-flex; align-items: center; justify-content: center;
    width: 13px; height: 13px;
    border-radius: 50%;
    font: bold 11px Arial;
    line-height: 1;
    color: #fff;
    background: #b8b8c0;
    cursor: pointer;
    transition: background 100ms, transform 100ms;
    user-select: none;
  }
  :global(.cm-fold-pill:hover) { background: #888; transform: scale(1.1); }
  :global(.cm-fold-pill.closed) { background: #cc2222; }
  :global(.cm-foldGutter .cm-gutterElement) {
    width: 18px; padding: 0 2px;
  }
</style>
