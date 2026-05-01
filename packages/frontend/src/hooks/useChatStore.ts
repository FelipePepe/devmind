import { useState, useCallback, useRef } from 'react';
import { getAccessToken } from '../lib/api.js';
import { readSSE } from '../lib/sse.js';

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface ToolEvent {
  id: string;
  name: string;
  args: string;
  result?: string;
  error?: boolean;
}

export interface ChatState {
  streamingContent: string;
  isStreaming: boolean;
  error: string | null;
  toolEvents: ToolEvent[];
}

interface UseChatStoreReturn extends ChatState {
  send: (sessionId: string, content: string) => Promise<void>;
  cancel: () => void;
  clearError: () => void;
}

export function useChatStore(onDone: () => void): UseChatStoreReturn {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const send = useCallback(
    async (sessionId: string, content: string) => {
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      setError(null);
      setStreamingContent('');
      setToolEvents([]);
      setIsStreaming(true);

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
          const body = (await response.json().catch(() => ({ error: 'Unknown error' }))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }

        let activeToolCallId: string | null = null;

        for await (const { event, data } of readSSE(response, abort.signal)) {
          if (event === 'token') {
            const { content: chunk } = JSON.parse(data) as { content: string };
            setStreamingContent((prev) => prev + chunk);
          } else if (event === 'tool_call') {
            const { name, args } = JSON.parse(data) as { name: string; args: string };
            const id = crypto.randomUUID();
            activeToolCallId = id;
            setToolEvents((prev) => [...prev, { id, name, args }]);
          } else if (event === 'tool_result') {
            const { content: result, error: isError } = JSON.parse(data) as {
              name: string;
              content: string;
              error?: boolean;
            };
            if (activeToolCallId) {
              const id = activeToolCallId;
              setToolEvents((prev) =>
                prev.map((e) =>
                  e.id === id
                    ? { ...e, result, ...(isError !== undefined ? { error: isError } : {}) }
                    : e
                )
              );
              activeToolCallId = null;
            }
          } else if (event === 'done') {
            setIsStreaming(false);
            setStreamingContent('');
            setToolEvents([]);
            onDone();
            return;
          } else if (event === 'error') {
            const { message } = JSON.parse(data) as { message: string };
            throw new Error(message);
          }
        }
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to send message');
      } finally {
        if (!abort.signal.aborted) {
          setIsStreaming(false);
        }
      }
    },
    [onDone]
  );

  return { streamingContent, isStreaming, error, toolEvents, send, cancel, clearError };
}
