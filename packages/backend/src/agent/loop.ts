import { ollamaClient } from '../ollama/client.js';
import { ToolExecutor } from '../tools/executor.js';
import { logger } from '../logger.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolContext } from '../tools/types.js';
import type { ToolResult } from '../tools/executor.js';
import type { OllamaMessage, ChatStreamParams } from '../ollama/types.js';
import type { ToolCallAuditRepo } from '../db/repos/tool-call-audit.js';
import type { FlagsRepo } from '../db/repos/flags.js';
import type { MetricsRegistry } from '../telemetry/metrics.js';

const MAX_ITERATIONS = 8;

export interface AgentCallbacks {
  onIterationStart?(
    iteration: number,
    model: string,
    messages: OllamaMessage[],
    toolCount: number
  ): Promise<void>;
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
  // Spec 006 — passed through to ToolExecutor for audit log + autonomy gate.
  toolAudit?: ToolCallAuditRepo;
  flags?: FlagsRepo;
  // Spec 010 — metrics instrumentation.
  metrics?: MetricsRegistry;
}

/**
 * Simple deterministic agent loop:
 * 1. Call Ollama with tool definitions
 * 2. If finish_reason === tool_calls → execute tools → append results → repeat
 * 3. If finish_reason === stop (or max iterations reached) → done
 */
export async function runAgentLoop(opts: AgentLoopOptions): Promise<void> {
  const { model, registry, ctx, callbacks, toolAudit, flags, metrics } = opts;
  const executor = new ToolExecutor(registry, toolAudit, flags, metrics);
  const tools = registry.getOllamaTools();

  const messages: OllamaMessage[] = [...opts.messages];
  const loopStart = Date.now();

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (ctx.signal?.aborted) return;

    const params: ChatStreamParams = { model, messages, tools };
    await callbacks.onIterationStart?.(iteration, model, messages, tools.length);
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
      metrics?.recordAgentLoop('error', Date.now() - loopStart);
      await callbacks.onError(err instanceof Error ? err : new Error(String(err)), iteration);
      return;
    }

    // Append assistant turn. We stringify tool args in normalizeToolCall so
    // the executor can JSON.parse them, but some Ollama models (qwen3.6) reject
    // the string form when it shows up again in the conversation history —
    // they expect tool_call.function.arguments to be the original JSON object.
    // Re-parse here so the wire format matches what the model emitted.
    const assistantMsg: OllamaMessage = {
      role: 'assistant',
      content: assistantContent,
      ...(pendingToolCalls.length > 0
        ? {
            tool_calls: pendingToolCalls.map((tc) => {
              let argsForWire: unknown = tc.args;
              try {
                argsForWire = JSON.parse(tc.args);
              } catch {
                // Keep the raw string if it's not valid JSON; Ollama will surface
                // a clearer error than we could here.
              }
              return {
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: argsForWire as string },
              };
            }),
          }
        : {}),
    };
    messages.push(assistantMsg);

    // Some models (e.g. qwen3.6) emit tool_call chunks but finish with
    // reason 'stop' instead of 'tool_calls'. Execute pending tools whenever
    // they exist; only finish when there are genuinely no tools to run.
    if (pendingToolCalls.length === 0) {
      metrics?.recordAgentLoop('success', Date.now() - loopStart);
      await callbacks.onDone(iteration + 1);
      return;
    }
    if (finishReason && finishReason !== 'tool_calls') {
      logger.warn({ finishReason, pendingCount: pendingToolCalls.length, iteration }, 'Agent loop: executing tool calls despite non-tool finish_reason');
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
  metrics?.recordAgentLoop('max_iter', Date.now() - loopStart);
  await callbacks.onDone(MAX_ITERATIONS);
}
