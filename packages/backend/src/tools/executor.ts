import { logger } from '../logger.js';
import type { ToolRegistry } from './registry.js';
import type { ToolContext } from './types.js';
import type { OllamaToolCall } from '../ollama/types.js';

const TOOL_TIMEOUT_MS = 30_000;

export interface ToolResult {
  tool_call_id: string;
  name: string;
  content: string;
  error?: boolean;
}

export class ToolExecutor {
  constructor(private readonly registry: ToolRegistry) {}

  async execute(call: OllamaToolCall, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.registry.get(call.function.name);

    if (!tool) {
      return {
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify({ error: `Unknown tool: ${call.function.name}` }),
        error: true,
      };
    }

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(call.function.arguments) as Record<string, unknown>;
    } catch {
      return {
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify({ error: 'Failed to parse tool arguments' }),
        error: true,
      };
    }

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), TOOL_TIMEOUT_MS);

    // Merge parent signal with timeout signal
    const signal =
      ctx.signal
        ? (() => {
            const merged = new AbortController();
            ctx.signal!.addEventListener('abort', () => merged.abort());
            timeoutController.signal.addEventListener('abort', () => merged.abort());
            return merged.signal;
          })()
        : timeoutController.signal;

    try {
      const content = await tool.execute(args, { ...ctx, signal });
      return { tool_call_id: call.id, name: call.function.name, content };
    } catch (err) {
      logger.error({ err, tool: call.function.name }, 'Tool execution error');
      return {
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify({ error: err instanceof Error ? err.message : 'Tool failed' }),
        error: true,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
