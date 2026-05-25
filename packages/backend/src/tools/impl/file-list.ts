import { readdirSync, statSync } from 'fs';
import { resolve, relative, join } from 'path';
import type { ToolDef, ToolContext } from '../types.js';

interface Entry { name: string; type: 'file' | 'dir'; size?: number }

function listDir(abs: string, workspaceRoot: string, depth: number): Entry[] {
  const entries: Entry[] = [];
  let items: string[];
  try {
    items = readdirSync(abs);
  } catch {
    return entries;
  }

  for (const name of items) {
    if (name.startsWith('.') || name === 'node_modules' || name === 'dist') continue;
    const full = join(abs, name);
    const rel = relative(workspaceRoot, full);
    if (rel.startsWith('..')) continue;
    try {
      const st = statSync(full);
      if (st.isDirectory()) {
        entries.push({ name, type: 'dir' });
        if (depth > 0) {
          const children = listDir(full, workspaceRoot, depth - 1);
          for (const c of children) {
            entries.push({ ...c, name: `${name}/${c.name}` });
          }
        }
      } else {
        entries.push({ name, type: 'file', size: st.size });
      }
    } catch {
      // ignore stat errors
    }
  }
  return entries;
}

export const fileListTool: ToolDef = {
  name: 'file_list',
  description: 'List files and directories inside the workspace. Skips node_modules, dist, and hidden files.',
  safety: 'read',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path relative to workspace root (defaults to ".")',
      },
      depth: {
        type: 'number',
        description: 'Recursion depth (0 = only direct children, default 1)',
      },
    },
  },
  async execute({ path, depth }, ctx: ToolContext): Promise<string> {
    const dir = typeof path === 'string' ? path : '.';
    const maxDepth = typeof depth === 'number' ? Math.min(Math.max(0, Math.floor(depth)), 4) : 1;

    const abs = resolve(ctx.workspaceRoot, dir);
    const rel = relative(ctx.workspaceRoot, abs);
    if (rel.startsWith('..')) {
      return JSON.stringify({ error: 'Path outside workspace root' });
    }

    const entries = listDir(abs, ctx.workspaceRoot, maxDepth);
    return JSON.stringify({ path: dir, entries });
  },
};
