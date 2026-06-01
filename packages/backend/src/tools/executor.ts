import { logger } from '../logger.js';
import type { ToolRegistry } from './registry.js';
import type { ToolContext, ToolDef } from './types.js';
import type { OllamaToolCall } from '../ollama/types.js';
import type { ToolCallAuditRepo, ToolSafety } from '../db/repos/tool-call-audit.js';
import type { FlagsRepo } from '../db/repos/flags.js';

const TOOL_TIMEOUT_MS = 30_000;

export interface ToolResult {
  tool_call_id: string;
  name: string;
  content: string;
  error?: boolean;
}

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    // Spec 006: audit + autonomy gate. Optional for back-compat with any
    // legacy caller (tests, scripts) that still constructs an executor with
    // only the registry — audit writes are skipped in that case and the gate
    // falls back to 'auto'.
    private readonly audit?: ToolCallAuditRepo,
    private readonly flags?: FlagsRepo,
    private readonly projectId?: string
  ) {}

  async execute(call: OllamaToolCall, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.registry.get(call.function.name);

    // ----- 1. Unknown tool -----------------------------------------------
    if (!tool) {
      const errorMsg = `Unknown tool: ${call.function.name}`;
      this.writeFinal(ctx, call.function.name, 'destructive', call.function.arguments, {
        status: 'invalid-args',
        outputExcerpt: errorMsg,
        error: errorMsg,
        durationMs: 0,
      });
      return errorResult(call, { error: errorMsg });
    }

    const safety: ToolSafety = tool.safety;

    // ----- 2. Parse JSON args --------------------------------------------
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(call.function.arguments) as Record<string, unknown>;
    } catch {
      const errorMsg = 'Failed to parse tool arguments';
      this.writeFinal(ctx, tool.name, safety, call.function.arguments, {
        status: 'invalid-args',
        outputExcerpt: errorMsg,
        error: errorMsg,
        durationMs: 0,
      });
      return errorResult(call, { error: errorMsg });
    }

    // ----- 3. Zod input validation ---------------------------------------
    if (tool.inputSchema) {
      const parsed = tool.inputSchema.safeParse(args);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
          code: i.code,
        }));
        const errorMsg = `Invalid arguments for ${tool.name}: ${JSON.stringify(issues)}`;
        this.writeFinal(ctx, tool.name, safety, call.function.arguments, {
          status: 'invalid-args',
          outputExcerpt: errorMsg,
          error: errorMsg,
          durationMs: 0,
        });
        return errorResult(call, { error: errorMsg, issues });
      }
      args = parsed.data as Record<string, unknown>;
    }

    // ----- 4. Autonomy gate ----------------------------------------------
    const autonomy = this.autonomyLevel();

    if (safety === 'destructive' && autonomy === 'block-destructive') {
      const errorMsg = `Tool ${tool.name} blocked by operator policy: tools.autonomy_level=block-destructive`;
      this.writeFinal(ctx, tool.name, safety, call.function.arguments, {
        status: 'blocked',
        outputExcerpt: errorMsg,
        error: errorMsg,
        durationMs: 0,
      });
      return errorResult(call, { error: errorMsg, blocked: true });
    }

    if (safety === 'destructive' && autonomy === 'confirm-destructive') {
      const confirmMsg =
        `⚠ Tool \`${tool.name}\` requires your approval (autonomy_level=confirm-destructive). ` +
        `Args: \`${call.function.arguments}\`. ` +
        `Reply with "yes, run ${tool.name}" to approve or "no" to skip.`;
      this.writeFinal(ctx, tool.name, safety, call.function.arguments, {
        status: 'blocked',
        outputExcerpt: confirmMsg,
        error: confirmMsg,
        durationMs: 0,
      });
      return errorResult(call, { error: confirmMsg, needsConfirmation: true, toolName: tool.name });
    }

    // ----- 5-8. Execute under audit + timeout ----------------------------
    const auditId = this.writeStart(ctx, tool, call.function.arguments);
    const start = Date.now();

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), TOOL_TIMEOUT_MS);
    const signal = mergeSignals(ctx.signal, timeoutController.signal);

    try {
      const content = await tool.execute(args, { ...ctx, signal });
      this.updateFinish(auditId, {
        status: 'ok',
        outputExcerpt: content,
        error: null,
        durationMs: Date.now() - start,
      });
      return { tool_call_id: call.id, name: call.function.name, content };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Tool failed';
      logger.error({ err, tool: call.function.name }, 'Tool execution error');
      this.updateFinish(auditId, {
        status: 'error',
        outputExcerpt: message,
        error: message,
        durationMs: Date.now() - start,
      });
      return errorResult(call, { error: message });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ---------------------------------------------------------------------------
  // Audit + flag helpers — never throw; failures here MUST NOT break the agent.
  // ---------------------------------------------------------------------------

  private autonomyLevel(): 'auto' | 'block-destructive' | 'confirm-destructive' {
    if (!this.flags) return 'auto';
    try {
      // Project-level override takes precedence over the global flag.
      const flagKeys = this.projectId
        ? [`tools.autonomy_level.${this.projectId}`, 'tools.autonomy_level']
        : ['tools.autonomy_level'];

      for (const key of flagKeys) {
        const flag = this.flags.get(key);
        if (!flag) continue;
        let parsed: unknown = flag.value;
        try { parsed = JSON.parse(flag.value); } catch { /* raw string fallback */ }
        if (parsed === 'block-destructive') return 'block-destructive';
        if (parsed === 'confirm-destructive') return 'confirm-destructive';
        return 'auto';
      }
      return 'auto';
    } catch (err) {
      logger.warn({ err }, 'Failed to read tools.autonomy_level flag, defaulting to auto');
      return 'auto';
    }
  }

  private writeStart(ctx: ToolContext, tool: ToolDef, argsJson: string): string | null {
    if (!this.audit) return null;
    try {
      return this.audit.insertStart({
        agentRunId: ctx.agentRunId ?? null,
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        projectId: ctx.projectId ?? null,
        toolName: tool.name,
        safety: tool.safety,
        argsJson,
      });
    } catch (err) {
      logger.warn({ err, tool: tool.name }, 'tool audit insertStart failed');
      return null;
    }
  }

  private writeFinal(
    ctx: ToolContext,
    toolName: string,
    safety: ToolSafety,
    argsJson: string,
    final: { status: 'invalid-args' | 'blocked'; outputExcerpt: string; error: string | null; durationMs: number }
  ): void {
    if (!this.audit) return;
    try {
      this.audit.insertFinal({
        agentRunId: ctx.agentRunId ?? null,
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        projectId: ctx.projectId ?? null,
        toolName,
        safety,
        argsJson,
        ...final,
      });
    } catch (err) {
      logger.warn({ err, tool: toolName }, 'tool audit insertFinal failed');
    }
  }

  private updateFinish(
    id: string | null,
    patch: { status: 'ok' | 'error'; outputExcerpt: string; error: string | null; durationMs: number }
  ): void {
    if (!this.audit || !id) return;
    try {
      this.audit.updateFinish(id, patch);
    } catch (err) {
      logger.warn({ err }, 'tool audit updateFinish failed');
    }
  }
}

function errorResult(call: OllamaToolCall, body: Record<string, unknown>): ToolResult {
  return {
    tool_call_id: call.id,
    name: call.function.name,
    content: JSON.stringify(body),
    error: true,
  };
}

function mergeSignals(parent: AbortSignal | undefined, timeout: AbortSignal): AbortSignal {
  if (!parent) return timeout;
  const merged = new AbortController();
  parent.addEventListener('abort', () => merged.abort());
  timeout.addEventListener('abort', () => merged.abort());
  return merged.signal;
}
