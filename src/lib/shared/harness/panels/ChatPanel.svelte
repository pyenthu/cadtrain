<script lang="ts">
  // The chat panel — the AI-build surface. Sends the prompt to the harness's onBuild
  // (→ /api/app/build), which builds the .app's GUI via verbs and returns the updated
  // manifest. The rendered app then reflects what the AI built.
  import type { Panel } from '$lib/appkit/manifest/types';
  let { panel, onBuild }: { panel: Panel; onBuild?: (prompt: string) => Promise<void> } = $props();

  let prompt = $state('');
  let busy = $state(false);
  let log = $state<Array<{ role: 'you' | 'ai' | 'err'; text: string }>>([]);

  async function send() {
    const p = prompt.trim();
    if (!p || busy || !onBuild) return;
    prompt = '';
    log = [...log, { role: 'you', text: p }];
    busy = true;
    try {
      await onBuild(p);
      log = [...log, { role: 'ai', text: 'built ✓' }];
    } catch (e) {
      log = [...log, { role: 'err', text: String(e) }];
    } finally {
      busy = false;
    }
  }
</script>

<div class="chat">
  <div class="log">
    {#if !log.length}<div class="hint">Describe the app — the AI builds the panels via verbs.</div>{/if}
    {#each log as m}<div class="msg {m.role}">{m.text}</div>{/each}
    {#if busy}<div class="msg ai">building…</div>{/if}
  </div>
  <div class="row">
    <input
      bind:value={prompt}
      placeholder="build me a…"
      disabled={busy || !onBuild}
      onkeydown={(e) => e.key === 'Enter' && send()}
    />
    <button onclick={() => send()} disabled={busy || !onBuild || !prompt.trim()}>Send</button>
  </div>
  {#if !onBuild}<div class="hint">(AI build not wired on this surface)</div>{/if}
</div>

<style>
  .chat { display: flex; flex-direction: column; height: 100%; min-height: 200px; gap: 8px; }
  .log { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 5px; }
  .hint { color: #94a3b8; font-size: 12px; font-style: italic; }
  .msg { padding: 5px 8px; border-radius: 6px; font-size: 12px; max-width: 90%; }
  .msg.you { align-self: flex-end; background: #0c4a6e; color: #fff; }
  .msg.ai { align-self: flex-start; background: #f1f5f9; color: #0f172a; }
  .msg.err { align-self: flex-start; background: #fef2f2; color: #b91c1c; }
  .row { display: flex; gap: 6px; }
  .row input { flex: 1; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 6px; font: 13px system-ui; }
  .row button { padding: 6px 12px; border: 1px solid #0369a1; border-radius: 6px; background: #0369a1; color: #fff; font: 600 12px system-ui; cursor: pointer; }
  .row button:disabled { opacity: .5; cursor: default; }
</style>
