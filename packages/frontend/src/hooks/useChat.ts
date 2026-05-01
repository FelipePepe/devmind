import { useState, useCallback, useRef } from 'react';
import { getAccessToken } from '../lib/api.js';
import { readSSE } from '../lib/sse.js';

export interface StreamingMessage {
  id: string;
  session_id: string;
  role: 'assistant';
  content: string;
  created_at: string;
}

interface TokenEvent { content: string }
interface ToolCallEvent { name: string; args: string }
interface ToolResultEvent { name: string; content: string; error?: boolean }
interface DoneEvent { messageId: string }
interface ErrorEvent { message: string }

interface UseChatReturn {
  streamingMessage: StreamingMessage | null;
  isStreaming: boolean;
  error: string | null;
  send: (sessionId: string, content: string) => Promise<void>;
  cancel: () => void;
}

/**
 * Handles sending a message and consuming the SSE response stream.
 * @param onDone  Called when the stream completes — use to reload persisted messages.
 */
export function useChat(onDone: () => void): UseChatReturn {
  const [streamingMessage, setStreamingMessage] = useState<StreamingMessage | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (sessionId: string, content: string) => {
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      setError(null);
      setStreamingMessage(null);
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
          const body = (await response
            .json()
            .catch(() => ({ error: 'Unknown error' }))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }

        let accumulated = '';

        for await (const { event, data } of readSSE(response, abort.signal)) {
          if (event === 'token') {
            const e = JSON.parse(data) as TokenEvent;
            accumulated += e.content;
            setStreamingMessage({
              id: '__streaming__',
              session_id: sessionId,
              role: 'assistant',
              content: accumulated,
              created_at: new Date().toISOString(),
            });
          } else if (event === 'tool_call') {
            // tool_call events are informational — could surface in UI later
            void (JSON.parse(data) as ToolCallEvent);
          } else if (event === 'tool_result') {
            void (JSON.parse(data) as ToolResultEvent);
          } else if (event === 'done') {
            const e = JSON.parse(data) as DoneEvent;
            // Update the id to match the persisted message
            setStreamingMessage((prev) =>
              prev ? { ...prev, id: e.messageId } : null
            );
            setIsStreaming(false);
            onDone();
            return;
          } else if (event === 'error') {
            const e = JSON.parse(data) as ErrorEvent;
            throw new Error(e.message);
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

  return { streamingMessage, isStreaming, error, send, cancel };
}
