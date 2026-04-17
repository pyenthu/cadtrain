<script lang="ts">
  import { authorChatStore } from './chat.svelte.ts';

  let inputText = $state('');
  let messagesEl = $state<HTMLDivElement | null>(null);

  async function handleSend() {
    const text = inputText.trim();
    if (!text || authorChatStore.loading) return;
    inputText = '';
    await authorChatStore.send(text);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  $effect(() => {
    if (messagesEl && authorChatStore.messages.length) {
      setTimeout(() => {
        if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
      }, 30);
    }
  });
</script>

<!-- Floating toggle button — bottom-right -->
<button
  class="toggle-btn"
  onclick={() => authorChatStore.toggle()}
  title="AI Assistant"
  aria-label="Toggle AI assistant"
>
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
</button>

{#if authorChatStore.open}
  <div class="chat-panel">
    <!-- Header -->
    <div class="header">
      <div class="header-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span class="title">Author AI</span>
        <select class="model-select" bind:value={authorChatStore.model}>
          {#each authorChatStore.models as m}
            <option value={m.id}>{m.label}</option>
          {/each}
        </select>
      </div>
      <div class="header-right">
        {#if authorChatStore.messages.length > 0}
          <button class="hdr-btn" onclick={() => authorChatStore.clear()} title="Clear conversation">Clear</button>
        {/if}
        <button class="hdr-btn close" onclick={() => authorChatStore.toggle()} aria-label="Close">✕</button>
      </div>
    </div>

    <!-- Messages -->
    <div class="messages" bind:this={messagesEl}>
      {#if authorChatStore.messages.length === 0}
        <p class="placeholder">
          Describe what to build — e.g. "create a hollow cylinder with OD 3 and add a threaded pin below it"
        </p>
      {/if}

      {#each authorChatStore.messages as msg}
        {#if msg.role === 'user'}
          <div class="msg-row user">
            <div class="bubble user-bubble">{msg.content}</div>
          </div>
        {:else if msg.role === 'tool_result'}
          <!-- tool results are shown inline with the assistant tool-call message -->
        {:else}
          <div class="msg-row assistant">
            <div class="bubble assistant-bubble">
              {#if msg.toolUseBlock}
                <span class="tool-call">⚡ {msg.toolUseBlock.name}</span>
              {:else}
                {msg.content}
              {/if}
            </div>
          </div>
        {/if}
      {/each}

      {#if authorChatStore.loading}
        <div class="msg-row assistant">
          <div class="bubble assistant-bubble loading-dots">
            <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          </div>
        </div>
      {/if}

      {#if authorChatStore.error}
        <div class="error-msg">{authorChatStore.error}</div>
      {/if}
    </div>

    <!-- Input -->
    <div class="input-bar">
      <textarea
        bind:value={inputText}
        onkeydown={handleKeydown}
        placeholder="Describe what to build or modify…"
        rows="1"
      ></textarea>
      <button
        class="send-btn"
        onclick={handleSend}
        disabled={authorChatStore.loading || !inputText.trim()}
      >Send</button>
    </div>
  </div>
{/if}

<style>
  .toggle-btn {
    position: fixed;
    bottom: 14px;
    right: 14px;
    z-index: 50;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: #cc2222;
    color: white;
    border: none;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s;
  }
  .toggle-btn:hover { background: #a51818; }

  .chat-panel {
    position: fixed;
    bottom: 60px;
    right: 14px;
    z-index: 50;
    display: flex;
    flex-direction: column;
    width: min(24rem, calc(100vw - 1.75rem));
    height: 480px;
    border-radius: 12px;
    border: 1px solid #444;
    background: #1a1a1a;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    overflow: hidden;
    font-family: Arial, sans-serif;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: #cc2222;
    flex-shrink: 0;
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 6px;
    color: white;
  }
  .title { font: bold 12px Arial; }
  .model-select {
    font: 10px Arial;
    background: rgba(255,255,255,0.15);
    color: white;
    border: 1px solid rgba(255,255,255,0.3);
    border-radius: 3px;
    padding: 2px 4px;
    cursor: pointer;
  }
  .model-select option { background: #333; color: white; }
  .header-right { display: flex; align-items: center; gap: 4px; }
  .hdr-btn {
    color: rgba(255,255,255,0.7);
    background: none;
    border: none;
    font: 11px Arial;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 3px;
    transition: all 0.15s;
  }
  .hdr-btn:hover { color: white; background: rgba(255,255,255,0.1); }
  .hdr-btn.close { font-size: 14px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; padding: 0; }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: #111;
  }
  .placeholder {
    color: #555;
    text-align: center;
    font-size: 11px;
    padding: 40px 16px;
    line-height: 1.6;
  }

  .msg-row { display: flex; }
  .msg-row.user { justify-content: flex-end; }
  .msg-row.assistant { justify-content: flex-start; }

  .bubble {
    max-width: 85%;
    padding: 6px 10px;
    border-radius: 12px;
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .user-bubble {
    background: #cc2222;
    color: white;
    border-bottom-right-radius: 4px;
  }
  .assistant-bubble {
    background: #2a2a2a;
    color: #ddd;
    border: 1px solid #333;
    border-bottom-left-radius: 4px;
  }

  .tool-call {
    font: 10px monospace;
    color: #f0c040;
    display: block;
  }

  .loading-dots { display: flex; gap: 4px; padding: 8px 12px; }
  .dot {
    width: 6px;
    height: 6px;
    background: #666;
    border-radius: 50%;
    animation: bounce 1s infinite;
  }
  .dot:nth-child(2) { animation-delay: 150ms; }
  .dot:nth-child(3) { animation-delay: 300ms; }
  @keyframes bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
  }

  .error-msg {
    text-align: center;
    color: #ff6b6b;
    font-size: 10px;
    padding: 4px 8px;
    background: rgba(255,0,0,0.1);
    border-radius: 6px;
    border: 1px solid rgba(255,0,0,0.2);
  }

  .input-bar {
    display: flex;
    gap: 6px;
    padding: 8px;
    border-top: 1px solid #333;
    background: #1a1a1a;
    flex-shrink: 0;
  }
  .input-bar textarea {
    flex: 1;
    resize: none;
    border: 1px solid #444;
    border-radius: 8px;
    padding: 6px 10px;
    font: 11px Arial;
    background: #222;
    color: #ddd;
    max-height: 72px;
    overflow-y: auto;
    outline: none;
    font-family: Arial, sans-serif;
  }
  .input-bar textarea:focus { border-color: #cc2222; }
  .send-btn {
    background: #cc2222;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 6px 12px;
    font: bold 11px Arial;
    cursor: pointer;
    flex-shrink: 0;
    transition: opacity 0.15s;
  }
  .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .send-btn:hover:not(:disabled) { background: #a51818; }
</style>
