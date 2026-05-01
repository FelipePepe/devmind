export interface SSEEvent {
  event: string;
  data: string;
}

/**
 * Reads a server-sent events stream from a fetch Response.
 * Use this instead of EventSource when you need POST + auth headers.
 */
export async function* readSSE(
  response: Response,
  signal?: AbortSignal
): AsyncGenerator<SSEEvent> {
  if (!response.body) throw new Error('Response has no body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      if (signal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });

      // SSE messages are separated by double newline
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        let event = 'message';
        let data = '';

        for (const line of trimmed.split('\n')) {
          if (line.startsWith('event:')) {
            event = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            data = line.slice(5).trim();
          }
        }

        yield { event, data };
      }
    }
  } finally {
    reader.releaseLock();
  }
}
