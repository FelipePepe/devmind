import { execFile } from 'child_process';
import { resolve, relative } from 'path';
import type { ToolDef, ToolContext } from '../types.js';

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 20_000;

/** Commands allowed to run without explicit user approval. */
const ALLOWLIST: ReadonlySet<string> = new Set([
  'git',
  'node',
  'pnpm',
  'npm',
  'npx',
  'tsc',
  'eslint',
  'prettier',
  'vitest',
  'jest',
  'rg',
  'find',
  'ls',
  'cat',
  'echo',
  'pwd',
  'whoami',
  'which',
  'curl',
  'grep',
  'sed',
  'awk',
  'wc',
  'diff',
]);

function truncate(s: string): string {
  if (s.length <= MAX_OUTPUT) return s;
  return s.slice(0, MAX_OUTPUT) + `\n... (truncated ${s.length - MAX_OUTPUT} bytes)`;
}

export const runCommandTool: ToolDef = {
  name: 'run_command',
  description:
    'Run an allowed shell command inside the workspace. ' +
    'Allowed commands: git, node, pnpm, npm, npx, tsc, eslint, prettier, vitest, jest, rg, find, ls, cat, echo, pwd, diff, grep, etc. ' +
    'Returns stdout and stderr.',
  parameters: {
    type: 'object',
    required: ['command', 'args'],
    properties: {
      command: {
        type: 'string',
        description: 'Executable name (must be in allowlist)',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Arguments to pass to the command',
      },
      cwd: {
        type: 'string',
        description: 'Working directory relative to workspace root (defaults to workspace root)',
      },
    },
  },
  async execute({ command, args, cwd }, ctx: ToolContext): Promise<string> {
    if (typeof command !== 'string') return JSON.stringify({ error: 'command must be a string' });
    if (!Array.isArray(args)) return JSON.stringify({ error: 'args must be an array' });

    const cmd = command.trim();
    if (!ALLOWLIST.has(cmd)) {
      return JSON.stringify({ error: `Command "${cmd}" is not in the allowlist` });
    }

    const workdir =
      typeof cwd === 'string'
        ? (() => {
            const abs = resolve(ctx.workspaceRoot, cwd);
            const rel = relative(ctx.workspaceRoot, abs);
            return rel.startsWith('..') ? ctx.workspaceRoot : abs;
          })()
        : ctx.workspaceRoot;

    const safeArgs = args.map(String);

    return new Promise((res) => {
      const child = execFile(
        cmd,
        safeArgs,
        { cwd: workdir, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT * 2 },
        (err, stdout, stderr) => {
          res(
            JSON.stringify({
              exit_code: (err as NodeJS.ErrnoException | null)?.code ?? 0,
              stdout: truncate(stdout),
              stderr: truncate(stderr),
            })
          );
        }
      );
      ctx.signal?.addEventListener('abort', () => child.kill());
    });
  },
};
