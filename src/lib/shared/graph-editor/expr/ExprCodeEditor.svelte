<!--
  ExprCodeEditor.svelte — CodeMirror 6 editor for the imperative loop DSL.
  Drop-in for ExpressionSrcPane (same src/completions/placeholder props) but with
  syntax highlighting (for/to/return · .append · cos/sin/… · numbers · tau/pi),
  bracket matching, real autocomplete, and LINE WRAPPING (long appends wrap
  visually — no hand-wrapping needed). CM is lazy-loaded (dynamic import) so it
  doesn't weigh on the main chunk. Enter inserts a newline (CM default); the
  editable is a contenteditable DIV, so GraphEditorPane's window Enter→re-bake
  (INPUT/TEXTAREA only) never fires here. Changes call onInput (the loop's dirty
  mark); blur bubbles focusout to the body wrapper (the ✓ tick / commit).
-->
<script module lang="ts">
  export type Completion = { text: string; kind: 'param' | 'expr' | 'fn' | 'const' };
</script>

<script lang="ts">
  import { onMount } from 'svelte';

  let { src = $bindable(), completions = [], placeholder = '', rows = 3, onInput }:
    { src: string; completions?: Completion[]; placeholder?: string; rows?: number; onInput?: () => void } = $props();

  let host: HTMLDivElement;
  let view: any = null;
  let fromProp = false; // guard: doc edits we pushed in (don't echo back to src)

  onMount(() => {
    let dead = false;
    (async () => {
      const [V, S, C, A, L, H] = await Promise.all([
        import('@codemirror/view'),
        import('@codemirror/state'),
        import('@codemirror/commands'),
        import('@codemirror/autocomplete'),
        import('@codemirror/language'),
        import('@lezer/highlight'),
      ]);
      if (dead || !host) return;
      const { EditorView, keymap, placeholder: cmPlaceholder } = V;
      const { EditorState } = S;
      const { defaultKeymap, history, historyKeymap, indentWithTab } = C;
      const { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } = A;
      const { StreamLanguage, HighlightStyle, syntaxHighlighting, bracketMatching } = L;
      const t = H.tags;

      // ── a tiny stream language for the loop DSL ──────────────────────────────
      const FN = /^(cos|sin|tan|sqrt|abs|min|max|pow|atan2|atan|asin|acos|floor|ceil|round|exp|log|hypot|sign|mod)\b/;
      const dslLang = StreamLanguage.define({
        name: 'cadexpr',
        token(stream: any) {
          if (stream.eatSpace()) return null;
          if (stream.match(/^(for|to|return)\b/)) return 'keyword';
          if (stream.match(/^\.append\b/)) return 'keyword';
          if (stream.match(FN)) return 'fn';
          if (stream.match(/^(tau|pi|e)\b/)) return 'atom';
          if (stream.match(/^\d+\.?\d*/)) return 'number';
          if (stream.match(/^[A-Za-z_]\w*/)) return 'name';
          stream.next();
          return null;
        },
        tokenTable: {
          keyword: t.keyword, fn: t.function(t.variableName),
          atom: t.atom, number: t.number, name: t.variableName,
        },
      });
      const dslHi = HighlightStyle.define([
        { tag: t.keyword, color: '#7c3aed', fontWeight: '700' },
        { tag: t.function(t.variableName), color: '#1d4ed8' },
        { tag: t.atom, color: '#9a3412', fontWeight: '600' },
        { tag: t.number, color: '#0891b2' },
        { tag: t.variableName, color: '#111827' },
      ]);

      // ── autocomplete from the `completions` prop (read fresh each time) ───────
      const acSource = (ctx: any) => {
        const word = ctx.matchBefore(/[A-Za-z_]\w*/);
        if (!word || (word.from === word.to && !ctx.explicit)) return null;
        return {
          from: word.from,
          options: completions.map((c) => ({
            label: c.text,
            type: c.kind === 'fn' ? 'function' : c.kind === 'const' ? 'constant' : 'variable',
          })),
        };
      };

      const theme = EditorView.theme({
        '&': { fontSize: '12px', background: '#f9fafb', border: '1px solid #d1d5db', borderRadius: '6px' },
        '&.cm-focused': { outline: '2px solid #93c5fd', outlineOffset: '-1px', background: '#fff' },
        '.cm-content': { fontFamily: 'ui-monospace, monospace', padding: '5px 7px', minHeight: `${Math.max(2, rows) * 1.5}em`, caretColor: '#111' },
        '.cm-line': { padding: '0 2px', lineHeight: '1.5' },
        '.cm-cursor': { borderLeftColor: '#111' },
        '&.cm-editor': { maxHeight: '320px' },
        '.cm-scroller': { overflow: 'auto' },
      });

      const state = EditorState.create({
        doc: src ?? '',
        extensions: [
          history(), bracketMatching(), closeBrackets(),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
          dslLang, syntaxHighlighting(dslHi),
          autocompletion({ override: [acSource] }),
          EditorView.lineWrapping,
          cmPlaceholder(placeholder),
          theme,
          EditorView.updateListener.of((u: any) => {
            if (u.docChanged && !fromProp) { src = u.state.doc.toString(); onInput?.(); }
          }),
        ],
      });
      view = new EditorView({ state, parent: host });
    })();
    return () => { dead = true; view?.destroy(); view = null; };
  });

  // external src changes (parse → prog → body) push into the editor
  $effect(() => {
    const s = src ?? '';
    if (view && s !== view.state.doc.toString()) {
      fromProp = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: s } });
      fromProp = false;
    }
  });
</script>

<div class="ge-cm" bind:this={host}></div>

<style>
  .ge-cm { width: 100%; min-width: 0; }
</style>
