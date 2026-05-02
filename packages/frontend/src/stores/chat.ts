import { create } from 'zustand';
import { type ToolEvent } from '../types/index.js';
import { getAccessToken } from '../lib/api.js';
import { readSSE } from '../lib/sse.js';

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

interface ChatState {
  streamingContent: string;
  isStreaming: boolean;
  error: string | null;
  toolEvents: ToolEvent[];
  _abortController: AbortController | null;
  send: (sessionId: string, content: string, onDone: () => void) => Promise<void>;
  cancel: () => void;
  clearError: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  streamingContent: '',
  isStreaming: false,
  error: null,
  toolEvents: [],
  _abortController: null,

  cancel: () => {
    get()._abortController?.abort();
  },

  clearError: () => {
    set({ error: null });
  },

  send: async (sessionId, content, onDone) => {
    get()._abortController?.abort();
    const abort = new AbortController();
    set({ _abortController: abort, error: null, streamingContent: '', toolEvents: [], isStreaming: true });

    try {
      const token = getAccessToken();
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ sessionId, content }),
        signal: abort.signal,
        credentials: 'include',
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({ error: 'Unknown error' }))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }

      let activeToolCallId: string | null = null;

      for await (const { event, data } of readSSE(response, abort.signal)) {
        if (event === 'token') {
          const { content: chunk } = JSON.parse(data) as { content: string };
          set((s) => ({ streamingContent: s.streamingContent + chunk }));
        } else if (event === 'tool_call') {
          const { name, args } = JSON.parse(data) as { name: string; args: string };
          const id = generateId();
          activeToolCallId = id;
          set((s) => ({ toolEvents: [...s.toolEvents, { id, name, args }] }));
        } else if (event === 'tool_result') {
          const { content: result, error: isError } = JSON.parse(data) as { name: string; content: string; error?: boolean };
          if (activeToolCallId) {
            const id = activeToolCallId;
            set((s) => ({
              toolEvents: s.toolEvents.map((e) =>
                e.id === id ? { ...e, result, ...(isError !== undefined ? { error: isError } : {}) } : e
              ),
            }));
            activeToolCallId = null;
          }
        } else if (event === 'done') {
          set({ isStreaming: false, streamingContent: '', toolEvents: [] });
          onDone();
          return;
        } else if (event === 'error') {
          const { message } = JSON.parse(data) as { message: string };
          throw new Error(message);
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      set({ error: err instanceof Error ? err.message : 'Failed to send message' });
    } finally {
      if (!abort.signal.aborted) set({ isStreaming: false });
    }
  },
}));
