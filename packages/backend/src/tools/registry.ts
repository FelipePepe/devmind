import type { ToolDef } from './types.js';
import type { OllamaTool } from '../ollama/types.js';

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDef>();

  register(...defs: ToolDef[]): this {
    for (const def of defs) {
      this.tools.set(def.name, def);
    }
    return this;
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  getOllamaTools(): OllamaTool[] {
    return [...this.tools.values()].map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  names(): string[] {
    return [...this.tools.keys()];
  }
}
