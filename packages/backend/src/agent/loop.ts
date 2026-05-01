import { ollamaClient } from '../ollama/client.js';
import { ToolExecutor } from '../tools/executor.js';
import { logger } from '../logger.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolContext } from '../tools/types.js';
import type { ToolResult } from '../tools/executor.js';
import type { OllamaMessage, ChatStreamParams } from '../ollama/types.js';

const MAX_ITERATIONS = 8;

export interface AgentCallbacks {
  onToken(content: string): Promise<void>;
  onToolCall(name: string, args: string): Promise<void>;
  onToolResult(result: ToolResult): Promise<void>;
  onDone(iterations: number): Promise<void>;
  onError(err: Error, iterations: number): Promise<void>;
}

export interface AgentLoopOptions {
  model: string;
  messages: OllamaMessage[];
  registry: ToolRegistry;
  ctx: ToolContext;
  callbacks: AgentCallbacks;
}

/**
 * Simple deterministic agent loop:
 * 1. Call Ollama with tool definitions
 * 2. If finish_reason === tool_calls → execute tools → append results → repeat
 * 3. If finish_reason === stop (or max iterations reached) → done
 */
export async function runAgentLoop(opts: AgentLoopOptions): Promise<void> {
  const { model, registry, ctx, callbacks } = opts;
  const executor = new ToolExecutor(registry);
  const tools = registry.getOllamaTools();

  const messages: OllamaMessage[] = [...opts.messages];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (ctx.signal?.aborted) return;

    const params: ChatStreamParams = { model, messages, tools };
    let assistantContent = '';
    let finishReason: 'stop' | 'tool_calls' | 'length' | undefined;
    const pendingToolCalls: Array<{ name: string; args: string; id: string }> = [];

    try {
      for await (const chunk of ollamaClient.chatStream(params, ctx.signal)) {
        if (ctx.signal?.aborted) return;

        if (chunk.type === 'text' && chunk.content) {
          assistantContent += chunk.content;
          await callbacks.onToken(chunk.content);
        } else if (chunk.type === 'tool_call' && chunk.tool_call) {
          const tc = chunk.tool_call;
          pendingToolCalls.push({
            id: tc.id,
            name: tc.function.name,
            args: tc.function.arguments,
          });
          await callbacks.onToolCall(tc.function.name, tc.function.arguments);
        } else if (chunk.type === 'done') {
          finishReason = chunk.finish_reason ?? 'stop';
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      logger.error({ err, iteration }, 'Agent loop stream error');
      await callbacks.onError(err instanceof Error ? err : new Error(String(err)), iteration);
      return;
    }

    // Append assistant turn
    const assistantMsg: OllamaMessage = {
      role: 'assistant',
      content: assistantContent,
      ...(pendingToolCalls.length > 0
        ? {
            tool_calls: pendingToolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: tc.args },
            })),
          }
        : {}),
    };
    messages.push(assistantMsg);

    if (finishReason !== 'tool_calls' || pendingToolCalls.length === 0) {
      await callbacks.onDone(iteration + 1);
      return;
    }

    // Execute all tool calls and append results
    for (const tc of pendingToolCalls) {
      if (ctx.signal?.aborted) return;

      const result = await executor.execute(
        { id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.args } },
        ctx
      );

      await callbacks.onToolResult(result);

      messages.push({
        role: 'tool',
        content: result.content,
        tool_call_id: result.tool_call_id,
      });
    }
  }

  // Max iterations reached — treat as done
  logger.warn({ sessionId: ctx.sessionId }, 'Agent loop hit max iterations');
  await callbacks.onDone(MAX_ITERATIONS);
}
