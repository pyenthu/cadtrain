<!--
  ExpressionSrcPane.svelte — the raw SRC textarea (multi-line, plain textarea —
  NO CodeMirror/Monaco dep). Per cadtrain convention the value commits on
  blur / Enter elsewhere, but the live block tree wants to update as you type, so
  we bind the source and push it up on input. Ctrl/Cmd+Enter is reserved by the
  popup for commit.

  Type-as-you-go AUTOCOMPLETE (Monaco/n8n-style, hand-rolled): as you type, the
  current token (a run of `[A-Za-z0-9_.]` ending at the caret) is matched against
  the `completions` corpus (passed as a prop — the part's p.*/e.* inputs plus the
  allowlisted functions + constants). A dropdown shows the matches:
    • ↑/↓  move the selection
    • Tab / Enter  accept (replace the token; Ctrl/Cmd+Enter still commits)
    • Esc  dismiss the dropdown (without closing the popup)
    • click  accept
  Caret is read via `selectionStart`; after an insert it is restored in a
  `queueMicrotask` (the textarea value re-renders first).
-->
<script module lang="ts">
  export type Completion = { text: string; kind: 'param' | 'expr' | 'fn' | 'const' };
</script>

<script lang="ts">
  let {
    src = $bindable(),
    completions = [],
  }: { src: string; completions?: Completion[] } = $props();

  let ta: HTMLTextAreaElement | undefined;
  let caret = $state(0);
  let dismissed = $state(false);
  let sel = $state(0);

  const TOKEN_RE = /[A-Za-z0-9_.]/;
  const MAX_SUGGESTIONS = 10;

  // ── current token (the run of identifier chars ending at the caret) ──────────
  let tok = $derived.by(() => {
    const value = src ?? '';
    const end = Math.min(caret, value.length);
    let start = end;
    while (start > 0 && TOKEN_RE.test(value[start - 1])) start--;
    return { start, end, text: value.slice(start, end) };
  });

  // ── matches: prefix-match (case-insensitive), exact full hits excluded ───────
  let matches = $derived.by<Completion[]>(() => {
    if (dismissed) return [];
    const t = tok.text.toLowerCase();
    if (t.length < 1) return [];
    const out: Completion[] = [];
    for (const c of completions) {
      const lt = c.text.toLowerCase();
      if (lt.startsWith(t) && lt !== t) out.push(c);
      if (out.length >= MAX_SUGGESTIONS) break;
    }
    return out;
  });
  let open = $derived(matches.length > 0);

  // keep the selection in range as matches change
  $effect(() => {
    if (sel >= matches.length) sel = 0;
  });

  function syncCaret() {
    caret = ta?.selectionStart ?? 0;
  }

  function onInput() {
    dismissed = false;
    syncCaret();
  }

  function accept(m: Completion) {
    const value = src ?? '';
    const before = value.slice(0, tok.start) + m.text;
    src = before + value.slice(tok.end);
    const pos = before.length;
    dismissed = true;
    queueMicrotask(() => {
      if (!ta) return;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = pos;
      caret = pos;
    });
  }

  function onKeydown(ev: KeyboardEvent) {
    if (!open) return;
    switch (ev.key) {
      case 'ArrowDown':
        ev.preventDefault();
        sel = (sel + 1) % matches.length;
        break;
      case 'ArrowUp':
        ev.preventDefault();
        sel = (sel - 1 + matches.length) % matches.length;
        break;
      case 'Enter':
      case 'Tab':
        // Ctrl/Cmd+Enter is the popup's COMMIT chord — let it bubble.
        if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) return;
        ev.preventDefault();
        accept(matches[sel]);
        break;
      case 'Escape':
        // dismiss the dropdown only — don't let the popup's window-Esc fire.
        ev.preventDefault();
        ev.stopPropagation();
        dismissed = true;
        break;
    }
  }
</script>

<div class="ge-expr-src">
  <label class="ge-expr-src-label" for="ge-expr-src-ta">SRC</label>
  <div class="ge-expr-src-wrap">
    <textarea
      bind:this={ta}
      id="ge-expr-src-ta"
      class="ge-expr-src-ta"
      spellcheck="false"
      autocomplete="off"
      rows="6"
      bind:value={src}
      oninput={onInput}
      onkeyup={syncCaret}
      onclick={syncCaret}
      onkeydown={onKeydown}
      placeholder="max((p.od - p.id) / 2, 0)"></textarea>

    {#if open}
      <ul class="ge-expr-ac" role="listbox">
        {#each matches as m, i (m.kind + ':' + m.text)}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
          <li
            class="ge-expr-ac-item"
            class:sel={i === sel}
            role="option"
            aria-selected={i === sel}
            onmousedown={(e) => { e.preventDefault(); accept(m); }}
            onmouseenter={() => (sel = i)}>
            <span class="ge-expr-ac-text">{m.text}</span>
            <span class="ge-expr-ac-kind {m.kind}">{m.kind}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .ge-expr-src { display: flex; flex-direction: column; gap: 3px; }
  .ge-expr-src-label { font: 600 10px Arial; letter-spacing: 0.05em; color: #6b7280; }
  .ge-expr-src-wrap { position: relative; }
  .ge-expr-src-ta {
    width: 100%; box-sizing: border-box; resize: vertical; display: block;
    font: 12px ui-monospace, monospace; color: #111827; line-height: 1.45;
    padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px;
    background: #f9fafb;
  }
  .ge-expr-src-ta:focus { outline: 2px solid #93c5fd; outline-offset: -1px; background: #fff; }

  .ge-expr-ac {
    position: absolute; left: 0; right: 0; top: calc(100% + 2px);
    margin: 0; padding: 3px; list-style: none; z-index: 10;
    max-height: 168px; overflow-y: auto;
    background: #fff; border: 1px solid #cbd5e1; border-radius: 6px;
    box-shadow: 0 8px 20px rgba(15, 23, 42, 0.18);
  }
  .ge-expr-ac-item {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 3px 7px; border-radius: 4px; cursor: pointer;
  }
  .ge-expr-ac-item.sel { background: #eff6ff; }
  .ge-expr-ac-text { font: 600 12px ui-monospace, monospace; color: #111827; }
  .ge-expr-ac-kind {
    font: 600 9px Arial; letter-spacing: 0.04em; text-transform: uppercase;
    padding: 0 4px; border-radius: 3px;
  }
  .ge-expr-ac-kind.param { color: #166534; background: #dcfce7; }
  .ge-expr-ac-kind.expr { color: #6b21a8; background: #f3e8ff; }
  .ge-expr-ac-kind.fn { color: #1d4ed8; background: #eff6ff; }
  .ge-expr-ac-kind.const { color: #9a3412; background: #ffedd5; }
</style>
