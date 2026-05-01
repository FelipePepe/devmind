import { config } from '../config.js';
import type {
  ChatParams,
  ChatResponse,
  ChatStreamParams,
  ChatChunk,
  OllamaMessage,
  OllamaToolCall,
} from './types.js';

interface OllamaRawChunk {
  model: string;
  message: OllamaMessage & { tool_calls?: OllamaToolCall[] };
  done: boolean;
  done_reason?: string;
}

interface OllamaEmbedResponse {
  embeddings: number[][];
}

export class OllamaClient {
  constructor(private baseUrl = config.OLLAMA_BASE_URL) {}

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/version`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, stream: false }),
    });
    if (!res.ok) {
      throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as OllamaRawChunk;
    return {
      message: data.message,
      finish_reason: (data.done_reason as ChatResponse['finish_reason']) ?? 'stop',
    };
  }

  async *chatStream(
    params: ChatStreamParams,
    signal?: AbortSignal
  ): AsyncGenerator<ChatChunk> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, stream: true }),
      signal: signal ?? null,
    });

    if (!res.ok) {
      throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
    }
    if (!res.body) throw new Error('Ollama returned no response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let chunk: OllamaRawChunk;
          try {
            chunk = JSON.parse(trimmed) as OllamaRawChunk;
          } catch {
            continue;
          }

          if (!chunk.done) {
            const toolCalls = chunk.message.tool_calls;
            if (toolCalls?.length) {
              for (const tc of toolCalls) {
                yield { type: 'tool_call', tool_call: tc };
              }
            } else if (chunk.message.content) {
              yield { type: 'text', content: chunk.message.content };
            }
          } else {
            // Final chunk — may contain tool_calls
            const toolCalls = chunk.message.tool_calls;
            if (toolCalls?.length) {
              for (const tc of toolCalls) {
                yield { type: 'tool_call', tool_call: tc };
              }
            }
            yield {
              type: 'done',
              finish_reason: (chunk.done_reason as ChatChunk['finish_reason']) ?? 'stop',
            };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async embed(model: string, texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts }),
    });
    if (!res.ok) {
      throw new Error(`Ollama embed error ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as OllamaEmbedResponse;
    return data.embeddings;
  }
}

export const ollamaClient = new OllamaClient();
