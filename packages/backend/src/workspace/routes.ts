import { Hono } from 'hono';
import { readdirSync, statSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, relative, join, extname } from 'path';
import { authMiddleware } from '../auth/middleware.js';
import { config } from '../config.js';
import type { HonoEnv } from '../types.js';

const MAX_FILE_SIZE = 200 * 1024;

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
}

function listDir(abs: string, workspaceRoot: string, depth: number, basePath = ''): FileEntry[] {
  const entries: FileEntry[] = [];
  let items: string[];
  try { items = readdirSync(abs).sort(); } catch { return entries; }

  for (const name of items) {
    if (name.startsWith('.') || name === 'node_modules' || name === 'dist' || name === '__pycache__') continue;
    const full = join(abs, name);
    const rel = relative(workspaceRoot, full);
    if (rel.startsWith('..')) continue;
    const path = basePath ? `${basePath}/${name}` : name;
    try {
      const st = statSync(full);
      if (st.isDirectory()) {
        entries.push({ name, path, type: 'dir' });
        if (depth > 0) {
          for (const c of listDir(full, workspaceRoot, depth - 1, path)) {
            entries.push(c);
          }
        }
      } else {
        entries.push({ name, path, type: 'file', size: st.size });
      }
    } catch { /* ignore */ }
  }
  return entries;
}

const TEXT_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h',
  '.json', '.yaml', '.yml', '.toml', '.env',
  '.md', '.txt', '.sh', '.sql', '.html', '.css', '.scss',
  '.xml', '.csv', '.lock', '.gitignore', '.dockerfile',
]);

export function createWorkspaceRouter(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  if (!existsSync(config.WORKSPACE_ROOT)) {
    mkdirSync(config.WORKSPACE_ROOT, { recursive: true });
  }

  router.get('/info', authMiddleware, (c) => {
    return c.json({ root: config.WORKSPACE_ROOT });
  });

  router.get('/files', authMiddleware, (c) => {
    const pathParam = c.req.query('path') ?? '.';
    const depth = Math.min(parseInt(c.req.query('depth') ?? '2', 10), 4);

    const abs = resolve(config.WORKSPACE_ROOT, pathParam);
    if (relative(config.WORKSPACE_ROOT, abs).startsWith('..')) {
      return c.json({ error: 'Path outside workspace' }, 400);
    }

    const entries = listDir(abs, config.WORKSPACE_ROOT, depth);
    return c.json({ path: pathParam, root: config.WORKSPACE_ROOT, entries });
  });

  router.get('/file', authMiddleware, (c) => {
    const filePath = c.req.query('path');
    if (!filePath) return c.json({ error: 'path required' }, 400);

    const abs = resolve(config.WORKSPACE_ROOT, filePath);
    if (relative(config.WORKSPACE_ROOT, abs).startsWith('..')) {
      return c.json({ error: 'Path outside workspace' }, 400);
    }
    if (!existsSync(abs)) return c.json({ error: 'File not found' }, 404);

    const st = statSync(abs);
    if (st.isDirectory()) return c.json({ error: 'Path is a directory' }, 400);
    if (st.size > MAX_FILE_SIZE) return c.json({ error: 'File too large', size: st.size }, 400);

    const ext = extname(filePath).toLowerCase();
    if (!TEXT_EXTS.has(ext)) return c.json({ error: 'Binary file' }, 400);

    const content = readFileSync(abs, 'utf8');
    return c.json({ path: filePath, content, size: st.size });
  });

  return router;
}
