/**
 * Claude chat state for the authoring assistant (Svelte 5 runes).
 * Supports tool calling: Claude decides which tool to call, the browser
 * executes it locally via tools.ts, and the result is fed back for the
 * next step. Mirrors SVTC's chat.svelte.js pattern.
 */

import { dispatchToolCall, readAppState } from './tools';

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool_result';
  content: string;
  toolUseBlock?: {
    type: 'tool_use';
    id: string;
    name: string;
    input: any;
  };
  toolUseId?: string;
}

const MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku (fast)' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet (balanced)' },
  { id: 'claude-opus-4-6', label: 'Opus (best)' },
] as const;

class ChatState {
  messages = $state<ChatMessage[]>([]);
  open = $state(false);
  loading = $state(false);
  error = $state<string | null>(null);
  model = $state(MODELS[0].id);
  models = MODELS;

  toggle() {
    this.open = !this.open;
  }

  async send(userText: string) {
    if (!userText.trim() || this.loading) return;

    this.messages = [...this.messages, { role: 'user', content: userText }];
    this.loading = true;
    this.error = null;

    try {
      const apiMessages = this.messages.map((m) => {
        if (m.role === 'tool_result') {
          return {
            role: 'user' as const,
            content: [{ type: 'tool_result' as const, tool_use_id: m.toolUseId!, content: m.content }],
          };
        }
        if (m.toolUseBlock) {
          return {
            role: 'assistant' as const,
            content: [m.toolUseBlock],
          };
        }
        return { role: m.role as 'user' | 'assistant', content: m.content };
      });

      const appState = readAppState();
      let data = await this._callApi(apiMessages, appState);

      let toolSteps = 0;
      const MAX_TOOL_STEPS = 5;
      while (data.type === 'tool_use' && toolSteps < MAX_TOOL_STEPS) {
        toolSteps++;
        const toolResult = dispatchToolCall(data.toolName, data.toolInput);

        this.messages = [
          ...this.messages,
          {
            role: 'assistant',
            content: `Calling ${data.toolName}(${JSON.stringify(data.toolInput)})…`,
            toolUseBlock: {
              type: 'tool_use',
              id: data.toolUseId,
              name: data.toolName,
              input: data.toolInput,
            },
          },
          {
            role: 'tool_result',
            toolUseId: data.toolUseId,
            content: toolResult,
          },
        ];

        const updatedMessages = this.messages.map((m) => {
          if (m.role === 'tool_result') {
            return {
              role: 'user' as const,
              content: [{ type: 'tool_result' as const, tool_use_id: m.toolUseId!, content: m.content }],
            };
          }
          if (m.toolUseBlock) {
            return { role: 'assistant' as const, content: [m.toolUseBlock] };
          }
          return { role: m.role as 'user' | 'assistant', content: m.content };
        });

        data = await this._callApi(updatedMessages, readAppState());
      }

      const finalText = data.content ?? data.text ?? '';
      this.messages = [...this.messages, { role: 'assistant', content: finalText }];
    } catch (e: any) {
      this.error = e.message ?? String(e);
    } finally {
      this.loading = false;
    }
  }

  async _callApi(messages: any[], appState: string) {
    const res = await fetch('/api/author/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, appState, model: this.model }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.message || `Error ${res.status}`);
    }
    return res.json();
  }

  clear() {
    this.messages = [];
    this.error = null;
  }
}

export const authorChatStore = new ChatState();
