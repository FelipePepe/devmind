import type { OllamaTool, OllamaToolCall } from '../ollama/types.js';

export interface ToolContext {
  userId: string;
  sessionId: string;
  workspaceRoot: string;
  signal?: AbortSignal;
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema object for parameters (passed directly to Ollama) */
  parameters: OllamaTool['function']['parameters'];
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export type { OllamaToolCall };
