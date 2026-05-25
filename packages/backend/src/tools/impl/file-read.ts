import { readFileSync } from 'fs';
import { resolve, relative } from 'path';
import type { ToolDef, ToolContext } from '../types.js';

const MAX_BYTES = 100_000;

export const fileReadTool: ToolDef = {
  name: 'file_read',
  description: 'Read the contents of a file inside the workspace. Returns the file text (truncated at 100 KB).',
  safety: 'read',
  parameters: {
    type: 'object',
    required: ['path'],
    properties: {
      path: {
        type: 'string',
        description: 'File path relative to workspace root',
      },
    },
  },
  async execute({ path }, ctx: ToolContext): Promise<string> {
    if (typeof path !== 'string') return JSON.stringify({ error: 'path must be a string' });

    const abs = resolve(ctx.workspaceRoot, path);
    const rel = relative(ctx.workspaceRoot, abs);
    if (rel.startsWith('..')) {
      return JSON.stringify({ error: 'Path outside workspace root' });
    }

    try {
      const raw = readFileSync(abs);
      const truncated = raw.length > MAX_BYTES;
      const content = raw.subarray(0, MAX_BYTES).toString('utf8');
      return JSON.stringify({ content, truncated, bytes: raw.length });
    } catch (err) {
      return JSON.stringify({ error: (err as NodeJS.ErrnoException).message });
    }
  },
};
