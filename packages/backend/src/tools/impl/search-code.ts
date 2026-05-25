import { execFile } from 'child_process';
import { resolve, relative } from 'path';
import type { ToolDef, ToolContext } from '../types.js';

const MAX_RESULTS = 50;
const TIMEOUT_MS = 10_000;

function runRipgrep(args: string[], cwd: string, signal?: AbortSignal): Promise<string> {
  return new Promise((res, rej) => {
    const child = execFile('rg', args, { cwd, timeout: TIMEOUT_MS, maxBuffer: 1_000_000 }, (err, stdout) => {
      if (err && (err as NodeJS.ErrnoException).code === '1') {
        // rg exits 1 when no matches — that's fine
        res('');
      } else if (err) {
        rej(err);
      } else {
        res(stdout);
      }
    });
    signal?.addEventListener('abort', () => child.kill());
  });
}

export const searchCodeTool: ToolDef = {
  name: 'search_code',
  description: 'Search for a pattern in source files using ripgrep. Returns matching lines with file:line context.',
  safety: 'read',
  parameters: {
    type: 'object',
    required: ['pattern'],
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex or literal pattern to search for',
      },
      path: {
        type: 'string',
        description: 'Restrict search to this subdirectory (relative to workspace root)',
      },
      file_glob: {
        type: 'string',
        description: 'Glob to filter files, e.g. "*.ts" or "**/*.{ts,tsx}"',
      },
      case_sensitive: {
        type: 'boolean',
        description: 'Whether the search is case-sensitive (default false)',
      },
    },
  },
  async execute({ pattern, path, file_glob, case_sensitive }, ctx: ToolContext): Promise<string> {
    if (typeof pattern !== 'string' || !pattern) {
      return JSON.stringify({ error: 'pattern is required' });
    }

    const searchDir =
      typeof path === 'string'
        ? (() => {
            const abs = resolve(ctx.workspaceRoot, path);
            const rel = relative(ctx.workspaceRoot, abs);
            return rel.startsWith('..') ? ctx.workspaceRoot : abs;
          })()
        : ctx.workspaceRoot;

    const args: string[] = [
      '--line-number',
      '--no-heading',
      '--color=never',
      `--max-count=${MAX_RESULTS}`,
    ];

    if (!case_sensitive) args.push('--ignore-case');
    if (typeof file_glob === 'string') args.push('--glob', file_glob);
    args.push('--', pattern, searchDir);

    try {
      const output = await runRipgrep(args, ctx.workspaceRoot, ctx.signal);
      const lines = output.trim().split('\n').filter(Boolean);
      return JSON.stringify({ matches: lines.slice(0, MAX_RESULTS), total: lines.length });
    } catch (err) {
      return JSON.stringify({ error: (err as Error).message });
    }
  },
};
