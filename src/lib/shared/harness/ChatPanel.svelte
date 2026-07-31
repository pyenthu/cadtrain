<script lang="ts">
  // ChatPanel — the SVTC-style floating AI build surface (#41). A launcher FAB → a chat panel
  // with a THREE-WAY model toggle: Claude CLI (subscription) · Claude API (metered) · Phi
  // (in-browser WebLLM, free/offline). Each send is a whole-app build request; the parent's
  // `onBuild(prompt, provider)` routes it (server for cli/cloud, client WebGPU for phi).
  // "The prompt is the programming language."
  type Provider = 'cli' | 'cloud' | 'phi';
  let {
    onBuild,
    onReport,
  }: {
    onBuild: (prompt: string, provider: Provider) => Promise<{ ok: boolean; steps?: number; error?: string }>;
    /** Report a build as a non-conformance (the ⚠ "needs work" signal → ai/app-rag/non-conformances). */
    onReport?: (prompt: string, note: string) => Promise<{ ok: boolean }>;
  } = $props();

  type Msg = { role: 'user' | 'assistant'; text: string; err?: boolean; prompt?: string; reported?: boolean };
  let open = $state(false);
  let provider = $state<Provider>('cloud');
  let input = $state('');
  let busy = $state(false);
  let messages = $state<Msg[]>([]);
  // The "needs work" note field (which message is being reported + its draft note).
  let reportIdx = $state<number | null>(null);
  let reportNote = $state('');

  const MODELS: Array<{ id: Provider; label: string; hint: string }> = [
    { id: 'cli', label: 'Claude CLI', hint: 'dev · bills your Max subscription (no API tokens)' },
    { id: 'cloud', label: 'Claude API', hint: 'metered ANTHROPIC_API_KEY' },
    { id: 'phi', label: 'Phi', hint: 'in-browser (WebGPU) · free · offline · ~2.4 GB one-time download' },
  ];

  async function send() {
    const p = input.trim();
    if (!p || busy) return;
    input = '';
    messages = [...messages, { role: 'user', text: p }];
    busy = true;
    try {
      const r = await onBuild(p, provider);
      messages = [
        ...messages,
        r.ok
          ? { role: 'assistant', text: `✓ built — ${r.steps ?? '?'} step${r.steps === 1 ? '' : 's'}`, prompt: p }
          : { role: 'assistant', text: `⚠ ${r.error ?? 'build failed'}`, err: true, prompt: p },
      ];
    } catch (e) {
      messages = [...messages, { role: 'assistant', text: `⚠ ${String(e)}`, err: true, prompt: p }];
    } finally {
      busy = false;
    }
  }

  /** SVTC-style "needs work": record this build's prompt as a non-conformance (with an optional
   *  note) → ai/app-rag/non-conformances for a developer to fix a rule-card / author a corrected
   *  golden. The prompt stays in the thread; it never grounds the model (negative signal only). */
  async function submitReport(i: number) {
    const m = messages[i];
    if (!m?.prompt || !onReport) { reportIdx = null; return; }
    const note = reportNote.trim() || 'needs work';
    try {
      await onReport(m.prompt, note);
      messages = messages.map((x, j) => (j === i ? { ...x, reported: true } : x));
    } catch {
      /* best-effort — leave the button so they can retry */
    }
    reportIdx = null;
    reportNote = '';
  }
</script>

{#if !open}
  <button class="fab" onclick={() => (open = true)} title="Build with AI (chat)">💬</button>
{:else}
  <div class="chat">
    <div class="head">
      <span class="ic">💬</span>
      <div class="models">
        {#each MODELS as m (m.id)}
          <button class:on={provider === m.id} onclick={() => (provider = m.id)} title={m.hint}>{m.label}</button>
        {/each}
      </div>
      <button class="x" onclick={() => (open = false)} title="close">✕</button>
    </div>
    <div class="thread">
      {#if !messages.length}
        <div class="hint">Describe the app or a change — the prompt is the program. Pick a model above; <b>Phi</b> runs in your browser (free, offline).</div>
      {/if}
      {#each messages as m, i (i)}
        <div class="msg {m.role}" class:err={m.err}>{m.text}</div>
        {#if m.role === 'assistant' && m.prompt && onReport}
          <div class="rep-wrap">
            {#if m.reported}
              <span class="rep done">✓ recorded — thanks</span>
            {:else if reportIdx === i}
              <input
                class="rep-in"
                placeholder="what needs work? (optional)"
                bind:value={reportNote}
                onkeydown={(e) => { if (e.key === 'Enter') submitReport(i); if (e.key === 'Escape') reportIdx = null; }}
              />
              <button class="rep-go" onclick={() => submitReport(i)}>record</button>
              <button class="rep-x" onclick={() => (reportIdx = null)} title="cancel">✕</button>
            {:else}
              <button class="rep" onclick={() => { reportIdx = i; reportNote = ''; }} title="record this prompt as a non-conformance for the developers to fix">🔧 needs work</button>
            {/if}
          </div>
        {/if}
      {/each}
      {#if busy}<div class="msg assistant busy">building…</div>{/if}
    </div>
    <form class="compose" onsubmit={(e) => { e.preventDefault(); send(); }}>
      <input bind:value={input} placeholder="e.g. add a casings table with od / id / top / bot columns" disabled={busy} />
      <button type="submit" disabled={busy || !input.trim()}>Send</button>
    </form>
  </div>
{/if}

<style>
  .fab { position: fixed; right: 22px; bottom: 22px; z-index: 60; width: 52px; height: 52px; border-radius: 50%; border: 0; background: #0369a1; color: #fff; font-size: 22px; cursor: pointer; box-shadow: 0 8px 24px rgba(2, 6, 23, .3); }
  .fab:hover { filter: brightness(1.08); }
  .chat { position: fixed; right: 22px; bottom: 22px; z-index: 60; width: 380px; max-width: calc(100vw - 44px); height: 480px; max-height: calc(100vh - 44px); display: flex; flex-direction: column; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; box-shadow: 0 20px 50px rgba(2, 6, 23, .28); overflow: hidden; font: 13px system-ui, Arial, sans-serif; color: #0f172a; }
  .head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #0f172a; color: #e2e8f0; }
  .head .ic { font-size: 15px; }
  .models { flex: 1; display: flex; gap: 3px; }
  .models button { padding: 3px 8px; border: 1px solid #334155; border-radius: 6px; background: transparent; color: #cbd5e1; font: 600 10.5px system-ui; cursor: pointer; }
  .models button:hover { background: #1e293b; }
  .models button.on { background: #0369a1; border-color: #0369a1; color: #fff; }
  .head .x { border: 0; background: transparent; color: #94a3b8; cursor: pointer; font-size: 13px; }
  .thread { flex: 1; min-height: 0; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .hint { color: #64748b; font-size: 12.5px; line-height: 1.5; text-align: center; margin: auto 8px; }
  .msg { max-width: 85%; padding: 7px 11px; border-radius: 12px; font-size: 12.5px; line-height: 1.4; }
  .msg.user { align-self: flex-end; background: #0369a1; color: #fff; border-bottom-right-radius: 4px; }
  .msg.assistant { align-self: flex-start; background: #f1f5f9; color: #0f172a; border-bottom-left-radius: 4px; }
  .msg.assistant.err { background: #fef2f2; color: #b91c1c; }
  .msg.busy { color: #64748b; font-style: italic; }
  .rep-wrap { align-self: flex-start; display: flex; align-items: center; gap: 5px; margin: -3px 0 2px 2px; }
  .rep { border: 0; background: transparent; color: #94a3b8; font: 500 11px system-ui; cursor: pointer; padding: 1px 3px; }
  .rep:hover { color: #b45309; }
  .rep.done { color: #16a34a; font-size: 11px; }
  .rep-in { padding: 3px 7px; border: 1px solid #fcd34d; border-radius: 6px; font: 11px system-ui; width: 150px; }
  .rep-in:focus { outline: none; border-color: #d97706; }
  .rep-go { padding: 3px 8px; border: 1px solid #d97706; border-radius: 6px; background: #fffbeb; color: #b45309; font: 600 11px system-ui; cursor: pointer; }
  .rep-x { border: 0; background: transparent; color: #94a3b8; cursor: pointer; font-size: 11px; }
  .compose { display: flex; gap: 7px; padding: 10px; border-top: 1px solid #eef2f6; }
  .compose input { flex: 1; min-width: 0; padding: 8px 11px; border: 1px solid #cbd5e1; border-radius: 8px; font: 13px system-ui; }
  .compose input:focus { outline: none; border-color: #0369a1; box-shadow: 0 0 0 3px rgba(3, 105, 161, .12); }
  .compose button { padding: 8px 16px; border: 0; border-radius: 8px; background: #0369a1; color: #fff; font: 600 13px system-ui; cursor: pointer; }
  .compose button:disabled { opacity: .5; cursor: default; }
</style>
