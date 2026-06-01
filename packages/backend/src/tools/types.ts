import type { z } from 'zod';
import type { OllamaTool, OllamaToolCall } from '../ollama/types.js';

export interface ToolContext {
  userId: string;
  sessionId: string;
  workspaceRoot: string;
  projectId?: string;
  /** Agent run that produced this call. Used by the executor to write audit rows. */
  agentRunId?: string;
  /** Trace ID threaded from the originating HTTP request for log correlation. */
  traceId?: string;
  signal?: AbortSignal;
}

/**
 * Spec 006 — runtime classification of a tool's blast radius.
 *
 * - `read`         observes state, never mutates anything.
 * - `write`        creates / modifies project state recoverable via spec-004 snapshots.
 * - `destructive`  spawns processes or makes changes outside the snapshot scope
 *                  (e.g. `run_command` writing to node_modules or git history).
 *
 * The autonomy gate (`tools.autonomy_level=block-destructive`) keys off this field.
 */
export type ToolSafety = 'read' | 'write' | 'destructive';

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema object for parameters (advisory, handed to Ollama). */
  parameters: OllamaTool['function']['parameters'];
  /** Required — spec 006. No default so new tools must declare intent. */
  safety: ToolSafety;
  /**
   * Optional Zod schema enforced by `ToolExecutor` before invoking `execute`.
   * Strongly recommended for `write` and `destructive` tools; read tools may
   * omit it and continue to do ad-hoc argument coercion in the body.
   */
  inputSchema?: z.ZodTypeAny;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export type { OllamaToolCall };
