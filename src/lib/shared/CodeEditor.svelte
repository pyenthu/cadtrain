<script lang="ts">
  /**
   * Thin Svelte 5 wrapper around CodeMirror 6.
   *
   * Goals:
   *   - Drop in to FloatingPanel popups for read-only / lightly-editable
   *     code views (the new Script popup tabs use it for Svelte source +
   *     compiled ManifoldCAD output).
   *   - No SSR cost — CM6 mounts in onMount, never on the server.
   *   - Lang is a string so the parent doesn't pull CM imports just to
   *     pick TS vs JS; the editor swaps language extensions internally.
   *
   * Reactivity: when `value` or `lang` change, the editor's state is
   * rebuilt. That's cheap for the small snippets we display.
   */
  import { onMount, onDestroy } from 'svelte';
  import { EditorState, type Extension } from '@codemirror/state';
  import { EditorView, lineNumbers, highlightActiveLine, keymap } from '@codemirror/view';
  import { javascript } from '@codemirror/lang-javascript';
  import { foldGutter, foldKeymap, codeFolding, indentOnInput, foldEffect } from '@codemirror/language';

  let {
    value = '',
    lang = 'javascript',
    readonly = true,
    variant = 'default',
    onChange = undefined,
    initialFold = undefined,
  }: {
    value: string;
    lang?: 'javascript' | 'typescript';
    readonly?: boolean;
    /** Visual skin. 'svelte' = light "design surface" (lavender + blue
     *  accent); 'script' = dark "machine output" (charcoal + amber);
     *  'default' = neutral. Used to make the same editor read as two
     *  different roles in the Script popup tabs. */
    variant?: 'default' | 'svelte' | 'script';
    /** Fires on every doc edit. Parent owns the latest text — pass it
     *  back through `value` if you want to round-trip, or just consume
     *  the latest value passed here when you save. */
    onChange?: (next: string) => void;
    /** Ranges to fold immediately after the editor mounts. Used by the
     *  Inspector to collapse the imports + meta blocks of a runes file so
     *  the user lands inside `geom`. Each range is `{ from, to }` byte
     *  offsets into `value`. The user's subsequent manual fold/unfold
     *  state persists for the rest of the editor's lifetime — only the
     *  FIRST mount applies the defaults. */
    initialFold?: Array<{ from: number; to: number }>;
  } = $props();

  let host: HTMLDivElement;
  let view: EditorView | null = null;

  function langExt(l: string): Extension {
    return javascript({ typescript: l === 'typescript', jsx: false });
  }

  function themeFor(v: string): Extension {
    if (v === 'svelte') {
      // Svelte tab — light lavender "design surface". Blue accents
      // suggest declarative spec / authoring.
      return EditorView.theme({
        '&': { height: '100%', fontSize: '12px', background: '#f5f3fb', color: '#22223b' },
        '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', caretColor: '#3b3b8a' },
        '.cm-gutters': { background: '#ebe7f5', borderRight: '1px solid #d8d4e8', color: '#8884a8' },
        '.cm-activeLine': { backgroundColor: 'rgba(80,90,200,0.08)' },
        '.cm-activeLineGutter': { backgroundColor: 'rgba(80,90,200,0.14)', color: '#3b3b8a' },
        '.cm-cursor': { borderLeftColor: '#3b3b8a' },
      });
    }
    if (v === 'script') {
      // Script tab — charcoal "machine output". Amber accents suggest
      // generated / compiler-emitted code.
      return EditorView.theme(
        {
          '&': { height: '100%', fontSize: '12px', background: '#1e1e22', color: '#d8d8d8' },
          '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', caretColor: '#f0a040' },
          '.cm-gutters': { background: '#26262c', borderRight: '1px solid #353540', color: '#666' },
          '.cm-activeLine': { backgroundColor: 'rgba(240,160,64,0.08)' },
          '.cm-activeLineGutter': { backgroundColor: 'rgba(240,160,64,0.18)', color: '#f0a040' },
          '.cm-cursor': { borderLeftColor: '#f0a040' },
          // Soft syntax tinting against the dark background.
          '.cm-lineNumbers .cm-gutterElement': { color: '#555' },
        },
        { dark: true },
      );
    }
    // Default — kept for non-runes uses.
    return EditorView.theme({
      '&': { height: '100%', fontSize: '12px' },
      '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
      '.cm-gutters': { background: '#f3f3f7', borderRight: '1px solid #e2e2e8', color: '#888' },
      '.cm-activeLine': { backgroundColor: 'rgba(204,34,34,0.05)' },
      '.cm-activeLineGutter': { backgroundColor: 'rgba(204,34,34,0.08)', color: '#cc2222' },
    });
  }

  /** Custom rounded +/− marker for the fold gutter — sits on the left
   *  next to the line numbers. Click toggles the fold. */
  function foldMarker(open: boolean): HTMLElement {
    const el = document.createElement('span');
    el.className = `cm-fold-pill ${open ? 'open' : 'closed'}`;
    el.textContent = open ? '−' : '+';
    return el;
  }

  function buildExtensions(): Extension[] {
    return [
      lineNumbers(),
      foldGutter({
        markerDOM: foldMarker,
      }),
      codeFolding(),
      indentOnInput(),
      highlightActiveLine(),
      langExt(lang),
      keymap.of(foldKeymap),
      EditorState.readOnly.of(readonly),
      EditorView.editable.of(!readonly),
      // Bubble doc edits to the parent. Skipped for read-only editors so
      // we don't fire spurious updates from upstream value changes.
      EditorView.updateListener.of((u) => {
        if (!readonly && u.docChanged && onChange) {
          onChange(u.state.doc.toString());
        }
      }),
      themeFor(variant),
    ];
  }

  /** Dispatch foldEffect transactions for each range in `initialFold`.
   *  Clamped to [0, docLength] so a stale range from a shorter previous
   *  doc won't throw. Idempotent at the editor's lifecycle boundary —
   *  later doc edits don't re-apply the defaults. */
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

  // Re-create the editor state when value or lang change — simpler and
  // safer than diffing dispatched transactions for the small snippets we
  // render here. Skips when the incoming value matches the editor's
  // current doc (avoids a feedback loop when the parent binds value back
  // through onChange).
  $effect(() => {
    const _v = value; const _l = lang; const _r = readonly; const _vr = variant;
    if (!view) return;
    if (view.state.doc.toString() === value) return;
    view.setState(EditorState.create({ doc: value, extensions: buildExtensions() }));
    // Re-apply default folds when the doc text changes (e.g. switching
    // between runes tabs). A `setState` resets all fold state, so without
    // this the imports + meta would pop open after every tab switch.
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
  /* Rounded +/− pill for the code-fold markers in the gutter — sits to
     the left of the line numbers. Different palette per editor variant
     (light = lavender for Svelte, amber for Script). */
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
  /* Variant tints — picked up via the cm-host's parent theme. CodeMirror
     puts the foldgutter markers inside .cm-foldGutter; we tint them via
     the theme rules below. */
  :global(.cm-foldGutter .cm-gutterElement) {
    width: 18px; padding: 0 2px;
  }
</style>
